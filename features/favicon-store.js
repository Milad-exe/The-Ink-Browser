'use strict';
/**
 * Persistent host → favicon (data-URL) cache.
 *
 * Favicons are fetched ONLY when you actually visit a site (remember(), driven by
 * page-favicon-updated in tabs.js) — a request to a site you're already connected
 * to. Everything else (omnibox suggestions, bookmark bar, bookmarks/history lists)
 * reads from this cache via getForHost() and makes NO network request: a host we
 * haven't visited simply shows a letter placeholder. This keeps typing in the
 * omnibox from firing a favicon request to every suggested (and possibly never-
 * visited) domain — which, besides the privacy win, avoids hammering sites like
 * github.com on each keystroke.
 *
 * Bounded (MAX_HOSTS, rough LRU by insertion order) and mirrored to disk
 * (debounced) so it survives restarts.
 */
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');

const MAX_HOSTS = 1000;      // ~1000 data-URLs ≈ a few MB on disk/in memory
const FETCH_CAP = 256 * 1024; // ignore anything larger than a real favicon
const store = new Map();     // host → data-URL
const inflight = new Set();  // hosts currently being fetched (dedupe)
let loaded = false;
let saveTimer = null;

function file() {
    return path.join(app.getPath('userData'), 'northstar', 'favicons.json');
}
function load() {
    if (loaded)
        return;
    loaded = true;
    try {
        const obj = JSON.parse(fs.readFileSync(file(), 'utf-8'));
        for (const [h, d] of Object.entries(obj))
            store.set(h, d);
    }
    catch { }
}
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.mkdirSync(path.dirname(file()), { recursive: true });
            fs.writeFileSync(file(), JSON.stringify(Object.fromEntries(store)));
        }
        catch { }
    }, 3000);
}
/** Cached favicon for a host, or '' — never triggers a fetch. */
function getForHost(host) {
    load();
    return (host && store.get(host)) || '';
}
/** Fetch one URL over Electron's net stack → data: URL (or '' on any failure). */
function fetchDataUrl(url) {
    return new Promise((resolve) => {
        if (!/^https?:\/\//i.test(url))
            return resolve('');
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        try {
            const req = net.request({ url, useSessionCookies: false });
            const chunks = [];
            let total = 0, ctype = '';
            req.on('response', (res) => {
                const s = res.statusCode || 0;
                ctype = String(res.headers['content-type'] || res.headers['Content-Type'] || '');
                if (s < 200 || s >= 300 || !ctype.includes('image')) {
                    res.on('data', () => { });
                    res.on('end', () => finish(''));
                    return;
                }
                res.on('data', (c) => {
                    total += c.length;
                    if (total > FETCH_CAP) { try { req.abort(); } catch { } return finish(''); }
                    chunks.push(c);
                });
                res.on('end', () => {
                    if (!chunks.length)
                        return finish('');
                    const mime = (ctype.split(';')[0] || '').trim() || 'image/x-icon';
                    finish(`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`);
                });
            });
            req.on('error', () => finish(''));
            req.on('abort', () => finish(''));
            setTimeout(() => finish(''), 8000);
            req.end();
        }
        catch { finish(''); }
    });
}
/**
 * Remember the favicon for a page you actually visited. faviconUrl is the site's
 * declared icon (page-favicon-updated); falls back to <origin>/favicon.ico.
 * No-op if the host is already cached (favicons rarely change).
 */
async function remember(pageUrl, faviconUrl) {
    let host, ico;
    try {
        const u = new URL(pageUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return;
        host = u.host;
        ico = (faviconUrl && /^https?:\/\//i.test(faviconUrl)) ? faviconUrl : `${u.origin}/favicon.ico`;
    }
    catch { return; }
    if (!host)
        return;
    load();
    if (store.has(host)) {
        // Touch for rough LRU (move to newest) — no refetch.
        const v = store.get(host);
        store.delete(host);
        store.set(host, v);
        return;
    }
    if (inflight.has(host))
        return;
    inflight.add(host);
    try {
        const data = await fetchDataUrl(ico);
        if (data) {
            store.set(host, data);
            while (store.size > MAX_HOSTS) {
                const oldest = store.keys().next().value;
                store.delete(oldest);
            }
            save();
        }
    }
    finally {
        inflight.delete(host);
    }
}

module.exports = { getForHost, remember };
