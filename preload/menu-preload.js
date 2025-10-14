const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {
  windowClick: (pos) => ipcRenderer.send("window-click", pos),
  addTab: () => ipcRenderer.invoke("addTab"),
  newWindow: () => ipcRenderer.invoke("newWindow"),
  openHistoryTab: () => ipcRenderer.invoke("open-history-tab"),
  closeMenu: () => ipcRenderer.invoke("close-menu")
});
