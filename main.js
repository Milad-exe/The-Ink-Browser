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