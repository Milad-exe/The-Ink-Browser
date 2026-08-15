'use strict';
/**
 * Profiles — Chrome-style separate browsing selves.
 *
 * A profile is WHO you are: its own cookies/logins, its own history, its own
 * bookmarks + Essentials, its own personas. Settings, theme, and extensions
 * stay shared across profiles (per-profile extensions is heavy and rarely
 * wanted). Each window belongs to one profile; the toolbar switcher opens (or
 * focuses) a window per profile.
 *
 * Layering: a persona (features/containers.js) is WHICH ACCOUNT on one site,
 * *inside* a profile. Profile 1 ("Personal") maps to the app's original default
 * session and legacy store files, so existing users keep logins/history with no
 * migration; every other profile gets its own persist: partition hardened
 * exactly like a persona session, plus its own store files.
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { setup } = require('./private-session');
const adBlocker = require('./ad-blocker');
const downloadManager = require('./download-manager');

const COLORS = ['#e0894a', '#4a9eff', '#3fbf7f', '#c86fe0', '#e05a7a', '#e0c341', '#5ad0d0', '#9a7bff'];
// Default per-profile emoji avatars; a profile can clear its emoji (→ coloured dot).
const EMOJIS = ['🏠', '💼', '🎨', '🚀', '🌙', '🎧', '🐙', '🔥'];
const sessions = new Map(); // profile id → Electron Session (non-default only)

let _reg = null; // { nextId, list: [{id,name,color,essentials:[{url,title,persona}]}] }
function file() { return path.join(app.getPath('userData'), 'northstar', 'profiles.json'); }

function load() {
    if (_reg)
        return _reg;
    try {
        const raw = JSON.parse(fs.readFileSync(file(), 'utf-8'));
        if (raw && Array.isArray(raw.list) && raw.list.length) {
            _reg = { nextId: Number(raw.nextId) || (raw.list.length + 1), list: raw.list };
            return _reg;
        }
    }
    catch { }
    _reg = { nextId: 2, list: [{ id: '1', name: 'Personal', color: COLORS[0], emoji: EMOJIS[0], essentials: [] }] };
    save();
    return _reg;
}

function save() {
    try {
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), JSON.stringify(_reg, null, 2));
    }
    catch { }
}

function _find(id) { return load().list.find(p => p.id === String(id)) || null; }

const _pub = (p) => ({ id: p.id, name: p.name, color: p.color, emoji: p.emoji || null, container: p.container || null });
function list() { return load().list.map(_pub); }
function meta(id) { const p = _find(id); return p ? _pub(p) : null; }

function create(name) {
    const reg = load();
    const id = String(reg.nextId++);
    const p = {
        id,
        name: (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 24) : `Profile ${id}`,
        color: COLORS[reg.list.length % COLORS.length],
        emoji: EMOJIS[reg.list.length % EMOJIS.length],
        essentials: [],
    };
    reg.list.push(p);
    save();
    return _pub(p);
}

// Update a profile's name and/or emoji. Pass emoji '' to clear it (→ dot).
function update(id, patch) {
    const p = _find(id);
    if (!p)
        return null;
    if (patch && typeof patch.name === 'string' && patch.name.trim())
        p.name = patch.name.trim().slice(0, 24);
    if (patch && 'emoji' in patch)
        p.emoji = (patch.emoji || '').trim().slice(0, 8) || null;
    // container: a named container id whose cookie jar this space uses, 'default'
    // for the shared session, or null to keep the space's own jar. Changing it
    // repoints where logins live, so it only takes effect on the next session
    // lookup (callers re-open/switch the space).
    if (patch && 'container' in patch) {
        const v = patch.container;
        p.container = (v === null || v === undefined || v === '') ? null : String(v);
        sessions.delete(String(id)); // drop the memoised session for this space
    }
    save();
    return _pub(p);
}

function rename(id, name) {
    const p = _find(id);
    if (!p)
        return null;
    if (typeof name === 'string' && name.trim())
        p.name = name.trim().slice(0, 24);
    save();
    return _pub(p);
}

/**
 * The browsing session for a profile. Profile 1 IS the default session (so
 * existing cookies survive); others get a persist: partition with the persona
 * hardening stack (UA + headers + ad blocking + downloads + spoof preloads).
 */
function sessionFor(id) {
    const key = String(id);
    const { session } = require('electron');
    // A space bound to a Profile takes that container's jar instead of its own,
    // so two spaces on the same container share one login set. Spaces created
    // before this existed have no binding and keep their own jar.
    const bound = _find(key)?.container;
    if (bound) {
        if (bound === 'default')
            return session.defaultSession;
        const containers = require('./containers');
        return containers.get(bound);
    }
    if (key === '1')
        return session.defaultSession;
    if (sessions.has(key))
        return sessions.get(key);
    const sess = session.fromPartition(`persist:profile-${key}`);
    setup(sess, { persist: true });
    try { adBlocker.enableBlockingInSession(sess); }
    catch { }
    try { downloadManager.attach(sess); }
    catch { }
    for (const [pid, f] of [
        [`chrome-spoof-prof-${key}`, 'chrome-spoof.js'],
        [`adblock-cosmetic-prof-${key}`, 'ad-block-cosmetic.js'],
    ]) {
        try {
            sess.registerPreloadScript({ type: 'frame', id: pid, filePath: path.join(__dirname, '../preload', f) });
        }
        catch { }
    }
    sessions.set(key, sess);
    return sess;
}

// ── Essentials (per profile; pinned favourites) ───────────────────────────────
function essentials(id) {
    const p = _find(id);
    return p ? (p.essentials || []).map(e => ({ ...e })) : [];
}
function addEssential(id, e) {
    const p = _find(id);
    if (!p || !e || !e.url)
        return false;
    p.essentials = p.essentials || [];
    if (p.essentials.some(x => x.url === e.url && (x.persona || null) === (e.persona || null)))
        return false;
    p.essentials.push({ url: e.url, title: e.title || e.url, persona: e.persona || null });
    save();
    return true;
}
function removeEssential(id, url, persona = null) {
    const p = _find(id);
    if (!p || !p.essentials)
        return false;
    const i = p.essentials.findIndex(x => x.url === url && (x.persona || null) === (persona || null));
    if (i === -1)
        return false;
    p.essentials.splice(i, 1);
    save();
    return true;
}

module.exports = { list, meta, create, rename, update, sessionFor, essentials, addEssential, removeEssential, COLORS, EMOJIS };
