'use strict';
/**
 * Container sessions — persistent, isolated cookie jars you can put a tab in.
 *
 * A "container" is a named/numbered Electron session on a persist: partition, so
 * unlike private tabs (in-memory, wiped on close) its cookies/storage SURVIVE:
 * you stay signed in. Tabs in the SAME container share that session; tabs in
 * DIFFERENT containers (or the default, un-contained tabs) are fully independent.
 *
 * This is what stops one tab's session "carrying over" to another for sites that
 * key everything off cookies (SuccessFactors, Salesforce, any multi-tenant SaaS):
 * open the same site in two containers and you get two truly separate logins that
 * never clobber each other, no matter which tab you switch to.
 *
 * Each container session gets the same hardening a private session does (UA +
 * client-hints + privacy headers + ad blocking + downloads + chrome-spoof), but
 * with PERSISTENT permission decisions — it behaves like a normal tab that just
 * happens to have its own jar.
 */
const path = require('path');
const { setup } = require('./private-session');
const adBlocker = require('./ad-blocker');
const downloadManager = require('./download-manager');

const sessions = new Map(); // container id (string) → Electron Session

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
    for (const [pid, file] of [
        [`chrome-spoof-ctr-${key}`, 'chrome-spoof.js'],
        [`adblock-cosmetic-ctr-${key}`, 'ad-block-cosmetic.js'],
    ]) {
        try {
            sess.registerPreloadScript({ type: 'frame', id: pid, filePath: path.join(__dirname, '../preload', file) });
        }
        catch { }
    }
    sessions.set(key, sess);
    return sess;
}

// A small, fixed accent palette so container tabs are visually distinguishable
// (the id is mapped to a colour in the renderer via containerColor()).
const COLORS = ['#e0894a', '#4a9eff', '#3fbf7f', '#c86fe0', '#e05a7a', '#e0c341', '#5ad0d0', '#9a7bff'];
function colorFor(id) {
    const n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
    return COLORS[n % COLORS.length];
}

module.exports = { get, colorFor, COLORS };
