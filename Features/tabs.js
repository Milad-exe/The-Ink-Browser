const { WebContentsView, BrowserWindow }  = require('electron');
const History = require("./history");

class Tabs {
    constructor(mainWindow, History) {
        this.mainWindow = mainWindow
        this.history = History
        this.TabMap = new Map()
        this.tabUrls = new Map()
        this.activeTabIndex = 0
        this.nextTabIndex = 0
        
        this.mainWindow.on('resize', () => {
            this.resizeAllTabs()
        })
    }

    CreateTab(){
        const tabIndex = this.nextTabIndex
        this.nextTabIndex++
        
        const tab = new WebContentsView()
        this.mainWindow.contentView.addChildView(tab)
        tab.webContents.loadFile('renderer/NewTab/index.html')
        
        const bounds = this.getTabBounds()
        tab.setBounds(bounds)

        this.TabMap.set(tabIndex, tab)
        this.tabUrls.set(tabIndex, 'newtab')
        this.activeTabIndex = tabIndex
        
        this.setupTabListeners(tabIndex, tab)
        
        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: 'New Tab',
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
        tab.webContents.on('did-navigate', (event, url) => {
            if (!url.startsWith('file://')) {
                this.tabUrls.set(tabIndex, url)
                this.sendTabUpdate(tabIndex, tab, url)
                this.sendNavigationUpdate(tabIndex)
                this.addToHistory(url, tab.webContents.getTitle())
            }
        })
        
        tab.webContents.on('did-navigate-in-page', (event, url) => {
            if (!url.startsWith('file://')) {
                this.tabUrls.set(tabIndex, url)
                this.sendTabUpdate(tabIndex, tab, url)
                this.sendNavigationUpdate(tabIndex)
                this.addToHistory(url, tab.webContents.getTitle())
            }
        })
        
        tab.webContents.on('page-title-updated', (event, title) => {
            const currentUrl = this.tabUrls.get(tabIndex) || ''
            if (currentUrl !== 'newtab' && !currentUrl.startsWith('file://')) {
                this.sendTabUpdate(tabIndex, tab, currentUrl, title)
            }
        })

        tab.webContents.on('page-favicon-updated', (event, favicons) => {
            const currentUrl = this.tabUrls.get(tabIndex) || ''
            if (currentUrl !== 'newtab' && !currentUrl.startsWith('file://')) {
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
        this.mainWindow.webContents.send('url-updated', {
            index: tabIndex,
            url: url,
            title: title || tab.webContents.getTitle(),
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
                console.log('Error sending navigation update:', error)
            }
        }
    }
    
    addToHistory(url, title) {
        if (this.history && url && !url.startsWith('file://')) {
            this.history.addToHistory(url, title || url).catch(error => {
                console.error('Failed to add to history:', error)
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
                url: currentUrl === 'newtab' ? '' : currentUrl,
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
            
            this.mainWindow.webContents.send('tab-removed', {
                index: index,
                totalTabs: this.TabMap.size
            })
            
            if (this.activeTabIndex === index && this.TabMap.size > 0) {
                const remainingTabs = Array.from(this.TabMap.keys())
                this.showTab(remainingTabs[0])
            }
        }
    }
    
    getTotalTabs() {
        return this.TabMap.size
    }
    
    goBack(index) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            if (tab.webContents.navigationHistory.canGoBack()) {
                tab.webContents.navigationHistory.goBack()
                setTimeout(() => {
                    this.sendNavigationUpdate(index)
                }, 100)
            }
        }
    }
    
    goForward(index) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            if (tab.webContents.navigationHistory.canGoForward()) {
                tab.webContents.navigationHistory.goForward()
                setTimeout(() => {
                    this.sendNavigationUpdate(index)
                }, 100)
            }
        }
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
            const tab = this.TabMap.get(index)
            return tab.webContents.navigationHistory.canGoBack()
        }
        return false
    }
    
    canGoForward(index) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            return tab.webContents.navigationHistory.canGoForward()
        }
        return false
    }
    
    resizeAllTabs() {
        const bounds = this.getTabBounds()
        
        this.TabMap.forEach((tab, index) => {
            tab.setBounds(bounds)
        })
        
        console.log('Resized all tabs to:', bounds)
    }
}

module.exports = Tabs;
