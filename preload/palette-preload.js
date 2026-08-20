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
// The palette needs both its overlay lifecycle and a few internal bridges, and a
// view gets exactly one preload — so the handful it uses are re-exposed here
// rather than pulling in the whole shared preload.
contextBridge.exposeInMainWorld('overlayPalette', {
    onOpen: (cb) => ipcRenderer.on('palette:data', (_e, d) => cb(d)),
    done: () => ipcRenderer.send('palette:done'),
    dismiss: () => ipcRenderer.send('palette:dismiss'),
});
contextBridge.exposeInMainWorld('tab', {
    add: () => ipcRenderer.invoke('addTab'),
    loadUrl: (index, url) => ipcRenderer.invoke('loadUrl', index, url),
});
contextBridge.exposeInMainWorld('browserHistory', {
    search: (query, limit) => ipcRenderer.invoke('history-search', query, limit),
    // history-search returns nothing for an empty query, so the palette needs
    // the raw list to show anything before you type.
    recent: () => ipcRenderer.invoke('history-get'),
    // Local cache only — never a network fetch, so typing cannot ping every
    // domain you have ever visited.
    cachedFavicon: (host) => ipcRenderer.invoke('favicon-cached', host),
});
contextBridge.exposeInMainWorld('browserBookmarks', {
    getAll: () => ipcRenderer.invoke('bookmarks-get'),
});
