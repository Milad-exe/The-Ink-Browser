const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {
  windowClick: (pos) => ipcRenderer.send("window-click", pos),
  addTab: () => ipcRenderer.invoke("addTab"),
  openHistoryTab: () => ipcRenderer.invoke("open-history-tab"),
  closeMenu: () => ipcRenderer.invoke("close-menu")
});
