'use strict';
/**
 * Containers — named, colour-coded, reusable isolated sessions (Firefox
 * Multi-Account Containers).
 *
 * A "container" is a persistent identity (name + colour + optional glyph) backed
 * by its own Electron session on a persist: partition. Unlike private tabs
 * (in-memory, wiped on close) a container's cookies/storage SURVIVE, so you stay
 * signed in. Tabs in the SAME container share that jar; tabs in DIFFERENT
 * containers (or the default, un-contained tabs) are fully independent.
 *
 * This is what stops one tab's session "carrying over" to another for sites that
 * key everything off cookies (SuccessFactors, Salesforce, any multi-tenant SaaS):
 * open the same site in two containers and you get two truly separate logins that
 * never clobber each other, no matter which tab you switch to.
 *
 * The identity list is persisted to userData/northstar/containers.json; each
 * session gets the same hardening a private session does (UA + client-hints +
 * privacy headers + ad blocking + downloads + chrome-spoof), but with PERSISTENT
 * permission decisions — it behaves like a normal tab with its own jar.
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { setup } = require('./private-session');
const adBlocker = require('./ad-blocker');
const downloadManager = require('./download-manager');

const sessions = new Map(); // container id (string) → Electron Session

// A fixed accent palette new containers cycle through (also the manager's swatches).
const COLORS = ['#e0894a', '#4a9eff', '#3fbf7f', '#c86fe0', '#e05a7a', '#e0c341', '#5ad0d0', '#9a7bff'];
// Optional single-glyph icons that fit the mono aesthetic ('' = colour dot only).
const ICONS = ['', '●', '◆', '★', '⬢', '▲', '⚑', '⬤'];

// ── Registry (persisted identities) ───────────────────────────────────────────
let _registry = null; // { nextId, list: [{id,name,color,icon}] }
function file() { return path.join(app.getPath('userData'), 'northstar', 'containers.json'); }

const DEFAULTS = () => ({
    nextId: 4,
    list: [
        { id: '1', name: 'Personal', color: COLORS[0], icon: '' },
        { id: '2', name: 'Work', color: COLORS[1], icon: '' },
        { id: '3', name: 'Banking', color: COLORS[2], icon: '' },
    ],
});

function load() {
    if (_registry)
        return _registry;
    try {
        const raw = JSON.parse(fs.readFileSync(file(), 'utf-8'));
        if (raw && Array.isArray(raw.list)) {
            _registry = { nextId: Number(raw.nextId) || (raw.list.length + 1), list: raw.list };
            return _registry;
        }
    }
    catch { }
    _registry = DEFAULTS();
    save();
    return _registry;
}

function save() {
    try {
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), JSON.stringify(_registry, null, 2));
    }
    catch { }
}

/** All container identities (safe copies). */
function list() {
    return load().list.map(c => ({ ...c }));
}

/** Identity for an id, or null. */
function meta(id) {
    if (id == null)
        return null;
    const c = load().list.find(x => x.id === String(id));
    return c ? { ...c } : null;
}

function _sanitizeColor(color) {
    return (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : null;
}

/** Create a new container identity. Returns it. */
function create({ name, color, icon } = {}) {
    const reg = load();
    const id = String(reg.nextId++);
    const c = {
        id,
        name: (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 24) : `Container ${id}`,
        color: _sanitizeColor(color) || COLORS[(reg.list.length) % COLORS.length],
        icon: ICONS.includes(icon) ? icon : '',
    };
    reg.list.push(c);
    save();
    return { ...c };
}

/** Patch an existing container's name/color/icon. Returns the updated meta or null. */
function update(id, patch = {}) {
    const reg = load();
    const c = reg.list.find(x => x.id === String(id));
    if (!c)
        return null;
    if (typeof patch.name === 'string' && patch.name.trim())
        c.name = patch.name.trim().slice(0, 24);
    const col = _sanitizeColor(patch.color);
    if (col)
        c.color = col;
    if (patch.icon !== undefined && ICONS.includes(patch.icon))
        c.icon = patch.icon;
    save();
    return { ...c };
}

/** Delete a container identity and wipe its stored data. */
function remove(id) {
    const reg = load();
    const key = String(id);
    const i = reg.list.findIndex(x => x.id === key);
    if (i === -1)
        return false;
    reg.list.splice(i, 1);
    save();
    // Wipe the jar so a future container with the same numeric id can't inherit it.
    try {
        const sess = sessions.get(key) || require('electron').session.fromPartition(`persist:container-${key}`);
        sess.clearStorageData();
        sess.clearCache();
    }
    catch { }
    sessions.delete(key);
    return true;
}

// ── Sessions ──────────────────────────────────────────────────────────────────
/** Get (creating once) the persistent session for a container id. */
function get(id) {
    const key = String(id);
    if (sessions.has(key))
        return sessions.get(key);
    const { session } = require('electron');
    const sess = session.fromPartition(`persist:container-${key}`);
    setup(sess, { persist: true });
    try { adBlocker.enableBlockingInSession(sess); }
    catch { }
    try { downloadManager.attach(sess); }
    catch { }
    for (const [pid, f] of [
        [`chrome-spoof-ctr-${key}`, 'chrome-spoof.js'],
        [`adblock-cosmetic-ctr-${key}`, 'ad-block-cosmetic.js'],
    ]) {
        try {
            sess.registerPreloadScript({ type: 'frame', id: pid, filePath: path.join(__dirname, '../preload', f) });
        }
        catch { }
    }
    sessions.set(key, sess);
    return sess;
}

/** The colour for a container id (from its identity, else palette fallback). */
function colorFor(id) {
    const m = meta(id);
    if (m)
        return m.color;
    const n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
    return COLORS[n % COLORS.length];
}

module.exports = { get, colorFor, list, meta, create, update, remove, COLORS, ICONS };
