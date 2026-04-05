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
        getButton: (index) => ipcRenderer.invoke("getTabButton", index),
        pin: (index) => ipcRenderer.invoke("pinTab", index),
    reorder: (order) => ipcRenderer.invoke('reorderTabs', order),
        onTabCreated: (callback) => ipcRenderer.on('tab-created', callback),
        onTabRemoved: (callback) => ipcRenderer.on('tab-removed', callback),
        onTabSwitched: (callback) => ipcRenderer.on('tab-switched', callback),
        onUrlUpdated: (callback) => ipcRenderer.on('url-updated', callback),
        onNavigationUpdated: (callback) => ipcRenderer.on('navigation-updated', callback)
    }
);

// Bridge for UI events emitted from main (via Tabs.pinTab -> 'pin-tab')
contextBridge.exposeInMainWorld('tabsUI', {
    onPinTab: (handler) => ipcRenderer.on('pin-tab', (_e, { index }) => handler(index)),
});

// Persistence controls
contextBridge.exposeInMainWorld('persist', {
    getMode: () => ipcRenderer.invoke('getPersistMode'),
    setMode: (enabled) => ipcRenderer.invoke('setPersistMode', enabled),
});

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
        search: (query, limit) => ipcRenderer.invoke('history-search', query, limit),
        remove: (url, timestamp) => ipcRenderer.invoke('remove-history-entry', url, timestamp)
    }
);

// Suggestions overlay controls from the main renderer
contextBridge.exposeInMainWorld('suggestions', {
    open: (bounds, items, activeIndex) => ipcRenderer.invoke('suggestions-open', { bounds, items, activeIndex }),
    update: (bounds, items, activeIndex) => ipcRenderer.invoke('suggestions-update', { bounds, items, activeIndex }),
    close: () => ipcRenderer.invoke('suggestions-close'),
        onSelected: (handler) => ipcRenderer.on('suggestion-selected', (_e, item) => handler(item)),
        onPointerDown: (handler) => ipcRenderer.on('suggestions-pointer-down', (_e) => handler()),
        onCreated: (handler) => ipcRenderer.on('suggestions-created', (_e) => handler())
});

contextBridge.exposeInMainWorld("electronAPI", {
  windowClick: (pos) => ipcRenderer.send("window-click", pos),
  onShowFindInPage: (callback) => ipcRenderer.on('show-find-in-page', callback),
  openHistoryTab: () => ipcRenderer.invoke('open-history-tab'),
  openBookmarksTab: () => ipcRenderer.invoke('open-bookmarks-tab'),
  navigateActiveTab: (url) => ipcRenderer.invoke('navigate-active-tab', url),
  activeTabGoBack: () => ipcRenderer.invoke('active-tab-go-back'),
  onToggleBookmarkBar: (handler) => ipcRenderer.on('toggle-bookmark-bar', () => handler()),
  reportChromeHeight: (height) => ipcRenderer.send('chrome-height-changed', height),
});

contextBridge.exposeInMainWorld('focusMode', {
  toggle: () => ipcRenderer.invoke('focus-mode-toggle'),
  getState: () => ipcRenderer.invoke('focus-mode-get'),
  onChanged: (handler) => ipcRenderer.on('focus-mode-changed', (_e, active) => handler(active)),
  overlayOpen: () => ipcRenderer.send('overlay-open'),
  overlayClose: () => ipcRenderer.send('overlay-close'),
});

contextBridge.exposeInMainWorld('browserBookmarks', {
  getAll:  ()           => ipcRenderer.invoke('bookmarks-get'),
  add:     (url, title) => ipcRenderer.invoke('bookmarks-add', url, title),
  remove:  (url)        => ipcRenderer.invoke('bookmarks-remove', url),
  has:     (url)        => ipcRenderer.invoke('bookmarks-has', url),
  onChanged: (handler)  => ipcRenderer.on('bookmarks-changed', () => handler()),
});

// Any click anywhere in this webContents should close the settings menu
document.addEventListener('mousedown', () => {
    try { ipcRenderer.send('content-view-click'); } catch {}
}, true);

contextBridge.exposeInMainWorld('windowControls', {
  platform:         process.platform,
  minimize:         ()  => ipcRenderer.invoke('window-minimize'),
  maximize:         ()  => ipcRenderer.invoke('window-maximize'),
  close:            ()  => ipcRenderer.invoke('window-close'),
  isMaximized:      ()  => ipcRenderer.invoke('window-is-maximized'),
  onMaximizeChanged:(fn) => ipcRenderer.on('window-maximize-changed', (_e, v) => fn(v)),
});

contextBridge.exposeInMainWorld('inkSettings', {
  get:               ()         => ipcRenderer.invoke('settings-get'),
  set:               (key, val) => ipcRenderer.invoke('settings-set', key, val),
  clearHistory:      ()         => ipcRenderer.invoke('settings-clear-history'),
  toggleBookmarkBar: ()         => ipcRenderer.send('toggle-bookmark-bar'),
  loginGoogle:       (clientId, clientSecret) => ipcRenderer.invoke('google-login', clientId, clientSecret),
});

contextBridge.exposeInMainWorld("bruno", {
    open: () => ipcRenderer.invoke('bruno-open'),
    close: () => ipcRenderer.invoke('bruno-close'),
    selectDirectory: () => ipcRenderer.invoke('bruno-select-directory'),
    // Resize divider
    resizeStart: (x) => ipcRenderer.invoke('bruno-resize-start', x),
    resizeMove:  (x) => ipcRenderer.invoke('bruno-resize-move', x),
    resizeEnd:   ()  => ipcRenderer.invoke('bruno-resize-end'),
    // Request operations
    listRequests:  (path)                 => ipcRenderer.invoke('bruno-list-requests', path),
    createRequest: (path, name)           => ipcRenderer.invoke('bruno-create-request', path, name),
    saveRequest:   (path, filename, data) => ipcRenderer.invoke('bruno-save-request', path, filename, data),
    loadRequest:   (path)                 => ipcRenderer.invoke('bruno-load-request', path),
    deleteRequest: (path, filename)       => ipcRenderer.invoke('bruno-delete-request', path, filename),
    // Environment operations
    createEnvironment:    (path, name) => ipcRenderer.invoke('bruno-create-environment', path, name),
    listEnvironments:     (path)       => ipcRenderer.invoke('bruno-list-environments', path),
    loadEnvironment:      (path)       => ipcRenderer.invoke('bruno-load-environment', path),
    loadEnvironmentFull:  (path)       => ipcRenderer.invoke('bruno-load-environment-full', path),
    saveEnvironment:      (path, vars) => ipcRenderer.invoke('bruno-save-environment', path, vars),
    deleteEnvironment:    (path)       => ipcRenderer.invoke('bruno-delete-environment', path),
    // Collection
    openCollection:        ()         => ipcRenderer.invoke('bruno-list-collections'),
    createCollection:      ()         => ipcRenderer.invoke('bruno-create-collection'),
    initCollection:        (path)     => ipcRenderer.invoke('bruno-init-collection', path),
    getActiveEnvironment:  (path)     => ipcRenderer.invoke('bruno-get-active-environment', path),
    setActiveEnvironment:  (path, n)  => ipcRenderer.invoke('bruno-set-active-environment', path, n),
    // State persistence
    saveState: (state) => ipcRenderer.invoke('bruno-save-state', state),
    loadState: ()      => ipcRenderer.invoke('bruno-load-state'),
    // File ops (legacy / export-import)
    exportCollection:    (path)       => ipcRenderer.invoke('bruno-export-collection', path),
    importCollection:    (path)       => ipcRenderer.invoke('bruno-import-collection', path),
    deleteCollectionFile:(path)       => ipcRenderer.invoke('bruno-delete-collection-file', path),
    loadCollectionFile:  (path)       => ipcRenderer.invoke('bruno-load-collection-file', path),
    saveCollectionFile:  (path, data) => ipcRenderer.invoke('bruno-save-collection-file', path, data),
    gitInit:        (path) => ipcRenderer.invoke('bruno-git-init', path),
    isGitRepo:      (path) => ipcRenderer.invoke('bruno-is-git-repo', path),
    gitStatus:      (path) => ipcRenderer.invoke('bruno-git-status', path),
    createGitignore:(path) => ipcRenderer.invoke('bruno-create-gitignore', path)
});
