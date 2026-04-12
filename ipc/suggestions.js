/**
 * IPC handlers — URL / search suggestion overlay.
 *
 * The overlay is a transparent WebContentsView positioned below the address bar.
 * It is created lazily on the first open request and removed on close.
 */

const path = require('path');
const { WebContentsView } = require('electron');

const ITEM_HEIGHT = 35;
const MAX_HEIGHT  = 280;

function register(ipcMain, { wm }) {

    ipcMain.handle('suggestions-open', async (_e, payload) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd) return false;

        const { bounds, items = [], activeIndex = -1 } = payload || {};
        try {
            if (!wd.suggestions) {
                wd.suggestions = new WebContentsView({
                    webPreferences: {
                        preload: path.join(__dirname, '../preload/suggestions-preload.js'),
                        contextIsolation: true,
                        nodeIntegration: false,
                    },
                });
                wd.suggestions.setBackgroundColor('#00000000');
                wd.window.contentView.addChildView(wd.suggestions);

                // Notify chrome renderer so it can restore focus to the address bar
                try { wd.window.webContents.send('suggestions-created'); } catch {}

                wd.suggestions.webContents.loadFile('renderer/Suggestions/index.html');
                await new Promise(res => wd.suggestions.webContents.once('did-finish-load', res));

                // loadFile steals Electron-level focus; restore it to keep typing in the URL bar
                try { wd.window.webContents.focus(); } catch {}
            }

            wd.suggestions.setBounds(itemBounds(bounds, items.length));
            wd.suggestions.webContents.send('suggestions-data', { items, activeIndex });
            return true;
        } catch (err) {
            console.error('suggestions-open:', err);
            return false;
        }
    });

    ipcMain.handle('suggestions-update', async (_e, payload) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd || !wd.suggestions) return false;

        const { bounds, items = [], activeIndex = -1 } = payload || {};
        try {
            if (bounds && typeof bounds.left === 'number') {
                wd.suggestions.setBounds(itemBounds(bounds, items.length));
            }
            wd.suggestions.webContents.send('suggestions-data', { items, activeIndex });
            return true;
        } catch (err) {
            console.error('suggestions-update:', err);
            return false;
        }
    });

    ipcMain.handle('suggestions-close', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd || !wd.suggestions) return false;
        try {
            wd.window.contentView.removeChildView(wd.suggestions);
            wd.suggestions = null;
            return true;
        } catch (err) {
            console.error('suggestions-close:', err);
            return false;
        }
    });

    ipcMain.handle('suggestions-select', (_e, item) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd) return false;
        try {
            wd.window.webContents.send('suggestion-selected', item);
            if (wd.suggestions) {
                wd.window.contentView.removeChildView(wd.suggestions);
                wd.suggestions = null;
            }
            return true;
        } catch (err) {
            console.error('suggestions-select:', err);
            return false;
        }
    });

    // Pointer-down from the overlay: notify the owning chrome renderer so it
    // can suppress the hide-on-blur briefly while the click is processed.
    ipcMain.handle('suggestions-pointer-down', (_e) => {
        for (const w of wm.getAllWindows()) {
            if (w.suggestions?.webContents === _e.sender) {
                try { w.window.webContents.send('suggestions-pointer-down'); } catch {}
                break;
            }
        }
        return true;
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function itemBounds(bounds, count) {
    return {
        x:      Math.max(0, Math.floor(bounds.left)),
        y:      Math.max(0, Math.floor(bounds.top)),
        width:  Math.floor(bounds.width),
        height: Math.min(MAX_HEIGHT, Math.max(1, count) * ITEM_HEIGHT + 2),
    };
}

module.exports = { register };
