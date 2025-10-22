const { BrowserWindow } = require('electron');
const path = require("path");
const Tabs = require("./tabs");
const History = require("./history");
const Shortcuts = require("./shortcuts");

class WindowManager {
    constructor() {
        this.windows = new Map();
        this.history = new History();
        this.nextWindowId = 0;
    }

    createWindow(width = 800, height = 600) {
        const windowId = this.nextWindowId++;
        
        const window = new BrowserWindow({
            width: width,
            height: height,
            minWidth: 800,
            minHeight: 600,
            webPreferences: {
                preload: path.join(__dirname, "../preload/preload.js"),
            }
        });

        window.loadFile('renderer/Browser/index.html');
        
        const tabs = new Tabs(window, this.history);
        const shortcuts = new Shortcuts(window, tabs, this);
        
        tabs.setShortcuts(shortcuts);
        
        const windowData = {
            id: windowId,
            window: window,
            tabs: tabs,
            shortcuts: shortcuts,
            menu: null
        };

        this.windows.set(windowId, windowData);

        window.webContents.once('did-finish-load', () => {
            tabs.CreateTab();
            shortcuts.registerAllShortcuts();
        });

        window.on('closed', () => {
            if (shortcuts) {
                shortcuts.unregisterAllShortcuts();
            }
            this.windows.delete(windowId);
        });

        window.webContents.setWindowOpenHandler(({ url }) => {
            this.createWindow();
            return { action: 'deny' };
        });

        return windowData;
    }

    getWindowByWebContents(webContents) {
        for (const [id, windowData] of this.windows) {
            if (windowData.window.webContents === webContents) {
                return windowData;
            }
        }
        return null;
    }

    getAllWindows() {
        return Array.from(this.windows.values());
    }

    getWindowById(id) {
        return this.windows.get(id) || null;
    }

    getWindowCount() {
        return this.windows.size;
    }

    closeAllWindows() {
        for (const [id, windowData] of this.windows) {
            if (windowData.shortcuts) {
                windowData.shortcuts.unregisterAllShortcuts();
            }
            
            if (!windowData.window.isDestroyed()) {
                windowData.window.close();
            }
        }
        this.windows.clear();
    }
}

module.exports = WindowManager;