/**
 * Extension API gap layer.
 *
 * electron-chrome-extensions implements ten chrome.* namespaces (browserAction,
 * commands, contextMenus, cookies, notifications, permissions, runtime, tabs,
 * webNavigation, windows) and Electron's own extension system supplies more
 * (storage, offscreen, runtime.getContexts …). chrome.tabCapture is supplied by
 * neither, so an MV3 worker calling it dies on "Cannot read properties of
 * undefined (reading 'getMediaStreamId')" with no clue which API was missing.
 *
 * TIMING: a service-worker preload runs BEFORE the extension system installs the
 * `chrome` global, so patching at load time is a no-op. We patch whatever is
 * already there, intercept the assignment, and retry a couple of times — one of
 * those wins whatever order the runtime chooses.
 */
'use strict';
let ipcRenderer = null;
try { ({ ipcRenderer } = require('electron')); }
catch { /* no IPC in this context — the shims below degrade to rejections */ }

function makeTabCapture() {
    const warn = (api, detail) => {
        try {
            const id = (globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id) || 'unknown';
            console.warn(`[ink] extension ${id} used ${api} — ${detail}`);
            ipcRenderer.send('ext:unsupported', { id, api });
        }
        catch { }
    };
    return {
        // Backed by webContents.getMediaSourceId in main — the same id Chrome
        // hands to getUserMedia with chromeMediaSource:'tab'.
        getMediaStreamId: (options = {}) =>
            ipcRenderer.invoke('ext:getMediaStreamId', {
                targetTabId: options.targetTabId ?? null,
                consumerTabId: options.consumerTabId ?? null,
            }),
        capture: () => {
            warn('chrome.tabCapture.capture', 'not implemented');
            return Promise.reject(new Error('chrome.tabCapture.capture is not implemented'));
        },
        getCapturedTabs: () => Promise.resolve([]),
        onStatusChanged: { addListener() { }, removeListener() { }, hasListener: () => false },
    };
}

function patch(c) {
    try {
        if (!c || typeof c !== 'object' || c.tabCapture)
            return c;
        c.tabCapture = makeTabCapture();
    }
    catch { }
    return c;
}

try {
    patch(globalThis.chrome);
    // Catch the moment the runtime installs `chrome`, if it has not already.
    if (!globalThis.chrome) {
        let held;
        Object.defineProperty(globalThis, 'chrome', {
            configurable: true,
            get() { return held; },
            set(v) { held = patch(v); },
        });
    }
    // Belt and braces: if `chrome` arrives as a non-configurable own property the
    // setter above never fires, so sweep again once the worker starts running.
    queueMicrotask(() => patch(globalThis.chrome));
    setTimeout(() => patch(globalThis.chrome), 0);
    setTimeout(() => patch(globalThis.chrome), 50);
}
catch (e) {
    try { console.warn('[ink] extension polyfill failed:', e && e.message); }
    catch { }
}
