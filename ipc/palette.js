/**
 * IPC handlers — the command palette overlay.
 *
 * Opens in place of creating a new tab: the palette is what creates the tab once
 * you commit, so there is no blank new-tab page to pass through. Hosted in its
 * own WebContentsView because the page is composited over the chrome.
 */
const log = require('../features/log');
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
        // The overlay took keyboard focus when it opened; hand it back or the
        // window is left with nothing focused and the next accelerator beeps.
        // On a blank tab there is no page to type into, so the address bar
        // takes the caret — dismissing the palette should leave you somewhere
        // you can start typing, not nowhere.
        try {
            wd.window.webContents.focus();
            const t = wd.tabs;
            const blank = t && !/^https?:/i.test(String(t.tabUrls.get(t.activeTabIndex) || ''));
            if (blank)
                wd.window.webContents.send('focus-address-bar');
        }
        catch (e) { log.debug('palette', 'hidePalette', e); }
    }
    catch (e) { log.debug('palette', 'hidePalette', e); }
}

/**
 * Tell the palette where the page card is, so it can centre on the page rather
 * than on the window. Sent on open and whenever the window is resized while it
 * is up (the sidebar resizer changes the card's left edge too).
 */
function sendFrame(wd) {
    try {
        const view = wd?.palette;
        if (!view || view.webContents.isDestroyed())
            return;
        const card = wd.tabs?.getTabBounds?.();
        const win = wd.window.getContentBounds();
        if (!card)
            return;
        view.webContents.send('palette:frame', {
            left: Math.max(0, Math.round(card.x)),
            right: Math.max(0, Math.round(win.width - (card.x + card.width))),
            top: Math.max(0, Math.round(card.y)),
            bottom: Math.max(0, Math.round(win.height - (card.y + card.height))),
        });
    }
    catch (e) { log.debug('palette', 'sendFrame', e); }
}

// Raise the palette for a window. Every user-facing "new tab" goes through
// here — the tab is created when the query is committed, not before.
async function openFor(wd) {
    if (!wd) return false;
    try {
        const view = await ensurePalette(wd);
        const b = wd.window.getContentBounds();
        view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
        try {
            wd.window.contentView.removeChildView(view);
            wd.window.contentView.addChildView(view);
        }
        catch (e) { log.debug('palette', 'openFor', e); }
        view.setVisible(true);
        wd.paletteOpen = true;
        sendFrame(wd);
        view.webContents.send('palette:data', {});
        if (!wd._paletteResizeHooked) {
            wd._paletteResizeHooked = true;
            wd.window.on('resize', () => { if (wd.paletteOpen) sendFrame(wd); });
        }
        try { view.webContents.focus(); }
        catch (e) { log.debug('palette', 'openFor', e); }
        return true;
    }
    catch (err) {
        console.error('palette open:', err);
        return false;
    }
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
            catch (e) { log.debug('palette', 'palette:open', e); }
            view.setVisible(true);
            wd.paletteOpen = true;
            // Bind the scrim to the page card, exactly as openFor does. Without
            // this the --frame-* vars stay unset and #surface falls back to a
            // stale default top, so the dimming scrim ("the shadow") covers the
            // chrome instead of sitting inside the tab view.
            sendFrame(wd);
            if (!wd._paletteResizeHooked) {
                wd._paletteResizeHooked = true;
                wd.window.on('resize', () => { if (wd.paletteOpen) sendFrame(wd); });
            }
            view.webContents.send('palette:data', {});
            try { view.webContents.focus(); }
            catch (e) { log.debug('palette', 'palette:open', e); }
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

/* features/ reaches the palette through features/palette-bridge, never by
   requiring this module — that would be a layer below depending on one above.
   Registering here, at load, is what makes the bridge work. */
require('../features/palette-bridge').provide({ openFor, hidePalette });

module.exports = { register, hidePalette, openFor };
