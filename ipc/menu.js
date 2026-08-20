/**
 * IPC handlers — hamburger menu overlay and click-outside dismissal.
 *
 * The menu is a transparent WebContentsView that slides in from the top-right.
 * It must be dismissed when the user clicks anywhere outside it.
 */
const log = require('../features/log');
const path = require('path');
const { resolveAppFile } = require('../app-paths');
const { WebContentsView } = require('electron');
const { closeWindowMenu, closeFolderDropdown } = require('./utils');
const { panelBounds, PANEL_RADIUS, W_SM } = require('../features/overlay-bounds');
const MENU_WIDTH = W_SM;
// Rows (12 x --row-h) + the zoom row + four separators + the card's own
// padding. Measured from the rendered card rather than guessed: an oversized
// menu window is invisible but still swallows clicks below the card.
const MENU_HEIGHT = 468;
// (12 rows + zoom + separators; adding a row without raising this clips the menu)
function register(ipcMain, { wm }) {
    // ── Open ─────────────────────────────────────────────────────────────────
    ipcMain.handle('open', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return;
        wd.menu = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, '../preload/menu-preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        wd.menu.setBackgroundColor('#00000000');
        try { wd.menu.setBorderRadius(PANEL_RADIUS); } catch (e) { log.debug('menu', 'open', e); }
        wd.window.contentView.addChildView(wd.menu);
        wd.menu.webContents.loadFile(resolveAppFile('renderer/Menu/index.html'));
        // No anchor: the menu belongs to the window, so it opens in the
        // shell's own corner — level with the top of the page card.
        wd.menu.setBounds(panelBounds(wd.window, { width: MENU_WIDTH, height: MENU_HEIGHT }));
        // Close the menu the moment the user clicks outside it or the window
        // loses OS focus. Use a one-shot flag so cleanup only fires once.
        const cleanups = [];
        let fired = false;
        const closeOnce = () => {
            if (fired)
                return;
            fired = true;
            closeWindowMenu(wd);
        };
        wd.window.once('blur', closeOnce);
        cleanups.push(() => wd.window.removeListener('blur', closeOnce));
        wd.window.webContents.once('focus', closeOnce);
        cleanups.push(() => wd.window.webContents.removeListener('focus', closeOnce));
        wd.menuCleanups = cleanups;
    });
    // ── Close ─────────────────────────────────────────────────────────────────
    ipcMain.handle('close-menu', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        closeWindowMenu(wd);
    });
    // ── Click-outside detection ───────────────────────────────────────────────
    // Any mousedown in a tab or floating WebContentsView sends this.
    // Close the menu, dismiss the bookmark prompt, and close the folder dropdown.
    ipcMain.on('content-view-click', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return;
        if (wd.menu)
            closeWindowMenu(wd);
        if (wd.bookmarkPrompt) {
            wd.window.contentView.removeChildView(wd.bookmarkPrompt);
            wd.bookmarkPrompt = null;
        }
        if (wd.folderDropdown)
            closeFolderDropdown(wd);
        // Forward click to chrome renderer only when it came from a child view
        // (e.g. a tab), not from the chrome renderer itself.
        if (_e.sender !== wd.window.webContents) {
            wd.window.webContents.send('content-clicked');
        }
    });
    // Click coordinates from the chrome renderer — close floating panels
    // if the click landed outside their bounds.
    // The overflow menu's New Tab raises the palette, like every other
    // user-facing new-tab entry point.
    ipcMain.handle('menu-new-tab', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        try { return require('./palette').openFor(wd); }
        catch { wd?.tabs?.createTab(); return false; }
    });
    ipcMain.on('window-click', (_e, pos) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return;
        if (wd.menu) {
            try {
                const b = wd.menu.getBounds();
                const outside = pos.x < b.x || pos.x > b.x + b.width ||
                    pos.y < b.y || pos.y > b.y + b.height;
                if (outside)
                    closeWindowMenu(wd);
            }
            catch {
                closeWindowMenu(wd);
            }
        }
        if (wd.bookmarkPrompt) {
            try {
                const b = wd.bookmarkPrompt.getBounds();
                const outside = pos.x < b.x || pos.x > b.x + b.width ||
                    pos.y < b.y || pos.y > b.y + b.height;
                if (outside) {
                    wd.window.contentView.removeChildView(wd.bookmarkPrompt);
                    wd.bookmarkPrompt = null;
                }
            }
            catch {
                wd.window.contentView.removeChildView(wd.bookmarkPrompt);
                wd.bookmarkPrompt = null;
            }
        }
    });
}

module.exports = { register };