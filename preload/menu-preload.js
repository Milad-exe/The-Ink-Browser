const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {
  windowClick: (pos) => ipcRenderer.send("window-click", pos),
  addTab: () => ipcRenderer.invoke("addTab"),
  newWindow: () => ipcRenderer.invoke("newWindow"),
  openHistoryTab: () => ipcRenderer.invoke("open-history-tab"),
  closeMenu: () => ipcRenderer.invoke("close-menu")
});

// Expose persistence controls to the menu renderer
contextBridge.exposeInMainWorld('persist', {
  getMode: () => ipcRenderer.invoke('getPersistMode'),
  setMode: (enabled) => ipcRenderer.invoke('setPersistMode', enabled),
});
