/**
 * Extension API gap layer — adds chrome.tabCapture to extension service workers.
 *
 * WHAT IS MISSING: electron-chrome-extensions implements ten namespaces
 * (browserAction, commands, contextMenus, cookies, notifications, permissions,
 * runtime, tabs, webNavigation, windows) and Electron's own extension system
 * supplies the rest of the MV3 core — chrome.offscreen and runtime.getContexts
 * are native. chrome.tabCapture is supplied by neither, so an MV3 worker calling
 * it dies on "Cannot read properties of undefined (reading 'getMediaStreamId')".
 *
 * WHY THIS IS AWKWARD: two things defeat the obvious approach.
 *   1. A service-worker preload runs in an ISOLATED world, so assigning to
 *      globalThis.chrome here is invisible to the worker. Reaching it needs
 *      contextBridge.executeInMainWorld — the same route the library uses.
 *   2. The library calls Object.freeze(chrome) once it has installed its APIs,
 *      and preloads run in registration order — ours is after theirs, so the
 *      object is already frozen and a plain assignment silently does nothing.
 *      Hence the copy-and-rebind below rather than a mutation.
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Handed to the main world; it cannot reach ipcRenderer by itself.
const bridge = {
    getMediaStreamId: (options) => ipcRenderer.invoke('ext:getMediaStreamId', options),
    reportGap: (id, api) => { try { ipcRenderer.send('ext:unsupported', { id, api }); } catch { } },
    // chrome.scripting — Electron backs these with executeJavaScript/insertCSS.
    executeScript: (req) => ipcRenderer.invoke('ext:scripting.executeScript', req),
    insertCSS: (req) => ipcRenderer.invoke('ext:scripting.insertCSS', req),
    removeCSS: (req) => ipcRenderer.invoke('ext:scripting.removeCSS', req),
    // chrome.alarms — timers live in main so they survive worker suspension.
    alarmCreate: (req) => ipcRenderer.invoke('ext:alarms.create', req),
    alarmClear: (req) => ipcRenderer.invoke('ext:alarms.clear', req),
    alarmGet: (req) => ipcRenderer.invoke('ext:alarms.get', req),
    onAlarm: (cb) => ipcRenderer.on('ext:alarm', (_e, alarm) => cb(alarm)),
};

// Runs INSIDE the worker's own global scope.
function mainWorldScript() {
    const api = globalThis.__inkExtBridge;
    const current = globalThis.chrome;
    if (!api || !current)
        return;
    if (current.tabCapture && current.scripting && current.alarms)
        return;
    const tabCapture = current.tabCapture || {
        getMediaStreamId: (options = {}) => api.getMediaStreamId({
            targetTabId: options.targetTabId ?? null,
            consumerTabId: options.consumerTabId ?? null,
        }),
        capture: () => {
            api.reportGap(current.runtime && current.runtime.id, 'chrome.tabCapture.capture');
            return Promise.reject(new Error('chrome.tabCapture.capture is not implemented'));
        },
        getCapturedTabs: () => Promise.resolve([]),
        onStatusChanged: { addListener() { }, removeListener() { }, hasListener: () => false },
    };
    // chrome is frozen, so rebuild it with the extra namespace and rebind. The
    // binding itself is writable even though the object is not.
    const next = {};
    for (const key of Reflect.ownKeys(current)) {
        const desc = Object.getOwnPropertyDescriptor(current, key);
        try { Object.defineProperty(next, key, desc); }
        catch { }
    }
    Object.defineProperty(next, 'tabCapture', { value: tabCapture, enumerable: true, configurable: true });

    // ── chrome.scripting ──────────────────────────────────────────────────
    // MV3's content-injection API. func/args are stringified here because a
    // function cannot cross IPC; files are read and evaluated in main.
    if (!current.scripting) {
        const scripting = {
            executeScript: (injection = {}) => api.executeScript({
                target: injection.target || {},
                files: injection.files || null,
                world: injection.world || 'ISOLATED',
                args: injection.args || [],
                source: typeof injection.func === 'function' ? injection.func.toString() : null,
            }),
            insertCSS: (injection = {}) => api.insertCSS({
                target: injection.target || {}, css: injection.css || null, files: injection.files || null,
            }),
            removeCSS: (injection = {}) => api.removeCSS({
                target: injection.target || {}, key: injection.key || null,
            }),
            registerContentScripts: () => Promise.resolve(),
            getRegisteredContentScripts: () => Promise.resolve([]),
            unregisterContentScripts: () => Promise.resolve(),
            updateContentScripts: () => Promise.resolve(),
        };
        Object.defineProperty(next, 'scripting', { value: scripting, enumerable: true, configurable: true });
    }

    // ── chrome.alarms ─────────────────────────────────────────────────────
    if (!current.alarms) {
        const listeners = new Set();
        api.onAlarm((alarm) => { for (const fn of listeners) { try { fn(alarm); } catch { } } });
        const alarms = {
            create: (name, info) => {
                if (typeof name === 'object') { info = name; name = ''; }
                return api.alarmCreate({ name: name || '', info: info || {} });
            },
            clear: (name) => api.alarmClear({ name: name || '' }),
            clearAll: () => api.alarmClear({ all: true }),
            get: (name) => api.alarmGet({ name: name || '' }),
            getAll: () => api.alarmGet({ all: true }),
            onAlarm: {
                addListener: (fn) => listeners.add(fn),
                removeListener: (fn) => listeners.delete(fn),
                hasListener: (fn) => listeners.has(fn),
            },
        };
        Object.defineProperty(next, 'alarms', { value: alarms, enumerable: true, configurable: true });
    }
    try { globalThis.chrome = next; }
    catch { }
}

try {
    if (!process.contextIsolated) {
        // No isolation: this scope IS the worker's, so run it directly.
        globalThis.__inkExtBridge = bridge;
        mainWorldScript();
    }
    else {
        contextBridge.exposeInMainWorld('__inkExtBridge', bridge);
        if ('executeInMainWorld' in contextBridge)
            contextBridge.executeInMainWorld({ func: mainWorldScript });
        else
            console.warn('[ink] executeInMainWorld unavailable — chrome.tabCapture not installed');
    }
}
catch (e) {
    try { console.warn('[ink] extension polyfill failed:', e && e.message); }
    catch { }
}
