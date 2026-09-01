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
/* The theme, same bootstrap the other overlay preloads carry. Read synchronously
   so the first paint is already right, then FOLLOW 'theme-changed' — that message
   carries this window's SPACE theme. Reading only the global setting (as before)
   left the panel in the stock palette while the chrome wore the space's theme. */
try {
    const settings = ipcRenderer.sendSync('settings-get-sync');
    if (settings && settings.theme && settings.theme !== 'default') {
        const applyTheme = () => document.documentElement.setAttribute('data-theme', settings.theme);
        if (document.documentElement)
            applyTheme();
        else
            document.addEventListener('DOMContentLoaded', applyTheme);
    }
}
catch (e) { /* no settings yet: the default palette is the right fallback */ }
ipcRenderer.on('theme-changed', (_e, theme) => {
    if (theme && theme !== 'default')
        document.documentElement.setAttribute('data-theme', theme);
    else
        document.documentElement.removeAttribute('data-theme');
});
contextBridge.exposeInMainWorld('siteInfoApi', {
    getInfo: () => ipcRenderer.invoke('site-info-current'),
    setPermission: (name, value) => ipcRenderer.invoke('site-permission-set', name, value),
    setProtection: (off) => ipcRenderer.invoke('site-protection-set', off),
    clearData: () => ipcRenderer.invoke('site-clear-data'),
    resize: (height) => ipcRenderer.invoke('site-info-resize', height),
    close: () => ipcRenderer.invoke('close-site-info'),
});
