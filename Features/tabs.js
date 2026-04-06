const { WebContentsView, BrowserWindow, Menu, shell, app }  = require('electron');
const path = require('path');
const History = require("./history");
const UserAgent = require("./user-agent");
const contextMenu = require("./tab-context-menu");
const NavigationHistory = require("./navigation-history");
const FindDialogManager = require("./find-dialog");
const focusMode = require("./focus-mode");

class Tabs {
    constructor(mainWindow, History, Persistence) {
        this.mainWindow = mainWindow
        this.history = History
        this.persistence = Persistence || null
        this.navigationHistory = new NavigationHistory()
        this.findDialog = FindDialogManager.getInstance().createDialog(mainWindow)
        this.shortcuts = null
        this.TabMap = new Map()
        this.tabUrls = new Map()
        this.activeTabIndex = 0
        this.nextTabIndex = 0
        this.allowClose = false
        this.closePreventionActive = false
        this.isHtmlFullScreen = false
        this.pinnedTabs = new Set()
        this.tabOrder = []
        this._closedTabHistory = [] // stack of {url, title} for "Reopen Closed Tab"
        
        this.mainWindow.on('resize', () => {
            this.resizeAllTabs()
        })
        
        this.mainWindow.on('leave-full-screen', () => {
            this.isHtmlFullScreen = false;
            this.resizeAllTabs();
            // Force any HTML fullscreen elements to exit if the OS window left fullscreen
            this.TabMap.forEach(tab => {
                if (tab && tab.webContents) {
                    tab.webContents.executeJavaScript('if (document.fullscreenElement) document.exitFullscreen();').catch(() => {});
                }
            });
        });
        
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

    CreateLazyTab(url, title, isPinned) {
        const tabIndex = this.nextTabIndex;
        this.nextTabIndex++;
        
        const tab = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, '../preload/preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });
        
        this.mainWindow.contentView.addChildView(tab);
        tab.setVisible(false); // Do not show initially
        
        UserAgent.setupTab(tab);
        
        // Setup context menu
        tab.webContents.on("context-menu", (event, params) => { 
            const contextMenuInstance = new contextMenu(tab, params, this);
            const menu = Menu.buildFromTemplate(contextMenuInstance.getTemplate());
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                menu.popup({ window: this.mainWindow });
            }
        });

        const bounds = this.getTabBounds();
        tab.setBounds(bounds);

        this.TabMap.set(tabIndex, tab);
        this.tabUrls.set(tabIndex, url || 'newtab');
        this.tabOrder.push(tabIndex);
        
        if (isPinned) {
            this.pinnedTabs.add(tabIndex);
        }

        tab._lazyLoaded = false;
        
        let tempTitle = title || url || 'New Tab';
        if ((!title || title === 'New Tab' || title === '') && url && url.startsWith('http')) {
            try { tempTitle = new URL(url).hostname; } catch {}
        }
        tab._lazyTitle = tempTitle;

        this.navigationHistory.initializeTab(tabIndex, url || 'newtab');
        this.setupTabListeners(tabIndex, tab);

        tab.webContents.on('did-finish-load', () => {
            const windowData = this._getWindowData();
            if (windowData) {
                const loadedUrl = tab.webContents.getURL ? tab.webContents.getURL() : '';
                focusMode.applyToTab(windowData, tab.webContents, loadedUrl);
            }
            if (tab.webContents.getTitle()) {
                tab._lazyTitle = tab.webContents.getTitle();
                this.sendTabUpdate(tabIndex, tab, this.tabUrls.get(tabIndex) || '', tab._lazyTitle);
            }
        });

        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: tab._lazyTitle,
            totalTabs: this.TabMap.size
        });
        this.sendTabUpdate(tabIndex, tab, url || 'newtab', tab._lazyTitle);

        return tabIndex;
    }

    _computeDisplayTitleFor(index, fallbackTitle) {
        try {
            const tab = this.TabMap.get(index);
            if (tab && tab._lazyLoaded === false && tab._lazyTitle) {
                return tab._lazyTitle;
            }
            if (tab && tab._lazyTitle && tab.webContents && !tab.webContents.isDestroyed() && !tab.webContents.getTitle()) {
                return tab._lazyTitle;
            }
            const urlType = this.tabUrls.get(index) || '';
            if (urlType === 'newtab' || (typeof urlType === 'string' && urlType.startsWith('file://'))) {
                return 'New Tab';
            }
            if (urlType === 'history') {
                return 'History';
            }
            if (urlType === 'settings') {
                return 'Settings';
            }
            if (fallbackTitle) return fallbackTitle;
            const t = tab && tab.webContents ? tab.webContents.getTitle() : '';
            return t || 'New Tab';
        } catch {
            return 'New Tab';
        }
    }

    _updateWindowTitle(index, explicitTitle) {
        try {
            const title = explicitTitle || this._computeDisplayTitleFor(index);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setTitle(title);
            }
        } catch {}
    }

    setWindowManager(windowManager) {
        this._windowManager = windowManager;
    }

    _getWindowData() {
        if (!this._windowManager) return null;
        return this._windowManager.getWindowByWebContents(this.mainWindow.webContents);
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
        
        UserAgent.setupTab(tab)
        
        tab.webContents.on("context-menu", (event, params) => { 
            const contextMenuInstance = new contextMenu(tab, params, this);
            const menu = Menu.buildFromTemplate(contextMenuInstance.getTemplate());
            menu.popup({ window: this.mainWindow });
        })

        const bounds = this.getTabBounds()
        tab.setBounds(bounds)

    this.TabMap.set(tabIndex, tab)
        this.tabUrls.set(tabIndex, 'newtab')
    this.tabOrder.push(tabIndex)
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
    this._saveStateDebounced()

        this.sendTabUpdate(tabIndex, tab, '', 'New Tab')

        tab.webContents.on('did-finish-load', () => {
            const windowData = this._getWindowData();
            if (windowData) {
                const url = tab.webContents.getURL ? tab.webContents.getURL() : '';
                focusMode.applyToTab(windowData, tab.webContents, url);
            }
            if (tab.webContents.getTitle()) {
                tab._lazyTitle = tab.webContents.getTitle();
                this.sendTabUpdate(tabIndex, tab, this.tabUrls.get(tabIndex) || '', tab._lazyTitle);
            }
        });
            return tabIndex
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
        
        UserAgent.setupTab(tab)
        
        const bounds = this.getTabBounds()
        tab.setBounds(bounds)

        tab._lazyTitle = pageTitle || pageType;

        this.TabMap.set(tabIndex, tab)
        this.tabUrls.set(tabIndex, pageType)
        this.tabOrder.push(tabIndex)
        this.activeTabIndex = tabIndex
        this.navigationHistory.initializeTab(tabIndex, pageType)
        
        const initialHistory = this.navigationHistory.getHistory(tabIndex);
        
        this.setupTabListeners(tabIndex, tab)
        
        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: pageTitle || pageType,
            totalTabs: this.TabMap.size
        })
        
        this.sendTabUpdate(tabIndex, tab, pageType, pageTitle);
        
        this.showTab(tabIndex)

        tab.webContents.on('did-finish-load', () => {
            const windowData = this._getWindowData();
            if (windowData) {
                const url = tab.webContents.getURL ? tab.webContents.getURL() : '';
                focusMode.applyToTab(windowData, tab.webContents, url);
            }
            if (tab.webContents.getTitle()) {
                tab._lazyTitle = tab.webContents.getTitle();
                this.sendTabUpdate(tabIndex, tab, this.tabUrls.get(tabIndex) || '', tab._lazyTitle);
            }
            this._saveStateDebounced()
        });
        return tabIndex
    }
    
    getTabBounds() {
        const contentBounds = this.mainWindow.getContentBounds()
        
        if (this.mainWindow && (this.isHtmlFullScreen || this.mainWindow.isSimpleFullScreen())) {
            return { x: 0, y: 0, width: contentBounds.width, height: contentBounds.height };
        }
        
        // utility-bar (50px) + tab-bar (38px) + optional bookmark-bar (28px)
        const yOffset = 88 + (this.bookmarkBarHeight || 0)
        let width = contentBounds.width - (this.brunoWidth || 0)
        let height = contentBounds.height - yOffset
        if (width < 0) width = 0;
        if (height < 0) height = 0;
        return { x: 0, y: yOffset, width: Math.floor(width), height: Math.floor(height) }
    }
    
    setupTabListeners(tabIndex, tab) {
        let isNavigatingProgrammatically = false;
        let lastAddedUrl = null;
        const shouldOpenExternally = (_targetUrl) => {
            // Don't send any navigations to external browser — let them happen in-tab.
            // window.open popups are handled separately by setWindowOpenHandler.
            return false;
        };
        
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
                let resolvedType = 'newtab';
                if (url.includes('/Settings/index.html')) resolvedType = 'settings';
                else if (url.includes('/Bookmarks/index.html')) resolvedType = 'bookmarks';
                else if (url.includes('/History/index.html')) resolvedType = 'history';
                else if (url.includes('/Bruno/index.html')) resolvedType = 'bruno';
                
                this.tabUrls.set(tabIndex, resolvedType)
                lastAddedUrl = resolvedType;
                
                let title = 'New Tab';
                if (resolvedType === 'settings') title = 'Settings';
                else if (resolvedType === 'bookmarks') title = 'Bookmarks';
                else if (resolvedType === 'history') title = 'History';
                else if (resolvedType === 'bruno') title = 'Bruno';

                this.sendTabUpdate(tabIndex, tab, resolvedType, title)
                this.sendNavigationUpdate(tabIndex)
            }
            
            isNavigatingProgrammatically = false;
        })

        // All window.open / target="_blank" links open in a new tab, never a new BrowserWindow
        tab.webContents.setWindowOpenHandler(({ url }) => {
            setImmediate(() => {
                const newIndex = this.CreateTab();
                this.loadUrl(newIndex, url);
            });
            return { action: 'deny' };
        });
        
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

        // HTML5 Fullscreen (e.g. YouTube videos)
        tab.webContents.on('enter-html-full-screen', () => {
            this.isHtmlFullScreen = true;
            this.mainWindow.setFullScreen(true);
            this.resizeAllTabs();
        });

        tab.webContents.on('leave-html-full-screen', () => {
            this.isHtmlFullScreen = false;
            this.mainWindow.setFullScreen(false);
            this.resizeAllTabs();
        });

        // Error page — skip aborts (e.g. navigating away mid-load) and sub-frame errors
        tab.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame) return;
            if (errorCode === -3) return; // ERR_ABORTED — user navigated away
            const params = new URLSearchParams({
                url:  validatedURL || '',
                code: String(errorCode),
                desc: errorDescription || '',
            });
            isNavigatingProgrammatically = true;
            tab.webContents.loadFile(
                path.join(__dirname, '../renderer/Error/index.html'),
                { search: '?' + params.toString() }
            );
        });

        tab.webContents.on('found-in-page', (event, result) => {
            if (this.findDialog) {
                this.findDialog.handleFindResult(result);
            }
        });
        
        tab.webContents.on('page-title-updated', (event, title) => {
            tab._lazyTitle = title;
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
        let displayTitle = title || this._computeDisplayTitleFor(tabIndex) || "New Tab";
        
        let isInternal = ['newtab', 'settings', 'bookmarks', 'history', 'bruno'].includes(url) || (url && url.startsWith('file://'));

        if (isInternal) {
            displayUrl = '';
            if (url === 'settings' || (url && url.includes('/Settings/index.html'))) displayTitle = 'Settings';
            else if (url === 'bookmarks' || (url && url.includes('/Bookmarks/index.html'))) displayTitle = 'Bookmarks';
            else if (url === 'history' || (url && url.includes('/History/index.html'))) displayTitle = 'History';
            else if (url === 'bruno' || (url && url.includes('/Bruno/index.html'))) displayTitle = 'Bruno';
            else displayTitle = 'New Tab';
        }
        
        // Provide a default favicon instantly for http/https URLs to prevent empty gaps
        let resolvedFavicon = favicon;
        if (!resolvedFavicon && url && url.startsWith('http')) {
            try {
                resolvedFavicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
            } catch (e) {}
        }
        
        this.mainWindow.webContents.send('url-updated', {
            index: tabIndex,
            url: displayUrl,
            title: displayTitle,
            favicon: resolvedFavicon
        })

        // Keep the window title in sync with the active tab
        if (tabIndex === this.activeTabIndex) {
            this._updateWindowTitle(tabIndex, displayTitle);
        }
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
            const tab = this.TabMap.get(index);
            tab.setVisible(true)
            this.activeTabIndex = index
            
            if (tab._lazyLoaded === false) {
                tab._lazyLoaded = true;
                const lazyUrl = this.tabUrls.get(index);
                if (lazyUrl === 'history') {
                    tab.webContents.loadFile('renderer/History/index.html');
                } else if (lazyUrl === 'bookmarks') {
                    tab.webContents.loadFile('renderer/Bookmarks/index.html');
                } else if (lazyUrl === 'settings') {
                    tab.webContents.loadFile('renderer/Settings/index.html');
                } else if (lazyUrl && lazyUrl !== 'newtab' && !lazyUrl.startsWith('file://')) {
                    tab.webContents.loadURL(lazyUrl);
                } else {
                    tab.webContents.loadFile('renderer/NewTab/index.html');
                }
            } else if (tab._needsReloadForFocusMode) {
                tab._needsReloadForFocusMode = false;
                tab.webContents.reload();
            }

            const currentUrl = this.tabUrls.get(index) || ''
            
            this.mainWindow.webContents.send('tab-switched', {
                index: index,
                url: (currentUrl === 'newtab' || currentUrl === 'history') ? '' : currentUrl,
                totalTabs: this.TabMap.size
            })
            
            this.sendNavigationUpdate(index)

            // Update window title to reflect the newly active tab
            this._updateWindowTitle(index)
            
            // Put the website back into focus so keyboard events register immediately
            tab.webContents.focus()
        }
    }
    
    loadUrl(index, url) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            tab.webContents.loadURL(url)
            this.tabUrls.set(index, url)
            
            // Set a temporary title before the page actually loads
            let tempTitle = url;
            try { tempTitle = new URL(url).hostname; } catch {}
            tab._lazyTitle = tempTitle;
            this.sendTabUpdate(index, tab, url, tempTitle);
            
            this.navigationHistory.addEntry(index, url)
            
            setTimeout(() => {
                this.sendNavigationUpdate(index)
            }, 200)
        }
    }
    
    _destroyTab(tab) {
        try { tab.webContents.audioMuted = true; } catch {}
        try { this.mainWindow.contentView.removeChildView(tab); } catch {}
        try { tab.webContents.destroy(); } catch {}
    }

    _recordClosed(index) {
        const url = this.tabUrls.get(index);
        if (url && url !== 'newtab' && !url.startsWith('file://')) {
            const tab = this.TabMap.get(index);
            let title = url;
            try { title = tab?.webContents?.getTitle() || url; } catch {}
            this._closedTabHistory.push({ url, title });
            if (this._closedTabHistory.length > 20) this._closedTabHistory.shift();
        }
    }

    removeTab(index) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            this._recordClosed(index)
            this._destroyTab(tab)
            this.TabMap.delete(index)
            this.tabUrls.delete(index)
            // Clean up pinned state if needed
            this.pinnedTabs.delete(index)
            this.tabOrder = this.tabOrder.filter(i => i !== index)
            
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
            this._saveStateDebounced()
        }
    }
    
    removeTabWithTargetFocus(index, targetTabIndex) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index);
            this._recordClosed(index)
            this._destroyTab(tab);
            this.TabMap.delete(index);
            this.tabUrls.delete(index);
            this.pinnedTabs.delete(index)
            this.tabOrder = this.tabOrder.filter(i => i !== index)
            
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
            this._saveStateDebounced()
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

    collapseAllTabs() {
        // Move tabs off-screen so native views don't cover HTML overlays
        this.TabMap.forEach((tab) => {
            tab.setBounds({ x: -9999, y: -9999, width: 1, height: 1 });
        });
    }

    restoreAllTabs() {
        this.resizeAllTabs();
    }

    muteTab(index) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index);
            const isMuted = tab.webContents.isAudioMuted();
            tab.webContents.setAudioMuted(!isMuted);
        }
    }

    pinTab(index) {
        console.log('[MAIN] pinTab sending event for index', index);
        const isPinned = this.pinnedTabs.has(index)
        if (!isPinned) {
            const totalTabs = this.TabMap.size
            const futurePinned = this.pinnedTabs.size + 1
            const futureUnpinned = totalTabs - futurePinned
            if (futureUnpinned <= 0) {
                // Auto-create a new unpinned tab; then return focus to the original tab
                this.CreateTab()
                // Leave focus on the newly created tab so subsequent pin acts on it
                // Proceed to pin the originally requested tab index
                console.log('[MAIN] pinTab auto-created new tab to preserve one unpinned')
            }
            this.pinnedTabs.add(index)
        } else {
            this.pinnedTabs.delete(index)
        }
        this.mainWindow.webContents.send('pin-tab', { index });
        this._saveStateDebounced()
    }

    reorderTabs(newOrder) {
        if (!Array.isArray(newOrder)) return;
        const allKeys = new Set(this.TabMap.keys());
        const ok = newOrder.every(k => allKeys.has(k)) && newOrder.length === allKeys.size;
        if (!ok) return;
        this.tabOrder = [...newOrder];
        this._saveStateDebounced();
    }

    _buildSerializableState() {
        const includeAll = !!(this.persistence && this.persistence.getPersistMode());
        const order = this.tabOrder.length ? this.tabOrder : Array.from(this.TabMap.keys());
        const selected = includeAll ? order : order.filter(idx => this.pinnedTabs.has(idx));
        const tabs = selected.map((idx) => {
            const url = this.tabUrls.get(idx) || 'newtab';
            let title = this._computeDisplayTitleFor(idx) || 'New Tab';
            return {
                url,
                title,
                pinned: this.pinnedTabs.has(idx)
            };
        });
        // Map active to its ordinal in current order
        const activeOrdinal = Math.max(0, order.indexOf(this.activeTabIndex));
        return { tabs, activeIndex: activeOrdinal, persistAllTabs: includeAll };
    }

    _saveStateDebounced() {
        if (!this.persistence) return;
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            try { this.persistence.saveState(this._buildSerializableState()); } catch {}
        }, 200);
    }
}

module.exports = Tabs;
