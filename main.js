const { BrowserWindow, app, ipcMain, WebContentsView}  = require('electron');
const path = require("path");
const Tabs = require("./Features/tabs");
const History = require("./Features/history");

//the actual browser
class Ink {
  constructor() {
      this.mainWindow = null;
      this.tabs = null;
      this.history = null;
      this.Init();
      this.menu = null;
  }

  Init(){
    const createWindow = () => {
        this.mainWindow = new BrowserWindow({
            width: 800,
            height: 600,
            minWidth: 800,
            minHeight: 600,
            webPreferences: {
                preload: path.join(__dirname, "./preload/preload.js"),
            }
        })

        this.mainWindow.loadFile('renderer/Browser/index.html')
        
        this.history = new History()
        this.tabs = new Tabs(this.mainWindow, this.history)
        
        this.mainWindow.webContents.once('did-finish-load', () => {
          this.tabs.CreateTab()
        })
    }

    app.whenReady().then(() => {
      createWindow()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow()
        }
      })

      if(this.tabs.TabMap.size == 0){
        this.tabs.CreateTab()
      }

    })
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit()
    })
  }  
}

const inkInstance = new Ink();

ipcMain.handle("addTab", async () => {
  inkInstance.tabs.CreateTab()
});

ipcMain.handle("removeTab", async (event, index) => {
  inkInstance.tabs.removeTab(index)
});

ipcMain.handle("switchTab", async (event, index) => {
  inkInstance.tabs.showTab(index)
});

ipcMain.handle("loadUrl", async (event, index, url) => {
  inkInstance.tabs.loadUrl(index, url)
});

ipcMain.handle("goBack", async (event, index) => {
  inkInstance.tabs.goBack(index)
});

ipcMain.handle("goForward", async (event, index) => {
  inkInstance.tabs.goForward(index)
});

ipcMain.handle("reload", async (event, index) => {
  inkInstance.tabs.reload(index)
});

ipcMain.handle("open", async (event, index) => {
  inkInstance.menu = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "./preload/menu-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  inkInstance.mainWindow.contentView.addChildView(inkInstance.menu)
  inkInstance.menu.webContents.loadFile('renderer/Menu/index.html')

  const browserWidth = inkInstance.mainWindow.getBounds().width;
  const width = 160;
  const windowXPos = browserWidth - 12 - width;
  inkInstance.menu.setBounds({
    height: 200,
    width: width,
    x:windowXPos,
    y:40
  })
});


ipcMain.on("window-click", (event, pos) => {
  if (inkInstance.menu) {
    try {
      const bounds = inkInstance.menu.getBounds();

      const isOutsideBounds = pos.x < bounds.x ||
        pos.x > bounds.x + bounds.width ||
        pos.y < bounds.y ||
        pos.y > bounds.y + bounds.height;
        
      if (isOutsideBounds) {
        inkInstance.mainWindow.contentView.removeChildView(inkInstance.menu);
        inkInstance.menu = null;
        inkInstance.mainWindow.webContents.send('menu-closed');
      }
    } catch (error) {
      console.error('Error handling menu click:', error);
      inkInstance.menu = null;
      inkInstance.mainWindow.webContents.send('menu-closed');
    }
  }
});

ipcMain.handle("history-get", async () => {
  console.log('history-get IPC handler called');
  try {
    const result = await inkInstance.history.loadHistory();
    console.log('History loaded:', result);
    return result;
  } catch (error) {
    console.error('Error in history-get handler:', error);
    return { History: [] };
  }
})

ipcMain.handle("open-history-tab", async () => {
  console.log('open-history-tab IPC received');
  try {
    inkInstance.tabs.CreateTabWithPage('renderer/History/index.html', 'history', 'History')
    console.log('History tab created successfully');
  } catch (error) {
    console.error('Error creating history tab:', error);
  }
})

ipcMain.handle("remove-history-entry", async (event, url, timestamp) => {
  console.log('remove-history-entry IPC received:', { url, timestamp });
  try {
    const result = await inkInstance.history.removeFromHistory(url, timestamp);
    console.log('History entry removal result:', result);
    return result;
  } catch (error) {
    console.error('Error in remove-history-entry handler:', error);
    return false;
  }
})

ipcMain.handle("close-menu", async () => {
  if (inkInstance.menu) {
    try {
      inkInstance.mainWindow.contentView.removeChildView(inkInstance.menu);
      inkInstance.menu = null;
      inkInstance.mainWindow.webContents.send('menu-closed');
    } catch (error) {
      console.error('Error closing menu:', error);
    }
  }
})