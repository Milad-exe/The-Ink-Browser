/**
 * IPC handlers — browsing history.
 *
 * History is stored by Features/history.js and accessed here read-only
 * (writes happen inside Features/tabs.js as pages load).
 */
const log = require('../features/log');
const { isPlaceholderTitle } = require('../features/history');
function register(ipcMain, { wm }) {
    ipcMain.handle('history-get', async (_e) => {
        try {
            return await wm.historyFor(wm.profileOf(_e.sender)).loadHistory();
        }
        catch {
            return [];
        }
    });
    ipcMain.handle('history-search', async (_e, query, limit = 50) => {
        try {
            const items = await wm.historyFor(wm.profileOf(_e.sender)).loadHistory();
            if (!query?.trim())
                return [];
            const q = query.trim().toLowerCase();
            // Score once per entry, THEN sort — scoring inside the comparator
            // recomputed both scores on every comparison (O(n log n) rescans).
            const scored = [];
            for (const e of items) {
                if (isSearchResultUrl(e.url))
                    continue;
                if (!(e.title || '').toLowerCase().includes(q) &&
                    !(e.url || '').toLowerCase().includes(q))
                    continue;
                scored.push([relevanceScore(e, q), e]);
            }
            scored.sort((a, b) => b[0] - a[0]);
            // Entries written before titles were recorded properly still carry
            // the URL-shaped placeholder. Blank it on the way out rather than
            // rewriting the store: the row then falls back to showing the url
            // once instead of twice, and fixes itself on the next visit.
            return scored.slice(0, limit).map(([, e]) => (
                isPlaceholderTitle(e.title, e.url) ? { ...e, title: '' } : e
            ));
        }
        catch (err) {
            console.error('history-search:', err);
            return [];
        }
    });
    ipcMain.handle('remove-history-entry', async (_e, url, timestamp) => {
        try {
            return await wm.historyFor(wm.profileOf(_e.sender)).removeFromHistory(url, timestamp);
        }
        catch {
            return false;
        }
    });
    ipcMain.handle('open-history-tab', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (wd?.tabs)
            wd.tabs.openInternalPage('history');
    });
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function isSearchResultUrl(rawUrl) {
    if (!rawUrl)
        return false;
    try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        const p = u.pathname.toLowerCase();
        const ps = u.searchParams;
        if (host.includes('google.') && (p.startsWith('/search') || p.startsWith('/url') || ps.has('q')))
            return true;
        if (host.includes('bing.com') && (p.startsWith('/search') || ps.has('q')))
            return true;
        if (host.includes('duckduckgo.com') && ps.has('q'))
            return true;
        if (p.includes('/search') && ps.has('q'))
            return true;
    }
    catch (e) { log.debug('history', 'isSearchResultUrl', e); }
    return false;
}
/**
 * Rank a history entry against the typed query.
 *
 * Higher is better. Two things drive it, in this order:
 *
 *   WHERE the query matched. A hit on the host beats a hit buried in a path or
 *   a title — typing "youtube.com" means the site, not a video you happened to
 *   watch on it.
 *
 *   HOW DEEP the URL is. The bare domain outranks a deep link on the same host,
 *   which is what was wrong before: every youtube.com URL scored identically on
 *   "contains the query", so the ordering fell through to insertion order and
 *   the list filled with /shorts/ links while youtube.com itself was nowhere.
 *
 * Recency stays, but only as a nudge — it cannot lift a random deep link above
 * the domain the user actually typed.
 */
function relevanceScore(entry, q) {
    const t = (entry.title || '').toLowerCase();
    const raw = (entry.url || '');
    const u = raw.toLowerCase();
    let host = '', pathAndQuery = '';
    try {
        const parsed = new URL(raw);
        host = parsed.hostname.replace(/^www\./, '').toLowerCase();
        pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
    }
    catch {
        host = u;
    }
    const bareQuery = q.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

    let score = 0;
    if (host === bareQuery)
        score += 600;             // youtube.com for "youtube.com"
    else if (host.startsWith(bareQuery))
        score += 450;             // youtube.com for "you"
    else if (host.includes(bareQuery))
        score += 250;             // m.youtube.com for "youtube"
    if (t.startsWith(q))
        score += 120;
    else if (t.includes(q))
        score += 60;
    if (!score && pathAndQuery.includes(q))
        score += 30;              // last resort: it only matched deep in the url

    // Depth. "/" is the front door; every extra segment is further from what
    // someone typing a bare domain asked for. Capped so a deep link is pushed
    // below the root without being pushed out of the list entirely.
    const depth = pathAndQuery.split('/').filter(Boolean).length;
    score -= Math.min(depth, 6) * 25;
    if (pathAndQuery === '' || pathAndQuery === '/')
        score += 90;
    // A query string is nearly always a session artefact, not a destination.
    if (pathAndQuery.includes('?'))
        score -= 30;
    // An untitled entry is one we know less about; prefer the one we can name.
    if (!entry.title)
        score -= 15;

    const ts = Date.parse(entry.timestamp || entry.date || 0);
    if (!isNaN(ts)) {
        const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
        if (days < 1)
            score += 12;
        else if (days < 7)
            score += 6;
    }
    return score;
}

module.exports = { register };