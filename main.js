const { BrowserWindow, app, ipcMain, WebContentsView, Menu, session, webContents } = require('electron');
const UserAgent = require('./Features/user-agent');
const path = require("path");

// Must be called before app.whenReady().
// Removes Chromium's AutomationControlled flag — the flag that sets
// navigator.webdriver = true and is the primary trigger for Google's
// "this browser may not be secure" block.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Ensure the global fallback UA (used by service workers, OAuth sub-requests,
// and anything without a session-level UA) never exposes "Electron/".
// This must be set before app.whenReady() fires.
app.userAgentFallback = UserAgent.generate();

const WindowManager = require("./Features/window-manager");
const Bruno = require("./Features/Bruno");
const focusMode = require("./Features/focus-mode");
const { loginWithGoogle } = require("./Features/google-auth");

class Ink {
  constructor() {
      this.windowManager = new WindowManager();
      this.Init();
  }

  Init(){
    const createWindow = () => {
        return this.windowManager.createWindow();
    }

    app.whenReady().then(() => {
      Menu.setApplicationMenu(null);
      if (process.platform === 'darwin') {
        app.dock.setIcon(path.join(__dirname, 'logo.png'));
      }

      // Set up UA + minimal privacy headers once on the default session.
      // This runs before any tab is created so every request (including the
      // very first navigation) sees the correct user agent.
      UserAgent.setupSession(session.defaultSession);

      // Inject chrome-spoof before every page script.
      // This adds window.chrome and removes navigator.webdriver so Google
      // does not redirect to the "unsupported browser" page.
      session.defaultSession.registerPreloadScript({
        type: 'frame',
        id:   'chrome-spoof',
        filePath: path.join(__dirname, 'preload/chrome-spoof.js')
      });

      // Allow all permission requests (notifications, camera, mic, etc.)
      // so sites like Google Meet / YouTube work without prompts.
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(true);
      });

      // Initialize Bruno feature (registers IPC handlers)
      new Bruno();

      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    });

    // Ensure we persist primary window state and allow windows to close on quit
    app.on('before-quit', () => {
      try {
        // Persist from primary window synchronously to avoid last-window overwrite issues
        this.windowManager.savePrimaryState();
      } catch {}
      try {
        const all = this.windowManager.getAllWindows();
        all.forEach(w => { if (w && w.tabs) w.tabs.allowClose = true; });
      } catch {}
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
  }  
}

const inkInstance = new Ink();
global.inkInstance = inkInstance; // Make globally available for Bruno feature

ipcMain.handle("addTab", async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.tabs.CreateTab();
  }
});

ipcMain.handle("removeTab", async (event, index) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.tabs.removeTab(index);
  }
});

ipcMain.handle("switchTab", async (event, index) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.tabs.showTab(index);
  }
});

ipcMain.handle("loadUrl", async (event, index, url) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.tabs.loadUrl(index, url);
  }
});

ipcMain.handle("goBack", async (event, index) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.tabs.goBack(index);
  }
});

ipcMain.handle("goForward", async (event, index) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.tabs.goForward(index);
  }
});

ipcMain.handle("reload", async (event, index) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.tabs.reload(index);
  }
});

ipcMain.handle("newWindow", async () => {
  inkInstance.windowManager.createWindow();
});

function closeWindowMenu(windowData) {
  if (!windowData || !windowData.menu) return;
  try { windowData.window.contentView.removeChildView(windowData.menu); } catch {}
  windowData.menu = null;
  try { windowData.window.webContents.send('menu-closed'); } catch {}
  // Clean up all listeners attached when menu opened
  if (windowData._menuCleanups) {
    for (const fn of windowData._menuCleanups) { try { fn(); } catch {} }
    windowData._menuCleanups = null;
  }
}

ipcMain.handle("open", async (event, index) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.menu = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "./preload/menu-preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    windowData.menu.setBackgroundColor('#00000000');
    windowData.window.contentView.addChildView(windowData.menu);
    windowData.menu.webContents.loadFile('renderer/Menu/index.html');

    const browserWidth = windowData.window.getBounds().width;
    const width = 160;
    const windowXPos = browserWidth - 12 - width;
    windowData.menu.setBounds({ height: 174, width, x: windowXPos, y: 40 });

    // Close menu on any click in a tab/Bruno WebContentsView, or when the
    // BrowserWindow loses OS focus (user switches to another app).
    const cleanups = [];
    const closeOnce = (() => {
      let fired = false;
      return () => { if (!fired) { fired = true; closeWindowMenu(windowData); } };
    })();

    // Window blur → another app focused
    windowData.window.once('blur', closeOnce);
    cleanups.push(() => windowData.window.removeListener('blur', closeOnce));

    // Click in browser chrome (URL bar, tab bar) — already handled by window-click IPC,
    // but also guard via main-window webContents focus
    windowData.window.webContents.once('focus', closeOnce);
    cleanups.push(() => windowData.window.webContents.removeListener('focus', closeOnce));

    // Clicks in tabs/Bruno are detected via 'content-view-click' IPC sent from the preload
    // (before-input-event only fires for keyboard, not mouse events in Electron)
    windowData._menuCleanups = cleanups;
  }
});


// Any mousedown in a tab or Bruno WebContentsView (sent from the shared preload)
ipcMain.on("content-view-click", (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    if (windowData.menu) closeWindowMenu(windowData);
    
    // Only forward the blur click if the click came from a child view (e.g. a tab), 
    // NOT the main browser UI itself where the search bar lives.
    if (event.sender !== windowData.window.webContents) {
      windowData.window.webContents.send('content-clicked');
    }
  }
});

ipcMain.on("window-click", (event, pos) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.menu) {
    try {
      const bounds = windowData.menu.getBounds();
      const isOutsideBounds = pos.x < bounds.x || pos.x > bounds.x + bounds.width ||
        pos.y < bounds.y || pos.y > bounds.y + bounds.height;
      if (isOutsideBounds) closeWindowMenu(windowData);
    } catch {
      closeWindowMenu(windowData);
    }
  }
});

  // Suggestions Overlay IPC
  ipcMain.handle('suggestions-open', async (event, payload) => {
    const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
    if (!windowData) return false;
    const { bounds, items = [], activeIndex = -1 } = payload || {};
    try {
      if (!windowData.suggestions) {
        windowData.suggestions = new WebContentsView({
          webPreferences: {
            preload: path.join(__dirname, './preload/suggestions-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        windowData.suggestions.setBackgroundColor('#00000000');
        windowData.window.contentView.addChildView(windowData.suggestions);
        // Notify the renderer immediately that the overlay view was created so it can restore focus
        try { windowData.window.webContents.send('suggestions-created'); } catch (e) {}
        windowData.suggestions.webContents.loadFile('renderer/Suggestions/index.html');
        await new Promise(res => windowData.suggestions.webContents.once('did-finish-load', res));
        // loadFile steals Electron-level focus; restore it to the main renderer so the URL bar keeps typing focus
        try { windowData.window.webContents.focus(); } catch {}
      }
      const h = Math.min(280, (items.length || 1) * 35 + 2);
      windowData.suggestions.setBounds({ x: Math.max(0, Math.floor(bounds.left)), y: Math.max(0, Math.floor(bounds.top)), width: Math.floor(bounds.width), height: h });
      windowData.suggestions.webContents.send('suggestions-data', { items, activeIndex });
      return true;
    } catch (err) {
      console.error('suggestions-open error:', err);
      return false;
    }
  });

  ipcMain.handle('suggestions-update', async (event, payload) => {
    const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
    if (!windowData || !windowData.suggestions) return false;
    const { bounds, items = [], activeIndex = -1 } = payload || {};
    try {
      const h = Math.min(280, (items.length || 1) * 35 + 2);
      if (bounds && typeof bounds.left === 'number') {
        windowData.suggestions.setBounds({ x: Math.max(0, Math.floor(bounds.left)), y: Math.max(0, Math.floor(bounds.top)), width: Math.floor(bounds.width), height: h });
      }
      windowData.suggestions.webContents.send('suggestions-data', { items, activeIndex });
      return true;
    } catch (err) {
      console.error('suggestions-update error:', err);
      return false;
    }
  });

  ipcMain.handle('suggestions-close', async (event) => {
    const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
    if (!windowData || !windowData.suggestions) return false;
    try {
      windowData.window.contentView.removeChildView(windowData.suggestions);
      windowData.suggestions = null;
      return true;
    } catch (err) {
      console.error('suggestions-close error:', err);
      return false;
    }
  });

  ipcMain.handle('suggestions-select', async (event, item) => {
    const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
    if (!windowData) return false;
    try {
      // Forward selection to the main renderer process to handle navigation
      windowData.window.webContents.send('suggestion-selected', item);
      // Close overlay
      if (windowData.suggestions) {
        windowData.window.contentView.removeChildView(windowData.suggestions);
        windowData.suggestions = null;
      }
      return true;
    } catch (err) {
      console.error('suggestions-select error:', err);
      return false;
    }
  });

  // Pointer-down from overlay: forward to owning main renderer so it can suppress hide-on-blur briefly
  ipcMain.handle('suggestions-pointer-down', (event) => {
    try {
      // Find which window owns this overlay (event.sender is overlay webContents)
      const all = inkInstance.windowManager.getAllWindows();
      for (const w of all) {
        if (w.suggestions && w.suggestions.webContents && w.suggestions.webContents === event.sender) {
          try { w.window.webContents.send('suggestions-pointer-down'); } catch {}
          break;
        }
      }
    } catch (err) {
      console.error('suggestions-pointer-down handling error:', err);
    }
    return true;
  });

ipcMain.handle("history-get", async () => {
  try {
    const result = await inkInstance.windowManager.history.loadHistory();
    return result;
  } catch (error) {
    console.error('Error in history-get handler:', error);
    return [];
  }
});

ipcMain.handle("history-search", async (event, query, limit = 50) => {
  try {
    const items = await inkInstance.windowManager.history.loadHistory();
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    // Basic filtering by title or url containing the query
    let filtered = (Array.isArray(items) ? items : []).filter(e => {
      const t = (e.title || '').toLowerCase();
      const u = (e.url || '').toLowerCase();
      return t.includes(q) || u.includes(q);
    });

    // Exclude likely search-result pages (e.g. Google/Bing/DuckDuckGo result URLs)
    const isLikelySearchResult = (rawUrl) => {
      if (!rawUrl) return false;
      try {
        const u = new URL(rawUrl);
        const host = (u.hostname || '').toLowerCase();
        const path = (u.pathname || '').toLowerCase();
        const params = u.searchParams;

        // Common search engine hosts
        const isGoogle = host.includes('google.');
        const isBing = host.includes('bing.com');
        const isDuck = host.includes('duckduckgo.com');

        // Google uses /search and /url with q=, Bing uses /search, DuckDuckGo uses /?q=
        if ((isGoogle && (path.startsWith('/search') || path.startsWith('/url') || params.has('q'))) ||
            (isBing && (path.startsWith('/search') || params.has('q'))) ||
            (isDuck && params.has('q'))) {
          return true;
        }

        // Generic heuristic: if the path contains 'search' and there's a 'q' param, treat as search
        if (path.includes('/search') && params.has('q')) return true;

        // Some search-result redirect links include 'q=' in query; avoid showing raw search target pages
        if (u.search && u.search.toLowerCase().includes('q=')) return true;
      } catch (err) {
        return false;
      }
      return false;
    };

    filtered = filtered.filter(e => !isLikelySearchResult(e.url));
    // simple relevance: title match > url match, startsWith bonus, recency bonus
    const score = (e) => {
      const t = (e.title || '').toLowerCase();
      const u = (e.url || '').toLowerCase();
      let s = 0;
      if (t === q || u === q) s += 100;
      if (t.includes(q)) s += 50;
      if (u.includes(q)) s += 25;
      if (t.startsWith(q)) s += 25;
      if (u.startsWith(q)) s += 10;
      const ts = Date.parse(e.timestamp || e.date || 0);
      if (!isNaN(ts)) {
        const days = (Date.now() - ts) / (1000*60*60*24);
        if (days < 1) s += 10; else if (days < 7) s += 5;
      }
      return s;
    };
    filtered.sort((a,b) => score(b) - score(a));
    return filtered.slice(0, limit);
  } catch (error) {
    console.error('Error in history-search handler:', error);
    return [];
  }
});

ipcMain.handle("open-history-tab", async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    try {
      windowData.tabs.CreateTabWithPage('renderer/History/index.html', 'history', 'History');
    } catch (error) {
      console.error('Error creating history tab:', error);
    }
  }
});

ipcMain.handle("remove-history-entry", async (event, url, timestamp) => {
  try {
    const result = await inkInstance.windowManager.history.removeFromHistory(url, timestamp);
    return result;
  } catch (error) {
    console.error('Error in remove-history-entry handler:', error);
    return false;
  }
});

// ── Bookmarks IPC ──────────────────────────────────────────────────────────
ipcMain.handle('bookmarks-get', async () => {
  return await inkInstance.windowManager.bookmarks.getAll();
});

ipcMain.handle('bookmarks-add', async (event, url, title) => {
  const added = await inkInstance.windowManager.bookmarks.add(url, title);
  // Notify the chrome renderer so the bookmark bar refreshes
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) windowData.window.webContents.send('bookmarks-changed');
  return added;
});

ipcMain.handle('bookmarks-remove', async (event, url) => {
  const removed = await inkInstance.windowManager.bookmarks.remove(url);
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) windowData.window.webContents.send('bookmarks-changed');
  return removed;
});

ipcMain.handle('bookmarks-has', async (event, url) => {
  return await inkInstance.windowManager.bookmarks.has(url);
});

ipcMain.handle('open-bookmarks-tab', async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    try {
      windowData.tabs.CreateTabWithPage('renderer/Bookmarks/index.html', 'bookmarks', 'Bookmarks');
    } catch (err) {
      console.error('Error creating bookmarks tab:', err);
    }
  }
});

// Navigate the currently active tab (used by history/bookmarks pages)
ipcMain.handle('navigate-active-tab', async (event, url) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (!windowData) return false;
  const idx = windowData.tabs.activeTabIndex;
  windowData.tabs.loadUrl(idx, url);
  return true;
});

ipcMain.handle('active-tab-go-back', async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (!windowData) return false;
  const idx = windowData.tabs.activeTabIndex;
  windowData.tabs.goBack(idx);
  return true;
});

ipcMain.handle("close-menu", async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  closeWindowMenu(windowData);
});

ipcMain.on('focus-address-bar', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.window.webContents.send('focus-address-bar');
  }
});

// Forward bookmark-bar toggle from menu WebContentsView to the chrome renderer
ipcMain.on('toggle-bookmark-bar', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) windowData.window.webContents.send('toggle-bookmark-bar');
});

// Chrome height changed (bookmark bar shown/hidden) — resize all tabs accordingly
ipcMain.on('chrome-height-changed', (event, height) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.tabs) {
    windowData.tabs.bookmarkBarHeight = height;
    windowData.tabs.resizeAllTabs();
  }
});

// ── Overlay visibility (collapse/restore tab WebContentsViews) ─────────────
ipcMain.on('overlay-open', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.tabs) windowData.tabs.collapseAllTabs();
});

ipcMain.on('overlay-close', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.tabs) windowData.tabs.restoreAllTabs();
});

// ── Focus Mode IPC ─────────────────────────────────────────────────────────
ipcMain.handle('focus-mode-toggle', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (!windowData) return false;
  focusMode.toggle(windowData);
  return focusMode.isActive(windowData);
});

ipcMain.handle('focus-mode-get', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (!windowData) return false;
  return focusMode.isActive(windowData);
});

// Drag and drop handlers
ipcMain.handle('getTabUrl', async (event, index) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    return windowData.tabs.tabUrls.get(index) || '';
  }
  return '';
});

ipcMain.handle('get-this-window-id', async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  return windowData ? windowData.id : null;
});

ipcMain.handle('get-window-at-point', async (event, screenX, screenY) => {
  const all = inkInstance.windowManager.getAllWindows();
  const matchingWindows = [];
  
  for (const w of all) {
    const b = w.window.getBounds();
    if (screenX >= b.x && screenX <= b.x + b.width && screenY >= b.y && screenY <= b.y + b.height) {
      matchingWindows.push(w);
    }
  }
  
  if (matchingWindows.length === 0) return null;
  if (matchingWindows.length === 1) return { id: matchingWindows[0].id };
  
  const allBrowserWindows = BrowserWindow.getAllWindows();
  
  for (let i = allBrowserWindows.length - 1; i >= 0; i--) {
    const bw = allBrowserWindows[i];
    const match = matchingWindows.find(w => w.window === bw);
    if (match && bw.isVisible() && !bw.isMinimized()) {
      return { id: match.id };
    }
  }
  
  return { id: matchingWindows[0].id };
});

ipcMain.handle('move-tab-to-window', async (event, fromWindowId, tabIndex, targetWindowId, url) => {
  const sourceWindow = inkInstance.windowManager.getWindowById(fromWindowId);
  const targetWindow = inkInstance.windowManager.getWindowById(targetWindowId);
  
  if (!sourceWindow || !targetWindow) return false;
  
  try {
    // Create new tab in target window with same URL
    if (!url || url === 'newtab') {
      targetWindow.tabs.CreateTab();
    } else {
      const newIndex = targetWindow.tabs.CreateTab();
      targetWindow.tabs.loadUrl(newIndex, url);
    }
    
    // Remove from source window
    sourceWindow.tabs.removeTab(tabIndex);
    
    return true;
  } catch (err) {
    console.error('move-tab-to-window error:', err);
    return false;
  }
});

ipcMain.handle('detach-to-new-window', async (event, tabIndex, screenX, screenY, url) => {
  const sourceWindow = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (!sourceWindow) return false;
  
  try {
    // Create new window at drop position
    const newWindow = inkInstance.windowManager.createWindow(800, 600);
    
    // Position it near the drop point
    newWindow.window.setBounds({
      x: Math.max(0, Math.floor(screenX - 400)),
      y: Math.max(0, Math.floor(screenY - 300)),
      width: 800,
      height: 600
    });
    
    // Wait for window to load, then set URL if needed
    if (url && url !== 'newtab') {
      newWindow.window.webContents.once('did-finish-load', () => {
        // The window creates its own initial tab, just load the URL into it
        const firstTabIndex = Array.from(newWindow.tabs.TabMap.keys())[0];
        if (firstTabIndex !== undefined) {
          newWindow.tabs.loadUrl(firstTabIndex, url);
        }
      });
    }
    
    // Remove from source window
    sourceWindow.tabs.removeTab(tabIndex);
    
    return true;
  } catch (err) {
    console.error('detach-to-new-window error:', err);
    return false;
  }
});

ipcMain.handle('pinTab', (event, index) => {
  console.log('[MAIN] handle pinTab', index);
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.tabs) {
    windowData.tabs.pinTab(index);
    return true;
  }
  return false;
});

// Persistency mode controls
ipcMain.handle('getPersistMode', (event) => {
  return inkInstance.windowManager.persistence.getPersistMode();
});

ipcMain.handle('setPersistMode', (event, enabled) => {
  inkInstance.windowManager.persistence.setPersistMode(!!enabled);
  // Trigger a save from the active window if present
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.tabs) {
    try { windowData.tabs._saveStateDebounced(); } catch {}
  }
  return true;
});

// Reorder tabs within a window
ipcMain.handle('reorderTabs', (event, order) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.tabs) {
    windowData.tabs.reorderTabs(order);
    return true;
  }
  return false;
});

// ── Settings IPC ──────────────────────────────────────────────────────────
ipcMain.handle('settings-get', () => {
  const s = inkInstance.windowManager.persistence.getAll();
  s._version = app.getVersion();
  return s;
});

ipcMain.on('settings-get-sync', (event) => {
  const s = inkInstance.windowManager.persistence.getAll();
  event.returnValue = s;
});

ipcMain.handle('settings-set', (event, key, value) => {
  inkInstance.windowManager.persistence.set(key, value);
  if (key === 'theme') {
    // Broadcast theme update to all web contents
    const allWebContents = webContents.getAllWebContents();
    allWebContents.forEach((wc) => {
      try { wc.send('theme-changed', value); } catch {}
    });
  }
  if (key === 'persistAllTabs') {
    const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
    if (windowData && windowData.tabs) {
      try { windowData.tabs._saveStateDebounced(); } catch {}
    }
  }
  return true;
});

// Handle Google Login request
ipcMain.handle('google-login', async (event, clientId, clientSecret) => {
  try {
    const authData = await loginWithGoogle(clientId, clientSecret);
    return { success: true, data: authData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings-clear-history', async () => {
  try { return await inkInstance.windowManager.history.clearHistory(); } catch { return false; }
});

ipcMain.handle('open-settings-tab', async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    try {
      windowData.tabs.CreateTabWithPage('renderer/Settings/index.html', 'settings', 'Settings');
    } catch (err) {
      console.error('Error creating settings tab:', err);
    }
  }
});

// ── Window controls IPC ────────────────────────────────────────────────────
ipcMain.handle('window-minimize', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) windowData.window.minimize();
});

ipcMain.handle('window-maximize', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (!windowData) return;
  if (windowData.window.isMaximized()) windowData.window.unmaximize();
  else windowData.window.maximize();
});

ipcMain.handle('window-close', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) windowData.window.close();
});

ipcMain.handle('window-is-maximized', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  return windowData ? windowData.window.isMaximized() : false;
});

// Bruno feature is auto-initialized in the constructor above
// All Bruno IPC handlers are registered by the Bruno class
