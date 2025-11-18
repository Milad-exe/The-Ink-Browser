const { globalShortcut, BrowserWindow } = require('electron');

class Shortcuts {
    constructor(mainWindow, tabManager, windowManager = null) {
        this.mainWindow = mainWindow;
        this.tabManager = tabManager;
        this.windowManager = windowManager;
        this.shortcuts = new Map();
        this.processing = false;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.mainWindow.webContents.on('before-input-event', (event, input) => {
            this.handleInput(event, input);
        });

        this.setupAllTabListeners();
    }

    setupAllTabListeners() {
        this.tabManager.TabMap.forEach((tab) => {
            this.setupTabListener(tab);
        });
    }

    setupTabListener(tab) {
        if (!tab._shortcutListenerSetup) {
            tab.webContents.on('before-input-event', (event, input) => {
                this.handleInput(event, input);
            });
            tab._shortcutListenerSetup = true;
        }
    }

    onTabCreated(tab) {
        this.setupTabListener(tab);
    }

    handleInput(event, input) {
        for (const [accelerator, callback] of this.shortcuts) {
            if (this.matchesAccelerator(input, accelerator)) {
                event.preventDefault();
                
                if (this.processing) {
                    return;
                }
                this.processing = true;
                
                setImmediate(() => {
                    this.processing = false;
                });
                
                callback();
                break;
            }
        }
    }

    registerAllShortcuts() {
        this.registerTabShortcuts();
        this.registerNavigationShortcuts();
        this.registerPageShortcuts();
        this.registerDeveloperShortcuts();
        this.registerApplicationShortcuts();
    }

    registerTabShortcuts() {
        this.registerShortcut('CmdOrCtrl+T', () => {
            this.tabManager.CreateTab();
        });

        this.registerShortcut('CmdOrCtrl+N', () => {
            if (this.windowManager) {
                this.windowManager.createWindow();
            }
        });

        this.registerShortcut('CmdOrCtrl+Shift+N', () => {
            if (this.windowManager) {
                this.windowManager.createWindow();
            }
        });

        this.registerShortcut('CmdOrCtrl+W', () => {
            const currentTabIndex = this.tabManager.activeTabIndex;
            const totalTabs = this.tabManager.TabMap.size;
            
            if (totalTabs > 1) {
                const allTabIndexes = Array.from(this.tabManager.TabMap.keys()).sort((a, b) => a - b);
                const currentPosition = allTabIndexes.indexOf(currentTabIndex);
                let targetTabIndex = null;
                
                if (currentPosition !== -1) {
                    if (currentPosition < allTabIndexes.length - 1) {
                        targetTabIndex = allTabIndexes[currentPosition + 1];
                    } else if (currentPosition > 0) {
                        targetTabIndex = allTabIndexes[currentPosition - 1];
                    }
                }
                
                this.tabManager.removeTabWithTargetFocus(currentTabIndex, targetTabIndex);
            } else {
                this.tabManager.removeTab(currentTabIndex);
            }
            
            setTimeout(() => {
                if (!this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                    this.mainWindow.focus();
                    this.mainWindow.show();
                    
                    if (this.tabManager.TabMap.has(this.tabManager.activeTabIndex)) {
                        const activeTab = this.tabManager.TabMap.get(this.tabManager.activeTabIndex);
                        if (activeTab && activeTab.webContents) {
                            activeTab.webContents.focus();
                        }
                    }
                }
            }, 10);
        });

        this.registerShortcut('CmdOrCtrl+Tab', () => {
            this.switchToNextTab();
        });

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

    registerApplicationShortcuts() {
        const { app } = require('electron');
        
        // Quit the app directly (mark all tabs allowClose so their close guards don't block)
        this.registerShortcut('CmdOrCtrl+Q', () => {
            if (this.windowManager) {
                this.windowManager.getAllWindows().forEach(windowData => {
                    if (windowData.tabs) windowData.tabs.allowClose = true;
                });
            }
            app.quit();
        });

        // Close all windows but keep the app running (mac-style window close)
        this.registerShortcut('CmdOrCtrl+Shift+Q', () => {
            if (this.windowManager) {
                this.windowManager.getAllWindows().forEach(windowData => {
                    if (windowData.tabs) windowData.tabs.allowClose = true;
                });
                this.windowManager.closeAllWindows();
            }
        });
    }

    registerShortcut(accelerator, callback) {
        this.shortcuts.set(accelerator, callback);
    }

    matchesAccelerator(input, accelerator) {
        const parts = accelerator.toLowerCase().split('+');
        const key = parts[parts.length - 1];
        const modifiers = parts.slice(0, -1);

        let keyMatches = false;
        if (input.key.toLowerCase() === key) {
            keyMatches = true;
        } else if (key === 'tab' && input.key === 'Tab') {
            keyMatches = true;
        } else if (key.match(/^[0-9]$/) && input.key === key) {
            keyMatches = true;
        } else if (key === 'left' && input.key === 'ArrowLeft') {
            keyMatches = true;
        } else if (key === 'right' && input.key === 'ArrowRight') {
            keyMatches = true;
        } else if (key === 'plus' && (input.key === '+' || input.key === '=')) {
            keyMatches = true;
        } else if (key === '-' && (input.key === '-' || input.key === '_')) {
            keyMatches = true;
        }

        if (!keyMatches) return false;

        const hasCmdOrCtrl = modifiers.includes('cmdorctrl');
        const hasShift = modifiers.includes('shift');
        const hasAlt = modifiers.includes('alt');

        const platform = process.platform;
        const expectMeta = hasCmdOrCtrl && platform === 'darwin';
        const expectCtrl = hasCmdOrCtrl && platform !== 'darwin';

        return (
            (!expectMeta || input.meta) &&
            (!expectCtrl || input.control) &&
            (!hasShift || input.shift) &&
            (!hasAlt || input.alt) &&
            (expectMeta ? input.meta === true : input.meta === false) &&
            (expectCtrl ? input.control === true : input.control === false) &&
            (hasShift ? input.shift === true : input.shift === false) &&
            (hasAlt ? input.alt === true : input.alt === false)
        );
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
        this.shortcuts.clear();
    }

    isShortcutRegistered(accelerator) {
        return this.shortcuts.has(accelerator);
    }

    getRegisteredShortcuts() {
        return Array.from(this.shortcuts.keys());
    }
}

module.exports = Shortcuts;