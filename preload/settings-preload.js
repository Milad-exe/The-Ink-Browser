const { contextBridge, ipcRenderer } = require('electron');

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
