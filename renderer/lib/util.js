/**
 * Browser chrome — pure helpers.
 *
 * Split out of renderer/renderer.js: these are the parts with no DOM and no
 * shared state, which is exactly what makes them testable (tests/unit.js
 * requires this file directly — hence the UMD-ish wrapper).
 *
 * The omnibox ranking rules live here rather than in the address-bar code
 * because they encode judgements — "is this typed text a URL or a search",
 * "is this history hit worth showing" — that are much easier to argue about
 * against a list of examples than by driving the UI.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.Ink = root.Ink || {};
    root.Ink.util = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    /** Trailing-edge debounce with a .cancel(). */
    function debounce(fn, delay = 150) {
        let timer = null;
        const wrapped = (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
        wrapped.cancel = () => clearTimeout(timer);
        return wrapped;
    }

    /** Does the typed text look like a URL/domain rather than a search? */
    function looksLikeUrl(q) {
        if (/^https?:\/\//i.test(q))
            return true;
        if (/\s/.test(q))
            return false;
        // bare domain / host[:port][/path] — needs a dot with a TLD-ish tail
        return /^[^\s/]+\.[a-z]{2,}([:/].*)?$/i.test(q) || /^localhost([:/].*)?$/i.test(q);
    }

    /** Dedup key: host (without www) + path, lowercased, no trailing slash. */
    function normalizeUrl(u) {
        try {
            const n = new URL(u);
            return (n.hostname.replace(/^www\./, '') + n.pathname).toLowerCase().replace(/\/$/, '');
        }
        catch {
            return (u || '').toLowerCase();
        }
    }

    /**
     * Relevance rank for a history/bookmark/tab entry against the query.
     * Lower is better; -1 means "not relevant enough, hide it".
     *
     * This is what stops noise like `gymshark.com` / `spotify.com` showing for
     * "y" just because the letter appears somewhere inside them — a bare
     * substring only counts once the query is at least 3 chars long.
     */
    function linkScore(item, ql) {
        let host = '', path = '';
        const title = (item.title || '').toLowerCase();
        try {
            const u = new URL(item.url);
            host = u.hostname.replace(/^www\./, '').toLowerCase();
            path = (u.pathname + u.search).toLowerCase();
        }
        catch {
            host = (item.url || '').toLowerCase();
        }
        if (host.startsWith(ql))
            return 0; // youtube.com for "you"
        if (host.split('.').some(l => l.startsWith(ql)))
            return 1; // sub-label: m.youtube.com
        if (title.split(/[\s\-–—_/|:.()]+/).some(w => w.startsWith(ql)))
            return 2; // title word start
        if (ql.length >= 3 && (host.includes(ql) || title.includes(ql) || path.includes(ql)))
            return 3;
        return -1;
    }

    /**
     * Firefox surfaces clean, high-frecency pages — not OAuth/sign-in redirects
     * or giant tracking URLs. We lack visit counts, so approximate: a weak match
     * (title/substring only, score ≥ 2) that lands on a login redirect or a long
     * param-heavy URL is almost never what the user wants. Strong host matches
     * (score < 2, e.g. youtube.com/watch?v=…) are always kept.
     */
    function isLowValueMatch(url, score) {
        if (score < 2)
            return false;
        const u = url || '';
        if (u.length > 90)
            return true;
        if (/[?&](continue|dsh|ifkv|flowName|flowEntry|checkConnection|gclid|gclsrc|gad_)/i.test(u))
            return true;
        if (/\/(signin|oauth2?|auth|login|challenge)\b/i.test(u))
            return true;
        return false;
    }

    /** Lower = cleaner: short URLs with a real title sort ahead of long/untitled ones. */
    function cleanliness(item) {
        const hasTitle = item.title && item.title !== item.url;
        return (item.url || '').length + (hasTitle ? 0 : 40);
    }

    /**
     * Parse `url` into [dimmed prefix, host, dimmed rest] for the resting
     * address-bar display; null if it isn't a plain displayable http(s) URL.
     *
     * Splits the RAW string, not the parsed origin — IDN hosts, uppercase
     * schemes and credential forms would otherwise fall back to domain-only and
     * make the rest of the URL vanish from the bar.
     */
    function urlDisplayParts(url) {
        let u;
        try {
            u = new URL(url);
        }
        catch {
            return null;
        }
        if (u.protocol !== 'https:' && u.protocol !== 'http:')
            return null;
        const m = String(url).match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^/?#@]*@)?)([^/?#]+)([\s\S]*)$/);
        return m ? [m[1], m[2], m[3]] : null;
    }

    /**
     * The engine a leading keyword selects (`w electron` → the Wikipedia
     * engine), or null. A bare keyword with no query is just a search for that
     * word, so it does not match.
     */
    function keywordEngine(text, engines) {
        const raw = String(text || '');
        const i = raw.indexOf(' ');
        if (i <= 0 || !raw.slice(i + 1).trim())
            return null;
        const head = raw.slice(0, i).toLowerCase();
        return (engines || []).find(e => e.keyword && e.keyword === head) || null;
    }

    /** Search URL for typed text, honouring a leading engine keyword. */
    function searchUrl(text, engines, defaultId) {
        const list = (engines && engines.length) ? engines : [];
        const raw = String(text || '').trim();
        const via = keywordEngine(raw, list);
        const engine = via || list.find(e => e.id === defaultId) || list[0];
        if (!engine)
            return '';
        const query = via ? raw.slice(raw.indexOf(' ') + 1).trim() : raw;
        return String(engine.url).replace(/%s/g, encodeURIComponent(query));
    }

    /**
     * How wide the sidebar is allowed to be, for a window of `winW`.
     *
     * The limits scale with the window (measured off the reference: ~10.5% at
     * its narrowest, ~29.6% at its widest) with absolute floors so it stays
     * usable on a small screen.
     */
    function sidebarLimits(winW) {
        const w = Number(winW) || 0;
        if (!w)
            return { min: 180, max: 460 };
        return {
            min: Math.max(178, Math.round(w * 0.105)),
            max: Math.max(320, Math.round(w * 0.296)),
        };
    }

    /**
     * The width the sidebar should actually take for a pointer at `px`.
     *
     * ONE rule, used by the drag in the chrome AND by the main process when the
     * pointer crosses over the page view mid-drag. They used to disagree — the
     * chrome collapsed to a 56px rail below 132 while main refused to go under
     * its minimum — so dragging narrow kept shrinking the sidebar visually past
     * the point where the page stopped moving.
     */
    function clampSidebarWidth(px, winW) {
        const { min, max } = sidebarLimits(winW);
        const w = Math.round(Number(px) || min);
        return Math.max(min, Math.min(max, w));
    }

    return {
        debounce, looksLikeUrl, normalizeUrl, linkScore, isLowValueMatch,
        cleanliness, urlDisplayParts, keywordEngine, searchUrl,
        sidebarLimits, clampSidebarWidth,
    };
});
