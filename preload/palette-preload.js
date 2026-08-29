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
/* The theme, same bootstrap every other overlay preload carries — the palette
   had none, so it came up in the stock palette while the chrome around it wore
   the space's theme. Read synchronously at construction so the first paint is
   already right, then followed on every change. */
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
// The palette needs both its overlay lifecycle and a few internal bridges, and a
// view gets exactly one preload — so the handful it uses are re-exposed here
// rather than pulling in the whole shared preload.
contextBridge.exposeInMainWorld('overlayPalette', {
    onOpen: (cb) => ipcRenderer.on('palette:data', (_e, d) => cb(d)),
    // The palette covers the whole window, but it belongs to the PAGE — main
    // sends the page card's rect so the card can centre on it rather than on
    // the window (which put it 116px left of centre beside a sidebar).
    onFrame: (cb) => ipcRenderer.on('palette:frame', (_e, d) => cb(d)),
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
