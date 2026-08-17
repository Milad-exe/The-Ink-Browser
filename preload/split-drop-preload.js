const { contextBridge, ipcRenderer } = require('electron');
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
