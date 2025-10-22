const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
    "tab", {
        add: () => ipcRenderer.invoke("addTab"),
        remove: (index) => ipcRenderer.invoke("removeTab", index),
        switch: (index) => ipcRenderer.invoke("switchTab", index),
        loadUrl: (index, url) => ipcRenderer.invoke("loadUrl", index, url),
        goBack: (index) => ipcRenderer.invoke("goBack", index),
        goForward: (index) => ipcRenderer.invoke("goForward", index),
        reload: (index) => ipcRenderer.invoke("reload", index),
        getTabUrl: (index) => ipcRenderer.invoke("getTabUrl", index),
        
        onTabCreated: (callback) => ipcRenderer.on('tab-created', callback),
        onTabRemoved: (callback) => ipcRenderer.on('tab-removed', callback),
        onTabSwitched: (callback) => ipcRenderer.on('tab-switched', callback),
        onUrlUpdated: (callback) => ipcRenderer.on('url-updated', callback),
        onNavigationUpdated: (callback) => ipcRenderer.on('navigation-updated', callback)
    }
);

contextBridge.exposeInMainWorld(
    "dragdrop", {
        getWindowAtPoint: (screenX, screenY) => ipcRenderer.invoke('get-window-at-point', screenX, screenY),
        getThisWindowId: () => ipcRenderer.invoke('get-this-window-id'),
        moveTabToWindow: (fromWindowId, tabIndex, targetWindowId, url) => ipcRenderer.invoke('move-tab-to-window', fromWindowId, tabIndex, targetWindowId, url),
        detachToNewWindow: (tabIndex, screenX, screenY, url) => ipcRenderer.invoke('detach-to-new-window', tabIndex, screenX, screenY, url)
    }
);

contextBridge.exposeInMainWorld(
    "menu", {
        open: () => ipcRenderer.invoke('open'),
        close: () => ipcRenderer.invoke('close-menu'),
        onClosed: (callback) => ipcRenderer.on('menu-closed', callback)
    }
);

contextBridge.exposeInMainWorld(
    "browserHistory", {
        get: () => ipcRenderer.invoke('history-get'),
        remove: (url, timestamp) => ipcRenderer.invoke('remove-history-entry', url, timestamp)
    }
);

contextBridge.exposeInMainWorld("electronAPI", {
  windowClick: (pos) => ipcRenderer.send("window-click", pos),
  
  onShowFindInPage: (callback) => ipcRenderer.on('show-find-in-page', callback)
});
