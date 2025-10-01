const { WebContentsView, BrowserWindow }  = require('electron');

class Tabs {
    constructor(mainWindow) {
        this.mainWindow = mainWindow
        this.TabMap = new Map()
        this.tabUrls = new Map() // Track URLs for each tab
        this.activeTabIndex = 0
        this.nextTabIndex = 0
        
        // Listen for window resize to update tab bounds
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
        
        // Set initial bounds
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
            }
        })
        
        tab.webContents.on('did-navigate-in-page', (event, url) => {
            if (!url.startsWith('file://')) {
                this.tabUrls.set(tabIndex, url)
                this.sendTabUpdate(tabIndex, tab, url)
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
    }

    sendTabUpdate(tabIndex, tab, url, title, favicon) {
        this.mainWindow.webContents.send('url-updated', {
            index: tabIndex,
            url: url,
            title: title || tab.webContents.getTitle(),
            favicon: favicon
        })
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
        }
    }
    
    loadUrl(index, url) {
        if (this.TabMap.has(index)) {
            const tab = this.TabMap.get(index)
            tab.webContents.loadURL(url)
            this.tabUrls.set(index, url)
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
    
    resizeAllTabs() {
        const bounds = this.getTabBounds()
        
        this.TabMap.forEach((tab, index) => {
            tab.setBounds(bounds)
        })
        
        console.log('Resized all tabs to:', bounds)
    }
}

module.exports = Tabs;
