const { BrowserWindow, Menu}  = require('electron');
const path = require("path");
const Tabs = require("./tabs");
const Persistence = require("./persistence");
const History = require("./history");
const Shortcuts = require("./shortcuts");
const contextMenu = require("./window-context-menu");

class WindowManager {
    constructor() {
        this.windows = new Map();
        this.history = new History();
        this.nextWindowId = 0;
        this.persistence = new Persistence();
        this._restored = false;
        // Track most recently focused BrowserWindow
        this.lastFocusedWindowId = null;
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

        // Track focus order: most recently focused is considered primary for persistence
        window.on('focus', () => {
            this.lastFocusedWindowId = windowId;
        });
        
    const tabs = new Tabs(window, this.history, this.persistence);
        const shortcuts = new Shortcuts(window, tabs, this);
        
        tabs.setShortcuts(shortcuts);

    window.webContents.on("context-menu", async (event, params) => {
            // Determine the element under the cursor to enrich params for context decisions
            try {
                const contextInfo = await window.webContents.executeJavaScript(
                    `(() => { 
                        const elementFromPoint = document.elementFromPoint(${params.x}, ${params.y}); // Get the element at the context menu position
                        const tabElement = elementFromPoint ? elementFromPoint.closest('.tab-button') : null; // Check if it's within a tab button
                        return { targetElementId: elementFromPoint ? (elementFromPoint.id || '') : '', isTabButton: !!tabElement }; // Return the info
                    })()`
                );
                params.targetElementId = contextInfo.targetElementId;
                params.isTabButton = contextInfo.isTabButton;
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
            // Restore only once into the first opened window (if any state exists)
            const state = (!this._restored && this.persistence.hasState()) ? this.persistence.loadState() : null;
            if (state && state.tabs && state.tabs.length > 0) {
                try {
                    // Create in saved order
                    state.tabs.forEach((t) => {
                        if (t.url && t.url !== 'newtab') {
                            const idx = tabs.CreateTab();
                            tabs.loadUrl(idx, t.url);
                        } else {
                            tabs.CreateTab();
                        }
                    });
                    // Apply pinned flags by their creation order indices
                    const indices = Array.from(tabs.TabMap.keys()).sort((a,b)=>a-b);
                    state.tabs.forEach((t, i) => {
                        const idx = indices[i];
                        if (t.pinned) tabs.pinTab(idx);
                    });
                    // Focus saved active if valid
                    if (typeof state.activeIndex === 'number') {
                        const indices2 = Array.from(tabs.TabMap.keys()).sort((a,b)=>a-b);
                        const focusIdx = indices2[state.activeIndex] ?? indices2[0];
                        if (typeof focusIdx === 'number') tabs.showTab(focusIdx);
                    }
                } catch {
                    // Fallback: at least one tab
                    if (tabs.getTotalTabs() === 0) tabs.CreateTab();
                }
                this._restored = true;
            } else {
                tabs.CreateTab();
            }
            shortcuts.registerAllShortcuts();
        });

        window.on('closed', () => {
            if (shortcuts) {
                shortcuts.unregisterAllShortcuts();
            }
            this.windows.delete(windowId);

            // If other windows remain, move focus to the most recently focused one (or any)
            if (this.windows.size > 0) {
                // Micro-UX tweak: only bring a window forward if one of ours isn't already focused
                const focused = BrowserWindow.getFocusedWindow();
                if (!focused) {
                    const next = this.getMostRecentlyFocusedWindow() || this.getPrimaryWindow() || Array.from(this.windows.values())[0];
                    if (next && next.window && !next.window.isDestroyed()) {
                        try {
                            next.window.show();
                            next.window.focus();
                            // Ensure the active tab's webContents receives focus
                            setTimeout(() => {
                                try {
                                    const activeIdx = next.tabs.activeTabIndex;
                                    const activeTab = next.tabs.TabMap.get(activeIdx);
                                    if (activeTab && activeTab.webContents) {
                                        activeTab.webContents.focus();
                                    }
                                } catch {}
                            }, 20);
                        } catch {}
                    }
                }
            }
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

    // Most recently focused window, if still open
    getMostRecentlyFocusedWindow() {
        if (this.lastFocusedWindowId !== null) {
            const win = this.windows.get(this.lastFocusedWindowId);
            if (win) return win;
        }
        return null;
    }

    // Primary window for persistence is the most recently focused; fallback to oldest
    getPrimaryWindow() {
        const recent = this.getMostRecentlyFocusedWindow();
        if (recent) return recent;
        if (this.windows.size === 0) return null;
        const entries = Array.from(this.windows.entries()).sort((a, b) => a[0] - b[0]);
        return entries[0][1] || null;
    }

    // Save the current state from the primary window (synchronously) into persistence
    savePrimaryState() {
        try {
            const primary = this.getPrimaryWindow();
            if (!primary || !primary.tabs) return false;
            const state = primary.tabs._buildSerializableState();
            this.persistence.saveState(state);
            return true;
        } catch (e) {
            return false;
        }
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