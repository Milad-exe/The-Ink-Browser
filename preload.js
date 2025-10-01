const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
    
    //TAB FUNCTIONS
    "tab", {
        add: () => ipcRenderer.invoke("addTab"),
        remove: (index) => ipcRenderer.invoke("removeTab", index),
        switch: (index) => ipcRenderer.invoke("switchTab", index),
        loadUrl: (index, url) => ipcRenderer.invoke("loadUrl", index, url),
        
        // Listen for tab events from main process
        onTabCreated: (callback) => ipcRenderer.on('tab-created', callback),
        onTabRemoved: (callback) => ipcRenderer.on('tab-removed', callback),
        onTabSwitched: (callback) => ipcRenderer.on('tab-switched', callback),
        onUrlUpdated: (callback) => ipcRenderer.on('url-updated', callback)
    }
);