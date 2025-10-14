const { WebContentsView, BrowserWindow, Menu}  = require('electron');
const path = require('path');
const History = require("./history");
const UserAgent = require("./user-agent");
const contextMenu = require("./context-menu");
const NavigationHistory = require("./navigation-history");
const FindDialogManager = require("./find-dialog");
const { app } = require('electron/main');

class Tabs {
    constructor(mainWindow, History) {
        this.mainWindow = mainWindow
        this.history = History
        this.navigationHistory = new NavigationHistory()
        this.findDialog = FindDialogManager.getInstance().createDialog(mainWindow)
        this.shortcuts = null
        this.TabMap = new Map()
        this.tabUrls = new Map()
        this.activeTabIndex = 0
        this.nextTabIndex = 0
        this.allowClose = false
        this.closePreventionActive = false
        
        this.mainWindow.on('resize', () => {
            this.resizeAllTabs()
        })
        
        this.mainWindow.on('close', (event) => {
            if (this.TabMap.size > 0 && !this.allowClose) {
                event.preventDefault();
                
                setImmediate(() => {
                    if (!this.mainWindow.isDestroyed()) {
                        this.mainWindow.focus();
                        
                        if (this.TabMap.has(this.activeTabIndex)) {
                            const activeTab = this.TabMap.get(this.activeTabIndex);
                            if (activeTab && activeTab.webContents) {
                                activeTab.webContents.focus();
                            }
                        }
                    }
                });
                return;
            }
        });
        
        this.mainWindow.on('closed', () => {
        });
        
        this.mainWindow.on('before-quit', (event) => {
        });
        
        const originalClose = this.mainWindow.close.bind(this.mainWindow);
        const originalDestroy = this.mainWindow.destroy.bind(this.mainWindow);
        
        this.mainWindow.close = () => {
            if (this.TabMap.size > 0 && !this.allowClose) {
                return;
            }
            
            const result = originalClose();
            this.allowClose = false;
            return result;
        };
        
        this.mainWindow.destroy = () => {
            if (this.TabMap.size > 0 && !this.allowClose) {
                return;
            }
            
            return originalDestroy();
        };
    }

    setShortcuts(shortcuts) {
        this.shortcuts = shortcuts;
    }

    CreateTab(){
        const tabIndex = this.nextTabIndex
        this.nextTabIndex++
        
        const tab = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, '../preload/preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        })
        this.mainWindow.contentView.addChildView(tab)
        tab.webContents.loadFile('renderer/NewTab/index.html')
        
        UserAgent.setupTabHeaders(tab)
        
        tab.webContents.on("context-menu", (event, params) => { 
            const contextMenuInstance = new contextMenu(tab, params, this);
            const menu = Menu.buildFromTemplate(contextMenuInstance.getTemplate());
            menu.popup({ window: this.mainWindow });
        })

        const bounds = this.getTabBounds()
        tab.setBounds(bounds)

        this.TabMap.set(tabIndex, tab)
        this.tabUrls.set(tabIndex, 'newtab')
        this.activeTabIndex = tabIndex
        this.navigationHistory.initializeTab(tabIndex, 'newtab')
        
        const initialHistory = this.navigationHistory.getHistory(tabIndex);
        
        this.setupTabListeners(tabIndex, tab)
        
        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: 'New Tab',
            totalTabs: this.TabMap.size
        })
        
        this.showTab(tabIndex)

        this.sendTabUpdate(tabIndex, tab, '', 'New Tab')

        tab.webContents.on('did-finish-load', () => {
            tab.webContents.insertCSS('html{filter:grayscale(100%)}');
        });
    }

    CreateTabWithPage(pagePath, pageType, pageTitle) {
        const tabIndex = this.nextTabIndex
        this.nextTabIndex++
        
        const tab = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, '../preload/preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        })
        this.mainWindow.contentView.addChildView(tab)
        tab.webContents.loadFile(pagePath)
        
        UserAgent.setupTabHeaders(tab)
        
        const bounds = this.getTabBounds()
        tab.setBounds(bounds)

        this.TabMap.set(tabIndex, tab)
        this.tabUrls.set(tabIndex, pageType)
        this.activeTabIndex = tabIndex
        this.navigationHistory.initializeTab(tabIndex, pageType)
        
        const initialHistory = this.navigationHistory.getHistory(tabIndex);
        
        this.setupTabListeners(tabIndex, tab)
        
        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: pageTitle,
            totalTabs: this.TabMap.size
        })
        
        this.showTab(tabIndex)

        tab.webContents.on('did-finish-load', () => {
            tab.webContents.insertCSS('html{filter:grayscale(100%)}');
        });
        
    }
    
    getTabBounds() {
        const width = this.mainWindow.getContentBounds().width
        const height = this.mainWindow.getContentBounds().height - 70
        return { x: 0, y: 70, width: width, height: height }
    }
    
    setupTabListeners(tabIndex, tab) {
        let isNavigatingProgrammatically = false;
        let lastAddedUrl = null;
        
        if (this.shortcuts) {
            this.shortcuts.onTabCreated(tab);
        }
        
        tab.webContents.on('did-navigate', (event, url) => {
            if (!url.startsWith('file://') && !isNavigatingProgrammatically) {
                if (lastAddedUrl !== url) {
                    this.tabUrls.set(tabIndex, url)
                    this.navigationHistory.addEntry(tabIndex, url)
                    lastAddedUrl = url;
                    
                    this.sendTabUpdate(tabIndex, tab, url)
                    this.sendNavigationUpdate(tabIndex)
                    this.addToHistory(url, tab.webContents.getTitle())
                }
            } else if (url.startsWith('file://')) {
                this.tabUrls.set(tabIndex, 'newtab')
                lastAddedUrl = 'newtab';
                this.sendTabUpdate(tabIndex, tab, '', 'New Tab')
                this.sendNavigationUpdate(tabIndex)
            }
            
            isNavigatingProgrammatically = false;
        })
        
        tab.webContents.on('did-navigate-in-page', (event, url) => {
            if (!url.startsWith('file://') && !isNavigatingProgrammatically) {
                const currentUrl = this.tabUrls.get(tabIndex);
                if (currentUrl !== url && lastAddedUrl !== url) {
                    this.tabUrls.set(tabIndex, url)
                    this.navigationHistory.addEntry(tabIndex, url)
                    lastAddedUrl = url;
                    
                    this.sendTabUpdate(tabIndex, tab, url)
                    this.sendNavigationUpdate(tabIndex)
                    this.addToHistory(url, tab.webContents.getTitle())
                }
            }
        })
        
        tab._isNavigatingProgrammatically = () => isNavigatingProgrammatically;
        tab._setNavigatingProgrammatically = (value) => { isNavigatingProgrammatically = value; };

        tab.webContents.on('found-in-page', (event, result) => {
            if (this.findDialog) {
                this.findDialog.handleFindResult(result);
            }
        });
        
        tab.webContents.on('page-title-updated', (event, title) => {
            const currentUrl = this.tabUrls.get(tabIndex) || ''
            if (currentUrl !== 'newtab' && currentUrl !== 'history' && !currentUrl.startsWith('file://')) {
                this.sendTabUpdate(tabIndex, tab, currentUrl, title)
            }
        })

        tab.webContents.on('page-favicon-updated', (event, favicons) => {
            const currentUrl = this.tabUrls.get(tabIndex) || ''
            if (currentUrl !== 'newtab' && currentUrl !== 'history' && !currentUrl.startsWith('file://')) {
                const favicon = favicons && favicons.length > 0 ? favicons[0] : null
                this.sendTabUpdate(tabIndex, tab, currentUrl, tab.webContents.getTitle(), favicon)
            }
        })
        
        tab.webContents.on('did-finish-load', () => {
            this.sendNavigationUpdate(tabIndex)
        })
        
        tab.webContents.on('did-stop-loading', () => {
            this.sendNavigationUpdate(tabIndex)
        })
    }

    sendTabUpdate(tabIndex, tab, url, title, favicon) {
        let displayUrl = url;
        let displayTitle = title || tab.webContents.getTitle();
        
        if (url === 'newtab' || url.startsWith('file://')) {
            displayUrl = '';
            displayTitle = 'New Tab';
        }
        
        this.mainWindow.webContents.send('url-updated', {
            index: tabIndex,
            url: displayUrl,
            title: displayTitle,
            favicon: favicon
        })
    }
    
    sendNavigationUpdate(tabIndex) {
        if (this.TabMap.has(tabIndex) && tabIndex === this.activeTabIndex) {
            try {
                this.mainWindow.webContents.send('navigation-updated', {
                    index: tabIndex,
                    canGoBack: this.canGoBack(tabIndex),
                    canGoForward: this.canGoForward(tabIndex)
                })
            } catch (error) {
                
            }
        }
    }
    
    addToHistory(url, title) {
        if (this.history && url && !url.startsWith('file://')) {
            this.history.addToHistory(url, title || url).catch(error => {
                
            })
        }
    }
    
    showTab(index) {
        this.TabMap.forEach((tab, i) => {
            tab.setVisible(false)
        })
        
        if (this.TabMap.has(index)) {
            this.TabMap.get(index).setVisible(true)
            this.activeTabIndex = index
            
            const currentUrl = this.tabUrls.get(index) || ''
            
            this.mainWindow.webContents.send('tab-switched', {
                index: index,
                url: (currentUrl === 'newtab' || currentUrl === 'history') ? '' : currentUrl,
                totalTabs: this.TabMap.size
            })
            
            this.sendNavigationUpdate(index)
        }
    }
    
    loadUrl(index, url) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            tab.webContents.loadURL(url)
            this.tabUrls.set(index, url)
            
            this.navigationHistory.addEntry(index, url)
            
            setTimeout(() => {
                this.sendNavigationUpdate(index)
            }, 200)
        }
    }
    
    removeTab(index) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            this.mainWindow.contentView.removeChildView(tab)
            this.TabMap.delete(index)
            this.tabUrls.delete(index)
            
            this.navigationHistory.removeTab(index)
            
            this.mainWindow.webContents.send('tab-removed', {
                index: index,
                totalTabs: this.TabMap.size
            })
            
            if (this.activeTabIndex === index && this.TabMap.size > 0) {
                const remainingTabs = Array.from(this.TabMap.keys())
                this.showTab(remainingTabs[0])
            }
            
            if (this.TabMap.size === 0) {
                this.allowClose = true;
                this.mainWindow.close();
            }
        }
    }
    
    removeTabWithTargetFocus(index, targetTabIndex) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index);
            this.mainWindow.contentView.removeChildView(tab);
            this.TabMap.delete(index);
            this.tabUrls.delete(index);
            
            this.navigationHistory.removeTab(index);
            
            this.mainWindow.webContents.send('tab-removed', {
                index: index,
                totalTabs: this.TabMap.size
            });
            
            if (this.TabMap.size === 0) {
                this.allowClose = true;
                this.mainWindow.close();
            } else {
                if (targetTabIndex !== null && this.TabMap.has(targetTabIndex)) {
                    this.showTab(targetTabIndex);
                } else {
                    const remainingTabs = Array.from(this.TabMap.keys());
                    this.showTab(remainingTabs[0]);
                }
                
                setTimeout(() => {
                    if (!this.mainWindow.isDestroyed()) {
                        this.mainWindow.focus();
                    }
                }, 20);
            }
        }
    }
    
    getTotalTabs() {
        return this.TabMap.size
    }
    
    goBack(index) {
        const startTime = performance.now();
        
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            const currentUrl = this.tabUrls.get(index);
            const historyBefore = this.navigationHistory.getHistory(index);
            const previousUrl = this.navigationHistory.goBack(index)
            const historyAfter = this.navigationHistory.getHistory(index);

            if (previousUrl && previousUrl !== 'newtab') {
                tab._setNavigatingProgrammatically(true);
                tab.webContents.loadURL(previousUrl)
                this.tabUrls.set(index, previousUrl)
            } else if (previousUrl === 'newtab') {
                tab._setNavigatingProgrammatically(true);
                tab.webContents.loadFile('renderer/NewTab/index.html')
                this.tabUrls.set(index, 'newtab')
            } else {
                tab.webContents.loadFile('renderer/NewTab/index.html')
                this.tabUrls.set(index, 'newtab')
            }
            this.sendNavigationUpdate(index)
            const endTime = performance.now();
        } else {}
    }
    
    goForward(index) {
        const startTime = performance.now();
        
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            const currentUrl = this.tabUrls.get(index);
            
            const historyBefore = this.navigationHistory.getHistory(index);
            const nextUrl = this.navigationHistory.goForward(index);
            const historyAfter = this.navigationHistory.getHistory(index);
            
            if (nextUrl && nextUrl !== 'newtab') {
                tab._setNavigatingProgrammatically(true);
                tab.webContents.loadURL(nextUrl)
                this.tabUrls.set(index, nextUrl)
            } else if (nextUrl === 'newtab') {
                tab._setNavigatingProgrammatically(true);
                tab.webContents.loadFile('renderer/NewTab/index.html')
                this.tabUrls.set(index, 'newtab')
            }
            this.sendNavigationUpdate(index)
            const endTime = performance.now();
        } else {}
    }
    
    reload(index) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            tab.webContents.reload()
            setTimeout(() => {
                this.sendNavigationUpdate(index)
            }, 100)
        }
    }
    
    canGoBack(index) {
        if (this.TabMap.has(index)) {
            const canGoBack = this.navigationHistory.canGoBack(index);
            return canGoBack;
        }
        return false
    }
    
    canGoForward(index) {
        if (this.TabMap.has(index)) {
            const canGoForward = this.navigationHistory.canGoForward(index);
            return canGoForward;
        }
        return false
    }
    
    resizeAllTabs() {
        const bounds = this.getTabBounds()
        
        this.TabMap.forEach((tab, index) => {
            tab.setBounds(bounds)
        })
    }
}

module.exports = Tabs;
