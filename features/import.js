'use strict';
/**
 * Import from another browser — detection and readers.
 *
 * Covers the browsers a first-run import wizard is expected to find:
 *   • Chromium family — Chrome (+ Beta/Dev/Canary), Edge (+ Beta/Dev), Brave,
 *     Vivaldi, Opera, Opera GX, Chromium. Every profile is enumerated with its
 *     real display name (read from the browser's `Local State`), not just Default.
 *   • Firefox — every profile in profiles.ini, bookmarks AND history read from
 *     places.sqlite. The active default profile is surfaced first.
 *   • Safari (macOS only) — bookmarks from Bookmarks.plist (via `plutil`) and
 *     history from History.db.
 *
 * Data types: bookmarks, history and search engines are read straight off disk
 * here. PASSWORDS are deliberately NOT decrypted — every browser wraps them with
 * the OS keystore, so they come in through the CSV export/import path instead.
 *
 * Everything is dependency-free: JSON for Chromium bookmarks, the runtime's
 * built-in `node:sqlite` for every SQLite store, a tiny INI/HTML/plist reader for
 * the rest.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const log = require('./log');

const HOME = os.homedir();
const PLATFORM = process.platform;

function exists(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/**
 * Open a SQLite store a browser may be holding a lock on: copy it (plus its -wal
 * and -shm sidecars) to a temp file, run `fn(db)`, then delete the copies.
 */
function withSqliteCopy(dbPath, fn) {
    const { DatabaseSync } = require('node:sqlite');
    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2);
    const tmp = path.join(os.tmpdir(), 'ns-imp-' + stamp);
    const copies = [];
    try {
        fs.copyFileSync(dbPath, tmp);
        copies.push(tmp);
        for (const ext of ['-wal', '-shm'])
            if (exists(dbPath + ext)) { fs.copyFileSync(dbPath + ext, tmp + ext); copies.push(tmp + ext); }
        const db = new DatabaseSync(tmp);
        try { return fn(db); }
        finally { db.close(); }
    }
    finally {
        for (const f of copies) { try { fs.unlinkSync(f); } catch (e) { /* temp cleanup */ } }
    }
}

function countBookmarks(tree) {
    let n = 0;
    for (const node of tree || []) {
        if (node.type === 'folder') n += countBookmarks(node.children);
        else if (node.url) n++;
    }
    return n;
}

/* ── Chromium family ─────────────────────────────────────────────────────── */

// Every Chromium-based browser's user-data directory, per OS. The base is the
// "User Data" dir that holds Local State and the profile folders (for Opera it
// is the profile itself).
function chromiumBrowsers() {
    const out = [];
    const add = (browser, base) => out.push({ browser, base });
    if (PLATFORM === 'win32') {
        const L = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
        const R = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
        add('Google Chrome', path.join(L, 'Google', 'Chrome', 'User Data'));
        add('Chrome Beta', path.join(L, 'Google', 'Chrome Beta', 'User Data'));
        add('Chrome Dev', path.join(L, 'Google', 'Chrome Dev', 'User Data'));
        add('Chrome Canary', path.join(L, 'Google', 'Chrome SxS', 'User Data'));
        add('Microsoft Edge', path.join(L, 'Microsoft', 'Edge', 'User Data'));
        add('Edge Beta', path.join(L, 'Microsoft', 'Edge Beta', 'User Data'));
        add('Edge Dev', path.join(L, 'Microsoft', 'Edge Dev', 'User Data'));
        add('Brave', path.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data'));
        add('Brave Beta', path.join(L, 'BraveSoftware', 'Brave-Browser-Beta', 'User Data'));
        add('Vivaldi', path.join(L, 'Vivaldi', 'User Data'));
        add('Chromium', path.join(L, 'Chromium', 'User Data'));
        add('Opera', path.join(R, 'Opera Software', 'Opera Stable'));
        add('Opera GX', path.join(R, 'Opera Software', 'Opera GX Stable'));
    }
    else if (PLATFORM === 'darwin') {
        const A = path.join(HOME, 'Library', 'Application Support');
        add('Google Chrome', path.join(A, 'Google', 'Chrome'));
        add('Chrome Beta', path.join(A, 'Google', 'Chrome Beta'));
        add('Chrome Canary', path.join(A, 'Google', 'Chrome Canary'));
        add('Microsoft Edge', path.join(A, 'Microsoft Edge'));
        add('Edge Beta', path.join(A, 'Microsoft Edge Beta'));
        add('Brave', path.join(A, 'BraveSoftware', 'Brave-Browser'));
        add('Vivaldi', path.join(A, 'Vivaldi'));
        add('Chromium', path.join(A, 'Chromium'));
        add('Opera', path.join(A, 'com.operasoftware.Opera'));
        add('Opera GX', path.join(A, 'com.operasoftware.OperaGX'));
    }
    else {
        const C = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
        add('Google Chrome', path.join(C, 'google-chrome'));
        add('Chrome Beta', path.join(C, 'google-chrome-beta'));
        add('Chromium', path.join(C, 'chromium'));
        add('Microsoft Edge', path.join(C, 'microsoft-edge'));
        add('Brave', path.join(C, 'BraveSoftware', 'Brave-Browser'));
        add('Vivaldi', path.join(C, 'vivaldi'));
        add('Opera', path.join(C, 'opera'));
        add('Opera GX', path.join(C, 'opera-gx'));
    }
    return out.filter(b => exists(b.base));
}

// The profiles inside one Chromium base, with their friendly display names.
function chromiumProfiles(base) {
    let info = {};
    try {
        const ls = path.join(base, 'Local State');
        if (exists(ls)) info = readJson(ls)?.profile?.info_cache || {};
    }
    catch (e) { log.debug('import', 'local state', e); }
    const dirs = new Set();
    try {
        for (const e of fs.readdirSync(base, { withFileTypes: true }))
            if (e.isDirectory() && (e.name === 'Default' || /^Profile /.test(e.name))) dirs.add(e.name);
    }
    catch (e) { log.debug('import', 'profiles readdir', e); }
    // Opera keeps Bookmarks/History at the base itself, with no profile folder.
    if (dirs.size === 0 && (exists(path.join(base, 'Bookmarks')) || exists(path.join(base, 'History'))))
        return [{ dir: '', name: 'Default' }];
    for (const k of Object.keys(info)) if (k) dirs.add(k);
    const out = [];
    for (const dir of dirs) out.push({ dir, name: (info[dir] && info[dir].name) || dir });
    return out.length ? out : [{ dir: 'Default', name: 'Default' }];
}

/** A Chromium Bookmarks file (plain JSON) → our bookmark tree. */
function readChromiumBookmarks(bmPath) {
    const data = readJson(bmPath);
    const roots = data.roots || {};
    const conv = (node) => {
        if (!node) return null;
        if (node.type === 'folder' || Array.isArray(node.children))
            return { type: 'folder', title: String(node.name || 'Folder'), children: (node.children || []).map(conv).filter(Boolean) };
        if (node.type === 'url' && node.url && /^https?:/i.test(node.url))
            return { type: 'bookmark', title: String(node.name || node.url), url: node.url };
        return null;
    };
    const tree = [];
    if (roots.bookmark_bar) tree.push(...(roots.bookmark_bar.children || []).map(conv).filter(Boolean));
    if (roots.other && (roots.other.children || []).length)
        tree.push({ type: 'folder', title: 'Other bookmarks', children: (roots.other.children || []).map(conv).filter(Boolean) });
    if (roots.synced && (roots.synced.children || []).length)
        tree.push({ type: 'folder', title: 'Mobile bookmarks', children: (roots.synced.children || []).map(conv).filter(Boolean) });
    return tree;
}

/**
 * A Chromium History database → [{ url, title, lastVisit (ms epoch), visitCount }].
 * last_visit_time is microseconds since 1601, which overflows a JS number, so
 * integer columns are read as BigInt and converted.
 */
function readChromiumHistory(historyDbPath, limit = 5000) {
    return withSqliteCopy(historyDbPath, (db) => {
        const stmt = db.prepare(
            "SELECT url, title, last_visit_time, visit_count FROM urls " +
            "WHERE url LIKE 'http://%' OR url LIKE 'https://%' ORDER BY last_visit_time DESC LIMIT ?"
        );
        stmt.setReadBigInts(true);
        const rows = stmt.all(limit);
        const EPOCH_1601_TO_1970_MS = 11644473600000n;
        return rows.map(r => ({
            url: r.url,
            title: r.title || '',
            lastVisit: r.last_visit_time ? Number(BigInt(r.last_visit_time) / 1000n - EPOCH_1601_TO_1970_MS) : Date.now(),
            visitCount: Number(r.visit_count || 1n),
        }));
    });
}

/** A Chromium `Web Data` store → user-added search engines, as our engine shape. */
function readChromiumEngines(webDataPath) {
    try {
        return withSqliteCopy(webDataPath, (db) => {
            let rows = [];
            try { rows = db.prepare('SELECT short_name, keyword, url, prepopulate_id FROM keywords').all(); }
            catch (e) { return []; }
            const out = [];
            for (const r of rows) {
                if (r.prepopulate_id && Number(r.prepopulate_id) > 0) continue; // a built-in engine, not user-added
                let url = String(r.url || '');
                if (!url.includes('{searchTerms}')) continue;
                url = url.replace(/\{searchTerms\}/g, '%s').replace(/\{[^}]*\}/g, ''); // drop the other template params
                if (!/^https?:/i.test(url)) continue;
                out.push({
                    name: String(r.short_name || r.keyword || url).slice(0, 40),
                    keyword: String(r.keyword || '').trim().toLowerCase().slice(0, 12),
                    url,
                });
            }
            return out;
        });
    }
    catch (e) { log.debug('import', 'engines', e); return []; }
}

/* ── Firefox ─────────────────────────────────────────────────────────────── */

function firefoxBase() {
    if (PLATFORM === 'win32') return path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Mozilla', 'Firefox');
    if (PLATFORM === 'darwin') return path.join(HOME, 'Library', 'Application Support', 'Firefox');
    return path.join(HOME, '.mozilla', 'firefox');
}

function parseIni(text) {
    const out = {};
    let cur = null;
    for (let line of String(text).split(/\r?\n/)) {
        line = line.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const sec = /^\[(.+)\]$/.exec(line);
        if (sec) { cur = sec[1]; out[cur] = {}; continue; }
        const eq = line.indexOf('=');
        if (eq > 0 && cur) out[cur][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return out;
}

function firefoxProfiles() {
    const base = firefoxBase();
    const ini = path.join(base, 'profiles.ini');
    if (!exists(ini)) return [];
    let cfg;
    try { cfg = parseIni(fs.readFileSync(ini, 'utf8')); }
    catch (e) { log.debug('import', 'profiles.ini', e); return []; }
    // The genuinely active profile is the one named in [InstallXXXX].Default.
    let defaultPath = null;
    for (const [sec, v] of Object.entries(cfg))
        if (/^Install/i.test(sec) && v.Default) defaultPath = v.Default;
    const out = [];
    for (const [sec, v] of Object.entries(cfg)) {
        if (!/^Profile\d+$/i.test(sec) || !v.Path) continue;
        const rel = v.IsRelative === '1' || v.IsRelative === undefined;
        const dir = rel ? path.join(base, v.Path) : v.Path;
        const isDefault = (defaultPath && v.Path === defaultPath) || (!defaultPath && v.Default === '1');
        out.push({ dir, name: v.Name || path.basename(dir), isDefault });
    }
    out.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
    return out;
}

// Firefox keeps bookmarks and history together in places.sqlite. Roots are the
// fixed ids toolbar (3), menu (2) and unfiled (5); mobile is found by guid.
function readFirefoxBookmarks(placesPath) {
    return withSqliteCopy(placesPath, (db) => {
        const places = new Map();
        for (const r of db.prepare('SELECT id, url FROM moz_places').all()) places.set(r.id, r.url);
        const rows = db.prepare('SELECT id, parent, type, title, fk FROM moz_bookmarks ORDER BY parent, position').all();
        const byParent = new Map();
        for (const r of rows) {
            if (!byParent.has(r.parent)) byParent.set(r.parent, []);
            byParent.get(r.parent).push(r);
        }
        const build = (parentId) => {
            const out = [];
            for (const k of byParent.get(parentId) || []) {
                if (k.type === 2)
                    out.push({ type: 'folder', title: String(k.title || 'Folder'), children: build(k.id) });
                else if (k.type === 1) {
                    const url = places.get(k.fk);
                    if (url && /^https?:/i.test(url)) out.push({ type: 'bookmark', title: String(k.title || url), url });
                }
            }
            return out;
        };
        const tree = [];
        tree.push(...build(3)); // Bookmarks Toolbar → top level
        const menu = build(2);
        if (menu.length) tree.push({ type: 'folder', title: 'Bookmarks Menu', children: menu });
        const unfiled = build(5);
        if (unfiled.length) tree.push({ type: 'folder', title: 'Other Bookmarks', children: unfiled });
        try {
            const m = db.prepare("SELECT id FROM moz_bookmarks WHERE guid = 'mobile______'").get();
            if (m) { const mob = build(m.id); if (mob.length) tree.push({ type: 'folder', title: 'Mobile Bookmarks', children: mob }); }
        }
        catch (e) { log.debug('import', 'ff mobile', e); }
        return tree;
    });
}

function firefoxBookmarkCount(placesPath) {
    try { return withSqliteCopy(placesPath, (db) => Number(db.prepare('SELECT COUNT(*) c FROM moz_bookmarks WHERE type = 1').get().c)); }
    catch (e) { log.debug('import', 'ff count', e); return 0; }
}

// Firefox last_visit_date is microseconds since the UNIX epoch (not 1601).
function readFirefoxHistory(placesPath, limit = 5000) {
    return withSqliteCopy(placesPath, (db) => {
        const stmt = db.prepare(
            "SELECT url, title, last_visit_date, visit_count FROM moz_places " +
            "WHERE last_visit_date IS NOT NULL AND (url LIKE 'http://%' OR url LIKE 'https://%') " +
            "ORDER BY last_visit_date DESC LIMIT ?"
        );
        stmt.setReadBigInts(true);
        const rows = stmt.all(limit);
        return rows.map(r => ({
            url: r.url,
            title: r.title || '',
            lastVisit: r.last_visit_date ? Number(BigInt(r.last_visit_date) / 1000n) : Date.now(),
            visitCount: Number(r.visit_count || 1n),
        }));
    });
}

/* ── Safari (macOS only) ─────────────────────────────────────────────────── */

function safariSources() {
    if (PLATFORM !== 'darwin') return [];
    const base = path.join(HOME, 'Library', 'Safari');
    const bm = path.join(base, 'Bookmarks.plist');
    const hist = path.join(base, 'History.db');
    if (!exists(bm) && !exists(hist)) return [];
    return [{
        id: 'safari||default', kind: 'safari', browser: 'Safari', profile: 'Default',
        bookmarks: exists(bm) ? null : 0, history: exists(hist), passwords: false, engines: false,
        _paths: { bookmarks: exists(bm) ? bm : null, history: exists(hist) ? hist : null },
    }];
}

// Safari's Bookmarks.plist is a binary plist; `plutil` (present on every Mac)
// converts it to JSON we can walk.
function readSafariBookmarks(plistPath) {
    const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    const data = JSON.parse(json);
    const conv = (node) => {
        if (!node) return null;
        if (node.WebBookmarkType === 'WebBookmarkTypeList')
            return { type: 'folder', title: String(node.Title || 'Folder'), children: (node.Children || []).map(conv).filter(Boolean) };
        if (node.WebBookmarkType === 'WebBookmarkTypeLeaf' && node.URLString && /^https?:/i.test(node.URLString))
            return { type: 'bookmark', title: String((node.URIDictionary && node.URIDictionary.title) || node.URLString), url: node.URLString };
        return null;
    };
    return (data.Children || []).map(conv).filter(Boolean);
}

// Safari visit_time is CFAbsoluteTime — seconds since 2001-01-01 UTC.
function readSafariHistory(dbPath, limit = 5000) {
    return withSqliteCopy(dbPath, (db) => {
        const stmt = db.prepare(
            'SELECT hi.url AS url, hv.title AS title, hv.visit_time AS visit_time ' +
            'FROM history_items hi JOIN history_visits hv ON hv.history_item = hi.id ' +
            "WHERE hi.url LIKE 'http%' ORDER BY hv.visit_time DESC LIMIT ?"
        );
        const rows = stmt.all(limit);
        const CF_EPOCH_TO_UNIX_S = 978307200;
        return rows.map(r => ({
            url: r.url,
            title: r.title || '',
            lastVisit: Math.round((Number(r.visit_time) + CF_EPOCH_TO_UNIX_S) * 1000),
            visitCount: 1,
        }));
    });
}

/* ── HTML (any browser's export) ─────────────────────────────────────────── */

function decodeEntities(s) {
    return String(s || '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'")
        .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch (e) { return _; } });
}

/** A Netscape bookmark HTML file → our bookmark tree. Nested folders preserved. */
function parseHtmlBookmarks(html) {
    const root = { children: [] };
    const stack = [root];
    let pendingFolder = null;
    const re = /<h3[^>]*>([\s\S]*?)<\/h3>|<a\s+[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<dl[^>]*>|<\/dl>/gi;
    let m;
    while ((m = re.exec(html))) {
        if (m[1] !== undefined) {
            pendingFolder = { type: 'folder', title: decodeEntities(m[1].trim()) || 'Folder', children: [] };
            stack[stack.length - 1].children.push(pendingFolder);
        }
        else if (m[2] !== undefined) {
            const url = m[2];
            if (/^https?:/i.test(url))
                stack[stack.length - 1].children.push({ type: 'bookmark', title: decodeEntities((m[3] || '').trim()) || url, url });
        }
        else if (/^<dl/i.test(m[0])) {
            stack.push(pendingFolder || stack[stack.length - 1]);
            pendingFolder = null;
        }
        else if (stack.length > 1) {
            stack.pop();
        }
    }
    return root.children;
}

/* ── Detection (all families) ────────────────────────────────────────────── */

// Detection copies SQLite stores off disk, so cache it briefly: the wizard asks
// for the list and then, a moment later, imports from one of the ids.
let _cache = null;
let _cacheAt = 0;

function detectSources() {
    if (_cache && Date.now() - _cacheAt < 4000) return _cache;
    const out = [];
    // Chromium
    for (const { browser, base } of chromiumBrowsers()) {
        for (const prof of chromiumProfiles(base)) {
            const pdir = path.join(base, prof.dir);
            const bm = path.join(pdir, 'Bookmarks');
            const hist = path.join(pdir, 'History');
            const logins = path.join(pdir, 'Login Data');
            const web = path.join(pdir, 'Web Data');
            let count = 0;
            try { if (exists(bm)) count = countBookmarks(readChromiumBookmarks(bm)); }
            catch (e) { log.debug('import', 'detect bm', e); }
            const hasHistory = exists(hist);
            if (count === 0 && !hasHistory) continue;
            out.push({
                id: `chromium|${browser}|${prof.dir}`, kind: 'chromium', browser, profile: prof.name || 'Default',
                bookmarks: count, history: hasHistory, passwords: exists(logins), engines: exists(web),
                _paths: { bookmarks: exists(bm) ? bm : null, history: hasHistory ? hist : null, logins, webdata: exists(web) ? web : null },
            });
        }
    }
    // Firefox
    for (const prof of firefoxProfiles()) {
        const places = path.join(prof.dir, 'places.sqlite');
        if (!exists(places)) continue;
        out.push({
            id: `firefox|${prof.dir}`, kind: 'firefox', browser: 'Firefox', profile: prof.name || 'default',
            bookmarks: firefoxBookmarkCount(places), history: true,
            passwords: exists(path.join(prof.dir, 'logins.json')), engines: false,
            _paths: { places },
        });
    }
    // Safari
    out.push(...safariSources());
    _cache = out;
    _cacheAt = Date.now();
    return out;
}

/** Detected sources without the internal on-disk paths — safe to send to a renderer. */
function listSources() {
    return detectSources().map(({ _paths, ...pub }) => pub);
}

function findSource(id) {
    return detectSources().find(s => s.id === id) || null;
}

/* ── Readers dispatched by source kind ───────────────────────────────────── */

function getBookmarks(source) {
    if (!source) return [];
    const p = source._paths || {};
    if (source.kind === 'chromium') return p.bookmarks && exists(p.bookmarks) ? readChromiumBookmarks(p.bookmarks) : [];
    if (source.kind === 'firefox') return exists(p.places) ? readFirefoxBookmarks(p.places) : [];
    if (source.kind === 'safari') return p.bookmarks && exists(p.bookmarks) ? readSafariBookmarks(p.bookmarks) : [];
    return [];
}

function getHistory(source, limit) {
    if (!source) return [];
    const p = source._paths || {};
    if (source.kind === 'chromium') return p.history && exists(p.history) ? readChromiumHistory(p.history, limit) : [];
    if (source.kind === 'firefox') return exists(p.places) ? readFirefoxHistory(p.places, limit) : [];
    if (source.kind === 'safari') return p.history && exists(p.history) ? readSafariHistory(p.history, limit) : [];
    return [];
}

function getEngines(source) {
    if (!source) return [];
    const p = source._paths || {};
    if (source.kind === 'chromium' && p.webdata && exists(p.webdata)) return readChromiumEngines(p.webdata);
    return [];
}

module.exports = {
    detectSources, listSources, findSource,
    getBookmarks, getHistory, getEngines,
    readChromiumBookmarks, readChromiumHistory, readChromiumEngines,
    readFirefoxBookmarks, readFirefoxHistory,
    parseHtmlBookmarks, countBookmarks,
};
