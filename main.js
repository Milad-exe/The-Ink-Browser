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
                preload: path.join(__dirname, "preload.js"),
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
  inkInstance.menu = new WebContentsView()
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