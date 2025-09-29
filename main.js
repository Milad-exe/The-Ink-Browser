const { BrowserWindow, app, WebContentsView }  = require('electron');

//the actual browser
class Ink {
    constructor() {
        this.mainWindow = null;

        this.Init();
    }

    Init(){
        const createWindow = () => {
            this.mainWindow = new BrowserWindow({
                width: 800,
                height: 600
            })

            this.mainWindow.loadFile('renderer/index.html')



            const view1 = new WebContentsView()
            this.mainWindow.contentView.addChildView(view1)
            view1.webContents.loadURL('https://electronjs.org')
            view1.setBounds({ x: 0, y: 0, width: 400, height: 400 })
        }
        app.whenReady().then(() => {
            createWindow()
            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    createWindow()
                }
            })
        })
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') app.quit()
        })
    }

    
}

new Ink();