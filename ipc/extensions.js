/**
 * IPC handlers — extension management (Settings page).
 *
 * Browser-action buttons/popups are handled by the <browser-action-list>
 * element (electron-chrome-extensions), not here.
 */
const path = require('path');
const { dialog, WebContentsView } = require('electron');
const { resolveAppFile } = require('../app-paths');
const extensions = require('../features/extensions');
const WEB_STORE_URL = 'https://chromewebstore.google.com/';
// ── Toolbar panel (puzzle icon) — same overlay pattern as the downloads panel ──
const PANEL_WIDTH = 320;
const HEADER_H = 38;
const FOOTER_H = 40;
const ITEM_H = 46;
const MAX_PANEL_H = 430;
function panelBounds(anchor, count) {
    const height = Math.min(MAX_PANEL_H, HEADER_H + FOOTER_H + Math.max(1, count) * ITEM_H + 2);
    return {
        x: Math.max(0, Math.floor(anchor.right - PANEL_WIDTH)),
        y: Math.floor(anchor.bottom + 6),
        width: PANEL_WIDTH,
        height,
    };
}
async function ensurePanel(wd) {
    if (wd.extensionsPanel) {
        if (wd.extensionsPanelReady)
            await wd.extensionsPanelReady;
        return wd.extensionsPanel;
    }
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, '../preload/extensions-panel-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    view.setBackgroundColor('#00000000');
    try { view.setBorderRadius(12) } catch {}
    view.setVisible(false);
    wd.extensionsPanel = view;
    wd.window.contentView.addChildView(view);
    view.webContents.loadFile(resolveAppFile('renderer/ExtensionsPanel/index.html'));
    wd.extensionsPanelReady = new Promise(res => view.webContents.once('did-finish-load', () => res()));
    await wd.extensionsPanelReady;
    return view;
}
function hidePanel(wd) {
    if (!wd?.extensionsPanel)
        return false;
    try {
        wd.extensionsPanel.setVisible(false);
        wd.extensionsPanelOpen = false;
        try {
            wd.window.webContents.send('extensions-panel-closed');
        }
        catch { }
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Gap-layer handlers (see preload/ext-polyfill.js). Bound per service worker,
 * because a worker's IPC router is its own — not the global ipcMain.
 */
// Resolve a path inside the calling extension's own directory, refusing to
// escape it — the source is extension-controlled.
function _resolveExtensionFile(event, rel) {
    try {
        const { session } = event.serviceWorker;
        const id = new URL(event.serviceWorker.scope).hostname;
        const ext = (session.extensions || session).getAllExtensions?.().find((e) => e.id === id);
        if (!ext) return null;
        const base = path.resolve(ext.path);
        const abs = path.resolve(base, rel.replace(/^\/+/, ''));
        return abs.startsWith(base) && fs.existsSync(abs) ? abs : null;
    }
    catch { return null; }
}
function attachGapHandlers(router, wm) {
    // ── Extension API gap layer (see preload/ext-polyfill.js) ─────────────────
    const { webContents } = require('electron');
    // electron-chrome-extensions uses the webContents id as the chrome tab id.
    const tabWcById = (id) => {
        if (id == null) return null;
        try { return webContents.fromId(Number(id)) || null; }
        catch { return null; }
    };
    router.handle('ext:getMediaStreamId', (_e, { targetTabId, consumerTabId } = {}) => {
        // Chrome hands back an id the CONSUMER can pass to getUserMedia with
        // chromeMediaSource:'tab'. Electron's equivalent is target.getMediaSourceId
        // (requestWebContents), so both ends have to resolve to real contents.
        const target = tabWcById(targetTabId) || wm.getPrimaryWindow()?.tabs?.tabMap?.get(wm.getPrimaryWindow()?.tabs?.activeTabIndex)?.webContents;
        if (!target)
            throw new Error('tabCapture: no target tab');
        // A service-worker IPC event has no .sender, so resolve the consumer
        // ourselves: the extension's own page (its offscreen document is what
        // calls getUserMedia), else the chrome window.
        const extOrigin = _e.serviceWorker?.scope || '';
        const consumer = tabWcById(consumerTabId)
            || (extOrigin ? webContents.getAllWebContents().find(w => {
                try { return w.getURL().startsWith(extOrigin); }
                catch { return false; }
            }) : null)
            || wm.getPrimaryWindow()?.window?.webContents;
        if (!consumer)
            throw new Error('tabCapture: no consumer context');
        try {
            return target.getMediaSourceId(consumer);
        }
        catch (err) {
            throw new Error('tabCapture: ' + err.message);
        }
    });
    // Contexts we can actually account for. Offscreen documents are unsupported,
    // so an OFFSCREEN_DOCUMENT filter correctly comes back empty rather than
    // claiming one exists.
    router.handle('ext:getContexts', (_e, { filter } = {}) => {
        const types = filter?.contextTypes;
        if (Array.isArray(types) && !types.includes('BACKGROUND') && !types.includes('SERVICE_WORKER'))
            return [];
        return [{ contextType: 'SERVICE_WORKER', contextId: String(_e.sender.id), documentUrl: undefined, incognito: false }];
    });
    // ── chrome.scripting ─────────────────────────────────────────────────────
    const targetWc = (target = {}) => tabWcById(target.tabId);
    router.handle('ext:scripting.executeScript', async (_e, { target, files, source, args } = {}) => {
        const wc = targetWc(target);
        if (!wc)
            throw new Error('scripting: no such tab');
        const results = [];
        const run = async (code) => {
            const value = await wc.executeJavaScript(code, true);
            results.push({ frameId: 0, result: value });
        };
        if (source) {
            // The function arrived as source text; call it with its args applied.
            await run(`(${source}).apply(null, ${JSON.stringify(args || [])})`);
        }
        for (const rel of files || []) {
            const abs = _resolveExtensionFile(_e, rel);
            if (abs) await run(fs.readFileSync(abs, 'utf-8'));
        }
        return results;
    });
    router.handle('ext:scripting.insertCSS', async (_e, { target, css, files } = {}) => {
        const wc = targetWc(target);
        if (!wc)
            throw new Error('scripting: no such tab');
        const keys = [];
        if (css)
            keys.push(await wc.insertCSS(css));
        for (const rel of files || []) {
            const abs = _resolveExtensionFile(_e, rel);
            if (abs) keys.push(await wc.insertCSS(fs.readFileSync(abs, 'utf-8')));
        }
        return keys;
    });
    router.handle('ext:scripting.removeCSS', async (_e, { target, key } = {}) => {
        const wc = targetWc(target);
        if (wc && key)
            try { await wc.removeInsertedCSS(key); }
            catch { }
        return true;
    });
    // ── chrome.alarms ────────────────────────────────────────────────────────
    // Timers live here rather than in the worker, so an alarm still fires after
    // the service worker is suspended — which is the whole point of the API.
    const alarms = new Map(); // name → { name, periodInMinutes, scheduledTime, timer }
    const fire = (sw, name) => {
        const a = alarms.get(name);
        if (!a) return;
        try { sw.send('ext:alarm', { name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes }); }
        catch { }
        if (a.periodInMinutes) {
            a.scheduledTime = Date.now() + a.periodInMinutes * 60000;
            a.timer = setTimeout(() => fire(sw, name), a.periodInMinutes * 60000);
        }
        else {
            alarms.delete(name);
        }
    };
    router.handle('ext:alarms.create', (_e, { name, info } = {}) => {
        const key = name || '';
        const existing = alarms.get(key);
        if (existing?.timer) clearTimeout(existing.timer);
        const delayMs = info?.when ? Math.max(0, info.when - Date.now())
            : (info?.delayInMinutes ?? info?.periodInMinutes ?? 0) * 60000;
        const rec = {
            name: key,
            periodInMinutes: info?.periodInMinutes || null,
            scheduledTime: Date.now() + delayMs,
            timer: null,
        };
        rec.timer = setTimeout(() => fire(_e.serviceWorker, key), delayMs);
        alarms.set(key, rec);
        return true;
    });
    router.handle('ext:alarms.clear', (_e, { name, all } = {}) => {
        const drop = (k) => { const a = alarms.get(k); if (a?.timer) clearTimeout(a.timer); alarms.delete(k); };
        if (all) { for (const k of [...alarms.keys()]) drop(k); return true; }
        drop(name || '');
        return true;
    });
    router.handle('ext:alarms.get', (_e, { name, all } = {}) => {
        const pub = (a) => ({ name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes });
        if (all) return [...alarms.values()].map(pub);
        const a = alarms.get(name || '');
        return a ? pub(a) : undefined;
    });
    // One line per missing API, so the next gap is named in the log.
    const seenGaps = new Set();
    router.on('ext:unsupported', (_e, { id, api } = {}) => {
        const key = `${id}:${api}`;
        if (seenGaps.has(key)) return;
        seenGaps.add(key);
        console.warn(`[extensions] ${id} needs ${api}, which this browser does not implement`);
    });
}

function register(ipcMain, { wm }) {
    extensions.onChanged(() => {
        for (const wd of wm.getAllWindows()) {
            try {
                wd.window.webContents.send('extensions-changed');
            }
            catch { }
            if (wd.extensionsPanel) {
                try {
                    wd.extensionsPanel.webContents.send('extensions-data', listWithPinned());
                }
                catch { }
            }
        }
    });
    ipcMain.handle('extensions-list', () => listWithPinned());
    ipcMain.handle('extensions-remove', (_e, id) => extensions.remove(id));
    ipcMain.handle('extensions-set-enabled', (_e, id, enabled) => extensions.setEnabled(id, enabled));
    ipcMain.handle('extensions-open-options', (_e, id) => extensions.openOptions(id));
    // Install by Chrome Web Store ID or URL.
    ipcMain.handle('extensions-install-id', async (_e, idOrUrl) => {
        try {
            const info = await extensions.installById(idOrUrl);
            return { ok: true, ...info };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    // mode: 'unpacked' (folder) | 'crx' (file)
    ipcMain.handle('extensions-add', async (_e, mode) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        const parent = wd?.window;
        const opts = mode === 'crx'
            ? { title: 'Select extension (.crx)', properties: ['openFile'], filters: [{ name: 'Chrome Extension', extensions: ['crx', 'zip'] }] }
            : { title: 'Select unpacked extension folder', properties: ['openDirectory'] };
        try {
            const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
            if (res.canceled || !res.filePaths?.length)
                return { canceled: true };
            const info = mode === 'crx'
                ? await extensions.installCrx(res.filePaths[0])
                : await extensions.installUnpacked(res.filePaths[0]);
            return { ok: true, ...info };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    });
    // Open the Chrome Web Store and bring it into focus. If a store tab is
    // already open in the window, switch to it instead of opening another.
    ipcMain.handle('extensions-open-store', (_e) => {
        let wd = wm.getWindowByWebContents(_e.sender);
        if (!wd) {
            for (const w of wm.getAllWindows()) {
                if (w.extensionsPanel?.webContents === _e.sender) {
                    wd = w;
                    break;
                }
            }
        }
        if (!wd?.tabs)
            return false;
        for (const [idx, url] of wd.tabs.tabUrls) {
            if (typeof url === 'string' && url.includes('chromewebstore.google.com')) {
                try {
                    wd.tabs.showTab(idx);
                    wd.window.focus();
                }
                catch { }
                return true;
            }
        }
        const idx = wd.tabs.createLazyTab(WEB_STORE_URL, 'Chrome Web Store', false, false, true, true);
        try {
            wd.tabs.showTab(idx);
            wd.window.focus();
        }
        catch { }
        return true;
    });
    // Chrome clicks / page clicks dismiss an open action popup (Firefox behavior).
    ipcMain.handle('extensions-close-action-popup', () => {
        extensions.closePopups();
        return true;
    });
    // Firefox-style pinning: missing key = pinned (extensions land in the
    // toolbar on install; unpinning moves them into the puzzle panel only).
    const pinnedMap = () => wm.persistence.get('extPinned') || {};
    const listWithPinned = () => {
        const pinned = pinnedMap();
        return extensions.list().map(row => ({ ...row, pinned: pinned[row.id] !== false }));
    };
    ipcMain.handle('extensions-set-pinned', (_e, id, pinned) => {
        const map = { ...pinnedMap(), [id]: !!pinned };
        wm.persistence.set('extPinned', map);
        for (const wd of wm.getAllWindows()) {
            try {
                wd.window.webContents.send('ext-pinned-changed', map);
            }
            catch { }
            if (wd.extensionsPanel) {
                try {
                    wd.extensionsPanel.webContents.send('extensions-data', listWithPinned());
                }
                catch { }
            }
        }
        return true;
    });
    // Panel row click — activate the extension's action in the chrome page
    // (opens its popup / fires its onClicked), exactly like Firefox's panel.
    ipcMain.handle('extensions-activate', (_e, id) => {
        let wd = wm.getWindowByWebContents(_e.sender);
        if (!wd) {
            for (const w of wm.getAllWindows()) {
                if (w.extensionsPanel?.webContents === _e.sender) {
                    wd = w;
                    break;
                }
            }
        }
        if (!wd)
            return false;
        hidePanel(wd);
        try {
            wd.window.webContents.send('ext-activate-action', id);
        }
        catch { }
        return true;
    });
    // Toggle the panel under the puzzle toolbar button. Returns the new state.
    ipcMain.handle('extensions-panel-toggle', async (_e, anchor) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return false;
        if (wd.extensionsPanelOpen) {
            hidePanel(wd);
            return false;
        }
        extensions.closePopups(); // opening the panel dismisses any action popup
        try {
            const view = await ensurePanel(wd);
            const items = listWithPinned();
            view.setBounds(panelBounds(anchor, items.length));
            // Re-add on every open: newly created tab views would otherwise
            // sit above the panel in the contentView child order.
            try {
                wd.window.contentView.removeChildView(view);
            }
            catch { }
            try {
                wd.window.contentView.addChildView(view);
            }
            catch { }
            view.webContents.send('extensions-data', items);
            view.setVisible(true);
            wd.extensionsPanelOpen = true;
            return true;
        }
        catch (err) {
            console.error('extensions-panel-toggle:', err);
            return false;
        }
    });
    ipcMain.handle('extensions-panel-close', (_e) => {
        // Called from the chrome renderer OR from inside the panel itself.
        let wd = wm.getWindowByWebContents(_e.sender);
        if (!wd) {
            for (const w of wm.getAllWindows()) {
                if (w.extensionsPanel?.webContents === _e.sender) {
                    wd = w;
                    break;
                }
            }
        }
        return hidePanel(wd);
    });
}

module.exports = { attachGapHandlers, register };