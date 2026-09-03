const { contextBridge, ipcRenderer } = require('electron');
// Match the app's theme the way the other overlay windows do.
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
contextBridge.exposeInMainWorld('nsImport', {
    sources: () => ipcRenderer.invoke('import-wizard:sources'),
    run: (id, types) => ipcRenderer.invoke('import-wizard:run', id, types),
    html: () => ipcRenderer.invoke('import-wizard:html'),
    // Passwords are wrapped by the OS keystore in every browser, so they come in
    // through the existing CSV importer rather than being decrypted here.
    passwordsCsv: () => ipcRenderer.invoke('data:import-passwords'),
    close: () => ipcRenderer.invoke('import-wizard:close'),
});
