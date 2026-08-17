const { contextBridge, ipcRenderer } = require('electron');
// Theme bootstrapping — same boilerplate as every overlay preload.
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
    if (theme && theme !== 'default')
        document.documentElement.setAttribute('data-theme', theme);
    else
        document.documentElement.removeAttribute('data-theme');
});
// One page serves three views; the hash says which one this is.
contextBridge.exposeInMainWorld('splitUI', {
    role: () => (location.hash || '').replace('#', '') || 'divider',
    // Resize: the pointer leaves this thin view almost immediately, so main
    // takes over the drag by watching the page views' input streams.
    resizeStart: () => ipcRenderer.send('split:resize-start'),
    resizeEnd: () => ipcRenderer.send('split:resize-end'),
    // Reposition this pane: 'left' | 'right' | 'top' | 'bottom'.
    move: (pane, dir) => ipcRenderer.send('split:move', pane, dir),
    onOrient: (fn) => ipcRenderer.on('split:orient', (_e, o) => fn(o)),
});
