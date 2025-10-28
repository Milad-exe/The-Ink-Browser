const { BrowserWindow, Menu}  = require('electron');
const path = require("path");
const Tabs = require("./tabs");
const History = require("./history");
const Shortcuts = require("./shortcuts");
const contextMenu = require("./window-context-menu");

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

    window.webContents.on("context-menu", async (event, params) => {
            // Determine the element under the cursor to enrich params for context decisions
            try {
                const contextInfo = await window.webContents.executeJavaScript(
                    `(() => { 
                        const elementFromPoint = document.elementFromPoint(${params.x}, ${params.y}); // Get the element at the context menu position
                        const tabElement = elementFromPoint ? elementFromPoint.closest('.tab-button') : null; // Check if it's within a tab button
                            const idx = tabElement && tabElement.dataset ? parseInt(tabElement.dataset.index) : null;
                            return { targetElementId: elementFromPoint ? (elementFromPoint.id || '') : '', isTabButton: !!tabElement, tabIndex: idx }; // Return the info
                    })()`
                );
                params.targetElementId = contextInfo.targetElementId;
                params.isTabButton = contextInfo.isTabButton;
                    params.tabIndex = contextInfo.tabIndex;
            } catch (_) {}

            const contextMenuInstance = new contextMenu(window, params, this);

            if (contextMenuInstance.getTemplate().length === 0) {
                return;
            }

            const menu = Menu.buildFromTemplate(contextMenuInstance.getTemplate());
            menu.popup({ window });
        })

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