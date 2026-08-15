const { contextBridge, ipcRenderer } = require('electron');
// Bridge for the context-menu overlay view. A pick is reported as either a path
// of row indices (regular menus) or { emoji } (the picker) — main forwards it to
// the chrome, which owns the actual handlers.
contextBridge.exposeInMainWorld('overlayMenu', {
    onOpen: (cb) => ipcRenderer.on('ctxmenu:data', (_e, data) => cb(data)),
    pick: (result) => ipcRenderer.send('ctxmenu:pick', result),
    dismiss: () => ipcRenderer.send('ctxmenu:dismiss'),
});
