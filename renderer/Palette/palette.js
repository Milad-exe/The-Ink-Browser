"use strict";
// Command palette. Opens BEFORE a tab exists: typing here is what creates the
// tab, so there is no empty new-tab page to land on first. Runs in its own
// WebContentsView because the page is composited over the chrome.
//
// It is a file:// page, so it gets the internal bridges (tab, browserHistory,
// browserBookmarks) and can resolve a query and open the result itself.
(() => {
    const surface = document.getElementById('surface');
    const input = document.getElementById('q');
    const results = document.getElementById('results');
    let rows = [];
    let sel = -1;

    const looksLikeUrl = (s) => /^[a-z]+:\/\//i.test(s) ||
        /^[\w-]+(\.[\w-]+)+(\/|$|:\d)/.test(s) ||
        /^(localhost|northstar:)/i.test(s);
    const toUrl = (s) => {
        const q = s.trim();
        if (!q) return null;
        if (/^[a-z]+:/i.test(q)) return q;
        if (looksLikeUrl(q)) return 'https://' + q;
        return 'https://www.google.com/search?q=' + encodeURIComponent(q);
    };

    const paint = () => {
        results.innerHTML = '';
        rows.forEach((r, i) => {
            const b = document.createElement('button');
            b.className = 'row' + (i === sel ? ' sel' : '');
            b.setAttribute('role', 'option');
            const fb = document.createElement('span');
            fb.className = 'fallback';
            try { fb.textContent = new URL(r.url).hostname.replace(/^www\./, '').charAt(0).toUpperCase(); }
            catch { fb.textContent = '·'; }
            b.appendChild(fb);
            const t = document.createElement('span');
            t.className = 't';
            t.textContent = r.title || r.url;
            b.appendChild(t);
            if (r.badge) {
                const g = document.createElement('span');
                g.className = 'badge';
                g.textContent = r.badge;
                b.appendChild(g);
            }
            const u = document.createElement('span');
            u.className = 'u';
            u.textContent = r.url;
            b.appendChild(u);
            b.addEventListener('click', () => go(r.url));
            results.appendChild(b);
        });
    };

    // The first row is always what Enter does, so the query's own destination
    // leads and history/bookmarks follow.
    const refresh = async () => {
        const q = input.value.trim();
        rows = [];
        if (!q) {
            // Opening the prompt with nothing typed used to show an empty box.
            // Recent pages make it useful the moment it appears, and give the
            // arrow keys something to act on.
            try {
                const recent = (await window.browserHistory.recent()) || [];
                for (const h of recent) {
                    if (!h?.url || rows.some(r => r.url === h.url)) continue;
                    rows.push({ url: h.url, title: h.title || h.url, badge: 'Recent' });
                    if (rows.length >= 6) break;
                }
            }
            catch { }
        }
        if (q) {
            const direct = toUrl(q);
            rows.push({
                url: direct,
                title: looksLikeUrl(q) || /^[a-z]+:/i.test(q) ? q : `Search for “${q}”`,
                badge: looksLikeUrl(q) || /^[a-z]+:/i.test(q) ? 'Open' : 'Search',
            });
            try {
                const hits = (await window.browserHistory.search(q, 6)) || [];
                for (const h of hits) {
                    if (!h?.url || rows.some(r => r.url === h.url)) continue;
                    rows.push({ url: h.url, title: h.title || h.url, badge: 'History' });
                }
            }
            catch { }
            try {
                const marks = (await window.browserBookmarks.getAll()) || [];
                for (const m of marks) {
                    if (!m?.url || rows.some(r => r.url === m.url)) continue;
                    const hay = `${m.title || ''} ${m.url}`.toLowerCase();
                    if (!hay.includes(q.toLowerCase())) continue;
                    rows.push({ url: m.url, title: m.title || m.url, badge: 'Bookmark' });
                    if (rows.length > 10) break;
                }
            }
            catch { }
        }
        sel = rows.length ? 0 : -1;
        paint();
    };

    const go = async (url) => {
        if (!url) return;
        try {
            const idx = await window.tab.add();
            if (typeof idx === 'number') window.tab.loadUrl(idx, url);
        }
        catch { }
        window.overlayPalette.done();
    };

    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 90);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); window.overlayPalette.dismiss(); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const pick = sel >= 0 && rows[sel] ? rows[sel].url : toUrl(input.value);
            go(pick);
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!rows.length) return;
            sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
            paint();
        }
    });
    surface.addEventListener('mousedown', (e) => {
        if (!document.getElementById('card').contains(e.target)) window.overlayPalette.dismiss();
    });

    window.overlayPalette.onOpen(() => {
        input.value = '';
        rows = [];
        sel = -1;
        paint();
        // refresh() only ran on input before, so opening the prompt always
        // showed an empty box — now the empty query has recents to list.
        refresh();
        setTimeout(() => input.focus(), 0);
    });
})();
