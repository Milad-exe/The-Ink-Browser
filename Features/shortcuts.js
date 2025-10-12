const { globalShortcut, BrowserWindow } = require('electron');

class Shortcuts {
    constructor(mainWindow, tabManager) {
        this.mainWindow = mainWindow;
        this.tabManager = tabManager;
        this.registeredShortcuts = [];
    }

    registerAllShortcuts() {
        this.registerTabShortcuts();
        this.registerNavigationShortcuts();
        this.registerPageShortcuts();
        this.registerDeveloperShortcuts();
    }

    registerTabShortcuts() {
        this.registerShortcut('CmdOrCtrl+T', () => {
            this.tabManager.CreateTab();
        });

        this.registerShortcut('CmdOrCtrl+W', () => {
            const currentTabIndex = this.tabManager.activeTabIndex;
            
            const tabIndexes = Array.from(this.tabManager.TabMap.keys()).sort((a, b) => a - b);
            const userTabIndexes = tabIndexes.filter(index => {
                const url = this.tabManager.tabUrls.get(index);
                return url !== undefined;
            });
            
            const currentPosition = userTabIndexes.indexOf(currentTabIndex);
            
            let targetTabIndex = null;
            if (userTabIndexes.length > 1) {
                if (currentPosition > 0) {
                    targetTabIndex = userTabIndexes[currentPosition - 1];
                } else if (currentPosition === 0 && userTabIndexes.length > 1) {
                    targetTabIndex = userTabIndexes[1];
                }
            }
            
            this.tabManager.removeTab(currentTabIndex);
            
            if (targetTabIndex !== null) {
                this.tabManager.showTab(targetTabIndex);
            }
        });

        this.registerShortcut('CmdOrCtrl+Tab', () => {
            this.switchToNextTab();
        });

        // Switch to previous tab
        this.registerShortcut('CmdOrCtrl+Shift+Tab', () => {
            this.switchToPreviousTab();
        });

        for (let i = 1; i <= 9; i++) {
            this.registerShortcut(`CmdOrCtrl+${i}`, () => {
                this.switchToTabByNumber(i);
            });
        }
    }

    registerNavigationShortcuts() {
        this.registerShortcut('CmdOrCtrl+Left', () => {
            this.tabManager.goBack(this.tabManager.activeTabIndex);
        });

        this.registerShortcut('CmdOrCtrl+Right', () => {
            this.tabManager.goForward(this.tabManager.activeTabIndex);
        });

        this.registerShortcut('CmdOrCtrl+R', () => {
            this.tabManager.reload(this.tabManager.activeTabIndex);
        });

        this.registerShortcut('CmdOrCtrl+Shift+R', () => {
            const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
            if (activeTab) {
                activeTab.webContents.reloadIgnoringCache();
            }
        });
    }

    registerPageShortcuts() {
        this.registerShortcut('CmdOrCtrl+F', () => {
            const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
            if (activeTab) {
                if (this.tabManager.findDialog) {
                    this.tabManager.findDialog.show(activeTab);
                }
            }
        });

        this.registerShortcut('CmdOrCtrl+Z', () => {
            const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
            if (activeTab && activeTab.webContents.isFocused()) {
                activeTab.webContents.undo();
            } else if (this.mainWindow.webContents.isFocused()) {
                this.mainWindow.webContents.undo();
            }
        });

        if (process.platform === 'darwin') {
            this.registerShortcut('CmdOrCtrl+Shift+Z', () => {
                const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
                if (activeTab && activeTab.webContents.isFocused()) {
                    activeTab.webContents.redo();
                } else if (this.mainWindow.webContents.isFocused()) {
                    this.mainWindow.webContents.redo();
                }
            });
        } else {
            this.registerShortcut('CmdOrCtrl+Y', () => {
                const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
                if (activeTab && activeTab.webContents.isFocused()) {
                    activeTab.webContents.redo();
                } else if (this.mainWindow.webContents.isFocused()) {
                    this.mainWindow.webContents.redo();
                }
            });
        }

        this.registerShortcut('CmdOrCtrl+Plus', () => {
            this.zoomIn();
        });

        this.registerShortcut('CmdOrCtrl+-', () => {
            this.zoomOut();
        });

        this.registerShortcut('CmdOrCtrl+0', () => {
            this.resetZoom();
        });

        this.registerShortcut('F11', () => {
            this.toggleFullScreen();
        });
    }

    registerDeveloperShortcuts() {
        this.registerShortcut('F12', () => {
            const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
            if (activeTab) {
                activeTab.webContents.toggleDevTools();
            }
        });

        this.registerShortcut('CmdOrCtrl+Shift+I', () => {
            const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
            if (activeTab) {
                activeTab.webContents.toggleDevTools();
            }
        });
    }

    registerShortcut(accelerator, callback) {
        try {
            const ret = globalShortcut.register(accelerator, callback);
            if (ret) {
                this.registeredShortcuts.push(accelerator);
            }
        } catch (error) {
            
        }
    }

    switchToNextTab() {
        const tabIndexes = Array.from(this.tabManager.TabMap.keys()).sort((a, b) => a - b);
        const userTabIndexes = tabIndexes.filter(index => {
            const url = this.tabManager.tabUrls.get(index);
            return url !== undefined;
        });
        
        const currentIndex = userTabIndexes.indexOf(this.tabManager.activeTabIndex);
        if (currentIndex !== -1) {
            const nextIndex = (currentIndex + 1) % userTabIndexes.length;
            this.tabManager.showTab(userTabIndexes[nextIndex]);
        }
    }

    switchToPreviousTab() {
        const tabIndexes = Array.from(this.tabManager.TabMap.keys()).sort((a, b) => a - b);
        const userTabIndexes = tabIndexes.filter(index => {
            const url = this.tabManager.tabUrls.get(index);
            return url !== undefined;
        });
        
        const currentIndex = userTabIndexes.indexOf(this.tabManager.activeTabIndex);
        if (currentIndex !== -1) {
            const previousIndex = currentIndex === 0 ? userTabIndexes.length - 1 : currentIndex - 1;
            this.tabManager.showTab(userTabIndexes[previousIndex]);
        }
    }

    switchToTabByNumber(number) {
        // Get all tab indices sorted by creation order (visual order)
        const tabIndexes = Array.from(this.tabManager.TabMap.keys()).sort((a, b) => a - b);
        
        const userTabIndexes = tabIndexes.filter(index => {
            const url = this.tabManager.tabUrls.get(index);
            return url !== undefined;
        });
        
        if (number >= 1 && number <= userTabIndexes.length) {
            const targetTabIndex = userTabIndexes[number - 1];
            this.tabManager.showTab(targetTabIndex);
        }
    }

    zoomIn() {
        const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
        if (activeTab) {
            const currentZoom = activeTab.webContents.getZoomLevel();
            activeTab.webContents.setZoomLevel(currentZoom + 0.5);
        }
    }

    zoomOut() {
        const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
        if (activeTab) {
            const currentZoom = activeTab.webContents.getZoomLevel();
            activeTab.webContents.setZoomLevel(currentZoom - 0.5);
        }
    }

    resetZoom() {
        const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
        if (activeTab) {
            activeTab.webContents.setZoomLevel(0);
        }
    }

    toggleFullScreen() {
        this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
    }

    unregisterAllShortcuts() {
        this.registeredShortcuts.forEach(shortcut => {
            globalShortcut.unregister(shortcut);
        });
        this.registeredShortcuts = [];
    }

    isShortcutRegistered(accelerator) {
        return globalShortcut.isRegistered(accelerator);
    }

    getRegisteredShortcuts() {
        return [...this.registeredShortcuts];
    }
}

module.exports = Shortcuts;