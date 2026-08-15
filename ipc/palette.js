/**
 * IPC handlers — the command palette overlay.
 *
 * Opens in place of creating a new tab: the palette is what creates the tab once
 * you commit, so there is no blank new-tab page to pass through. Hosted in its
 * own WebContentsView because the page is composited over the chrome.
 */
const path = require('path');
const { resolveAppFile } = require('../app-paths');
const { WebContentsView } = require('electron');

async function ensurePalette(wd) {
    if (wd.palette) {
        if (wd.paletteReady) await wd.paletteReady;
        return wd.palette;
    }
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, '../preload/palette-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            transparent: true,
        },
    });
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    wd.palette = view;
    wd.window.contentView.addChildView(view);
    view.webContents.loadFile(resolveAppFile('renderer/Palette/index.html'));
    wd.paletteReady = new Promise(res => view.webContents.once('did-finish-load', () => res()));
    await wd.paletteReady;
    return view;
}

function hidePalette(wd) {
    if (!wd?.palette) return;
    try {
        wd.palette.setVisible(false);
        wd.paletteOpen = false;
    }
    catch { }
}

function register(ipcMain, { wm }) {
    ipcMain.handle('palette:open', async (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd) return false;
        try {
            const view = await ensurePalette(wd);
            const b = wd.window.getContentBounds();
            view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
            // Raise above the tab views, which are added after this one.
            try {
                wd.window.contentView.removeChildView(view);
                wd.window.contentView.addChildView(view);
            }
            catch { }
            view.setVisible(true);
            wd.paletteOpen = true;
            view.webContents.send('palette:data', {});
            try { view.webContents.focus(); }
            catch { }
            return true;
        }
        catch (err) {
            console.error('palette:open:', err);
            return false;
        }
    });
    // 'done' closes after the palette opened something; 'dismiss' closes with
    // nothing created. Both just hide the view.
    for (const ch of ['palette:done', 'palette:dismiss']) {
        ipcMain.on(ch, (_e) => hidePalette(wm.getWindowByWebContents(_e.sender)));
    }
}

module.exports = { register, hidePalette };
