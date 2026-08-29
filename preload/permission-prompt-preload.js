'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The catalogue, so this panel's labels follow the language setting. Inlined
// rather than required from a shared module: overlay preloads are SANDBOXED
// (only the chrome window sets sandbox:false), and a sandboxed preload can
// require 'electron' and nothing else.
try {
    contextBridge.exposeInMainWorld('northstarI18n', {
        getSync: () => { try { return ipcRenderer.sendSync('i18n-sync') || {}; } catch { return {}; } },
    });
}
catch { }
// Match the browser's active theme so the panel doesn't look out of place.
try {
    const s = ipcRenderer.sendSync('settings-get-sync');
    const theme = (s && s.theme) || 'default';
    const apply = () => document.documentElement.setAttribute('data-theme', theme);
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', apply);
    else
        apply();
}
catch { }
contextBridge.exposeInMainWorld('permissionUI', {
    onData: (cb) => ipcRenderer.on('permission-data', (_e, data) => cb(data)),
    decide: (id, allowed, remember, dismissed) => ipcRenderer.invoke('permission-decide', { id, allowed, remember, dismissed }),
    resize: (height) => ipcRenderer.invoke('permission-ui-resize', height),
});
