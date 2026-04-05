const { contextBridge, ipcRenderer } = require('electron');

try {
    const settings = ipcRenderer.sendSync('settings-get-sync');
    if (settings && settings.theme && settings.theme !== 'default') {
        const applyTheme = () => document.documentElement.setAttribute('data-theme', settings.theme);
        if (document.documentElement) applyTheme();
        else document.addEventListener('DOMContentLoaded', applyTheme);
    }
} catch (e) {}

ipcRenderer.on('theme-changed', (e, theme) => {
    if (theme && theme !== 'default') {
        document.documentElement.setAttribute('data-theme', theme);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
});

contextBridge.exposeInMainWorld('inkSettings', {
  get:          ()          => ipcRenderer.invoke('settings-get'),
  set:          (key, val)  => ipcRenderer.invoke('settings-set', key, val),
  clearHistory: ()          => ipcRenderer.invoke('settings-clear-history'),
  toggleBookmarkBar: ()     => ipcRenderer.send('toggle-bookmark-bar'),
  openHistoryTab:  ()       => ipcRenderer.invoke('open-history-tab'),
  openBookmarksTab: ()      => ipcRenderer.invoke('open-bookmarks-tab'),
});

document.addEventListener('mousedown', () => {
  try { ipcRenderer.send('content-view-click'); } catch {}
}, true);
