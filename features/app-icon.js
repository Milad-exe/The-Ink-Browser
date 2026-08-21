/**
 * The dock/taskbar icon follows the selected theme.
 *
 * Four themes, four grounds, and the icon is the mark on the theme's own
 * ground — so a browser running Dune does not sit in the dock as a black tile.
 * icons/themes/*.png are checked into the tree — one per theme, rasterised
 * from renderer/assets/logo.svg back when a generator existed. This only
 * decides which of them is on screen; see that SVG for how to rebuild them.
 *
 * The bundle icon (icon.icns / icon.ico) cannot change at runtime, so it is
 * built from `default` — a window running the default theme therefore needs no
 * override at all, which also means the common case never touches the dock.
 *
 * macOS has one icon for the whole app, so this follows the app-wide setting.
 * Windows and Linux set it per window, and every window shares that setting
 * too, so they are handed the same image.
 */
const { app, nativeImage } = require('electron');
const path = require('path');
const { resolveAppFile } = require('../app-paths');
const log = require('./log');

const THEMES = ['default', 'fathom', 'porcelain', 'dune'];
const cache = new Map();

function imageFor(theme) {
    const name = THEMES.includes(theme) ? theme : 'default';
    if (!cache.has(name)) {
        const img = nativeImage.createFromPath(resolveAppFile(path.join('icons/themes', `${name}.png`)));
        cache.set(name, img.isEmpty() ? null : img);
    }
    return cache.get(name);
}

/**
 * Point the dock (macOS) or every window (Windows/Linux) at `theme`'s icon.
 * `wm` is only needed off macOS; pass it whenever you have one.
 */
function apply(theme, wm) {
    const img = imageFor(theme);
    if (!img) {
        log.warn('app-icon', `no icon for theme ${theme}`);
        return;
    }
    try {
        if (process.platform === 'darwin') {
            app.dock?.setIcon(img);
            return;
        }
        wm?.getAllWindows?.().forEach(wd => {
            try { wd.window.setIcon(img); }
            catch (e) { log.debug('app-icon', 'setIcon', e); }
        });
    }
    catch (e) {
        log.warn('app-icon', 'apply', e);
    }
}

/** A window created after a theme change starts on the bundle icon. */
function applyToWindow(win, theme) {
    if (process.platform === 'darwin')
        return;
    const img = imageFor(theme);
    if (!img)
        return;
    try { win.setIcon(img); }
    catch (e) { log.debug('app-icon', 'applyToWindow', e); }
}

module.exports = { apply, applyToWindow, THEMES };
