'use strict';
/**
 * The Firefox-style menu bar — File / Edit / View / History / Bookmarks /
 * Profiles / Tools / Help — that drops from the very top of the window when Alt
 * is tapped.
 *
 * WHY THIS EXISTS ONLY ON WINDOWS. A native menu bar is drawn by the OS from the
 * window frame, so it needs a framed window:
 *   - macOS: the system menu bar at the top of the screen (always present).
 *   - Linux: the window is framed, so autoHideMenuBar shows the native bar on Alt.
 *   - Windows: the window is FRAMELESS (custom chrome), so the OS has nowhere to
 *     draw a menu bar. This is the gap this feature fills — a bar rendered in the
 *     chrome DOM (renderer/Browser) that appears on Alt like the others.
 * app-menu.js installs the native bar on mac/Linux and installs NOTHING on
 * Windows; here is Windows' equivalent. All three are the same eight menus with
 * the same click handlers (app-menu.barMenus()); only the drawing differs.
 *
 * The bar's DOM lives in the chrome (so it inherits the theme and reflows the
 * page card through the existing reportChromeHeight channel). This module is the
 * main-process half: it toggles the bar (Alt tap, from Shortcuts) and opens a
 * top-level menu's dropdown through the themed overlay menu (features/
 * overlay-menu → the CtxMenu overlay), so a menu-bar dropdown looks exactly like
 * a right-click menu and floats above the native page views.
 */
const log = require('./log');
const appMenu = require('./app-menu');
const overlayMenu = require('./overlay-menu');

// mac has the system bar; Linux has the native (framed) bar on Alt. Only the
// frameless Windows window needs the in-chrome bar.
const ENABLED = process.platform === 'win32';

/** Alt was tapped — show/hide the bar in this window's chrome. No-op off Windows
 *  (the native bar handles Alt there) or when the window is gone. */
function toggle(wd) {
    if (!ENABLED || !wd || !wd.window || wd.window.isDestroyed())
        return;
    try { wd.window.webContents.send('menubar-toggle'); }
    catch (e) { log.debug('menu-bar', 'toggle', e); }
}

/**
 * The eight top-level items — the SINGLE source of the mnemonic (access-key)
 * assignment, used both by the chrome (to underline the letter) and by main (to
 * match a keypress while the bar is open). Each item's access key is its first
 * letter/digit not already claimed by an item to its left, so History→H,
 * Help→(H taken)→l, etc. Returns [{ label, keyIndex, key }].
 */
function items() {
    let labels;
    try { labels = appMenu.barMenus().map(m => m.label); }
    catch (e) { log.debug('menu-bar', 'items', e); return []; }
    const used = new Set();
    return labels.map(label => {
        let keyIndex = -1;
        for (let i = 0; i < label.length; i++) {
            const c = label[i].toLowerCase();
            if (/[a-z0-9]/.test(c) && !used.has(c)) { used.add(c); keyIndex = i; break; }
        }
        return { label, keyIndex, key: keyIndex >= 0 ? label[keyIndex].toLowerCase() : null };
    });
}

/** Index of the top-level menu whose access key is `key` (lowercase), or -1. */
function indexForKey(key) {
    if (!key)
        return -1;
    const k = String(key).toLowerCase();
    return items().findIndex(it => it.key === k);
}

/**
 * Open the dropdown for the top-level menu at `index`, anchored under its label.
 * `anchor` is the label's rect in window coordinates (left/right/top/bottom).
 * Returns whether the overlay took it.
 */
function openDropdown(wd, index, anchor) {
    if (!wd)
        return false;
    let menus;
    try { menus = appMenu.barMenus(); }
    catch (e) { log.debug('menu-bar', 'openDropdown build', e); return false; }
    const menu = menus[index];
    if (!menu || !menu.submenu || !menu.submenu.length)
        return false;
    const x = Math.round((anchor && (anchor.left ?? anchor.x)) || 0);
    const y = Math.round((anchor && anchor.bottom) || 0);
    // Tell the chrome when the dropdown closes so it can un-press the top-level
    // item, and hide the bar when an item was actually chosen.
    const onClose = (picked) => {
        try {
            if (wd.window && !wd.window.isDestroyed())
                wd.window.webContents.send('menubar-closed', { index, picked: !!picked });
        }
        catch (e) { log.debug('menu-bar', 'onClose', e); }
    };
    // mnemonics: true → the overlay underlines an access key per row and lets the
    // keyboard drive the dropdown and its nested submenus, continuing the bar's
    // own mnemonic chain.
    return overlayMenu.popup(wd, menu.submenu, x, y, onClose, { mnemonics: true });
}

module.exports = { toggle, items, indexForKey, openDropdown, get enabled() { return ENABLED; } };
