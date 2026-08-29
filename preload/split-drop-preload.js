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
contextBridge.exposeInMainWorld('splitDrop', {
    drop: (zone) => ipcRenderer.send('split-drop:drop', zone || null),
    cancel: () => ipcRenderer.send('split-drop:drop', null),
    // Drags visiting from another window never reach this view's own pointer
    // handlers — main feeds the zone in from its cursor poll instead.
    onHint: (fn) => ipcRenderer.on('split-drop:hint', (_e, zone) => fn(zone)),
    // The sheet is parked between drags rather than rebuilt — clear it on reuse.
    onReset: (fn) => ipcRenderer.on('split-drop:reset', () => fn()),
});
