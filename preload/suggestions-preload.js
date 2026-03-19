const { contextBridge, ipcRenderer } = require('electron');

// Preload for the Suggestions Overlay WebContentsView
contextBridge.exposeInMainWorld('overlaySuggestions', {
  onData: (callback) => ipcRenderer.on('suggestions-data', (_e, payload) => callback(payload)),
  close: () => ipcRenderer.invoke('suggestions-close'),
  select: (item) => ipcRenderer.invoke('suggestions-select', item),
  pointerDown: () => ipcRenderer.invoke('suggestions-pointer-down')
});
