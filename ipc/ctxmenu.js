/**
 * IPC handlers — the context-menu overlay.
 *
 * Chrome context menus are chrome DOM, but every tab is a WebContentsView
 * composited OVER the chrome, so a chrome-drawn menu is hidden behind the page.
 * This hosts them in their own view instead (same pattern as the downloads
 * panel and folder dropdown), sized to the whole window so the menu chain and
 * its click-outside handling all live in one place.
 *
 * Handlers can't cross IPC, so the chrome sends row *labels* and gets back the
 * path of indices that was picked; it owns the actual callbacks.
 */
const path = require('path');
const { resolveAppFile } = require('../app-paths');
const { WebContentsView } = require('electron');

async function ensureMenu(wd) {
    if (wd.ctxMenu) {
        if (wd.ctxMenuReady)
            await wd.ctxMenuReady;
        return wd.ctxMenu;
    }
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, '../preload/ctxmenu-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            transparent: true,
        },
    });
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    wd.ctxMenu = view;
    wd.window.contentView.addChildView(view);
    view.webContents.loadFile(resolveAppFile('renderer/CtxMenu/index.html'));
    wd.ctxMenuReady = new Promise(res => view.webContents.once('did-finish-load', () => res()));
    await wd.ctxMenuReady;
    return view;
}

function hideMenu(wd) {
    if (!wd?.ctxMenu)
        return;
    try {
        wd.ctxMenu.setVisible(false);
        wd.ctxMenuOpen = false;
    }
    catch { }
}

function register(ipcMain, { wm }) {
    ipcMain.handle('ctxmenu:open', async (_e, data) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return false;
        try {
            const view = await ensureMenu(wd);
            const b = wd.window.getContentBounds();
            // Full-window: the overlay owns the chain and the click-outside, so
            // it must cover everything the pointer might land on.
            view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
            // Raise above the tab views — the overlay is created once and would
            // otherwise sink behind any tab added after it.
            try {
                wd.window.contentView.removeChildView(view);
                wd.window.contentView.addChildView(view);
            }
            catch { }
            view.setVisible(true);
            wd.ctxMenuOpen = true;
            view.webContents.send('ctxmenu:data', data);
            try { view.webContents.focus(); }
            catch { }
            return true;
        }
        catch (err) {
            console.error('ctxmenu:open:', err);
            return false;
        }
    });
    ipcMain.on('ctxmenu:pick', (_e, result) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return;
        hideMenu(wd);
        try { wd.window.webContents.send('ctxmenu:picked', result); }
        catch { }
    });
    ipcMain.on('ctxmenu:dismiss', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return;
        hideMenu(wd);
        try { wd.window.webContents.send('ctxmenu:picked', null); }
        catch { }
    });
}

module.exports = { register, hideMenu };
