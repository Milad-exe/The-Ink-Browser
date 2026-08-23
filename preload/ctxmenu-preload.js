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
// Bridge for the context-menu overlay view. A pick is reported as either a path
// of row indices (regular menus) or { emoji } (the picker) — main forwards it to
// the chrome, which owns the actual handlers.
contextBridge.exposeInMainWorld('overlayMenu', {
    onOpen: (cb) => ipcRenderer.on('ctxmenu:data', (_e, data) => cb(data)),
    // What should be showing right now — for the first open of a session, where
    // the push can beat the listener.
    ready: () => ipcRenderer.invoke('ctxmenu:ready'),
    pick: (result) => ipcRenderer.send('ctxmenu:pick', result),
    dismiss: () => ipcRenderer.send('ctxmenu:dismiss'),
});
