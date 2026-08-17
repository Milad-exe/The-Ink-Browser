const { contextBridge, ipcRenderer } = require('electron');
// macOS frosted-glass flag (Settings runs with this preload).
try {
    if (process.platform === 'darwin') {
        const mark = () => document.documentElement.setAttribute('data-vibrancy', 'true');
        if (document.documentElement)
            mark();
        else
            document.addEventListener('DOMContentLoaded', mark);
    }
}
catch (e) { }
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
contextBridge.exposeInMainWorld('northstarSettings', {
    get: () => ipcRenderer.invoke('settings-get'),
    set: (key, val) => ipcRenderer.invoke('settings-set', key, val),
    clearHistory: () => ipcRenderer.invoke('settings-clear-history'),
    clearBrowsingData: (opts) => ipcRenderer.invoke('clear-browsing-data', opts),
    privacyStats: () => ipcRenderer.invoke('privacy-get-stats'),
    toggleBookmarkBar: () => ipcRenderer.send('toggle-bookmark-bar'),
    openHistoryTab: () => ipcRenderer.invoke('open-history-tab'),
    openBookmarksTab: () => ipcRenderer.invoke('open-bookmarks-tab'),
    cachedFavicon: (host) => ipcRenderer.invoke('favicon-cached', host),
});
// Search engines, per-site zoom, import/export, updates, diagnostics — the
// Settings page is the only surface that manages these.
contextBridge.exposeInMainWorld('northstarEngines', {
    list: () => ipcRenderer.invoke('engines:list'),
    save: (engine) => ipcRenderer.invoke('engines:save', engine),
    remove: (id) => ipcRenderer.invoke('engines:remove', id),
    onChanged: (cb) => ipcRenderer.on('engines-changed', (_e, list) => cb(list)),
});
contextBridge.exposeInMainWorld('northstarI18n', {
    locales: () => ipcRenderer.invoke('i18n:locales'),
    set: (id) => ipcRenderer.invoke('i18n:set', id),
});
contextBridge.exposeInMainWorld('northstarZoom', {
    list: () => ipcRenderer.invoke('zoom:list'),
    clear: (origin) => ipcRenderer.invoke('zoom:clear', origin),
});
contextBridge.exposeInMainWorld('userData', {
    importBookmarks: () => ipcRenderer.invoke('data:import-bookmarks'),
    exportBookmarks: () => ipcRenderer.invoke('data:export-bookmarks'),
    importPasswords: () => ipcRenderer.invoke('data:import-passwords'),
    exportPasswords: () => ipcRenderer.invoke('data:export-passwords'),
    exportHistory: () => ipcRenderer.invoke('data:export-history'),
    reveal: (p) => ipcRenderer.invoke('data:reveal', p),
    clearCertExceptions: () => ipcRenderer.invoke('cert:clear-exceptions'),
    checkUpdate: (force) => ipcRenderer.invoke('app:check-update', force),
    openRelease: (url) => ipcRenderer.invoke('app:open-release', url),
    defaultBrowserStatus: () => ipcRenderer.invoke('app:default-browser-status'),
    makeDefaultBrowser: () => ipcRenderer.invoke('app:make-default-browser'),
    keyProtection: () => ipcRenderer.invoke('app:key-protection'),
    openLog: () => ipcRenderer.invoke('app:open-log'),
    logTail: () => ipcRenderer.invoke('app:log-tail'),
    versions: () => ipcRenderer.invoke('app:version'),
});
contextBridge.exposeInMainWorld('northstarPasswords', {
    list: () => ipcRenderer.invoke('passwords-list'),
    reveal: (id) => ipcRenderer.invoke('passwords-reveal', id),
    remove: (id) => ipcRenderer.invoke('passwords-delete', id),
    onChanged: (cb) => ipcRenderer.on('passwords-changed', () => cb()),
});
contextBridge.exposeInMainWorld('northstarExtensions', {
    list: () => ipcRenderer.invoke('extensions-list'),
    add: (mode) => ipcRenderer.invoke('extensions-add', mode),
    installId: (idOrUrl) => ipcRenderer.invoke('extensions-install-id', idOrUrl),
    openStore: () => ipcRenderer.invoke('extensions-open-store'),
    remove: (id) => ipcRenderer.invoke('extensions-remove', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('extensions-set-enabled', id, enabled),
    openOptions: (id) => ipcRenderer.invoke('extensions-open-options', id),
    onChanged: (cb) => ipcRenderer.on('extensions-changed', () => cb()),
});
document.addEventListener('mousedown', (e) => {
    if (e.button !== 0)
        return;
    try {
        ipcRenderer.send('content-view-click');
    }
    catch { }
}, true);
