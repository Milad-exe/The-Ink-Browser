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
contextBridge.exposeInMainWorld('glanceBar', {
    close: () => ipcRenderer.send('glance:bar-close'),
    promote: () => ipcRenderer.send('glance:bar-promote'),
});
