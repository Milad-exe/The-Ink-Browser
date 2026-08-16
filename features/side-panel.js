/**
 * chrome.sidePanel — a dockable panel on the right of the page area.
 *
 * Chrome renders extension side panels beside the page, not over it, so this
 * genuinely reserves layout space rather than floating an overlay: Tabs keeps a
 * `sidePanelWidth` that getTabBounds() subtracts, and the page view shrinks.
 *
 * Two native views make up the panel, because a WebContentsView cannot be
 * nested inside another one's DOM:
 *   wd.sidePanelHeader  our own title + close strip (renderer/SidePanel)
 *   wd.sidePanel        the extension's page, in that space's session
 *
 * Both must stay listed in raiseFloatingViews() and getWindowByWebContents().
 */
'use strict';
const path = require('path');
const { WebContentsView } = require('electron');
const { resolveAppFile } = require('../app-paths');

const PANEL_WIDTH = 340;
const HEADER_H = 34;

// extension id → { path, enabled, tabPaths: Map(tabId → path) }
const options = new Map();
// extension id → openPanelOnActionClick
const behavior = new Map();
// Notified whenever the set of "clicking the toolbar button opens a panel"
// extensions changes, so the renderer can decide synchronously on click.
const listeners = new Set();
function onBehaviorChanged(fn) { listeners.add(fn); }
function _emit() {
    const ids = openOnActionClickIds();
    for (const fn of listeners) {
        try { fn(ids); }
        catch { }
    }
}
/** Extensions whose action click should open the side panel instead of a popup. */
function openOnActionClickIds() {
    const out = [];
    for (const [id, on] of behavior)
        if (on && pathFor(id, null))
            out.push(id);
    return out;
}

function rec(extensionId) {
    let r = options.get(extensionId);
    if (!r) {
        r = { path: null, enabled: true, tabPaths: new Map() };
        options.set(extensionId, r);
    }
    return r;
}

function setOptions(extensionId, o = {}) {
    const r = rec(extensionId);
    if (o.tabId != null) {
        if (o.path !== undefined)
            r.tabPaths.set(Number(o.tabId), o.path);
    }
    else {
        if (o.path !== undefined)
            r.path = o.path;
    }
    if (o.enabled !== undefined)
        r.enabled = !!o.enabled;
    _emit(); // a path arriving can make an action click meaningful
    return true;
}

function getOptions(extensionId, o = {}) {
    const r = rec(extensionId);
    const tabPath = o.tabId != null ? r.tabPaths.get(Number(o.tabId)) : undefined;
    return { path: tabPath ?? r.path ?? undefined, enabled: r.enabled, tabId: o.tabId };
}

function setPanelBehavior(extensionId, o = {}) {
    behavior.set(extensionId, !!o.openPanelOnActionClick);
    _emit();
    return true;
}

function shouldOpenOnActionClick(extensionId) {
    return behavior.get(extensionId) === true;
}

/** Resolve the page an extension wants shown, honouring per-tab overrides. */
function pathFor(extensionId, tabId) {
    const r = rec(extensionId);
    if (!r.enabled)
        return null;
    const p = (tabId != null ? r.tabPaths.get(Number(tabId)) : undefined) ?? r.path;
    return p || null;
}

/**
 * How wide the panel may actually be. On a narrow window the full width would
 * squeeze the page card to nothing, so never take more than 40% of the content.
 */
function widthFor(wd) {
    try {
        const content = wd.window.getContentBounds();
        return Math.max(220, Math.min(PANEL_WIDTH, Math.floor(content.width * 0.4)));
    }
    catch { return PANEL_WIDTH; }
}

function _activeWindow(wm) {
    return wm.getMostRecentlyFocusedWindow?.() || wm.getPrimaryWindow?.() || wm.getAllWindows?.()[0] || null;
}

/** Build (or reuse) the two views and dock them. */
async function open(extensionId, o = {}, wm) {
    const wd = _activeWindow(wm);
    if (!wd?.window)
        throw new Error('no window');
    const rel = pathFor(extensionId, o.tabId);
    if (!rel)
        throw new Error('No side panel path set for this extension');
    const url = `chrome-extension://${extensionId}/${String(rel).replace(/^\/+/, '')}`;

    // The panel page has to run in the session its extension is loaded into,
    // or chrome.* inside it resolves to nothing.
    let session = null;
    try {
        const profiles = require('./profiles');
        session = profiles.sessionFor(wd.profileId || '1');
    }
    catch { }

    if (!wd.sidePanelHeader) {
        const header = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, '../preload/side-panel-preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        header.setBackgroundColor('#00000000');
        wd.sidePanelHeader = header;
        wd.window.contentView.addChildView(header);
        // Keep the load promise: the title is sent below, and a send that lands
        // before the page is ready is silently dropped.
        wd.sidePanelHeaderReady = new Promise((res) => {
            header.webContents.once('did-finish-load', () => res());
        });
        header.webContents.loadFile(resolveAppFile('renderer/SidePanel/index.html'));
    }
    // Rebuild the content view when the session changes — a view's session is
    // fixed at construction, and the user may have switched spaces.
    if (wd.sidePanel && wd.sidePanelSession !== session) {
        try { wd.window.contentView.removeChildView(wd.sidePanel); }
        catch { }
        try { wd.sidePanel.webContents.close(); }
        catch { }
        wd.sidePanel = null;
    }
    if (!wd.sidePanel) {
        const view = new WebContentsView({
            webPreferences: {
                ...(session ? { session } : {}),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        try { view.setBorderRadius(10); }
        catch { }
        wd.sidePanel = view;
        wd.sidePanelSession = session;
        wd.window.contentView.addChildView(view);
    }
    if (wd.sidePanelUrl !== url) {
        wd.sidePanelUrl = url;
        try { await wd.sidePanel.webContents.loadURL(url); }
        catch (e) { throw new Error(`side panel failed to load: ${e.message}`); }
    }
    wd.sidePanelExtId = extensionId;
    wd.sidePanelOpen = true;
    if (wd.tabs)
        wd.tabs.sidePanelWidth = widthFor(wd);
    layout(wd);
    try { wd.sidePanel.setVisible(true); }
    catch { }
    try { wd.sidePanelHeader.setVisible(true); }
    catch { }
    // Title for the header strip.
    let name = extensionId;
    try {
        const extensions = require('./extensions');
        name = extensions.list().find(r => r.id === extensionId)?.name || extensionId;
    }
    catch { }
    try {
        await wd.sidePanelHeaderReady;
        wd.sidePanelHeader.webContents.send('side-panel-info', { name });
    }
    catch { }
    try { wd.tabs?.resizeAllTabs(); }
    catch { }
    return true;
}

function close(wd) {
    if (!wd?.sidePanelOpen)
        return false;
    wd.sidePanelOpen = false;
    try { wd.sidePanel?.setVisible(false); }
    catch { }
    try { wd.sidePanelHeader?.setVisible(false); }
    catch { }
    if (wd.tabs)
        wd.tabs.sidePanelWidth = 0;
    try { wd.tabs?.resizeAllTabs(); }
    catch { }
    return true;
}

/** Position both views in the column the page layout has reserved. */
function layout(wd) {
    if (!wd?.sidePanelOpen || !wd.window || !wd.tabs)
        return;
    // getTabBounds() has already reserved PANEL_WIDTH on the right, so the
    // column starts exactly where the page ends. GAP keeps the two cards apart.
    const GAP = 6;
    const page = wd.tabs.getTabBounds();
    const x = page.x + page.width + GAP;
    const width = Math.max(0, wd.tabs.sidePanelWidth - GAP);
    try {
        wd.sidePanelHeader?.setBounds({ x, y: page.y, width, height: HEADER_H });
        wd.sidePanel?.setBounds({
            x, y: page.y + HEADER_H,
            width,
            height: Math.max(0, page.height - HEADER_H),
        });
    }
    catch { }
}

/**
 * Re-clamp the reserved width before the page bounds are computed. Tabs calls
 * this at the top of resizeAllTabs(), so a window resize never lays the page
 * out against a stale panel width.
 */
function syncWidth(wd) {
    if (wd?.tabs && wd.sidePanelOpen)
        wd.tabs.sidePanelWidth = widthFor(wd);
}

module.exports = {
    setOptions, getOptions, setPanelBehavior, shouldOpenOnActionClick,
    onBehaviorChanged, openOnActionClickIds,
    open, close, layout, syncWidth, pathFor,
    PANEL_WIDTH, HEADER_H,
};
