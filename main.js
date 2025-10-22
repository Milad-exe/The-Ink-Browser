const { BrowserWindow, app, ipcMain, WebContentsView, Menu}  = require('electron');
const path = require("path");
const WindowManager = require("./Features/window-manager");

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
      
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
  }  
}

const inkInstance = new Ink();

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
    windowData.window.contentView.addChildView(windowData.menu);
    windowData.menu.webContents.loadFile('renderer/Menu/index.html');

    const browserWidth = windowData.window.getBounds().width;
    const width = 160;
    const windowXPos = browserWidth - 12 - width;
    windowData.menu.setBounds({
      height: 200,
      width: width,
      x: windowXPos,
      y: 40
    });
  }
});


ipcMain.on("window-click", (event, pos) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.menu) {
    try {
      const bounds = windowData.menu.getBounds();

      const isOutsideBounds = pos.x < bounds.x ||
        pos.x > bounds.x + bounds.width ||
        pos.y < bounds.y ||
        pos.y > bounds.y + bounds.height;
        
      if (isOutsideBounds) {
        windowData.window.contentView.removeChildView(windowData.menu);
        windowData.menu = null;
        windowData.window.webContents.send('menu-closed');
      }
    } catch (error) {
      console.error('Error handling menu click:', error);
      windowData.menu = null;
      windowData.window.webContents.send('menu-closed');
    }
  }
});

ipcMain.handle("history-get", async () => {
  try {
    const result = await inkInstance.windowManager.history.loadHistory();
    return result;
  } catch (error) {
    console.error('Error in history-get handler:', error);
    return { History: [] };
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

ipcMain.handle("close-menu", async (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData && windowData.menu) {
    try {
      windowData.window.contentView.removeChildView(windowData.menu);
      windowData.menu = null;
      windowData.window.webContents.send('menu-closed');
    } catch (error) {
      console.error('Error closing menu:', error);
    }
  }
});

ipcMain.on('focus-address-bar', (event) => {
  const windowData = inkInstance.windowManager.getWindowByWebContents(event.sender);
  if (windowData) {
    windowData.window.webContents.send('focus-address-bar');
  }
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