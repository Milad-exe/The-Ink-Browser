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

contextBridge.exposeInMainWorld("electronAPI", {
  windowClick: (pos) => ipcRenderer.send("window-click", pos),
  addTab: () => ipcRenderer.invoke("addTab"),
  newWindow: () => ipcRenderer.invoke("newWindow"),
  openHistoryTab: () => ipcRenderer.invoke("open-history-tab"),
  openBookmarksTab: () => ipcRenderer.invoke("open-bookmarks-tab"),
  openSettingsTab: () => ipcRenderer.invoke("open-settings-tab"),
  closeMenu: () => ipcRenderer.invoke("close-menu"),
  toggleBookmarkBar: () => ipcRenderer.send("toggle-bookmark-bar"),
});

// Expose persistence controls to the menu renderer
contextBridge.exposeInMainWorld('persist', {
  getMode: () => ipcRenderer.invoke('getPersistMode'),
  setMode: (enabled) => ipcRenderer.invoke('setPersistMode', enabled),
});
