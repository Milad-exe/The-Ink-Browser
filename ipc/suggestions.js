/**
 * IPC handlers — URL / search suggestion overlay.
 *
 * The overlay is a transparent WebContentsView positioned below the address bar.
 * It is created ONCE per window (pre-warmed at startup via 'suggestions-warm')
 * and then only shown/hidden. Recreating it on each open ran loadFile while the
 * user was typing, which stole Electron-level focus from the address bar and
 * swallowed the next key press.
 */
const log = require('../features/log');
const path = require('path');
const { resolveAppFile } = require('../app-paths');
const { WebContentsView } = require('electron');
const ITEM_HEIGHT = 38; // --row-h (36) + the row's 1px margins (Suggestions/styles.css)
/* Room inside the view for the card's shadow, and the ONLY panel that has one
   (see .surface-card in renderer/styles/surface.css). A WebContentsView clips
   at its own bounds, so every pixel the shadow needs has to be inside them.
   Measured in the app: this card's shadow — 0 6px 16px / 0 1px 4px, in
   Suggestions/styles.css — fades to nothing 20px to either side and 26px below.
   The page's body padding is these same numbers, so the card still lands
   exactly on `bounds`, i.e. flush under the address field.

   There is NO top pad: the view's top edge IS the card's top edge, so the part
   of the shadow that would fall upwards is simply never inside the view and can
   never be cut into a band. Padding the top instead (it used to be 4px) pushed
   the card 4px below the y the address bar asked for, doubling the gap. */
const PAD_X = 20;
const PAD_BOTTOM = 26;
const LIST_CHROME = PAD_BOTTOM + 8; // body padding bottom + the card's own
// Fits the full capped list (≤8 rows: base + ≤4 links + ≤3 search) without
// scrolling: 8 * ITEM_HEIGHT + LIST_CHROME. The caps live in renderer.js
// updateSuggestions.
const MAX_HEIGHT = 8 * ITEM_HEIGHT + LIST_CHROME;
/* The constant the panel is always drawn at. It is MAX_HEIGHT — the full eight
   rows renderer.js caps the list at — because a shorter preset would hide the
   last results behind a scroll on every full dropdown, and these are ranked:
   the ones you cannot see are the ones you asked for. One height that fits
   everything beats a shorter one that fits most things. */
const PANEL_HEIGHT = MAX_HEIGHT;
/** Create (once) and load the overlay view for a window. Resolves when loaded. */
async function ensureView(wd) {
    if (wd.suggestions) {
        if (wd.suggestionsReady)
            await wd.suggestionsReady;
        return wd.suggestions;
    }
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, '../preload/suggestions-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    view.setBackgroundColor('#00000000');
    /* No radius on the VIEW: the card inside draws its own, and rounding both at
       the same radius is what clipped the shadow at the corner. The view is a
       transparent rectangle the card floats in. */
    try { view.setBorderRadius(0) } catch (e) { log.debug('suggestions', 'setBorderRadius', e); }
    view.setVisible(false);
    wd.suggestions = view;
    wd.window.contentView.addChildView(view);
    // Notify chrome renderer so it can restore focus to the address bar
    try {
        wd.window.webContents.send('suggestions-created');
    }
    catch (e) { log.debug('suggestions', 'if', e); }
    view.webContents.loadFile(resolveAppFile('renderer/Suggestions/index.html'));
    wd.suggestionsReady = new Promise(res => view.webContents.once('did-finish-load', () => res()));
    await wd.suggestionsReady;
    // loadFile steals Electron-level focus; restore it to keep typing in the URL bar
    try {
        wd.window.webContents.focus();
    }
    catch (e) { log.debug('suggestions', 'if', e); }
    return view;
}
function hideView(wd) {
    if (!wd.suggestions)
        return false;
    try {
        wd.suggestions.setVisible(false);
        return true;
    }
    catch {
        return false;
    }
}
function register(ipcMain, { wm }) {
    // Pre-create the overlay while the window is idle so the first typing
    // session never pays the loadFile focus-steal.
    ipcMain.handle('suggestions-warm', async (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return false;
        try {
            await ensureView(wd);
            return true;
        }
        catch (err) {
            console.error('suggestions-warm:', err);
            return false;
        }
    });
    ipcMain.handle('suggestions-open', async (_e, payload) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return false;
        const { bounds, items = [], activeIndex = -1, query = '', engine = '' } = payload || {};
        try {
            const view = await ensureView(wd);
            view.setBounds(itemBounds(bounds, items.length));
            // Raise above the active tab's WebContentsView — the overlay is
            // created once and can otherwise sit behind a tab that was added
            // after it, making the suggestions invisible.
            try {
                wd.window.contentView.removeChildView(view);
                wd.window.contentView.addChildView(view);
            }
            catch (e) { log.debug('suggestions', 'suggestions-open', e); }
            view.setVisible(true);
            view.webContents.send('suggestions-data', { items, activeIndex, query, engine });
            return true;
        }
        catch (err) {
            console.error('suggestions-open:', err);
            return false;
        }
    });
    ipcMain.handle('suggestions-update', async (_e, payload) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd || !wd.suggestions)
            return false;
        const { bounds, items = [], activeIndex = -1, query = '', engine = '' } = payload || {};
        try {
            if (bounds && typeof bounds.left === 'number') {
                wd.suggestions.setBounds(itemBounds(bounds, items.length));
            }
            wd.suggestions.webContents.send('suggestions-data', { items, activeIndex, query, engine });
            return true;
        }
        catch (err) {
            console.error('suggestions-update:', err);
            return false;
        }
    });
    ipcMain.handle('suggestions-close', (_e) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return false;
        return hideView(wd);
    });
    // Domain favicon for an omnibox suggestion whose site we haven't visited —
    // fetched from the search engine's favicon service (Chrome/Firefox do this),
    // cached like the rest. NEVER for a private window/tab: it would leak the
    // typed domain, same rule as network search suggestions.
    ipcMain.handle('favicon-remote', (_e, host) => {
        const faviconStore = require('../features/favicon-store');
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return '';
        const t = wd.tabs;
        const active = t && t.tabMap.get(t.activeTabIndex);
        if (t?.isPrivateWindow || (active && active.isPrivate))
            return '';
        const engine = wm.persistence.get('searchEngine') || 'duckduckgo';
        return faviconStore.getForHostRemote(host, engine);
    });
    ipcMain.handle('suggestions-select', (_e, item) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return false;
        try {
            wd.window.webContents.send('suggestion-selected', item);
            hideView(wd);
            return true;
        }
        catch (err) {
            console.error('suggestions-select:', err);
            return false;
        }
    });
    // Pointer-down from the overlay: notify the owning chrome renderer so it
    // can suppress the hide-on-blur briefly while the click is processed.
    ipcMain.handle('suggestions-pointer-down', (_e) => {
        for (const w of wm.getAllWindows()) {
            if (w.suggestions?.webContents === _e.sender) {
                try {
                    w.window.webContents.send('suggestions-pointer-down');
                }
                catch (e) { log.debug('suggestions', 'suggestions-pointer-down', e); }
                break;
            }
        }
        return true;
    });
    // Pointer moved onto a row: tell the chrome so its keyboard selection follows
    // the mouse (Enter after hovering then goes where the pointer is).
    ipcMain.handle('suggestions-hover', (_e, index) => {
        for (const w of wm.getAllWindows()) {
            if (w.suggestions?.webContents === _e.sender) {
                try { w.window.webContents.send('suggestion-hover', index); }
                catch (e) { log.debug('suggestions', 'suggestions-hover', e); }
                break;
            }
        }
        return true;
    });
}
// ── Helpers ──────────────────────────────────────────────────────────────────
/* `bounds` is where the CARD goes (renderer.js getSuggestionsBounds: the
   address field's rect, 4px below it). The view is grown around it — never
   moved — so the card lands on `bounds` whatever the pad is. x is allowed to go
   negative for a field close to the window's left edge: the part that hangs off
   is shadow nobody can see, and clamping it to 0 shifted the card right of the
   field instead. */
function itemBounds(bounds, count) {
    /* ONE height, always. This used to be sized to the result count, so the box
       resized on every keystroke — 262px on opening, then 186, then 148, then
       72 as the list narrowed — and the panel's edge moved under the cursor the
       whole time you were typing. A dropdown that changes shape while you aim
       at it is the thing to avoid; the browsers this design follows keep it a
       constant surface and let the list scroll inside.

       PANEL_HEIGHT is what the box measures when it first opens, so focusing
       the field no longer resizes anything either. Fewer results leave the
       lower part of the card empty, which is the cost of a surface that holds
       still, and it is worth paying. */
    void count;
    return {
        x: Math.floor(bounds.left - PAD_X),
        y: Math.max(0, Math.floor(bounds.top)),
        width: Math.floor(bounds.width + PAD_X * 2),
        height: PANEL_HEIGHT,
    };
}

module.exports = { register, itemBounds, PAD_X, PAD_BOTTOM, ITEM_HEIGHT, LIST_CHROME, MAX_HEIGHT, PANEL_HEIGHT };