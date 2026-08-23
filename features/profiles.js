'use strict';
/**
 * Profiles — Chrome-style separate browsing selves.
 *
 * A profile is WHO you are: its own cookies/logins, its own history, its own
 * bookmarks + Essentials, its own containers, and its own THEME — a window
 * belongs to one profile, so it wears that profile's colours (null follows the
 * global setting). Settings and extensions stay shared across profiles
 * (per-profile extensions is heavy and rarely wanted). Each window belongs to one profile; the toolbar switcher opens (or
 * focuses) a window per profile.
 *
 * Layering: a profile (features/containers.js) is WHICH ACCOUNT on one site,
 * *inside* a profile. Profile 1 ("Personal") maps to the app's original default
 * session and legacy store files, so existing users keep logins/history with no
 * migration; every other profile gets its own persist: partition hardened
 * exactly like a profile session, plus its own store files.
 */
const log = require('./log');
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

let _reg = null; // { nextId, list: [{id,name,color,essentials:[{url,title,profile}]}] }
function file() { return path.join(app.getPath('userData'), 'northstar', 'profiles.json'); }

function load() {
    if (_reg)
        return _reg;
    try {
        const raw = JSON.parse(fs.readFileSync(file(), 'utf-8'));
        if (raw && Array.isArray(raw.list) && raw.list.length) {
            // Carry the global essentials through — rebuilding from nextId+list
            // alone would drop them on every launch.
            _reg = { nextId: Number(raw.nextId) || (raw.list.length + 1), list: raw.list };
            if (Array.isArray(raw.essentials)) {
                _reg.essentials = raw.essentials;
                // Essentials written before the rename use `container`.
                for (const e of _reg.essentials)
                    if (e && e.container !== undefined && e.profile === undefined) { e.profile = e.container; delete e.container; }
            }
            return _reg;
        }
    }
    catch (e) { log.debug('profiles', 'load', e); }
    _reg = { nextId: 2, list: [{ id: '1', name: 'Personal', color: COLORS[0], emoji: EMOJIS[0], essentials: [] }] };
    save();
    return _reg;
}

function save() {
    try {
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), JSON.stringify(_reg, null, 2));
    }
    catch (e) { log.debug('profiles', 'save', e); }
}

function _find(id) { return load().list.find(p => p.id === String(id)) || null; }

/* `theme` is the space's own theme id, or null to follow the global setting.
   A window belongs to one space, so this is what that window wears — see
   features/theme-runtime.js. */
const _pub = (p) => ({ id: p.id, name: p.name, color: p.color, emoji: p.emoji || null, container: p.container || null, theme: p.theme || null });
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
    // theme: a theme id this space wears, or null to follow the global setting.
    if (patch && 'theme' in patch)
        p.theme = patch.theme ? String(patch.theme) : null;
    if (patch && 'container' in patch) {
        const v = patch.container;
        p.container = (v === null || v === undefined || v === '') ? null : String(v);
        sessions.delete(String(id)); // drop the memoised session for this space
    }
    save();
    return _pub(p);
}

// Set the order spaces appear in (the foot row, and the switcher shortcuts).
function reorder(ids) {
    const reg = load();
    const wanted = (ids || []).map(String);
    const byId = new Map(reg.list.map(p => [p.id, p]));
    const ordered = wanted.map(id => byId.get(id)).filter(Boolean);
    if (ordered.length !== reg.list.length)
        return false; // stale list — ignore rather than drop a space
    reg.list = ordered;
    save();
    return true;
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
 * existing cookies survive); others get a persist: partition with the profile
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
    catch (e) { log.debug('profiles', 'if', e); }
    try { downloadManager.attach(sess); }
    catch (e) { log.debug('profiles', 'if', e); }
    for (const [pid, f] of [
        [`chrome-spoof-prof-${key}`, 'chrome-spoof.js'],
        [`adblock-cosmetic-prof-${key}`, 'ad-block-cosmetic.js'],
    ]) {
        try {
            sess.registerPreloadScript({ type: 'frame', id: pid, filePath: path.join(__dirname, '../preload', f) });
        }
        catch (e) { log.debug('profiles', 'for', e); }
    }
    sessions.set(key, sess);
    return sess;
}

/**
 * Delete a space and wipe its cookie jar. Refuses the last remaining space, and
 * refuses profile 1 outright — it IS the default session, so removing it would
 * take the browser's main storage with it.
 *
 * A space bound to a container shares that container's jar with other spaces, so
 * only an unbound space's own persist:profile-<id> partition is cleared.
 */
function remove(id) {
    const key = String(id);
    const reg = load();
    if (key === '1' || reg.list.length <= 1)
        return false;
    const i = reg.list.findIndex(p => p.id === key);
    if (i === -1)
        return false;
    const [gone] = reg.list.splice(i, 1);
    sessions.delete(key);
    save();
    if (!gone.container) {
        try {
            const { session } = require('electron');
            session.fromPartition(`persist:profile-${key}`).clearStorageData();
        }
        catch (e) { log.debug('profiles', 'if', e); }
    }
    return true;
}

// ── Essentials (global across spaces; the big favicon tiles) ─────────────────
// Essentials are GLOBAL across spaces — unlike pinned tabs, which are
// per-space. They used to be stored per profile, so the first read folds any
// old per-profile lists into the shared one (de-duped) and drops them.
const ESSENTIALS_MAX = 12;
function _essentials() {
    const reg = load();
    if (!Array.isArray(reg.essentials)) {
        const seen = new Set();
        reg.essentials = [];
        for (const p of reg.list) {
            for (const e of (p.essentials || [])) {
                const key = `${e.url}|${e.profile || ''}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                reg.essentials.push({ ...e });
            }
            delete p.essentials;
        }
        save();
    }
    return reg.essentials;
}
// The id argument is kept so existing per-window callers still work; Essentials
// no longer vary by space.
function essentials(_id) {
    // `home` is what "go back to its page" uses; unset means the Essential's
    // own url, so old entries keep working without a migration.
    return _essentials().map(e => ({ ...e, home: e.home || e.url }));
}
function addEssential(_id, e) {
    if (!e || !e.url)
        return false;
    const list = _essentials();
    if (list.some(x => x.url === e.url && (x.profile || null) === (e.profile || null)))
        return false;
    if (list.length >= ESSENTIALS_MAX)
        return false;
    list.push({ url: e.url, title: e.title || e.url, profile: e.profile || null });
    save();
    return true;
}
/**
 * The page an Essential goes back to.
 *
 * An Essential IS a tab: you click it, you land in its tab, and you can browse
 * away inside it. `home` is where "go back to its page" returns you, and it is
 * editable — an Essential added from a deep link can be pointed at the site's
 * front page instead, or vice versa. It defaults to the url the Essential was
 * created from, which stays its identity key.
 */
function setEssentialHome(_id, url, profile, home) {
    const e = _essentials().find(x => x.url === url && (x.profile || null) === (profile || null));
    if (!e)
        return false;
    const next = String(home || '').trim();
    if (next && !/^https?:\/\//i.test(next))
        return false;
    e.home = next || null;   // null → falls back to the Essential's own url
    save();
    return true;
}
// A static icon pinned to an Essential, overriding the live favicon (upstream
// behaviour: an Essential's icon does not change when the site's does).
function setEssentialIcon(_id, url, profile, icon) {
    const e = _essentials().find(x => x.url === url && (x.profile || null) === (profile || null));
    if (!e)
        return false;
    e.icon = (icon || '').trim().slice(0, 8) || null;
    save();
    return true;
}
function removeEssential(_id, url, profile = null) {
    const list = _essentials();
    const i = list.findIndex(x => x.url === url && (x.profile || null) === (profile || null));
    if (i === -1)
        return false;
    list.splice(i, 1);
    save();
    return true;
}

module.exports = { list, meta, create, remove, reorder, rename, update, sessionFor, essentials, addEssential, removeEssential, setEssentialIcon, setEssentialHome, COLORS, EMOJIS };
