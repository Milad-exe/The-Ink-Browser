const { BrowserWindow, app, ipcMain }  = require('electron');
const path = require("path");
const Tabs = require("./Features/tabs")

//the actual browser
class Ink {
    constructor() {
        this.mainWindow = null;
        this.tabs = null;

        this.Init();
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
            
            this.tabs = new Tabs(this.mainWindow)
            
            // Create initial tab when window is ready
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

//IPC HANDLING
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