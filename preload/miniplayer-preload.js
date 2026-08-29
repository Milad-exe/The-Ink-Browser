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
// Match the browser's active theme.
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
contextBridge.exposeInMainWorld('miniPlayerApi', {
    action: (act, value) => ipcRenderer.invoke('mp-action', act, value),
    onState: (fn) => ipcRenderer.on('mp-state', (_e, s) => fn(s)),
});
