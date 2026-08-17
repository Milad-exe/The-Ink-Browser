/**
 * Northstar — being (and behaving like) a default browser
 *
 * Two halves, and both are needed for the feature to mean anything:
 *  1. REGISTER as a handler for http/https so the OS lists Northstar at all.
 *     The OS still decides — macOS asks the user, Windows opens its Default Apps
 *     pane — so `status()` reports what is actually true rather than what we
 *     asked for.
 *  2. ACCEPT the links the OS then hands over. Without this half the app would
 *     be chosen as the default browser and then swallow every link: macOS
 *     delivers them through 'open-url', Windows and Linux as an argv entry on a
 *     second launch, and either can also arrive in the very first argv.
 */
'use strict';
const path = require('path');
const { app } = require('electron');
const log = require('./log');
const { sanitizeUrl } = require('./url-security');

const SCHEMES = ['http', 'https'];

/** An unpackaged run has to point the OS at electron + this app's path. */
function clientArgs() {
    return (process.defaultApp && process.argv.length >= 2)
        ? [process.execPath, [path.resolve(process.argv[1])]]
        : [];
}

function registerProtocols() {
    for (const scheme of SCHEMES) {
        try { app.setAsDefaultProtocolClient(scheme, ...clientArgs()); }
        catch (e) { log.warn('default-browser', `could not register ${scheme}`, e); }
    }
}

function status() {
    const out = {};
    for (const scheme of SCHEMES) {
        try { out[scheme] = app.isDefaultProtocolClient(scheme, ...clientArgs()); }
        catch { out[scheme] = false; }
    }
    out.isDefault = SCHEMES.every(s => out[s]);
    out.canPrompt = process.platform !== 'linux';
    return out;
}

/**
 * Ask to become the default. macOS shows its own confirmation; Windows only
 * opens the Default Apps pane (it forbids apps from setting this silently), so
 * the caller must tell the user to finish there.
 */
async function makeDefault() {
    registerProtocols();
    if (process.platform === 'win32') {
        try {
            const { shell } = require('electron');
            await shell.openExternal('ms-settings:defaultapps');
            return { ...status(), openedSettings: true };
        }
        catch (e) {
            log.warn('default-browser', 'could not open the Default Apps pane', e);
        }
    }
    return status();
}

// ── Accepting links from the OS ──────────────────────────────────────────────
let opener = null; // (url) => void, installed by init()

function firstUrlIn(argv) {
    for (const arg of argv || []) {
        if (typeof arg === 'string' && /^https?:\/\//i.test(arg))
            return arg;
    }
    return null;
}

function handleUrl(raw) {
    const url = sanitizeUrl(raw);
    if (!url || !opener)
        return;
    try { opener(url); }
    catch (e) { log.error('default-browser', 'could not open an external link', e); }
}

/**
 * @param wm WindowManager — used to find the window an incoming link goes to.
 */
function init(wm) {
    opener = (url) => {
        const wd = (wm.getMostRecentlyFocusedWindow && wm.getMostRecentlyFocusedWindow())
            || (wm.getPrimaryWindow && wm.getPrimaryWindow());
        if (!wd?.tabs) {
            // No window yet (cold start from a link): make one, then retry once
            // it exists.
            const fresh = wm.createWindow();
            setTimeout(() => {
                try {
                    const idx = fresh.tabs.createTab(null, true);
                    fresh.tabs.loadUrl(idx, url);
                }
                catch (e) { log.error('default-browser', 'cold-start link failed', e); }
            }, 350);
            return;
        }
        const idx = wd.tabs.createTab(null, true);
        wd.tabs.loadUrl(idx, url);
        try {
            wd.window.show();
            wd.window.focus();
        }
        catch (e) { log.debug('default-browser', 'wd', e); }
    };
    // macOS hands links to the running app here.
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleUrl(url);
    });
    // Windows / Linux: the OS launches a second copy with the URL in argv, which
    // the single-instance lock turns into this event.
    app.on('second-instance', (_event, argv) => {
        const url = firstUrlIn(argv);
        if (url)
            handleUrl(url);
    });
    // Cold start straight from a link.
    const initial = firstUrlIn(process.argv.slice(1));
    if (initial)
        setTimeout(() => handleUrl(initial), 600);
}

module.exports = { registerProtocols, status, makeDefault, init, firstUrlIn };
