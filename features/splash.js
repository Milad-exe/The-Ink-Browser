'use strict';
/**
 * First-launch window.
 *
 * Shown ONCE, on a profile that has never run the browser, and never again —
 * `seenWelcome` is written the moment it is shown, not when it finishes, so a
 * crash or a force-quit halfway through cannot bring it back on the next
 * launch. An intro you can be shown twice is not an intro.
 *
 * It never delays the browser. The main window is built at the same time and
 * simply waits to be revealed, so the splash overlaps startup rather than
 * adding to it; and if anything here throws, the caller carries on without it.
 */
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const log = require('./log');
const { resolveAppFile } = require('../app-paths');

// Longest the browser will ever wait on the animation. The page asks to be
// closed at ~1.9s; this is the backstop for a page that never gets there.
const MAX_MS = 4000;

let win = null;
let settle = null;

function close() {
    const w = win;
    win = null;
    const done = settle;
    settle = null;
    try {
        if (w && !w.isDestroyed())
            w.close();
    }
    catch (e) { log.debug('splash', 'close', e); }
    if (done)
        done();
}

/**
 * Show it if this profile has never seen it.
 * Resolves when the browser should be revealed — immediately when there is
 * nothing to show, so the normal path costs nothing.
 */
function maybeShow(persistence) {
    try {
        if (!persistence || persistence.get('seenWelcome'))
            return Promise.resolve(false);
        /* The harnesses launch on a throwaway profile, so every run would be a
           "first" run — two seconds of animation before the browser appears,
           on every test, for no signal. The e2e suite sets NORTHSTAR_TEST; the
           flag is still written, so this stays a one-shot either way. */
        if (process.env.NORTHSTAR_TEST === '1') {
            persistence.set('seenWelcome', true);
            return Promise.resolve(false);
        }
        // Written NOW, not on completion: a force-quit mid-animation must not
        // earn a second showing.
        persistence.set('seenWelcome', true);
        win = new BrowserWindow({
            width: 420, height: 420,
            frame: false, transparent: true, resizable: false, movable: false,
            minimizable: false, maximizable: false, fullscreenable: false,
            skipTaskbar: true, alwaysOnTop: true, center: true, show: false,
            backgroundColor: '#00000000',
            webPreferences: {
                preload: path.join(__dirname, '../preload/splash-preload.js'),
                contextIsolation: true, nodeIntegration: false, sandbox: true,
            },
        });
        win.once('ready-to-show', () => { try { win && win.show(); } catch (e) { log.debug('splash', 'show', e); } });
        win.loadFile(resolveAppFile('renderer/Splash/index.html'));
        setTimeout(close, MAX_MS);
        return new Promise((res) => { settle = () => res(true); });
    }
    catch (e) {
        log.warn('splash', 'could not show the first-launch window', e);
        win = null;
        return Promise.resolve(false);
    }
}

function register(ipcMain_) {
    (ipcMain_ || ipcMain).on('splash:done', () => close());
}

module.exports = { maybeShow, register, close };
