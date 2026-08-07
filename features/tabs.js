const { WebContentsView, Menu } = require('electron');
const { resolveAppFile } = require('../app-paths');
const path = require('path');
const UserAgent = require('./user-agent');
const faviconStore = require('./favicon-store');
const containers = require('./containers');
const profiles = require('./profiles');
const isolationRules = require('./isolation-rules');
const permissionUI = require('./permission-ui');
const captivePortal = require('./captive-portal');
const contextMenu = require('./tab-context-menu');
const NavigationHistory = require('./navigation-history');
const FindDialogManager = require('./find-dialog');
const focusMode = require('./focus-mode');
const { READERABLE_JS, EXTRACT_JS, PIP_JS } = require('./reader');
const extensions = require('./extensions');
const miniPlayer = require('./mini-player');
const privateSessions = require('./private-session');
const YOUTUBE_SPACE_FIX_JS = `
(() => {
    if (window.__inkYouTubeSpaceFix) return;
    window.__inkYouTubeSpaceFix = true;

    let lastSpace = null;

    function isEditable(el) {
        if (!el) return false;
        if (el.isContentEditable) return true;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        const role = el.getAttribute && el.getAttribute('role');
        return role && role.toLowerCase() === 'textbox';
    }

    function isYouTubeFullscreen() {
        const player = document.querySelector('.html5-video-player');
        return !!(
            document.fullscreenElement ||
            document.documentElement.classList.contains('ytp-fullscreen') ||
            document.body.classList.contains('ytp-fullscreen') ||
            (player && player.classList.contains('ytp-fullscreen'))
        );
    }

    function toggleYouTubeFullscreen() {
        const player = document.querySelector('#movie_player') ||
                       document.querySelector('.html5-video-player');
        if (isYouTubeFullscreen()) {
            // Exit: try HTML5 API first, then player API, then button
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            } else if (player && typeof player.exitFullscreen === 'function') {
                try { player.exitFullscreen(); } catch {}
            } else {
                const btn = document.querySelector('.ytp-fullscreen-button');
                if (btn) btn.click();
            }
        } else {
            // Enter: try player requestFullscreen, then button
            if (player && typeof player.requestFullscreen === 'function') {
                player.requestFullscreen().catch(() => {});
            } else {
                const btn = document.querySelector('.ytp-fullscreen-button');
                if (btn) btn.click();
            }
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code !== 'Space' && e.key !== ' ') return;
        if (isEditable(e.target) || isEditable(document.activeElement)) return;
        const video = document.querySelector('video');
        if (!video) return;
        lastSpace = {
            wasPaused: video.paused,
            time: Date.now(),
        };
    }, true);

    document.addEventListener('keyup', (e) => {
        if (e.code !== 'Space' && e.key !== ' ') return;
        if (isEditable(e.target) || isEditable(document.activeElement)) return;
        const video = document.querySelector('video');
        if (!video || !lastSpace) return;
        // If YouTube already handled the spacebar, don't toggle again.
        if (video.paused === lastSpace.wasPaused) {
            if (video.paused) video.play();
            else video.pause();
        }
        lastSpace = null;
    }, true);

    window.__inkYouTubeExitFullscreen = () => {
        if (isYouTubeFullscreen()) toggleYouTubeFullscreen();
    };
})();
`;
// The Settings page needs privileged APIs (passwords, extension management)
// that must NOT be exposed to ordinary web pages, so it uses a dedicated
// preload. Every other page (web content, History, Bookmarks, New Tab) uses
// the general preload.
function preloadForPage(kind) {
    const base = path.join(__dirname, '../preload');
    if (kind === 'settings' || (typeof kind === 'string' && kind.includes('/Settings/'))) {
        return path.join(base, 'settings-preload.js');
    }
    return path.join(base, 'preload.js');
}
// Internal pages addressable via the northstar:// scheme, e.g. northstar://settings
// or northstar://settings/appearance. Shown in the omnibox and typeable to navigate.
const INTERNAL_PAGES = {
    settings: { file: 'renderer/Settings/index.html', title: 'Settings' },
    history: { file: 'renderer/History/index.html', title: 'History' },
    bookmarks: { file: 'renderer/Bookmarks/index.html', title: 'Bookmarks' },
};
const SETTINGS_SECTIONS = ['general', 'appearance', 'focus', 'privacy', 'passwords', 'extensions', 'about'];
// Parse a northstar:// URL → { type, section } (section only for settings), or null.
function parseNorthstarUrl(raw) {
    const m = /^northstar:\/\/([a-z]+)(?:\/([a-z]+))?\/?$/i.exec((raw || '').trim());
    if (!m)
        return null;
    const type = m[1].toLowerCase();
    if (!INTERNAL_PAGES[type])
        return null;
    let section = m[2] ? m[2].toLowerCase() : null;
    if (!(type === 'settings' && section && SETTINGS_SECTIONS.includes(section)))
        section = null;
    return { type, section };
}
// The stored/display "url token" for an internal tab: 'settings', 'settings/appearance', …
function internalTokenFor(fileUrl) {
    let type = null;
    if (fileUrl.includes('/Settings/index.html'))
        type = 'settings';
    else if (fileUrl.includes('/Bookmarks/index.html'))
        type = 'bookmarks';
    else if (fileUrl.includes('/History/index.html'))
        type = 'history';
    if (!type)
        return null;
    let section = '';
    if (type === 'settings') {
        try {
            section = new URL(fileUrl).hash.replace(/^#/, '').toLowerCase();
        }
        catch { }
        // 'general' is the default section — it stays the bare northstar://settings.
        if (!SETTINGS_SECTIONS.includes(section) || section === 'general')
            section = '';
    }
    return section ? `${type}/${section}` : type;
}
class Tabs {
    // ── Wiring ────────────────────────────────────────────────────────────
    mainWindow;
    history;
    persistence; // Persistence — injected by WindowManager
    navigationHistory;
    findDialog; // FindDialog for this window
    shortcuts; // Shortcuts — set later via setShortcuts()
    windowManager; // WindowManager — set later via setWindowManager()
    // ── Tab bookkeeping ───────────────────────────────────────────────────
    tabMap; // tabIndex → live view
    tabUrls; // tabIndex → last committed URL
    tabOrder; // visual order of tab indices
    tabLastActive; // tabIndex → Date.now() of last activation
    activeTabIndex;
    nextTabIndex; // monotonically increasing id source
    pinnedTabs;
    privateTabs;
    isPrivateWindow;
    closedTabHistory; // stack for "Reopen Closed Tab"
    // ── Window close / fullscreen state machines ──────────────────────────
    allowClose;
    closePreventionActive;
    isHtmlFullScreen; // page called requestFullscreen()
    htmlFullScreenRequested;
    userFullScreenActive; // user pressed F11 / green button
    // ── Reader mode ───────────────────────────────────────────────────────
    readerMode; // tab indices currently showing the reader view
    readerArticles; // tabIndex → extracted article
    readerOriginal; // tabIndex → original URL to restore on exit
    // ── Timers / transient ────────────────────────────────────────────────
    bookmarkBarHeight;
    saveTimer;
    _sleepTimer;
    _pendingPrevActive; // tab to reactivate after a background-tab close
    constructor(mainWindow, History, Persistence, options = {}) {
        this.mainWindow = mainWindow;
        this.history = History;
        this.persistence = Persistence || null;
        this.navigationHistory = new NavigationHistory();
        this.findDialog = FindDialogManager.getInstance().createDialog(mainWindow);
        this.shortcuts = null;
        this.tabMap = new Map();
        this.tabUrls = new Map();
        // Tab sleeping: free the renderer process of long-inactive background
        // tabs (Chrome's "memory saver"). tabLastActive tracks when a tab was
        // last the active tab; the scan puts stale ones to sleep.
        this.tabLastActive = new Map();
        this._sleepTimer = setInterval(() => { try {
            this._sleepScan();
        }
        catch { } }, 60_000);
        this.activeTabIndex = 0;
        this.nextTabIndex = 0;
        this.allowClose = false;
        this.closePreventionActive = false;
        this.isHtmlFullScreen = false;
        this.htmlFullScreenRequested = false;
        this.userFullScreenActive = false;
        this.pinnedTabs = new Set();
        this.privateTabs = new Set();
        this.tabContainers = new Map(); // tabIndex → container id
        this.nextContainerId = 1;
        this.isPrivateWindow = options?.private ?? false;
        // Live sidebar width (px) — drag-resizable, persisted. Clamped.
        this.sidebarWidth = Math.max(180, Math.min(460, Number(this.persistence?.get('sidebarWidth')) || 232));
        // Which workspace/profile this window is currently browsing as ('1' =
        // default session + legacy stores). Personas scope within it. Tabs are
        // tagged with the workspace they were opened in (tabProfiles) so
        // switching workspaces swaps the visible tab set IN PLACE.
        this.profileId = options?.profile ? String(options.profile) : '1';
        this.tabProfiles = new Map(); // tabIndex → workspace/profile id
        this.splitPair = null; // [leftIdx, rightIdx] when split view is active
        this.glanceView = null; // floating page-preview overlay ("glance")
        this.glanceUrl = null;
        this.sidebarCompact = false; // side mode: sidebar hidden, page full-bleed
        this.tabOrder = [];
        this.closedTabHistory = []; // stack of {url, title} for "Reopen Closed Tab"
        this.readerMode = new Set(); // tab indices currently showing the reader view
        this.readerArticles = new Map(); // tabIndex → extracted article (served to the reader page)
        this.readerOriginal = new Map(); // tabIndex → original URL to restore on exit
        this.mainWindow.on('resize', () => {
            this.resizeAllTabs();
        });
        this.mainWindow.on('enter-full-screen', () => {
            if (!this.isHtmlFullScreen)
                this.userFullScreenActive = true;
        });
        this.mainWindow.on('leave-full-screen', () => {
            // Capture before reset: true means OS fullscreen was entered because YouTube
            // requested it (not the user pressing F11). In that case, YouTube triggered
            // its own exitFullscreen() and is cleaning up its CSS itself — calling
            // applyYouTubeExitFullscreen here races the macOS animation and double-toggles
            // back into fullscreen (works on Windows where exit is instant, breaks on Mac).
            const wasHtmlRequested = this.htmlFullScreenRequested;
            this.userFullScreenActive = false;
            this.isHtmlFullScreen = false;
            this.htmlFullScreenRequested = false;
            this.resizeAllTabs();
            if (!wasHtmlRequested) {
                // OS fullscreen was user-initiated (F11 / green button) while YouTube was
                // in CSS fullscreen — force YouTube to clean up its own state.
                this.tabMap.forEach(tab => {
                    if (tab && tab.webContents) {
                        tab.webContents.executeJavaScript('if (document.fullscreenElement) document.exitFullscreen();').catch(() => { });
                        this.applyYouTubeExitFullscreen(tab);
                    }
                });
            }
        });
        this.mainWindow.on('close', (event) => {
            if (this.tabMap.size > 0 && !this.allowClose) {
                // A user-initiated OS close (macOS traffic light, Alt-F4, taskbar
                // menu) arrives here without allowClose set. Honor it: state was
                // already persisted by window-manager's handler on this same
                // event, so mark the window closeable and re-issue the close.
                event.preventDefault();
                this.allowClose = true;
                setImmediate(() => {
                    try {
                        if (!this.mainWindow.isDestroyed())
                            this.mainWindow.close();
                    }
                    catch { }
                });
            }
        });
        const originalClose = this.mainWindow.close.bind(this.mainWindow);
        const originalDestroy = this.mainWindow.destroy.bind(this.mainWindow);
        this.mainWindow.close = () => {
            if (this.tabMap.size > 0 && !this.allowClose) {
                return;
            }
            const result = originalClose();
            this.allowClose = false;
            return result;
        };
        this.mainWindow.destroy = () => {
            if (this.tabMap.size > 0 && !this.allowClose) {
                return;
            }
            return originalDestroy();
        };
    }
    _getPrivateSession() {
        // Every private tab gets its OWN isolated in-memory session — cookies,
        // cache and storage never carry over to any other tab, private or not.
        // The session is wiped in destroyTab() the moment the tab closes.
        return privateSessions.createTabSession();
    }
    createLazyTab(url, title, isPinned, isPrivate = false, insertAfterActive = false, eager = false, containerId = null, workspaceId = null) {
        const tabIndex = this.nextTabIndex;
        this.nextTabIndex++;
        const makePrivate = isPrivate || this.isPrivateWindow;
        // Restore may rebuild tabs of a non-active workspace — honour the saved
        // workspace tag; live-created lazy tabs use the current one.
        const workspace = workspaceId ? String(workspaceId) : this.profileId;
        // Container binding is fixed here (chosen at creation, like private) and
        // only applies to non-private tabs.
        const container = (!makePrivate && containerId != null && String(containerId) !== '') ? String(containerId) : null;
        const webPrefs = {
            autoplayPolicy: 'user-gesture-required',
            preload: preloadForPage(url),
            contextIsolation: true,
            nodeIntegration: false,
        };
        if (makePrivate) {
            webPrefs.session = this._getPrivateSession();
            webPrefs.v8CacheOptions = 'none'; // disable V8 bytecode cache for private tabs
        }
        else if (container) {
            webPrefs.session = containers.get(container);
        }
        else if (this.profileId !== '1') {
            webPrefs.session = profiles.sessionFor(this.profileId);
        }
        const tab = new WebContentsView({ webPreferences: webPrefs });
        try { tab.setBorderRadius(Tabs.PAGE_RADIUS); } catch { }
        if (makePrivate) {
            tab.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
            tab.privateSession = webPrefs.session; // wiped when the tab closes
        }
        this.mainWindow.contentView.addChildView(tab);
        this.raiseFloatingViews();
        tab.setVisible(false); // Do not show initially
        UserAgent.setupTab(tab);
        this._applyTabBackground(tab, url || 'newtab');
        // Own-session tabs (persona / private / non-default profile) skip
        // extension registration — extensions live on the default session.
        if (!makePrivate && !container && this.profileId === '1')
            extensions.addTab(tab.webContents, this.mainWindow);
        // Setup context menu
        tab.webContents.on("context-menu", async (_event, params) => {
            let menuParams = params;
            if (params?.linkURL) {
                try {
                    await tab.webContents.executeJavaScript('try { const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges(); } catch {}', true);
                }
                catch { }
                menuParams = { ...params, selectionText: '' };
            }
            const contextMenuInstance = new contextMenu(tab, menuParams, this);
            const menu = Menu.buildFromTemplate(contextMenuInstance.getTemplate());
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                menu.popup({ window: this.mainWindow });
            }
        });
        const bounds = this.getTabBounds();
        tab.setBounds(bounds);
        this.tabMap.set(tabIndex, tab);
        this.tabUrls.set(tabIndex, url || 'newtab');
        this.tabLastActive.set(tabIndex, Date.now());
        // Placement: user "open in new tab" actions drop the tab right after the
        // current one (Chrome/Firefox style); everything else (session restore,
        // etc.) appends to the end so restored order is preserved.
        const afterIdx = (insertAfterActive && this.tabOrder.includes(this.activeTabIndex))
            ? this.activeTabIndex : null;
        const afterPos = afterIdx !== null ? this.tabOrder.indexOf(afterIdx) : -1;
        if (afterPos !== -1)
            this.tabOrder.splice(afterPos + 1, 0, tabIndex);
        else
            this.tabOrder.push(tabIndex);
        if (isPinned) {
            this.pinnedTabs.add(tabIndex);
        }
        if (makePrivate) {
            this.privateTabs.add(tabIndex);
        }
        tab.isPrivate = makePrivate;
        tab.containerId = container;
        if (container)
            this.tabContainers.set(tabIndex, container);
        this.tabProfiles.set(tabIndex, workspace);
        tab.lazyLoaded = false;
        let tempTitle = title || url || 'New Tab';
        if ((!title || title === 'New Tab' || title === '') && url && url.startsWith('http')) {
            try {
                tempTitle = new URL(url).hostname;
            }
            catch { }
        }
        tab.lazyTitle = tempTitle;
        this.navigationHistory.initializeTab(tabIndex, url || 'newtab');
        this.setupTabListeners(tabIndex, tab);
        tab.webContents.on('did-finish-load', () => {
            const windowData = this.getWindowData();
            if (windowData) {
                focusMode.applyToTab(windowData, tab.webContents, tab.webContents.getURL?.() ?? '');
            }
            this.applyYouTubeSpaceFix(tab, tab.webContents.getURL?.() ?? '');
            const title = tab.webContents.getTitle();
            if (title) {
                tab.lazyTitle = title;
                this.sendTabUpdate(tabIndex, tab, this.tabUrls.get(tabIndex) || '', title);
            }
        });
        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: tab.lazyTitle,
            totalTabs: this.tabMap.size,
            afterIndex: afterPos !== -1 ? afterIdx : null,
            active: false,
            private: makePrivate,
            container: container,
            containerColor: container ? containers.colorFor(container) : null,
            containerMeta: container ? containers.meta(container) : null,
            workspace: workspace,
        });
        this.sendTabUpdate(tabIndex, tab, url || 'newtab', tab.lazyTitle);
        // Eager background load (user-initiated "open in new tab"): start loading
        // immediately while the view is hidden so the page is ready when the user
        // switches over — but muted until first shown, so background video/audio
        // can't blast. Because the page loads with visibilityState "hidden", sites
        // like YouTube hold their autoplay until the tab is actually viewed,
        // instead of racing it against the tab becoming visible mid-load.
        // Session restore keeps eager=false (loading 20 tabs at startup would
        // wreck launch time and memory).
        if (eager && /^https?:/i.test(url || '')) {
            tab.lazyLoaded = true;
            tab.mutedUntilShown = true;
            tab.bgHoldMedia = true; // hold background autoplay until first viewed
            try {
                tab.webContents.audioMuted = true;
            }
            catch { }
            try {
                tab.webContents.loadURL(url);
            }
            catch { }
        }
        return tabIndex;
    }
    computeDisplayTitleFor(index, fallbackTitle) {
        try {
            const tab = this.tabMap.get(index);
            if (tab && tab.lazyLoaded === false && tab.lazyTitle) {
                return tab.lazyTitle;
            }
            if (tab && tab.lazyTitle && tab.webContents && !tab.webContents.isDestroyed() && !tab.webContents.getTitle()) {
                return tab.lazyTitle;
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
            if (fallbackTitle)
                return fallbackTitle;
            const t = tab && tab.webContents ? tab.webContents.getTitle() : '';
            return t || 'New Tab';
        }
        catch {
            return 'New Tab';
        }
    }
    updateWindowTitle(index, explicitTitle) {
        try {
            const title = explicitTitle || this.computeDisplayTitleFor(index);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setTitle(title);
            }
        }
        catch { }
    }
    setWindowManager(windowManager) {
        this.windowManager = windowManager;
    }
    getWindowData() {
        if (!this.windowManager)
            return null;
        return this.windowManager.getWindowByWebContents(this.mainWindow.webContents);
    }
    raiseFloatingViews() {
        const wd = this.getWindowData();
        if (!wd?.window?.contentView)
            return;
        const overlays = [this.glanceView, wd.menu, wd.suggestions, wd.bookmarkPrompt, wd.folderDropdown, wd.downloadsPanel, wd.extensionsPanel, wd.passwordPrompt];
        overlays.forEach((view) => {
            if (!view)
                return;
            try {
                wd.window.contentView.removeChildView(view);
                wd.window.contentView.addChildView(view);
            }
            catch { }
        });
    }
    setShortcuts(shortcuts) {
        this.shortcuts = shortcuts;
    }
    createTab(insertAfterIndex = null, shouldActivate = true, isPrivate = false, containerId = null) {
        const tabIndex = this.nextTabIndex;
        this.nextTabIndex++;
        const makePrivate = isPrivate || this.isPrivateWindow;
        // A container = a persistent isolated cookie jar (features/containers.js).
        // Private tabs are already isolated (in-memory), so container only applies
        // to normal tabs. Two tabs in different containers can hold independent
        // logins to the same site without one clobbering the other.
        const container = (!makePrivate && containerId != null) ? String(containerId) : null;
        const webPrefs = {
            autoplayPolicy: 'user-gesture-required',
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        };
        if (makePrivate) {
            webPrefs.session = this._getPrivateSession();
            webPrefs.v8CacheOptions = 'none';
        }
        else if (container) {
            webPrefs.session = containers.get(container);
        }
        else if (this.profileId !== '1') {
            webPrefs.session = profiles.sessionFor(this.profileId);
        }
        const tab = new WebContentsView({ webPreferences: webPrefs });
        try { tab.setBorderRadius(Tabs.PAGE_RADIUS); } catch { }
        if (makePrivate) {
            tab.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
            tab.privateSession = webPrefs.session; // wiped when the tab closes
        }
        this.mainWindow.contentView.addChildView(tab);
        tab.webContents.loadFile(resolveAppFile(makePrivate ? 'renderer/NewTab/private.html' : 'renderer/NewTab/index.html'));
        this.raiseFloatingViews();
        UserAgent.setupTab(tab);
        this._applyTabBackground(tab, 'newtab');
        // Persona/private/non-default-profile tabs run on their own session —
        // extensions are loaded on the default session only, so they skip
        // extension registration.
        if (!makePrivate && !container && this.profileId === '1')
            extensions.addTab(tab.webContents, this.mainWindow);
        tab.webContents.on("context-menu", async (_event, params) => {
            let menuParams = params;
            if (params?.linkURL) {
                try {
                    await tab.webContents.executeJavaScript('try { const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges(); } catch {}', true);
                }
                catch { }
                menuParams = { ...params, selectionText: '' };
            }
            const contextMenuInstance = new contextMenu(tab, menuParams, this);
            const menu = Menu.buildFromTemplate(contextMenuInstance.getTemplate());
            menu.popup({ window: this.mainWindow });
        });
        const bounds = this.getTabBounds();
        tab.setBounds(bounds);
        tab.setVisible(false);
        this.tabMap.set(tabIndex, tab);
        this.tabUrls.set(tabIndex, 'newtab');
        this.tabLastActive.set(tabIndex, Date.now());
        if (makePrivate) {
            this.privateTabs.add(tabIndex);
        }
        tab.isPrivate = makePrivate;
        tab.containerId = container;
        if (container)
            this.tabContainers.set(tabIndex, container);
        this.tabProfiles.set(tabIndex, this.profileId);
        // insertAfterIndex: existing tab index to insert after, -1 for the
        // front of the order (cross-window drop before the first tab), else end.
        const afterPos = (insertAfterIndex !== null && insertAfterIndex !== undefined && insertAfterIndex !== -1)
            ? this.tabOrder.indexOf(insertAfterIndex)
            : -1;
        if (insertAfterIndex === -1) {
            this.tabOrder.unshift(tabIndex);
        }
        else if (afterPos !== -1) {
            this.tabOrder.splice(afterPos + 1, 0, tabIndex);
        }
        else {
            this.tabOrder.push(tabIndex);
        }
        const previousActiveTabIndex = this.activeTabIndex;
        if (shouldActivate) {
            this.activeTabIndex = tabIndex;
            // createTab pre-sets activeTabIndex before showTab runs, so showTab
            // can't derive which tab we came from — carry it across explicitly
            // (used by the mini player's "walked away from a playing tab" hook).
            this._pendingPrevActive = previousActiveTabIndex;
        }
        this.navigationHistory.initializeTab(tabIndex, 'newtab');
        this.setupTabListeners(tabIndex, tab);
        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: 'New Tab',
            totalTabs: this.tabMap.size,
            afterIndex: insertAfterIndex === -1 ? -1 : (afterPos !== -1 ? insertAfterIndex : null),
            active: shouldActivate,
            private: makePrivate,
            container: container,
            containerColor: container ? containers.colorFor(container) : null,
            containerMeta: container ? containers.meta(container) : null,
            workspace: this.profileId,
        });
        if (shouldActivate) {
            this.showTab(tabIndex);
            // A freshly opened blank tab focuses the address bar (standard browser
            // behavior). showTab() gave OS focus to the tab's view, so pull focus
            // back to the chrome first, then focus the omnibox; fire again after the
            // page loads since its own load can re-grab OS focus.
            const focusOmnibox = () => {
                if (this.activeTabIndex !== tabIndex || this.mainWindow.isDestroyed())
                    return;
                try {
                    this.mainWindow.webContents.focus();
                    this.mainWindow.webContents.send('focus-address-bar');
                } catch { }
            };
            setImmediate(focusOmnibox);
            setTimeout(focusOmnibox, 200);
            tab.webContents.once('did-finish-load', () => setTimeout(focusOmnibox, 0));
        }
        else {
            const activeTab = this.tabMap.get(previousActiveTabIndex);
            if (activeTab) {
                activeTab.setVisible(true);
            }
            // Opened in the background (e.g. a link/video opened in a new tab):
            // keep it muted and HOLD any media until the user actually views it,
            // so it can't autoplay in the background. Both flags clear on first
            // showTab. (media-started-playing pauses held media.)
            tab.mutedUntilShown = true;
            tab.bgHoldMedia = true;
            try { tab.webContents.audioMuted = true; } catch { }
        }
        this.saveStateDebounced();
        this.sendTabUpdate(tabIndex, tab, '', 'New Tab');
        tab.webContents.on('did-finish-load', () => {
            const windowData = this.getWindowData();
            if (windowData) {
                focusMode.applyToTab(windowData, tab.webContents, tab.webContents.getURL?.() ?? '');
            }
            this.applyYouTubeSpaceFix(tab, tab.webContents.getURL?.() ?? '');
            const title = tab.webContents.getTitle();
            if (title) {
                tab.lazyTitle = title;
                this.sendTabUpdate(tabIndex, tab, this.tabUrls.get(tabIndex) || '', title);
            }
        });
        return tabIndex;
    }
    // Open (url) in a BRAND-NEW isolated instance — a fresh persistent isolated
    // session auto-named from the site. Two of these to the same site hold fully
    // independent logins, so switching tabs never carries one session over to the
    // other. This is the primary "open an isolated instance" action.
    openIsolatedInstance(url, insertAfterIndex = null) {
        const c = containers.createForUrl(url, this.profileId);
        return this.openInContainer(url, c.id, insertAfterIndex);
    }
    // Open (url) in an EXISTING instance (reuse its session — stay signed in).
    openInContainer(url, containerId, insertAfterIndex = null) {
        const idx = this.createTab(insertAfterIndex, true, false, containerId);
        if (url)
            this.loadUrl(idx, url);
        return idx;
    }
    // ── Autonomous isolation routing ──────────────────────────────────────────
    // Decide how a user-opened url should be sessioned. Never re-routes something
    // already in an instance (stickiness) or a private tab; only http(s) sites.
    //   → { mode: 'default' | 'keep' | 'isolate' | 'ask' }
    resolveIsolation(index, url, sourceContainerId) {
        if (!/^https?:/i.test(url || ''))
            return { mode: 'default' };
        if (this.isPrivateWindow || (index != null && this.privateTabs.has(index)))
            return { mode: 'default' };
        const pol = isolationRules.policyFor(url);
        // A decided-isolate site ALWAYS goes to its own tenant instance — even
        // from inside another instance — so a different tenant never loads into
        // the wrong session. Same-tenant tab → keep (no-op).
        if (pol === 'isolate') {
            let destHost = null;
            try { destHost = new URL(url).hostname; }
            catch { }
            if (sourceContainerId && containers.meta(sourceContainerId)?.tenantHost === destHost)
                return { mode: 'keep' };
            return { mode: 'isolate' };
        }
        // Not a decided-isolate site: stay in the current instance if we're in one
        // (stickiness); otherwise prompt for built-ins ('ask') or use the default.
        if (sourceContainerId)
            return { mode: 'keep' };
        if (pol === 'ask')
            return { mode: 'ask' };
        return { mode: 'default' };
    }
    // First-open doorhanger. Returns 'isolate' | 'no' | 'dismissed' and records the
    // decision (except dismiss). Reuses the permission doorhanger overlay.
    async _promptIsolate(wc, url) {
        let origin = url;
        try { origin = new URL(url).origin; }
        catch { }
        let res;
        try {
            res = await permissionUI.request(wc, {
                origin,
                title: 'Open this in its own persona?',
                action: 'open in its own persona',
                allowLabel: 'New persona',
                blockLabel: 'Use my main',
                iconType: 'shield',
                checkbox: false,
            });
        }
        catch {
            return 'dismissed';
        }
        if (res.dismissed)
            return 'dismissed';
        if (res.allowed) { isolationRules.set(url, 'isolate'); return 'isolate'; }
        isolationRules.set(url, 'no');
        return 'no';
    }
    // Replace tab (index) with a fresh tab in url's tenant instance, in place.
    _routeTypedToInstance(index, url) {
        const inst = containers.instanceForHost(url, this.profileId);
        const orderPos = this.tabOrder.indexOf(index);
        const insertAfter = orderPos > 0 ? this.tabOrder[orderPos - 1] : -1;
        const newIdx = this.openInContainer(url, inst.id, insertAfter);
        this.removeTab(index);
        return newIdx;
    }
    // User-initiated open (typed URL / bookmark / history). Routes flagged sites
    // into their isolated tenant instance (prompting the first time), else loads
    // normally in place. THE entry point ipc/tabs.js 'loadUrl' calls.
    async openUrlUserInitiated(index, url) {
        const r = this.resolveIsolation(index, url, this.tabContainers.get(index) || null);
        if (r.mode === 'isolate')
            return this._routeTypedToInstance(index, url);
        if (r.mode === 'ask') {
            const decision = await this._promptIsolate(this.tabMap.get(index)?.webContents, url);
            if (decision === 'isolate')
                return this._routeTypedToInstance(index, url);
        }
        this.loadUrl(index, url);
    }
    // A tab's instance is fixed at creation and never changes (its isolated
    // session is chosen then) — there is deliberately no "move tab to instance".
    // To use a different instance you open a NEW tab in it (openInContainer).
    //
    // Duplicate a tab into a NEW tab in the SAME container (or default) session.
    duplicateTab(index) {
        if (!this.tabMap.has(index))
            return null;
        const url = this.tabUrls.get(index);
        const httpUrl = (typeof url === 'string' && /^https?:/i.test(url)) ? url : null;
        const orderPos = this.tabOrder.indexOf(index);
        const insertAfter = orderPos !== -1 ? index : null;
        const id = this.tabContainers.get(index) || null;
        const idx = this.createTab(insertAfter, true, this.privateTabs.has(index), id);
        if (httpUrl)
            this.loadUrl(idx, httpUrl);
        return idx;
    }
    // A captive portal was detected → open its sign-in page in a new tab on the
    // DEFAULT session so the network's auth cookie applies to normal browsing.
    openCaptivePortalSignIn(url) {
        try {
            if (!this.mainWindow || this.mainWindow.isDestroyed())
                return;
            const idx = this.createTab(this.activeTabIndex, true, false);
            this.loadUrl(idx, url || 'http://neverssl.com/');
            try { this.mainWindow.webContents.send('captive-portal', { url: url || null }); }
            catch { }
        }
        catch { }
    }
    // Open an internal page (settings/history/bookmarks) via the northstar://
    // scheme. replaceActive replaces the current tab in place (used when a
    // northstar:// url is typed, or when the current tab is the new-tab page) —
    // internal pages can't just navigate an existing tab because Settings needs
    // its own privileged preload, chosen at tab creation.
    openInternalPage(type, section = null, replaceActive = false) {
        const page = INTERNAL_PAGES[type];
        if (!page)
            return null;
        const activeIdx = this.activeTabIndex;
        const canReplace = replaceActive && this.tabMap.has(activeIdx);
        const newIdx = this.createTabWithPage(page.file, type, page.title, {
            section,
            insertAfter: canReplace ? activeIdx : null,
        });
        if (canReplace && newIdx !== activeIdx)
            this.removeTab(activeIdx);
        return newIdx;
    }
    createTabWithPage(pagePath, pageType, pageTitle, opts = {}) {
        const section = opts.section || null;
        const tabIndex = this.nextTabIndex;
        this.nextTabIndex++;
        const tab = new WebContentsView({
            webPreferences: {
                autoplayPolicy: 'user-gesture-required',
                preload: preloadForPage(pageType),
                contextIsolation: true,
                nodeIntegration: false
            }
        });
        try { tab.setBorderRadius(Tabs.PAGE_RADIUS); } catch { }
        this.mainWindow.contentView.addChildView(tab);
        tab.webContents.loadFile(resolveAppFile(pagePath), section ? { hash: section } : undefined);
        this.raiseFloatingViews();
        UserAgent.setupTab(tab);
        this._applyTabBackground(tab, pageType);
        extensions.addTab(tab.webContents, this.mainWindow);
        const bounds = this.getTabBounds();
        tab.setBounds(bounds);
        tab.lazyTitle = pageTitle || pageType;
        const token = section ? `${pageType}/${section}` : pageType;
        this.tabMap.set(tabIndex, tab);
        this.tabUrls.set(tabIndex, token);
        // Position: after a given tab (for in-place replacement of the new-tab
        // page), otherwise append.
        const afterPos = (opts.insertAfter != null) ? this.tabOrder.indexOf(opts.insertAfter) : -1;
        if (afterPos !== -1)
            this.tabOrder.splice(afterPos + 1, 0, tabIndex);
        else
            this.tabOrder.push(tabIndex);
        this.activeTabIndex = tabIndex;
        this.navigationHistory.initializeTab(tabIndex, token);
        this.setupTabListeners(tabIndex, tab);
        this.mainWindow.webContents.send('tab-created', {
            index: tabIndex,
            title: pageTitle || pageType,
            totalTabs: this.tabMap.size,
            afterIndex: afterPos !== -1 ? opts.insertAfter : null
        });
        this.sendTabUpdate(tabIndex, tab, token, pageTitle);
        this.showTab(tabIndex);
        tab.webContents.on('did-finish-load', () => {
            const windowData = this.getWindowData();
            if (windowData) {
                focusMode.applyToTab(windowData, tab.webContents, tab.webContents.getURL?.() ?? '');
            }
            this.applyYouTubeSpaceFix(tab, tab.webContents.getURL?.() ?? '');
            const title = tab.webContents.getTitle();
            if (title) {
                tab.lazyTitle = title;
                this.sendTabUpdate(tabIndex, tab, this.tabUrls.get(tabIndex) || '', title);
            }
            this.saveStateDebounced();
        });
        return tabIndex;
    }
    // With macOS vibrancy the window is transparent, so a tab that doesn't fully
    // paint would bleed the frosted material through. Internal pages (new tab,
    // settings, history, bookmarks) opt INTO that frost with a transparent view;
    // web content gets an opaque white backing (matching Chrome) so nothing bleeds.
    _applyTabBackground(tab, urlOrType) {
        const t = urlOrType || '';
        const internal = t === 'newtab' || t === 'settings' || t === 'history' || t === 'bookmarks' ||
            (typeof t === 'string' && /\/(NewTab|Settings|History|Bookmarks)\//.test(t));
        try {
            tab.setBackgroundColor(internal ? '#00000000' : '#ffffff');
        }
        catch { }
    }
    // Shell margin around the floating page card (matches the shell padding in
    // Browser/styles.css). The page floats in a rounded card on a tinted shell
    // instead of filling the window edge-to-edge.
    static SHELL_PAD = 8;
    static PAGE_RADIUS = 12;
    // Width of the left tab sidebar (tabBarSide: 'side').
    static SIDEBAR_W = 224;
    // Shell inset above the tab strip (matches body padding-top in
    // Browser/styles.css) so the space above the tabs matches the space below.
    static SHELL_TOP = 6;

    // 0 while a video (or the OS) is truly fullscreen — the page must be
    // edge-to-edge and square there; otherwise the rounded floating card.
    _pageRadius() {
        const fs = this.isHtmlFullScreen || (this.mainWindow && this.mainWindow.isSimpleFullScreen && this.mainWindow.isSimpleFullScreen());
        return fs ? 0 : Tabs.PAGE_RADIUS;
    }

    getTabBounds() {
        const contentBounds = this.mainWindow.getContentBounds();
        if (this.mainWindow && (this.isHtmlFullScreen || this.mainWindow.isSimpleFullScreen())) {
            return { x: 0, y: 0, width: contentBounds.width, height: contentBounds.height };
        }
        const pad = Tabs.SHELL_PAD;
        // Sidebar mode: tabs live in a left column, so the page starts after it
        // and only the utility bar (+ optional bookmark bar) sits above.
        if ((this.persistence?.get('tabBarSide') ?? 'side') !== 'top') {
            const yOffset = 52 + Tabs.SHELL_TOP + (this.bookmarkBarHeight || 0);
            // Compact mode: the sidebar is hidden, so the page spans full width.
            const leftInset = this.sidebarCompact ? pad : this.sidebarWidth;
            let width = contentBounds.width - leftInset - pad;
            let height = contentBounds.height - yOffset - pad;
            if (width < 0)
                width = 0;
            if (height < 0)
                height = 0;
            return { x: leftInset, y: yOffset, width: Math.floor(width), height: Math.floor(height) };
        }
        // shell top inset (see body padding-top in Browser/styles.css) +
        // tab-bar (38px) + utility-bar (50px) + optional bookmark-bar (30px)
        const yOffset = 90 + Tabs.SHELL_TOP + (this.bookmarkBarHeight || 0);
        let width = contentBounds.width - pad * 2;
        let height = contentBounds.height - yOffset - pad;
        if (width < 0)
            width = 0;
        if (height < 0)
            height = 0;
        return { x: pad, y: yOffset, width: Math.floor(width), height: Math.floor(height) };
    }
    isYouTubeUrl(url) {
        try {
            const host = new URL(url).hostname || '';
            return host.includes('youtube.com') || host === 'youtu.be';
        }
        catch {
            return false;
        }
    }
    applyYouTubeSpaceFix(tab, url) {
        if (!tab || !tab.webContents || tab.webContents.isDestroyed())
            return;
        const currentUrl = url || (tab.webContents.getURL ? tab.webContents.getURL() : '');
        if (!this.isYouTubeUrl(currentUrl))
            return;
        try {
            tab.webContents.executeJavaScript(YOUTUBE_SPACE_FIX_JS, true);
        }
        catch { }
    }
    applyYouTubeExitFullscreen(tab) {
        if (!tab || !tab.webContents || tab.webContents.isDestroyed())
            return;
        const currentUrl = tab.webContents.getURL ? tab.webContents.getURL() : '';
        if (!this.isYouTubeUrl(currentUrl))
            return;
        try {
            tab.webContents.executeJavaScript('window.__inkYouTubeExitFullscreen && window.__inkYouTubeExitFullscreen();', true);
        }
        catch { }
    }
    setupTabListeners(tabIndex, tab) {
        let isNavigatingProgrammatically = false;
        let lastAddedUrl = null;
        if (this.shortcuts) {
            this.shortcuts.onTabCreated(tab);
        }
        // Block dangerous protocol navigations (javascript:, data:, vbscript:) initiated
        // by page scripts or injected links.
        const blockDangerousNav = (event, url) => {
            try {
                const proto = new URL(url).protocol;
                if (proto === 'javascript:' || proto === 'data:' || proto === 'vbscript:') {
                    event.preventDefault();
                }
            }
            catch { }
        };
        tab.webContents.on('will-navigate', blockDangerousNav);
        tab.webContents.on('will-redirect', blockDangerousNav);
        // Same-tab link click to a site the user has DECIDED to isolate (rule set,
        // not 'ask') → hand it off to its tenant instance instead of loading it in
        // this default-session tab. Only for main-frame, non-instance, non-private
        // tabs; 'ask' sites are handled on the typed/new-tab paths (no mid-click
        // prompt), and redirects (will-redirect) are never re-routed so SSO chains
        // complete.
        tab.webContents.on('will-navigate', (event, url) => {
            try {
                if (this.isPrivateWindow || this.privateTabs.has(tabIndex) || this.tabContainers.get(tabIndex))
                    return;
                if (!/^https?:/i.test(url) || isolationRules.policyFor(url) !== 'isolate')
                    return;
                event.preventDefault();
                this.openInContainer(url, containers.instanceForHost(url, this.profileId).id, tabIndex);
            }
            catch { }
        });
        tab.webContents.on('did-navigate', (event, url) => {
            // Keep the view backing in sync: frosted (transparent) for internal
            // pages, opaque for web content so vibrancy doesn't bleed through.
            this._applyTabBackground(tab, url);
            // Reader view loaded — keep the address bar showing the real page URL
            // and the article title instead of the internal file:// path.
            if (url.includes('/Reader/index.html')) {
                const orig = this.readerOriginal.get(tabIndex) || '';
                const art = this.readerArticles.get(tabIndex);
                this.tabUrls.set(tabIndex, orig || 'reader');
                lastAddedUrl = orig;
                this.sendTabUpdate(tabIndex, tab, orig, art?.title || 'Reader View');
                this.sendNavigationUpdate(tabIndex);
                try {
                    this.mainWindow.webContents.send('reader-state', { index: tabIndex, active: true, available: true });
                }
                catch { }
                isNavigatingProgrammatically = false;
                return;
            }
            // Any other navigation exits reader mode for this tab.
            if (this.readerMode.has(tabIndex)) {
                this.readerMode.delete(tabIndex);
                this.readerArticles.delete(tabIndex);
                try {
                    this.mainWindow.webContents.send('reader-state', { index: tabIndex, active: false });
                }
                catch { }
            }
            if (!url.startsWith('file://') && !isNavigatingProgrammatically) {
                if (lastAddedUrl !== url) {
                    this.tabUrls.set(tabIndex, url);
                    this.navigationHistory.addEntry(tabIndex, url);
                    lastAddedUrl = url;
                    this.sendTabUpdate(tabIndex, tab, url);
                    this.sendNavigationUpdate(tabIndex);
                    if (!this.privateTabs.has(tabIndex)) {
                        this.addToHistory(url, tab.webContents.getTitle(), this.tabContainers.get(tabIndex) || null);
                    }
                    this.saveStateDebounced();
                }
            }
            else if (url.startsWith('file://')) {
                // Internal page → a northstar:// token (e.g. 'settings/appearance'),
                // else the plain new-tab page.
                const token = internalTokenFor(url) || 'newtab';
                const base = token.split('/')[0];
                this.tabUrls.set(tabIndex, token);
                lastAddedUrl = token;
                let title = 'New Tab';
                if (base === 'settings')
                    title = 'Settings';
                else if (base === 'bookmarks')
                    title = 'Bookmarks';
                else if (base === 'history')
                    title = 'History';
                this.sendTabUpdate(tabIndex, tab, token, title);
                this.sendNavigationUpdate(tabIndex);
            }
            const windowData = this.getWindowData();
            if (windowData)
                focusMode.applyToTab(windowData, tab.webContents, url);
            this.applyYouTubeSpaceFix(tab, url);
            isNavigatingProgrammatically = false;
        });
        // window.open / target="_blank" handling.
        //
        // target="_blank" links and plain window.open() calls open as a new tab in
        // the same window — never a stray BrowserWindow.
        //
        // BUT genuine popups (a window.open() with a features string, or a popup
        // disposition) MUST be allowed to open as a real popup window with the
        // window.opener link intact. OAuth sign-in flows ("Sign in with Google",
        // Facebook/Discord/Twitch login), payment sheets, and pop-out web games
        // depend on that opener relationship — the popup posts its result back to
        // the opener (postMessage) and closes itself (window.close()). Forcing
        // those into a tab silently breaks login and leaves an orphaned tab that
        // the page can never close.
        tab.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
            // Block dangerous protocols outright, whatever the disposition.
            try {
                const proto = new URL(url).protocol;
                if (proto === 'javascript:' || proto === 'data:' || proto === 'vbscript:') {
                    return { action: 'deny' };
                }
            }
            catch {
                return { action: 'deny' };
            }
            const isPopup = disposition === 'new-popup' ||
                (typeof features === 'string' && features.trim().length > 0);
            if (isPopup) {
                // Let Chromium open a real popup. It inherits the opener's session
                // (so a private tab's popup stays in the private session), and the
                // session-level permission/privacy handlers still apply.
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        autoHideMenuBar: true,
                        webPreferences: {
                            contextIsolation: true,
                            nodeIntegration: false,
                            sandbox: true,
                        },
                    },
                };
            }
            setImmediate(async () => {
                const isPriv = this.privateTabs.has(tabIndex);
                const srcContainer = this.tabContainers.get(tabIndex) || null;
                const r = this.resolveIsolation(tabIndex, url, srcContainer);
                if (r.mode === 'isolate') {
                    this.openInContainer(url, containers.instanceForHost(url, this.profileId).id, tabIndex);
                    return;
                }
                if (r.mode === 'ask') {
                    const decision = await this._promptIsolate(this.tabMap.get(tabIndex)?.webContents, url);
                    if (decision === 'isolate') {
                        this.openInContainer(url, containers.instanceForHost(url, this.profileId).id, tabIndex);
                        return;
                    }
                    const ni = this.createTab(tabIndex, false, isPriv);
                    this.loadUrl(ni, url);
                    return;
                }
                // 'keep' carries the opener's instance; 'default' → default session.
                const newIndex = this.createTab(tabIndex, false, isPriv, srcContainer);
                this.loadUrl(newIndex, url);
            });
            return { action: 'deny' };
        });
        // Links opened from DevTools — middle-click / Ctrl-click a URL, or pick
        // "Open in new tab" on one in the Console / Network / Elements / Sources
        // panels. Electron surfaces these through 'devtools-open-url' (the
        // DevTools frontend is a separate webContents, so they never reach the
        // window-open handler above). Route them into a new tab like any link.
        tab.webContents.on('devtools-open-url', (_event, url) => {
            try {
                const proto = new URL(url).protocol;
                if (proto === 'javascript:' || proto === 'data:' || proto === 'vbscript:')
                    return;
            }
            catch {
                return;
            }
            setImmediate(() => {
                const isPriv = this.privateTabs.has(tabIndex);
                const newIndex = this.createTab(tabIndex, false, isPriv);
                this.loadUrl(newIndex, url);
            });
        });
        tab.webContents.on('did-navigate-in-page', (event, url) => {
            if (!url.startsWith('file://') && !isNavigatingProgrammatically) {
                const currentUrl = this.tabUrls.get(tabIndex);
                if (currentUrl !== url && lastAddedUrl !== url) {
                    this.tabUrls.set(tabIndex, url);
                    this.navigationHistory.addEntry(tabIndex, url);
                    lastAddedUrl = url;
                    this.sendTabUpdate(tabIndex, tab, url);
                    this.sendNavigationUpdate(tabIndex);
                    if (!this.privateTabs.has(tabIndex)) {
                        this.addToHistory(url, tab.webContents.getTitle(), this.tabContainers.get(tabIndex) || null);
                    }
                    this.saveStateDebounced();
                }
            }
            else if (url.startsWith('file://')) {
                // Settings section changes drive location.hash → recompute the
                // northstar://settings/<section> token so the omnibox stays live.
                const token = internalTokenFor(url);
                if (token && this.tabUrls.get(tabIndex) !== token) {
                    this.tabUrls.set(tabIndex, token);
                    lastAddedUrl = token;
                    this.sendTabUpdate(tabIndex, tab, token);
                    this.sendNavigationUpdate(tabIndex);
                }
            }
            const windowData = this.getWindowData();
            if (windowData)
                focusMode.applyToTab(windowData, tab.webContents, url);
            this.applyYouTubeSpaceFix(tab, url);
        });
        tab.isNavigatingProgrammatically = () => isNavigatingProgrammatically;
        tab.setNavigatingProgrammatically = (value) => { isNavigatingProgrammatically = value; };
        // HTML5 Fullscreen (e.g. YouTube videos)
        tab.webContents.on('enter-html-full-screen', () => {
            this.isHtmlFullScreen = true;
            this.htmlFullScreenRequested = !this.userFullScreenActive;
            if (this.htmlFullScreenRequested && !this.mainWindow.isFullScreen()) {
                this.mainWindow.setFullScreen(true);
            }
            this.resizeAllTabs();
        });
        tab.webContents.on('leave-html-full-screen', () => {
            if (this.htmlFullScreenRequested && this.mainWindow.isFullScreen()) {
                // OS fullscreen will exit next. Keep isHtmlFullScreen = true so
                // getTabBounds() returns full-window bounds during the macOS exit
                // animation — avoids a corrupted intermediate state (full-window size
                // minus the 88px toolbar offset) that visually sticks until a mouse
                // event triggers a repaint. leave-full-screen clears the flag and does
                // the final resize once the animation is done.
                // Also keep htmlFullScreenRequested = true so leave-full-screen knows
                // NOT to call applyYouTubeExitFullscreen (which would race the animation
                // and double-toggle back into fullscreen on macOS).
                setTimeout(() => {
                    try {
                        if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isFullScreen()) {
                            this.mainWindow.setFullScreen(false);
                        }
                    }
                    catch { }
                }, 0);
            }
            else {
                // No OS fullscreen exit pending — clean up immediately.
                this.isHtmlFullScreen = false;
                this.htmlFullScreenRequested = false;
                // Do NOT call applyYouTubeExitFullscreen here — YouTube cleans up its own
                // CSS state (.ytp-fullscreen) when HTML5 fullscreen exits. Clicking the button
                // here causes a double-toggle and also fires spuriously when DevTools opens.
                this.resizeAllTabs();
            }
        });
        // Error page — skip aborts (e.g. navigating away mid-load) and sub-frame errors
        tab.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame)
                return;
            if (errorCode === -3) {
                // ERR_ABORTED — e.g. the user hit stop. If the still-current
                // document is the new-tab page mid-fade-out, bring it back.
                try {
                    if ((tab.webContents.getURL() || '').includes('/NewTab/')) {
                        tab.webContents.executeJavaScript("document.documentElement.classList.remove('leaving')", true).catch(() => { });
                    }
                }
                catch { }
                return;
            }
            const params = new URLSearchParams({
                url: validatedURL || '',
                code: String(errorCode),
                desc: errorDescription || '',
            });
            isNavigatingProgrammatically = true;
            tab.webContents.loadFile(path.join(__dirname, '../renderer/Error/index.html'), { search: '?' + params.toString() });
            // A failed http(s) load may mean a captive portal intercepted us
            // (redirect / TLS block) — probe and, if so, auto-open its sign-in page.
            if ((validatedURL || '').startsWith('http'))
                captivePortal.check((loginUrl) => this.openCaptivePortalSignIn(loginUrl));
        });
        tab.webContents.on('found-in-page', (event, result) => {
            if (this.findDialog) {
                this.findDialog.handleFindResult(result);
            }
        });
        tab.webContents.on('page-title-updated', (event, title) => {
            tab.lazyTitle = title;
            this.navigationHistory.setCurrentTitle(tabIndex, title);
            const currentUrl = this.tabUrls.get(tabIndex) || '';
            if (currentUrl !== 'newtab' && currentUrl !== 'history' && !currentUrl.startsWith('file://')) {
                this.sendTabUpdate(tabIndex, tab, currentUrl, title);
            }
        });
        tab.webContents.on('page-favicon-updated', (event, favicons) => {
            const currentUrl = this.tabUrls.get(tabIndex) || '';
            if (currentUrl !== 'newtab' && currentUrl !== 'history' && !currentUrl.startsWith('file://')) {
                const favicon = favicons && favicons.length > 0 ? favicons[0] : null;
                this.sendTabUpdate(tabIndex, tab, currentUrl, tab.webContents.getTitle(), favicon);
                // Cache this visited site's favicon by host so suggestions/bookmarks
                // can show it later with no network fetch (features/favicon-store.js).
                if (!this.privateTabs.has(tabIndex))
                    faviconStore.remember(currentUrl, favicon);
            }
        });
        tab.webContents.on('did-start-loading', () => {
            clearTimeout(tab._loadingCapTimer);
            this.sendLoadingState(tabIndex, true);
        });
        // DOMContentLoaded: the page is parsed and usable. Many sites then keep
        // the network "loading" for 10-20s+ on non-essential third-party junk —
        // "Sign in with Google" (accounts.google.com/gsi/client), reCAPTCHA, ad
        // exchanges, error-tracker beacons — none of which affect the visible
        // page. Don't leave the tab spinning that whole time: clear the loading
        // indicator a short grace after dom-ready (unless did-stop-loading beat
        // us to it). Matches when the page actually feels loaded.
        tab.webContents.on('dom-ready', () => {
            clearTimeout(tab._loadingCapTimer);
            tab._loadingCapTimer = setTimeout(() => {
                try {
                    if (!tab.webContents.isDestroyed() && tab.webContents.isLoading()) {
                        this.sendLoadingState(tabIndex, false);
                    }
                }
                catch { }
            }, 3000);
        });
        tab.webContents.on('did-finish-load', () => {
            this.sendNavigationUpdate(tabIndex);
            this.detectReaderable(tabIndex, tab);
        });
        tab.webContents.on('did-stop-loading', () => {
            clearTimeout(tab._loadingCapTimer);
            this.sendNavigationUpdate(tabIndex);
            this.sendLoadingState(tabIndex, false);
        });
        // Picture-in-Picture is only offered while media is actually playing.
        // Track a per-tab flag and tell the chrome to show/hide the PiP button.
        tab.webContents.on('media-started-playing', () => {
            // A background-opened tab the user hasn't viewed yet must not play
            // media on its own — muted autoplay, or user-activation inherited from
            // the click that opened the tab, can otherwise start a video in the
            // background. Pause it and don't mark it as playing; showTab clears the
            // hold, so it plays normally once the user actually opens the tab.
            if (tab.bgHoldMedia && tabIndex !== this.activeTabIndex) {
                try {
                    tab.webContents.executeJavaScript("(()=>{try{document.querySelectorAll('video,audio').forEach(m=>{try{m.pause();}catch(e){}});}catch(e){}})()", true).catch(() => { });
                }
                catch { }
                return;
            }
            tab.hasPlayingMedia = true;
            if (tabIndex === this.activeTabIndex) {
                try {
                    this.mainWindow.webContents.send('media-state', { index: tabIndex, playing: true });
                }
                catch { }
            }
            // Mini player: media playing in a background tab shows the overlay.
            try {
                miniPlayer.onMediaState(this.getWindowData(), tabIndex, true);
            }
            catch { }
            this.sendMediaIndicators(tabIndex, tab); // muted tabs stay marked while playing
        });
        tab.webContents.on('media-paused', () => {
            tab.hasPlayingMedia = false;
            if (tabIndex === this.activeTabIndex) {
                try {
                    this.mainWindow.webContents.send('media-state', { index: tabIndex, playing: false });
                }
                catch { }
            }
            try {
                miniPlayer.onMediaState(this.getWindowData(), tabIndex, false);
            }
            catch { }
            this.sendMediaIndicators(tabIndex, tab);
        });
        // ── Tab-strip media indicators ────────────────────────────────────────
        // Speaker on audible tabs; mic/camera (recording) from the permission
        // layer's custom event — a granted getUserMedia is when capture starts.
        // Chromium gives no stream-ended signal, so recording clears on
        // navigation (the temp permission grants clear there too).
        tab.webContents.on('audio-state-changed', (e) => {
            tab.isAudible = !!e.audible;
            this.sendMediaIndicators(tabIndex, tab);
        });
        tab.webContents.on('media-capture-started', (names) => {
            if (!tab.capturing)
                tab.capturing = new Set();
            (Array.isArray(names) ? names : []).forEach(n => tab.capturing.add(n));
            this.sendMediaIndicators(tabIndex, tab);
        });
        tab.webContents.on('did-navigate', () => {
            if (tab.capturing && tab.capturing.size) {
                tab.capturing.clear();
                this.sendMediaIndicators(tabIndex, tab);
            }
        });
    }
    sendMediaIndicators(index, tab) {
        const cap = tab.capturing || new Set();
        const capture = cap.has('camera') ? 'camera' : (cap.has('microphone') ? 'mic' : null);
        try {
            this.mainWindow.webContents.send('tab-media-indicator', {
                index, audible: !!tab.isAudible, capture,
                muted: !!tab.webContents.isAudioMuted(),
                playing: !!tab.hasPlayingMedia,
            });
        }
        catch { }
    }
    sendTabUpdate(tabIndex, tab, url, title, favicon) {
        let displayUrl = url;
        let displayTitle = title || this.computeDisplayTitleFor(tabIndex) || "New Tab";
        // Internal pages: settings/bookmarks/history (and settings/<section>) keep
        // their token so the omnibox can show it as a northstar:// url; the new-tab
        // page and any bare file:// url show a blank address bar.
        const base = (typeof url === 'string' ? url.split('/')[0] : '');
        const isInternalToken = ['settings', 'bookmarks', 'history'].includes(base);
        const isBlankInternal = url === 'newtab' || (url && url.startsWith('file://') && !isInternalToken);
        if (isBlankInternal) {
            displayUrl = '';
            if (url && url.includes('/Settings/index.html'))
                displayTitle = 'Settings';
            else if (url && url.includes('/Bookmarks/index.html'))
                displayTitle = 'Bookmarks';
            else if (url && url.includes('/History/index.html'))
                displayTitle = 'History';
            else
                displayTitle = 'New Tab';
        }
        else if (isInternalToken) {
            displayUrl = url; // 'settings' / 'settings/appearance' / 'history' / 'bookmarks'
            if (base === 'settings')
                displayTitle = 'Settings';
            else if (base === 'bookmarks')
                displayTitle = 'Bookmarks';
            else if (base === 'history')
                displayTitle = 'History';
        }
        // Provide a default favicon instantly for http/https URLs to prevent empty gaps
        let resolvedFavicon = favicon;
        if (this.privateTabs.has(tabIndex)) {
            // The chrome renderer loads favicons through the DEFAULT session, so
            // fetching one for a private tab would leak the hostname outside the
            // private session.
            resolvedFavicon = null;
        }
        else if (!resolvedFavicon && url && url.startsWith('http')) {
            // The site's OWN favicon — not Google's aggregator (which would leak
            // every domain to Google). The real declared icon arrives shortly via
            // page-favicon-updated and replaces this.
            try {
                resolvedFavicon = `${new URL(url).origin}/favicon.ico`;
            }
            catch (e) { }
        }
        const ctrId = this.tabContainers.get(tabIndex) || null;
        this.mainWindow.webContents.send('url-updated', {
            index: tabIndex,
            url: displayUrl,
            title: displayTitle,
            favicon: resolvedFavicon,
            private: this.privateTabs.has(tabIndex),
            container: ctrId,
            containerMeta: ctrId ? containers.meta(ctrId) : null,
        });
        // Keep the window title in sync with the active tab
        if (tabIndex === this.activeTabIndex) {
            this.updateWindowTitle(tabIndex, displayTitle);
        }
    }
    // ── Tab sleeping ──────────────────────────────────────────────────────────
    // Free the renderer process of long-inactive background tabs (like Chrome's
    // memory saver). The WebContentsView and its navigation history survive;
    // showTab()/loadUrl() transparently revive the tab with a reload. Never
    // sleeps: the active tab, pinned tabs, tabs playing audio/media, internal
    // pages, unloaded lazy tabs, or tabs with DevTools open.
    _sleepScan() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            clearInterval(this._sleepTimer);
            return;
        }
        const p = this.persistence;
        if (p && p.get('tabSleepEnabled') === false)
            return;
        const mins = Math.max(1, Number(p?.get('tabSleepMinutes')) || 30);
        const cutoff = Date.now() - mins * 60_000;
        this.tabMap.forEach((tab, i) => {
            if (i === this.activeTabIndex || tab.slept)
                return;
            if (tab.lazyLoaded === false)
                return; // not loaded — nothing to free
            if (this.pinnedTabs.has(i))
                return;
            const url = this.tabUrls.get(i) || '';
            if (!/^https?:/i.test(url))
                return; // only real web pages
            if ((this.tabLastActive.get(i) || 0) > cutoff)
                return;
            try {
                const wc = tab.webContents;
                if (!wc || wc.isDestroyed() || wc.isCrashed())
                    return;
                if (tab.hasPlayingMedia || wc.isCurrentlyAudible())
                    return;
                if (wc.isDevToolsOpened())
                    return;
                tab.slept = true;
                wc.forcefullyCrashRenderer(); // frees the whole renderer process
            }
            catch { }
        });
    }
    // Tell the chrome a tab started/stopped loading so it can show a tab
    // spinner and flip the reload button to a stop button (and back).
    sendLoadingState(tabIndex, loading) {
        try {
            this.mainWindow.webContents.send('tab-loading', { index: tabIndex, loading: !!loading });
        }
        catch (e) { }
    }
    sendNavigationUpdate(tabIndex) {
        if (this.tabMap.has(tabIndex) && tabIndex === this.activeTabIndex) {
            try {
                this.mainWindow.webContents.send('navigation-updated', {
                    index: tabIndex,
                    canGoBack: this.canGoBack(tabIndex),
                    canGoForward: this.canGoForward(tabIndex)
                });
            }
            catch (error) {
            }
        }
    }
    addToHistory(url, title, persona = null) {
        if (this.history && url && !url.startsWith('file://')) {
            const personaName = persona ? (containers.meta(persona)?.name || null) : null;
            this.history.addToHistory(url, title || url, persona || null, personaName).catch(error => {
            });
        }
    }
    // ── Split view (two tabs side by side) ────────────────────────────────────
    _splitHalves() {
        const b = this.getTabBounds();
        const gap = 6;
        const w = Math.max(0, Math.floor((b.width - gap) / 2));
        return [
            { x: b.x, y: b.y, width: w, height: b.height },
            { x: b.x + w + gap, y: b.y, width: b.width - w - gap, height: b.height },
        ];
    }
    _layoutSplit() {
        if (!this.splitPair)
            return;
        const [l, r] = this.splitPair;
        if (!this.tabMap.has(l) || !this.tabMap.has(r)) {
            this.splitPair = null;
            return;
        }
        const [lb, rb] = this._splitHalves();
        const radius = this._pageRadius();
        const place = (idx, bounds) => {
            const tab = this.tabMap.get(idx);
            if (tab.slept) {
                tab.slept = false;
                try { tab.webContents.reload(); } catch { }
            }
            tab.setBounds(bounds);
            try { tab.setBorderRadius(radius); } catch { }
            tab.setVisible(true);
        };
        place(l, lb);
        place(r, rb);
        this.raiseFloatingViews();
    }
    splitWithActive(otherIdx) {
        const a = this.activeTabIndex;
        if (otherIdx == null || otherIdx === a || !this.tabMap.has(otherIdx) || !this.tabMap.has(a))
            return;
        // Split only within one workspace, and not private tabs.
        if ((this.tabProfiles.get(a) || '1') !== (this.tabProfiles.get(otherIdx) || '1'))
            return;
        if (this.privateTabs.has(a) || this.privateTabs.has(otherIdx))
            return;
        this.splitPair = [a, otherIdx];
        this.showTab(a); // lays out the split (see showTab tail)
        try { this.mainWindow.webContents.send('split-changed', true); } catch { }
    }
    closeSplit() {
        if (!this.splitPair)
            return;
        const keep = this.splitPair.includes(this.activeTabIndex) ? this.activeTabIndex : this.splitPair[0];
        this.splitPair = null;
        try { this.mainWindow.webContents.send('split-changed', false); } catch { }
        this.showTab(keep);
    }
    isSplit() { return !!this.splitPair; }
    // ── Glance (floating page preview over the current tab) ────────────────────
    _layoutGlance() {
        if (!this.glanceView)
            return;
        const b = this.getTabBounds();
        const w = Math.min(Math.floor(b.width * 0.72), 940);
        const h = Math.min(Math.floor(b.height * 0.84), 760);
        const x = b.x + Math.floor((b.width - w) / 2);
        const y = b.y + Math.floor((b.height - h) / 2);
        try { this.glanceView.setBounds({ x, y, width: Math.max(0, w), height: Math.max(0, h) }); }
        catch { }
    }
    openGlance(url) {
        if (!/^https?:/i.test(url || ''))
            return;
        this.closeGlance();
        const active = this.tabMap.get(this.activeTabIndex);
        // Same session as the current tab, so a glance from a persona/profile tab
        // stays in that isolated session.
        const sess = active?.webContents?.session;
        const view = new WebContentsView({
            webPreferences: {
                preload: preloadForPage(url),
                contextIsolation: true,
                nodeIntegration: false,
                ...(sess ? { session: sess } : {}),
            },
        });
        try { view.setBorderRadius(14); } catch { }
        view.setBackgroundColor('#00000000');
        this.mainWindow.contentView.addChildView(view);
        this.glanceView = view;
        this.glanceUrl = url;
        this._glanceOpenedAt = Date.now();
        UserAgent.setupTab(view);
        // A link opened from within the glance promotes to a real tab.
        view.webContents.setWindowOpenHandler(({ url: u }) => {
            setImmediate(() => {
                try {
                    const idx = this.createTab(this.activeTabIndex, true, false);
                    this.loadUrl(idx, u);
                }
                catch { }
            });
            this.closeGlance();
            return { action: 'deny' };
        });
        this._layoutGlance();
        view.webContents.loadURL(url);
        // Esc closes; Cmd/Ctrl+Enter promotes the glance to a real tab.
        view.webContents.on('before-input-event', (e, input) => {
            if (input.type !== 'keyDown')
                return;
            if (input.key === 'Escape') { e.preventDefault(); this.closeGlance(); }
            else if (input.key === 'Enter' && (input.meta || input.control)) { e.preventDefault(); this.promoteGlance(); }
        });
        // Click-away (focus leaves the glance) closes it — after a settle delay so
        // load-time focus churn doesn't dismiss it immediately.
        view.webContents.on('blur', () => {
            if (Date.now() - (this._glanceOpenedAt || 0) < 350)
                return;
            this.closeGlance();
        });
        try { view.webContents.focus(); } catch { }
    }
    closeGlance() {
        if (!this.glanceView)
            return;
        const v = this.glanceView;
        this.glanceView = null;
        this.glanceUrl = null;
        try { this.mainWindow.contentView.removeChildView(v); } catch { }
        try { v.webContents.close?.(); } catch { }
        try { this.tabMap.get(this.activeTabIndex)?.webContents.focus(); } catch { }
    }
    promoteGlance() {
        const url = this.glanceUrl;
        this.closeGlance();
        if (url) {
            const idx = this.createTab(this.activeTabIndex, true, false);
            this.loadUrl(idx, url);
        }
    }
    isGlancing() { return !!this.glanceView; }
    // ── Workspaces (a workspace IS a profile, switched in place) ───────────────
    // The window keeps tabs of every workspace alive in tabMap; only the active
    // workspace's tabs are shown/counted. Switching swaps the visible set.
    tabsInWorkspace(id) {
        const key = String(id);
        return this.tabOrder.filter(i => this.tabMap.has(i) && (this.tabProfiles.get(i) || '1') === key);
    }
    // Focus the active workspace after a switch: show its most-recent tab, or
    // open a fresh one if it has none. (this.profileId already points at it.)
    applyWorkspace() {
        const mine = this.tabsInWorkspace(this.profileId);
        if (!mine.length) {
            this.createTab(); // lands in the new workspace (uses this.profileId)
            return;
        }
        let target = mine.includes(this.activeTabIndex) ? this.activeTabIndex : null;
        if (target == null)
            target = mine.reduce((a, b) => ((this.tabLastActive.get(b) || 0) > (this.tabLastActive.get(a) || 0) ? b : a), mine[0]);
        this.showTab(target);
    }
    showTab(index) {
        // A glance is transient — dismiss it on any tab switch.
        this.closeGlance();
        // Switching to a tab outside the split pair dissolves the split.
        if (this.splitPair && !this.splitPair.includes(index))
            this.splitPair = null;
        this.tabMap.forEach((tab, i) => {
            tab.setVisible(false);
        });
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            // Background tabs skip live resizing (see resizeAllTabs) — catch up
            // on the current bounds before this one becomes visible.
            tab.setBounds(this.getTabBounds());
            try { tab.setBorderRadius(this._pageRadius()); } catch { }
            tab.setVisible(true);
            // Sleep bookkeeping: the outgoing tab starts ageing now; the incoming
            // tab is fresh. Wake it if the sleep scan discarded its renderer.
            this.tabLastActive.set(this.activeTabIndex, Date.now());
            this.tabLastActive.set(index, Date.now());
            if (tab.slept) {
                tab.slept = false;
                try {
                    tab.webContents.reload();
                }
                catch { }
            }
            // Eager background tabs load muted; restore sound on first view.
            if (tab.mutedUntilShown) {
                tab.mutedUntilShown = false;
                try {
                    tab.webContents.audioMuted = false;
                }
                catch { }
            }
            // Viewing the tab releases the background-media hold, so media may
            // play now that the user is actually looking at it.
            tab.bgHoldMedia = false;
            // Mini player: hide when arriving at the media tab; show when
            // walking away from a tab that is still playing. createTab pre-sets
            // activeTabIndex, so prefer the explicit previous index it stashes.
            const prevActiveIndex = (this._pendingPrevActive !== undefined)
                ? this._pendingPrevActive : this.activeTabIndex;
            this._pendingPrevActive = undefined;
            this.activeTabIndex = index;
            try {
                miniPlayer.onTabSwitch(this.getWindowData(), prevActiveIndex, index);
            }
            catch { }
            if (tab.lazyLoaded === false) {
                tab.lazyLoaded = true;
                const lazyUrl = this.tabUrls.get(index);
                if (lazyUrl === 'history') {
                    tab.webContents.loadFile(resolveAppFile('renderer/History/index.html'));
                }
                else if (lazyUrl === 'bookmarks') {
                    tab.webContents.loadFile(resolveAppFile('renderer/Bookmarks/index.html'));
                }
                else if (lazyUrl === 'settings') {
                    tab.webContents.loadFile(resolveAppFile('renderer/Settings/index.html'));
                }
                else if (lazyUrl && lazyUrl !== 'newtab' && !lazyUrl.startsWith('file://')) {
                    tab.webContents.loadURL(lazyUrl);
                }
                else {
                    const isPrivTab = this.privateTabs.has(index);
                    tab.webContents.loadFile(resolveAppFile(isPrivTab ? 'renderer/NewTab/private.html' : 'renderer/NewTab/index.html'));
                }
            }
            else if (tab.needsReloadForFocusMode) {
                tab.needsReloadForFocusMode = false;
                tab.needsReloadForShortform = false;
                tab.webContents.reload();
            }
            else if (tab.needsReloadForShortform) {
                tab.needsReloadForShortform = false;
                tab.webContents.reload();
            }
            const currentUrl = this.tabUrls.get(index) || '';
            this.mainWindow.webContents.send('tab-switched', {
                index: index,
                url: currentUrl === 'newtab' ? '' : currentUrl,
                totalTabs: this.tabMap.size
            });
            this.sendNavigationUpdate(index);
            // Reflect the newly active tab's loading state on the reload button.
            try {
                this.sendLoadingState(index, tab.webContents.isLoading());
            }
            catch (e) { }
            // Sync reader/PiP button visibility to the newly active tab.
            try {
                this.mainWindow.webContents.send('media-state', { index, playing: !!tab.hasPlayingMedia });
                if (this.readerMode.has(index)) {
                    this.mainWindow.webContents.send('reader-state', { index, active: true, available: true });
                }
                else {
                    this.detectReaderable(index, tab);
                }
            }
            catch { }
            // Update window title to reflect the newly active tab
            this.updateWindowTitle(index);
            // Notify the extension system of the active tab (chrome.tabs + actions)
            if (!this.privateTabs.has(index))
                extensions.selectTab(tab.webContents);
            // Put the website back into focus so keyboard events register immediately
            tab.webContents.focus();
            this.raiseFloatingViews();
        }
        // Split view: after showing the active half full, lay both halves out.
        if (this.splitPair && this.splitPair.includes(index))
            this._layoutSplit();
    }
    loadUrl(index, url) {
        // northstar:// internal pages: typing one navigates the current tab to
        // the internal page (replace-in-place, since Settings needs its own
        // preload chosen at tab creation).
        const internal = parseNorthstarUrl(url);
        if (internal) {
            this.activeTabIndex = index;
            this.openInternalPage(internal.type, internal.section, true);
            return;
        }
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            tab.slept = false; // loading revives a slept (discarded) renderer
            // Leaving the new-tab page: fade it out NOW. Chromium keeps the old
            // document painted until the new one commits, and a static clock
            // sitting there for the whole network wait reads as "stuck".
            if (this.tabUrls.get(index) === 'newtab') {
                try {
                    tab.webContents.executeJavaScript("document.documentElement.classList.add('leaving')", true).catch(() => { });
                }
                catch { }
            }
            tab.webContents.loadURL(url);
            this.tabUrls.set(index, url);
            // Set a temporary title before the page actually loads
            let tempTitle = url;
            try {
                tempTitle = new URL(url).hostname;
            }
            catch { }
            tab.lazyTitle = tempTitle;
            this.sendTabUpdate(index, tab, url, tempTitle);
            this.navigationHistory.addEntry(index, url);
            this.saveStateDebounced();
            setTimeout(() => {
                this.sendNavigationUpdate(index);
            }, 200);
        }
    }
    destroyTab(tab) {
        try {
            tab.webContents.audioMuted = true;
        }
        catch { }
        try {
            this.mainWindow.contentView.removeChildView(tab);
        }
        catch { }
        try {
            tab.webContents.destroy();
        }
        catch { }
        // Private tab → its isolated session dies with it. Deferred one tick
        // so the webContents teardown settles before storage is cleared.
        if (tab.privateSession) {
            const sess = tab.privateSession;
            tab.privateSession = null;
            setImmediate(() => { try {
                privateSessions.destroyTabSession(sess);
            }
            catch { } });
        }
    }
    recordClosed(index) {
        // Private tabs must not be resurrectable via "reopen closed tab".
        if (this.privateTabs.has(index))
            return;
        const url = this.tabUrls.get(index);
        if (url && url !== 'newtab' && !url.startsWith('file://')) {
            const tab = this.tabMap.get(index);
            let title = url;
            try {
                title = tab?.webContents?.getTitle() || url;
            }
            catch { }
            this.closedTabHistory.push({ url, title });
            if (this.closedTabHistory.length > 20)
                this.closedTabHistory.shift();
        }
    }
    // The tab to activate after `index` is closed: the visually-adjacent tab in
    // tab-bar order (right neighbour, else left). Call BEFORE removing `index`.
    // Chrome/Firefox behaviour; keyed off tabOrder so it respects drag-reorder.
    _neighborInOrder(index) {
        const order = this.tabOrder;
        const pos = order.indexOf(index);
        if (pos === -1)
            return null;
        for (let i = pos + 1; i < order.length; i++)
            if (this.tabMap.has(order[i]))
                return order[i];
        for (let i = pos - 1; i >= 0; i--)
            if (this.tabMap.has(order[i]))
                return order[i];
        return null;
    }
    removeTab(index) {
        if (this.tabMap.has(index)) {
            const wasActive = this.activeTabIndex === index;
            const nextActive = wasActive ? this._neighborInOrder(index) : null;
            const tab = this.tabMap.get(index);
            this.recordClosed(index);
            this.destroyTab(tab);
            this.tabMap.delete(index);
            this.tabUrls.delete(index);
            this.pinnedTabs.delete(index);
            this.privateTabs.delete(index); // session wipe happens in destroyTab()
            this.tabContainers.delete(index); // container SESSION persists (shared, reusable)
            this.tabProfiles.delete(index);
            if (this.splitPair && this.splitPair.includes(index)) {
                this.splitPair = null;
                try { this.mainWindow.webContents.send('split-changed', false); } catch { }
            }
            this.tabOrder = this.tabOrder.filter(i => i !== index);
            this.tabLastActive.delete(index);
            try {
                miniPlayer.onTabClosed(this.getWindowData(), index);
            }
            catch { }
            this.navigationHistory.removeTab(index);
            this.mainWindow.webContents.send('tab-removed', {
                index: index,
                totalTabs: this.tabMap.size
            });
            if (wasActive && this.tabMap.size > 0) {
                const target = (nextActive !== null && this.tabMap.has(nextActive))
                    ? nextActive : this.tabOrder[0];
                this.showTab(target);
            }
            if (this.tabMap.size === 0) {
                // Defer + re-check on the next tick: guards against a transient
                // empty state during rapid tab operations (double-close races)
                // closing the whole window spuriously. If a tab exists again by
                // then the window stays; imperceptible on a genuine last close.
                setImmediate(() => {
                    if (!this.mainWindow.isDestroyed() && this.tabMap.size === 0) {
                        this.allowClose = true;
                        this.mainWindow.close();
                    }
                });
            }
            this.saveStateDebounced();
        }
    }
    removeTabWithTargetFocus(index, targetTabIndex = null) {
        if (this.tabMap.has(index)) {
            const wasActive = this.activeTabIndex === index;
            // Prefer an explicit valid target; otherwise fall back to the
            // visually-adjacent tab (right, else left) in tab-bar order.
            const nextActive = (targetTabIndex !== null && this.tabMap.has(targetTabIndex))
                ? targetTabIndex : this._neighborInOrder(index);
            const tab = this.tabMap.get(index);
            this.recordClosed(index);
            this.destroyTab(tab);
            this.tabMap.delete(index);
            this.tabUrls.delete(index);
            this.pinnedTabs.delete(index);
            this.privateTabs.delete(index); // session wipe happens in destroyTab()
            this.tabContainers.delete(index); // container SESSION persists (shared, reusable)
            this.tabProfiles.delete(index);
            if (this.splitPair && this.splitPair.includes(index)) {
                this.splitPair = null;
                try { this.mainWindow.webContents.send('split-changed', false); } catch { }
            }
            this.tabOrder = this.tabOrder.filter(i => i !== index);
            this.tabLastActive.delete(index);
            try {
                miniPlayer.onTabClosed(this.getWindowData(), index);
            }
            catch { }
            this.navigationHistory.removeTab(index);
            this.mainWindow.webContents.send('tab-removed', {
                index: index,
                totalTabs: this.tabMap.size
            });
            if (this.tabMap.size === 0) {
                // Defer + re-check on the next tick: guards against a transient
                // empty state during rapid tab operations (double-close races)
                // closing the whole window spuriously. If a tab exists again by
                // then the window stays; imperceptible on a genuine last close.
                setImmediate(() => {
                    if (!this.mainWindow.isDestroyed() && this.tabMap.size === 0) {
                        this.allowClose = true;
                        this.mainWindow.close();
                    }
                });
            }
            else {
                if (wasActive) {
                    const target = (nextActive !== null && this.tabMap.has(nextActive))
                        ? nextActive : this.tabOrder[0];
                    this.showTab(target);
                }
                setTimeout(() => {
                    if (!this.mainWindow.isDestroyed()) {
                        this.mainWindow.focus();
                    }
                }, 20);
            }
            this.saveStateDebounced();
        }
    }
    getTotalTabs() {
        return this.tabMap.size;
    }
    goBack(index) {
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            const previousUrl = this.navigationHistory.goBack(index);
            const isPriv = this.privateTabs.has(index);
            const newTabFile = isPriv ? 'renderer/NewTab/private.html' : 'renderer/NewTab/index.html';
            if (previousUrl && previousUrl !== 'newtab') {
                tab.setNavigatingProgrammatically(true);
                tab.webContents.loadURL(previousUrl);
                this.tabUrls.set(index, previousUrl);
            }
            else if (previousUrl === 'newtab') {
                tab.setNavigatingProgrammatically(true);
                tab.webContents.loadFile(resolveAppFile(newTabFile));
                this.tabUrls.set(index, 'newtab');
            }
            else {
                tab.webContents.loadFile(resolveAppFile(newTabFile));
                this.tabUrls.set(index, 'newtab');
            }
            this.sendNavigationUpdate(index);
        }
    }
    goForward(index) {
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            const nextUrl = this.navigationHistory.goForward(index);
            const isPriv = this.privateTabs.has(index);
            if (nextUrl && nextUrl !== 'newtab') {
                tab.setNavigatingProgrammatically(true);
                tab.webContents.loadURL(nextUrl);
                this.tabUrls.set(index, nextUrl);
            }
            else if (nextUrl === 'newtab') {
                tab.setNavigatingProgrammatically(true);
                tab.webContents.loadFile(resolveAppFile(isPriv ? 'renderer/NewTab/private.html' : 'renderer/NewTab/index.html'));
                this.tabUrls.set(index, 'newtab');
            }
            this.sendNavigationUpdate(index);
        }
    }
    // Jump straight to a history entry (back/forward long-press dropdown)
    goToHistoryIndex(index, historyIndex) {
        if (!this.tabMap.has(index))
            return;
        const tab = this.tabMap.get(index);
        const url = this.navigationHistory.goToIndex(index, historyIndex);
        if (url === null)
            return;
        tab.setNavigatingProgrammatically(true);
        if (url && url !== 'newtab') {
            tab.webContents.loadURL(url);
            this.tabUrls.set(index, url);
        }
        else {
            const isPriv = this.privateTabs.has(index);
            tab.webContents.loadFile(resolveAppFile(isPriv ? 'renderer/NewTab/private.html' : 'renderer/NewTab/index.html'));
            this.tabUrls.set(index, 'newtab');
        }
        this.sendTabUpdate(index, tab, this.tabUrls.get(index));
        this.sendNavigationUpdate(index);
    }
    // ── Reader mode ────────────────────────────────────────────────────────────
    // Ask the page whether it looks like an article; tell the chrome to
    // enable/disable the reader button for the active tab.
    detectReaderable(index, tab) {
        if (this.readerMode.has(index))
            return; // reader page itself isn't "readerable"
        const url = (tab.webContents.getURL && tab.webContents.getURL()) || '';
        if (!/^https?:/.test(url)) {
            if (index === this.activeTabIndex) {
                try {
                    this.mainWindow.webContents.send('reader-state', { index, active: false, available: false });
                }
                catch { }
            }
            return;
        }
        tab.webContents.executeJavaScript(READERABLE_JS, true)
            .then((ok) => {
            try {
                this.mainWindow.webContents.send('reader-state', { index, active: false, available: !!ok });
            }
            catch { }
        })
            .catch(() => { });
    }
    async toggleReader(index) {
        const tab = this.tabMap.get(index);
        if (!tab)
            return;
        if (this.readerMode.has(index)) {
            // Exit — restore the original page.
            const orig = this.readerOriginal.get(index);
            this.readerMode.delete(index);
            this.readerArticles.delete(index);
            tab.setNavigatingProgrammatically(true);
            if (orig) {
                this.tabUrls.set(index, orig);
                tab.webContents.loadURL(orig);
            }
            else
                tab.webContents.reload();
            return;
        }
        let article = null;
        try {
            article = await tab.webContents.executeJavaScript(EXTRACT_JS, true);
        }
        catch { }
        if (!article || !article.ok) {
            try {
                this.mainWindow.webContents.send('reader-failed', { index });
            }
            catch { }
            return;
        }
        this.readerArticles.set(index, article);
        this.readerOriginal.set(index, tab.webContents.getURL());
        this.readerMode.add(index);
        tab.setNavigatingProgrammatically(true);
        tab.webContents.loadFile(resolveAppFile('renderer/Reader/index.html'));
    }
    getReaderArticle(index) {
        return this.readerArticles.get(index) || null;
    }
    // ── Picture-in-Picture ───────────────────────────────────────────────────────
    togglePictureInPicture(index) {
        const tab = this.tabMap.get(index);
        if (!tab || !tab.webContents || tab.webContents.isDestroyed())
            return;
        // userGesture = true so the PiP request counts as user-activated.
        tab.webContents.executeJavaScript(PIP_JS, true).catch(() => { });
    }
    reload(index) {
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            tab.webContents.reload();
            setTimeout(() => {
                this.sendNavigationUpdate(index);
            }, 100);
        }
    }
    canGoBack(index) {
        if (this.tabMap.has(index)) {
            const canGoBack = this.navigationHistory.canGoBack(index);
            return canGoBack;
        }
        return false;
    }
    canGoForward(index) {
        if (this.tabMap.has(index)) {
            const canGoForward = this.navigationHistory.canGoForward(index);
            return canGoForward;
        }
        return false;
    }
    resizeAllTabs() {
        const bounds = this.getTabBounds();
        // Only the visible tab is resized immediately. Background views would
        // each relayout + repaint on every setBounds — with many tabs open
        // that turns window resizing into a jank festival. Hidden tabs get
        // their bounds applied in showTab() the moment they become visible.
        const radius = this._pageRadius();
        this.tabMap.forEach((tab, index) => {
            if (index === this.activeTabIndex) {
                tab.setBounds(bounds);
                try { tab.setBorderRadius(radius); } catch { }
            }
        });
        if (this.splitPair)
            this._layoutSplit();
        if (this.glanceView)
            this._layoutGlance();
    }
    collapseAllTabs() {
        // Move tabs off-screen so native views don't cover HTML overlays
        this.tabMap.forEach((tab) => {
            tab.setBounds({ x: -9999, y: -9999, width: 1, height: 1 });
        });
    }
    restoreAllTabs() {
        this.resizeAllTabs();
    }
    muteTab(index) {
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            const isMuted = tab.webContents.isAudioMuted();
            tab.webContents.setAudioMuted(!isMuted);
            this.sendMediaIndicators(index, tab); // flip the speaker icon at once
        }
    }
    pinTab(index) {
        const isPinned = this.pinnedTabs.has(index);
        if (!isPinned) {
            const totalTabs = this.tabMap.size;
            const futurePinned = this.pinnedTabs.size + 1;
            const futureUnpinned = totalTabs - futurePinned;
            if (futureUnpinned <= 0) {
                // Auto-create a new unpinned tab to keep at least one unpinned
                this.createTab();
            }
            this.pinnedTabs.add(index);
        }
        else {
            this.pinnedTabs.delete(index);
        }
        this.mainWindow.webContents.send('pin-tab', { index });
        this.saveStateDebounced();
    }
    reorderTabs(newOrder) {
        if (!Array.isArray(newOrder))
            return;
        const allKeys = new Set(this.tabMap.keys());
        const ok = newOrder.every(k => allKeys.has(k)) && newOrder.length === allKeys.size;
        if (!ok)
            return;
        this.tabOrder = [...newOrder];
        this.saveStateDebounced();
    }
    buildSerializableState() {
        const includeAll = !!(this.persistence && this.persistence.getPersistMode());
        const order = this.tabOrder.length ? this.tabOrder : Array.from(this.tabMap.keys());
        const selected = includeAll
            ? order.filter(idx => !this.privateTabs.has(idx))
            : order.filter(idx => this.pinnedTabs.has(idx) && !this.privateTabs.has(idx));
        const tabs = selected.map((idx) => {
            const url = this.tabUrls.get(idx) || 'newtab';
            let title = this.computeDisplayTitleFor(idx) || 'New Tab';
            return {
                url,
                title,
                pinned: this.pinnedTabs.has(idx),
                container: this.tabContainers.get(idx) || null,
                workspace: this.tabProfiles.get(idx) || '1',
            };
        });
        // Map active to its ordinal within the SAVED list (selected), not the
        // full tab order — filtered-out tabs (private / unpinned) would shift
        // the index and the wrong tab would be focused on restore.
        const activeOrdinal = Math.max(0, selected.indexOf(this.activeTabIndex));
        return { tabs, activeIndex: activeOrdinal, persistAllTabs: includeAll, profile: this.profileId, activeWorkspace: this.profileId };
    }
    saveStateDebounced() {
        if (!this.persistence)
            return;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            try {
                this.persistence.saveState(this.buildSerializableState());
            }
            catch { }
        }, 200);
    }
}

Tabs.parseNorthstarUrl = parseNorthstarUrl;
module.exports = Tabs;