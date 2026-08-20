'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The catalogue, so this panel's labels follow the language setting. Inlined
// rather than required from a shared module: overlay preloads are SANDBOXED
// (only the chrome window sets sandbox:false), and a sandboxed preload can
// require 'electron' and nothing else.
try {
    contextBridge.exposeInMainWorld('inkI18n', {
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
contextBridge.exposeInMainWorld('siteInfoApi', {
    getInfo: () => ipcRenderer.invoke('site-info-current'),
    setPermission: (name, value) => ipcRenderer.invoke('site-permission-set', name, value),
    setProtection: (off) => ipcRenderer.invoke('site-protection-set', off),
    clearData: () => ipcRenderer.invoke('site-clear-data'),
    resize: (height) => ipcRenderer.invoke('site-info-resize', height),
    close: () => ipcRenderer.invoke('close-site-info'),
});
