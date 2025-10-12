const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('findAPI', {
    search: (searchTerm) => ipcRenderer.invoke('find-search', searchTerm),
    findNext: () => ipcRenderer.invoke('find-next'),
    findPrevious: () => ipcRenderer.invoke('find-previous'),
    clearSearch: () => ipcRenderer.invoke('find-clear'),
    close: () => ipcRenderer.invoke('find-close'),
    
    onMatchesUpdated: (callback) => {
        ipcRenderer.on('find-matches-updated', (event, current, total) => {
            callback(current, total);
        });
    }
});