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
catch (e) { }
ipcRenderer.on('theme-changed', (_e, theme) => {
    if (theme && theme !== 'default') {
        document.documentElement.setAttribute('data-theme', theme);
    }
    else {
        document.documentElement.removeAttribute('data-theme');
    }
});
contextBridge.exposeInMainWorld('findAPI', {
    search: (searchTerm) => ipcRenderer.invoke('find-search', searchTerm),
    findNext: () => ipcRenderer.invoke('find-next'),
    findPrevious: () => ipcRenderer.invoke('find-previous'),
    clearSearch: () => ipcRenderer.invoke('find-clear'),
    close: () => ipcRenderer.invoke('find-close'),
    onMatchesUpdated: (callback) => {
        ipcRenderer.on('find-matches-updated', (_e, current, total) => {
            callback(current, total);
        });
    }
});
