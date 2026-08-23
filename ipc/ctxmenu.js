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
const log = require('../features/log');
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
    // Size it BEFORE the page loads. The first right-click of a session is what
    // creates this view, and the page asks for its data while loading — with a
    // 0x0 viewport, every "keep it on screen" clamp in place() collapsed to the
    // 6px margin and the first menu opened in the window's top-left corner
    // instead of under the cursor.
    try {
        const b0 = wd.window.getContentBounds();
        view.setBounds({ x: 0, y: 0, width: b0.width, height: b0.height });
    }
    catch (e) { log.debug('ctxmenu', 'ensureMenu bounds', e); }
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
        wd.ctxMenuPending = null;
        // The overlay took keyboard focus when it opened; hand it back or the
        // window is left with nothing focused and the next accelerator beeps.
        try { wd.window.webContents.focus(); }
        catch (e) { log.debug('ctxmenu', 'hideMenu', e); }
    }
    catch (e) { log.debug('ctxmenu', 'hideMenu', e); }
}

function register(ipcMain, { wm }) {
    ipcMain.handle('ctxmenu:open', async (_e, data) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return false;
        /* Record what to show BEFORE the view exists. On the first right-click of
           a session this call is what creates the view, and the page asks for
           its data while it is loading — i.e. before this handler resumes past
           the await. Setting it afterwards meant the pull found nothing and the
           push had already gone out to a page that was not listening yet, so
           the first menu opened empty and the second worked. */
        wd.ctxMenuSeq = (wd.ctxMenuSeq || 0) + 1;
        data = { ...data, seq: wd.ctxMenuSeq };
        wd.ctxMenuPending = data;
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
            catch (e) { log.debug('ctxmenu', 'ctxmenu:open', e); }
            view.setVisible(true);
            wd.ctxMenuOpen = true;
            /* Push as well: an already-loaded view is not going to pull again. */
            view.webContents.send('ctxmenu:data', data);
            try { view.webContents.focus(); }
            catch (e) { log.debug('ctxmenu', 'ctxmenu:open', e); }
            return true;
        }
        catch (err) {
            console.error('ctxmenu:open:', err);
            return false;
        }
    });
    /* What the menu should be showing, asked for by the page once it is ready.
       Returns null when nothing is pending, so a reload of an idle view draws
       nothing rather than re-opening the last menu. */
    ipcMain.handle('ctxmenu:ready', (_e) => {
        for (const wd of wm.getAllWindows()) {
            if (wd.ctxMenu?.webContents === _e.sender)
                return wd.ctxMenuPending || null;
        }
        return null;
    });

    ipcMain.on('ctxmenu:pick', (_e, result) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return;
        hideMenu(wd);
        try { wd.window.webContents.send('ctxmenu:picked', result); }
        catch (e) { log.debug('ctxmenu', 'ctxmenu:pick', e); }
    });
    ipcMain.on('ctxmenu:dismiss', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return;
        hideMenu(wd);
        try { wd.window.webContents.send('ctxmenu:picked', null); }
        catch (e) { log.debug('ctxmenu', 'ctxmenu:dismiss', e); }
    });
}

module.exports = { register, hideMenu };
