const { BrowserWindow, Menu, screen } = require('electron');
const { resolveAppFile } = require('../app-paths');
const path = require('path');
const Tabs = require('./tabs');
const Persistence = require('./persistence');
const History = require('./history');
const Bookmarks = require('./bookmarks');
const Shortcuts = require('./shortcuts');
const contextMenu = require('./window-context-menu');
const zoom = require('./zoom');
const searchEngines = require('./search-engines');
const i18n = require('./i18n');
const log = require('./log');
class WindowManager {
    windows; // windowId → { id, window, tabs, shortcuts, menu, … overlays }
    nextWindowId;
    lastFocusedWindowId; // most recently focused window (persistence primary)
    restored; // saved tab state already restored into a window?
    cachedHistory;
    cachedBookmarks;
    cachedPersistence;
    constructor() {
        this.windows = new Map();
        this.cachedHistory = null;
        this.cachedBookmarks = null;
        this.nextWindowId = 0;
        this.cachedPersistence = null;
        this.restored = false;
        // Track most recently focused BrowserWindow
        this.lastFocusedWindowId = null;
    }
    get history() {
        if (!this.cachedHistory) {
            this.cachedHistory = new History();
        }
        return this.cachedHistory;
    }
    get persistence() {
        if (!this.cachedPersistence) {
            this.cachedPersistence = new Persistence();
            // Modules that hold user preferences but must not depend on
            // Persistence (construction order) are fed from here, once.
            try {
                History.setRetention({
                    maxDays: this.cachedPersistence.get('historyDays'),
                    maxEntries: this.cachedPersistence.get('historyMaxEntries'),
                });
                zoom.init(this.cachedPersistence);
                searchEngines.init(this.cachedPersistence);
                i18n.init(this.cachedPersistence);
            }
            catch (e) {
                log.warn('window-manager', 'could not apply stored preferences', e);
            }
        }
        return this.cachedPersistence;
    }
    get bookmarks() {
        if (!this.cachedBookmarks) {
            this.cachedBookmarks = new Bookmarks();
        }
        return this.cachedBookmarks;
    }
    // ── Per-profile stores ────────────────────────────────────────────────────
    // Profile 1 keeps the legacy files (no migration); other profiles get their
    // own '-p<id>'-suffixed history/bookmark files.
    historyFor(profileId) {
        const pid = String(profileId || '1');
        if (pid === '1')
            return this.history;
        if (!this.profileHistories)
            this.profileHistories = new Map();
        if (!this.profileHistories.has(pid))
            this.profileHistories.set(pid, new History(`-p${pid}`));
        return this.profileHistories.get(pid);
    }
    bookmarksFor(profileId) {
        const pid = String(profileId || '1');
        if (pid === '1')
            return this.bookmarks;
        if (!this.profileBookmarks)
            this.profileBookmarks = new Map();
        if (!this.profileBookmarks.has(pid))
            this.profileBookmarks.set(pid, new Bookmarks(`-p${pid}`));
        return this.profileBookmarks.get(pid);
    }
    // Profile of the window owning `sender` (chrome, overlay, or tab wc).
    profileOf(sender) {
        const wd = this.getWindowByWebContents(sender);
        return wd?.profileId || '1';
    }
    // Switch a window to another workspace IN PLACE: repoint its
    // profile + history store, reveal that workspace's tabs, and tell the chrome
    // to filter the strip + refresh essentials/bookmarks/profile chip.
    switchWorkspace(wd, id) {
        id = String(id);
        if (!wd?.tabs || (wd.profileId || '1') === id)
            return;
        wd.profileId = id;
        wd.tabs.profileId = id;
        wd.tabs.history = this.historyFor(id);
        try {
            wd.tabs.applyWorkspace();
        }
        catch (e) { log.debug('window-manager', 'switchWorkspace', e); }
        try {
            wd.window.webContents.send('workspace-switched', id);
            // These views are per-workspace — re-emit their change events so the
            // bookmark bar + Essentials reload for the new workspace.
            wd.window.webContents.send('bookmarks-changed');
            wd.window.webContents.send('essentials-changed');
        }
        catch (e) { log.debug('window-manager', 'switchWorkspace', e); }
        // Folders are per-workspace too. Without this the strip keeps the old
        // workspace's folders — and on the startup restore, which switches into
        // the saved workspace, they never appear at all.
        try { wd.tabs.broadcastFolders(); }
        catch (e) { log.debug('window-manager', 'switchWorkspace', e); }
    }
    _clampBoundsToDisplays(bounds) {
        try {
            const displays = screen.getAllDisplays();
            const { x, y, width, height } = bounds;
            const visible = displays.some(d => {
                const wa = d.workArea;
                return x < wa.x + wa.width - 50 &&
                    x + width > wa.x + 50 &&
                    y < wa.y + wa.height - 50 &&
                    y + height > wa.y + 50;
            });
            if (!visible) {
                const primary = screen.getPrimaryDisplay().workArea;
                return { x: primary.x, y: primary.y, width, height };
            }
        }
        catch (e) { log.debug('window-manager', '_clampBoundsToDisplays', e); }
        return bounds;
    }
    _persistWindowBounds(window, options = {}) {
        try {
            if (!window || window.isDestroyed())
                return;
            const { forceNormal = false } = options || {};
            const isMinimized = typeof window.isMinimized === 'function' ? window.isMinimized() : false;
            const isMaximized = forceNormal ? false
                : (typeof window.isMaximized === 'function' ? window.isMaximized() : false);
            const windowData = this.getWindowByWebContents?.(window.webContents);
            const isHtmlFullScreen = !!windowData?.tabs?.isHtmlFullScreen;
            const isFullScreen = forceNormal ? false
                : (!isHtmlFullScreen && (typeof window.isFullScreen === 'function' ? window.isFullScreen() : false));
            const bounds = window.getBounds();
            const normalBounds = (isMinimized || isMaximized || isFullScreen) && typeof window.getNormalBounds === 'function'
                ? window.getNormalBounds()
                : bounds;
            if (normalBounds && normalBounds.width > 0 && normalBounds.height > 0) {
                this.persistence.set('windowBounds', normalBounds);
                this.persistence.set('windowState', {
                    bounds,
                    normalBounds,
                    isMaximized,
                    isFullScreen,
                });
            }
        }
        catch (e) { log.debug('window-manager', 'normalBounds', e); }
    }
    _persistPrimaryWindowBounds() {
        try {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && !focused.isDestroyed()) {
                this._persistWindowBounds(focused);
                return;
            }
            const primary = this.getPrimaryWindow();
            if (primary?.window)
                this._persistWindowBounds(primary.window);
        }
        catch (e) { log.debug('window-manager', '_persistPrimaryWindowBounds', e); }
    }
    createWindow(width = 800, height = 600, options = {}) {
        const windowId = this.nextWindowId++;
        // Restore saved size/position when there are no open windows
        const savedState = this.windows.size === 0
            ? this.persistence.get('windowState')
            : null;
        const savedBounds = this.windows.size === 0
            ? (savedState?.normalBounds || savedState?.bounds || this.persistence.get('windowBounds'))
            : null;
        const restoredBounds = (savedBounds && savedBounds.width > 0 && savedBounds.height > 0)
            ? this._clampBoundsToDisplays(savedBounds)
            : null;
        const window = new BrowserWindow({
            width: restoredBounds ? restoredBounds.width : width,
            height: restoredBounds ? restoredBounds.height : height,
            ...(restoredBounds ? { x: restoredBounds.x, y: restoredBounds.y } : {}),
            // Hidden until ready-to-show: with a transparent background the
            // window would otherwise appear as an empty ghost at normal bounds
            // before the chrome paints (and before maximize/fullscreen apply).
            show: false,
            minWidth: 800,
            minHeight: 600,
            icon: path.join(__dirname, process.platform === 'win32' ? '../logo-win.png' : '../logo.png'),
            frame: process.platform === 'linux' ? true : false,
            titleBarStyle: process.platform === 'win32' || process.platform === 'linux' ? 'default' : 'hiddenInset',
            // Centre on the utility bar, which spans the top: shell-top inset
            // plus half the bar height, less half a 12px light. Derived rather
            // than hardcoded so it follows the bar height.
            trafficLightPosition: { x: 14, y: Tabs.SHELL_TOP + Math.round(Tabs.UTILITY_BAR_H / 2) - 6 },
            // macOS otherwise swallows the first click on a window that is not
            // key: it activates the window and the control never sees it. That
            // is the "I had to click twice" feeling when coming back from
            // another app, or after focus has moved into a page view. Browsers
            // deliver that first click, so this does too.
            acceptFirstMouse: true,
            // macOS frosted-glass: the window material shows through the
            // translucent chrome (renderer paints the chrome with alpha).
            ...(process.platform === 'darwin'
                ? { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
                : { backgroundColor: '#0e0f11' }), // --shell (themes.css)
            webPreferences: {
                preload: path.join(__dirname, "../preload/preload.js"),
                // The chrome UI loads only trusted local files, and its preload
                // must require the extension browser-action module from disk
                // (impossible in a sandboxed preload). Tabs stay sandboxed.
                sandbox: false,
                contextIsolation: true,
            }
        });
        // ── Gesture / hardware navigation ────────────────────────────────────
        // Neither of these existed, so two habits that work in every other
        // browser silently did nothing here: the macOS swipe gesture, and the
        // back/forward buttons on a mouse (Windows/Linux).
        const navigate = (back) => {
            const wd = this.getWindowByWebContents(window.webContents);
            const tabs = wd?.tabs;
            if (!tabs)
                return;
            try { back ? tabs.goBack(tabs.activeTabIndex) : tabs.goForward(tabs.activeTabIndex); }
            catch (e) { log.debug('window-manager', 'navigate', e); }
        };
        // macOS three-finger swipe (System Settings → Trackpad → "Swipe between
        // pages"). The two-finger overscroll variant is a Chromium browser-side
        // feature Electron does not expose, so it stays unavailable.
        window.on('swipe', (_e, direction) => {
            if (direction === 'left')
                navigate(true);
            else if (direction === 'right')
                navigate(false);
        });
        // Mouse thumb buttons.
        window.on('app-command', (e, cmd) => {
            if (cmd === 'browser-backward') { e.preventDefault?.(); navigate(true); }
            else if (cmd === 'browser-forward') { e.preventDefault?.(); navigate(false); }
        });
        window.on('maximize', () => {
            try {
                window.webContents.send('window-maximize-changed', true);
            }
            catch (e) { log.debug('window-manager', 'navigate', e); }
            this._persistWindowBounds(window);
        });
        window.on('unmaximize', () => {
            try {
                window.webContents.send('window-maximize-changed', false);
            }
            catch (e) { log.debug('window-manager', 'navigate', e); }
            this._persistWindowBounds(window);
        });
        window.on('enter-full-screen', () => {
            this._persistWindowBounds(window);
        });
        window.on('leave-full-screen', () => {
            this._persistWindowBounds(window);
        });
        // First reveal happens only after the chrome has painted, at its final
        // state (restored bounds + maximize/fullscreen), so the drag regions in
        // the tab strip / toolbar are grabbable from the very first frame.
        const shouldFullScreen = !!savedState?.isFullScreen;
        const shouldMaximize = !!savedState?.isMaximized && !shouldFullScreen;
        window.once('ready-to-show', () => {
            try {
                if (shouldFullScreen)
                    window.setFullScreen(true);
                else if (shouldMaximize)
                    window.maximize();
            }
            catch (e) { log.debug('window-manager', 'navigate', e); }
            // inactive: tab tear-off — focusing a new window mid-drag would
            // break mouse capture.
            try {
                options?.inactive ? window.showInactive() : window.show();
            }
            catch (e) { log.debug('window-manager', 'navigate', e); }
        });
        window.loadFile(resolveAppFile('renderer/Browser/index.html'));
        // Safety net: if the renderer never signals ready-to-show (load error),
        // don't leave the user with an invisible window.
        setTimeout(() => {
            try {
                if (!window.isDestroyed() && !window.isVisible())
                    window.show();
            }
            catch (e) { log.debug('window-manager', 'navigate', e); }
        }, 3000);
        // Save window bounds whenever it moves or resizes (debounced)
        let _saveBoundsTimer = null;
        const _saveBounds = () => {
            clearTimeout(_saveBoundsTimer);
            _saveBoundsTimer = setTimeout(() => {
                this._persistWindowBounds(window, { forceNormal: true });
            }, 400);
        };
        window.on('resize', _saveBounds);
        window.on('move', _saveBounds);
        // If this is the last window, persist its bounds and tab state before it
        // closes. On Windows/Linux 'before-quit' fires after this window has
        // already been removed from the map, so savePrimaryState() finds no
        // primary window — this is the last reliable moment to save.
        window.on('close', () => {
            this._persistWindowBounds(window);
            // Quitting already took the whole-session snapshot (savePrimaryState)
            // and froze it, so there is nothing to do here.
            if (this._quitting)
                return;
            try {
                if (!tabs.tabMap.size || tabs.isPrivateWindow)
                    return;
                if (this.windows.size === 1) {
                    // Closing the last window IS ending the session — and on
                    // Windows/Linux 'before-quit' arrives too late to see it.
                    this.persistence.saveWindowState(windowId, tabs.buildSerializableState());
                    this.persistence.flushStateSync();
                    this.persistence.freeze();
                }
                else {
                    // One window of several, closed by hand: the user threw it
                    // away, so it should not come back next launch.
                    this.persistence.forgetWindowState(windowId);
                }
            }
            catch (e) {
                log.warn('window-manager', 'could not save the window session', e);
            }
        });
        // Track focus order: most recently focused is considered primary for persistence
        window.on('focus', () => {
            this.lastFocusedWindowId = windowId;
        });
        // Each window belongs to one profile: its tabs browse on that profile's
        // session and record into that profile's history/bookmarks.
        const profileId = String(options?.profile || '1');
        const tabs = new Tabs(window, this.historyFor(profileId), this.persistence, { private: !!options?.private, profile: profileId, windowKey: windowId });
        const shortcuts = new Shortcuts(window, tabs, this);
        tabs.setShortcuts(shortcuts);
        tabs.setWindowManager(this);
        window.webContents.on("context-menu", async (_event, params) => {
            // Determine the element under the cursor to enrich params for context decisions
            try {
                const contextInfo = await window.webContents.executeJavaScript(`(() => {
                        const el = document.elementFromPoint(${params.x}, ${params.y});
                        const tabEl = el ? el.closest('.tab-button') : null;
                        const tabBarEl = el ? el.closest('#tab-bar') : null;
                        return {
                            targetElementId: el ? (el.id || '') : '',
                            isTabButton: !!tabEl,
                            rightClickedTabIndex: tabEl ? (parseInt(tabEl.dataset.index) ?? null) : null,
                            targetAreaIsTabBar: !!tabBarEl && !tabEl,
                        };
                    })()`);
                params.targetElementId = contextInfo.targetElementId;
                params.isTabButton = contextInfo.isTabButton;
                params.rightClickedTabIndex = contextInfo.rightClickedTabIndex;
                params.targetAreaIsTabBar = contextInfo.targetAreaIsTabBar;
            }
            catch (_) { log.debug('window-manager', '_saveBounds', _); }
            const contextMenuInstance = new contextMenu(window, params, this);
            if (contextMenuInstance.getTemplate().length === 0) {
                return;
            }
            const menu = Menu.buildFromTemplate(contextMenuInstance.getTemplate());
            menu.popup({ window });
        });
        const windowData = {
            id: windowId,
            window: window,
            tabs: tabs,
            shortcuts: shortcuts,
            profileId: profileId,
            menu: null
        };
        this.windows.set(windowId, windowData);
        window.webContents.once('did-finish-load', () => {
            // Notify renderer if this is a private window
            if (options?.private) {
                window.webContents.send('set-private-window', true);
            }
            // Restore only once into the first opened window (if any state
            // exists), and only into a window of the profile the state was saved
            // under. A window created FOR a restore carries its slice with it.
            let state = options?.restoreState || null;
            if (!state && !this.restored && this.persistence.hasState()) {
                const saved = this.persistence.loadAllWindowStates();
                state = saved[0] || null;
                this._pendingWindowStates = saved.slice(1);
            }
            if (state && state.tabs && state.tabs.length > 0 && String(state.profile || '1') === profileId) {
                try {
                    // Rebuild every workspace's tabs (each tagged with its own
                    // workspace + container); only the active workspace's show.
                    const tabKeys = [];
                    state.tabs.forEach((t) => {
                        tabs.createLazyTab(t.url, t.title, t.pinned, false, false, false, t.container || null, t.workspace || '1');
                        const key = tabs.nextTabIndex - 1;
                        tabKeys.push(key);
                        // Bring the tab's own back/forward tree and reading
                        // position with it, not just its address.
                        if (Array.isArray(t.history) && t.history.length > 1)
                            tabs.navigationHistory.restoreTab(key, t.history, t.historyIndex || 0);
                        if (t.scroll > 0)
                            tabs.tabScroll.set(key, t.scroll);
                    });
                    // Restore tab folders (tab groups) + their tab membership.
                    if (Array.isArray(state.folders) && state.folders.length) {
                        tabs.folders = state.folders.map(f => ({ ...f }));
                        let maxSeq = 0;
                        for (const f of tabs.folders) { const n = parseInt(String(f.id).replace(/^f/, '')); if (n > maxSeq) maxSeq = n; }
                        tabs._folderSeq = maxSeq + 1;
                        state.tabs.forEach((t, i) => { if (t.folder) tabs.tabFolders.set(tabKeys[i], t.folder); });
                    }
                    // User-set labels and icons override page metadata, so they
                    // have to come back before the tabs report their own titles.
                    state.tabs.forEach((t, i) => {
                        if (t.label) tabs.tabLabels.set(tabKeys[i], t.label);
                        if (t.icon) tabs.tabIcons.set(tabKeys[i], t.icon);
                        if (t.home) tabs.pinnedHome.set(tabKeys[i], t.home);
                    });
                    const activeWs = String(state.activeWorkspace || state.profile || '1');
                    if (activeWs !== profileId) {
                        tabs.profileId = activeWs;
                        windowData.profileId = activeWs;
                        tabs.history = this.historyFor(activeWs);
                    }
                    // Restore assigns folders straight onto the Tabs instance, so
                    // nothing tells the chrome about them: its own init fetch runs
                    // against the pre-restore workspace and comes back empty, and
                    // restored folders never appear. Push them once it can listen.
                    try {
                        const wc = windowData.window.webContents;
                        if (wc.isLoading())
                            wc.once('did-finish-load', () => { try { tabs.broadcastFolders(); } catch (e) { log.debug('window-manager', '_saveBounds', e); } });
                        else
                            tabs.broadcastFolders();
                    }
                    catch (e) { log.debug('window-manager', '_saveBounds', e); }
                    // Focus the saved active tab if it's in the active workspace,
                    // else the active workspace's first tab.
                    const inWs = tabs.tabsInWorkspace(tabs.profileId);
                    const savedActive = (typeof state.activeIndex === 'number') ? tabKeys[state.activeIndex] : undefined;
                    const focusIdx = (savedActive != null && inWs.includes(savedActive)) ? savedActive : inWs[0];
                    if (typeof focusIdx === 'number')
                        tabs.showTab(focusIdx);
                    else
                        tabs.createTab();
                }
                catch (e) {
                    // A failed restore used to be silent, so a session that came
                    // back empty looked like the state file was simply missing.
                    log.error('window-manager', 'session restore failed', e);
                    if (tabs.getTotalTabs() === 0)
                        tabs.createTab();
                }
                this.restored = true;
                // The rest of last session's windows, once this one is up.
                this._restoreRemainingWindows();
            }
            else {
                tabs.createTab();
            }
            // Whether or not there was anything to restore, the restore slot is
            // now spent: a window opened LATER in the session must start empty,
            // not re-run the restore and clone another window's tabs.
            this.restored = true;
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
                                    const activeTab = next.tabs.tabMap.get(activeIdx);
                                    if (activeTab && activeTab.webContents) {
                                        activeTab.webContents.focus();
                                    }
                                }
                                catch (e) { log.debug('window-manager', 'focusIdx', e); }
                            }, 20);
                        }
                        catch (e) { log.debug('window-manager', 'focusIdx', e); }
                    }
                }
                // After a window closes, persist bounds from the remaining primary window.
                this._persistPrimaryWindowBounds();
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
            if (windowData.window.webContents === webContents)
                return windowData;
            // Also match child WebContentsViews (suggestions, menu, bookmarkPrompt, folderDropdown, downloads)
            if (windowData.suggestions?.webContents === webContents)
                return windowData;
            if (windowData.menu?.webContents === webContents)
                return windowData;
            if (windowData.bookmarkPrompt?.webContents === webContents)
                return windowData;
            if (windowData.folderDropdown?.webContents === webContents)
                return windowData;
            if (windowData.downloadsPanel?.webContents === webContents)
                return windowData;
            if (windowData.ctxMenu?.webContents === webContents)
                return windowData;
            if (windowData.palette?.webContents === webContents)
                return windowData;
            if (windowData.extensionsPanel?.webContents === webContents)
                return windowData;
            if (windowData.sidePanel?.webContents === webContents)
                return windowData;
            if (windowData.sidePanelHeader?.webContents === webContents)
                return windowData;
            if (windowData.passwordPrompt?.webContents === webContents)
                return windowData;
            if (windowData.siteInfoView?.webContents === webContents)
                return windowData;
            if (windowData.miniPlayer?.webContents === webContents)
                return windowData;
            if (windowData.tabs?.glanceView?.webContents === webContents)
                return windowData;
            if (windowData.tabs?.glanceBackdrop?.webContents === webContents)
                return windowData;
            if (windowData.tabs?.glanceBar?.webContents === webContents)
                return windowData;
            if (windowData.tabs?.splitDivider?.webContents === webContents)
                return windowData;
            if (windowData.tabs?.splitDrop?.webContents === webContents)
                return windowData;
            if (windowData.tabs?.splitHandles?.some?.(v => v?.webContents === webContents))
                return windowData;
            // Match tab WebContentsViews
            if (windowData.tabs) {
                for (const [, tab] of windowData.tabs.tabMap) {
                    if (tab && tab.webContents === webContents)
                        return windowData;
                }
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
            if (win)
                return win;
        }
        return null;
    }
    // Primary window for persistence is the most recently focused; fallback to oldest
    getPrimaryWindow() {
        const recent = this.getMostRecentlyFocusedWindow();
        if (recent)
            return recent;
        if (this.windows.size === 0)
            return null;
        const entries = Array.from(this.windows.entries()).sort((a, b) => a[0] - b[0]);
        return entries[0][1] || null;
    }
    /** Re-open the other windows from last session, offset so they don't stack. */
    _restoreRemainingWindows() {
        const pending = this._pendingWindowStates || [];
        this._pendingWindowStates = [];
        if (!pending.length || this.persistence.get('restoreAllWindows') === false)
            return;
        pending.forEach((state, i) => {
            setTimeout(() => {
                try {
                    this.createWindow(1000, 700, {
                        profile: String(state.profile || '1'),
                        restoreState: state,
                    });
                }
                catch (e) {
                    log.warn('window-manager', 'could not restore an extra window', e);
                }
            }, 400 * (i + 1));
        });
    }
    /**
     * Quit path: record EVERY open window, synchronously, so the whole session
     * comes back. Also flips `_quitting`, which tells each window's 'close'
     * handler to keep its slice instead of dropping it (a window closed by hand
     * during a session is meant to be gone; one closed by quitting is not).
     */
    savePrimaryState() {
        this._quitting = true;
        try {
            const all = this.getAllWindows().filter(w => w?.tabs && !w.tabs.isPrivateWindow && w.tabs.tabMap.size);
            if (!all.length)
                return false;
            const keepAll = this.persistence.get('restoreAllWindows') !== false;
            for (const w of (keepAll ? all : all.slice(0, 1))) {
                try { this.persistence.saveWindowState(w.id, w.tabs.buildSerializableState()); }
                catch (e) { log.warn('window-manager', 'could not record a window for restore', e); }
            }
            this.persistence.flushStateSync();
            this.persistence.freeze(); // teardown must not rewrite the snapshot
            return true;
        }
        catch (e) {
            log.error('window-manager', 'session save failed', e);
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