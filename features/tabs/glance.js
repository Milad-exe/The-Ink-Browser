/**
 * Tabs — glance (mixed into Tabs.prototype by features/tabs.js).
 *
 * A floating preview of a page over the current tab: Alt+click a link, or click
 * a pinned tile. Expanding ADOPTS the preview's view as the tab's own view
 * rather than loading the URL again — the page is already rendered, so the
 * expand is instant — and appends to the tab's navigation tree so Back still
 * returns to the page the glance was launched from.
 */
'use strict';
const log = require('../log');
const path = require('path');
const { WebContentsView, Menu } = require('electron');
const { resolveAppFile } = require('../../app-paths');
const UserAgent = require('../user-agent');
const contextMenu = require('../tab-context-menu');
const extensions = require('../extensions');
const preloadForPage = require('./preload-for-page');

const GLANCE_BAR_H = 34; // header strip above the glance card
const GLANCE_BAR_GAP = 6;

module.exports = {
    // ── Glance (floating page preview over the current tab) ────────────────────
    _layoutGlance() {
        if (!this.glanceView)
            return;
        const b = this.getTabBounds();
        // Dim backdrop fills the page region so the glance reads as a floating card.
        try { this.glanceBackdrop?.setBounds(b); }
        catch (e) { log.debug('glance', '_layoutGlance', e); }
        const w = Math.min(Math.floor(b.width * 0.66), 900);
        const total = Math.min(Math.floor(b.height * 0.80), 720);
        const x = b.x + Math.floor((b.width - w) / 2);
        const y = b.y + Math.floor((b.height - total) / 2);
        // The card carries no chrome of its own, so Esc / Cmd+Enter were the
        // only ways to act on it and neither is visible. A header strip above
        // it names the site and offers the two actions.
        const barH = this.glanceBar ? GLANCE_BAR_H : 0;
        const gap = this.glanceBar ? GLANCE_BAR_GAP : 0;
        try { this.glanceBar?.setBounds({ x, y, width: Math.max(0, w), height: barH }); }
        catch (e) { log.debug('glance', '_layoutGlance', e); }
        try {
            this.glanceView.setBounds({
                x, y: y + barH + gap,
                width: Math.max(0, w),
                height: Math.max(0, total - barH - gap),
            });
        }
        catch (e) { log.debug('glance', '_layoutGlance', e); }
    },
    openGlance(url) {
        if (!/^https?:/i.test(url || ''))
            return;
        this.closeGlance();
        const active = this.tabMap.get(this.activeTabIndex);
        // Dim backdrop over the page so the glance reads as a floating card; a click
        // on it blurs the glance, which dismisses it (see the blur handler below).
        try {
            const backdrop = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
            try { backdrop.setBorderRadius(this._pageRadius()); } catch (e) { log.debug('glance', 'openGlance', e); }
            backdrop.setBackgroundColor('#00000000');
            this.mainWindow.contentView.addChildView(backdrop);
            backdrop.webContents.loadURL('data:text/html,<body style="margin:0;height:100vh;background:rgba(8,10,20,0.5)"></body>');
            this.glanceBackdrop = backdrop;
        }
        catch (e) { log.debug('glance', 'openGlance', e); }
        // Same session as the current tab, so a glance from a profile/profile tab
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
        try { view.setBorderRadius(14); } catch (e) { log.debug('glance', 'openGlance', e); }
        view.setBackgroundColor('#00000000');
        this.mainWindow.contentView.addChildView(view);
        this.glanceView = view;
        this.glanceUrl = url;
        try {
            const bar = new WebContentsView({
                webPreferences: {
                    preload: path.join(__dirname, '../preload/glance-bar-preload.js'),
                    contextIsolation: true,
                    nodeIntegration: false,
                },
            });
            bar.setBackgroundColor('#00000000');
            this.mainWindow.contentView.addChildView(bar);
            this.glanceBar = bar;
            bar.webContents.loadFile(resolveAppFile('renderer/GlanceBar/index.html'));
        }
        catch (e) { log.debug('glance', 'openGlance', e); }
        this._glanceOpenedAt = Date.now();
        UserAgent.setupTab(view);
        // A link opened from within the glance promotes to a real tab.
        view.webContents.setWindowOpenHandler(({ url: u }) => {
            setImmediate(() => {
                try {
                    const idx = this.createTab(this.activeTabIndex, true, false);
                    this.loadUrl(idx, u);
                }
                catch (e) { log.debug('glance', 'openGlance', e); }
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
        // Click-away closes the glance — but only once it has actually held focus
        // (armed on its first 'focus'), so the launching click's focus churn or a
        // slow first paint can't dismiss it the instant it opens.
        let armed = false;
        view.webContents.on('focus', () => { armed = true; });
        view.webContents.on('blur', () => {
            if (!armed || Date.now() - (this._glanceOpenedAt || 0) < 350)
                return;
            // Clicking the header strip blurs the card, so closing immediately
            // would tear the header down before its button click registered.
            // Defer briefly and stand down if the header took the focus.
            setTimeout(() => {
                try {
                    if (this.glanceBar && !this.glanceBar.webContents.isDestroyed()
                        && this.glanceBar.webContents.isFocused())
                        return;
                }
                catch (e) { log.debug('glance', 'openGlance', e); }
                this.closeGlance();
            }, 130);
        });
        // Focus on the next tick so the launching click has fully settled first.
        setTimeout(() => { try { this.glanceView === view && view.webContents.focus(); } catch (e) { log.debug('glance', 'openGlance', e); } }, 60);
    },
    closeGlance() {
        if (this.glanceBar) {
            const bar = this.glanceBar;
            this.glanceBar = null;
            try { this.mainWindow.contentView.removeChildView(bar); } catch (e) { log.debug('glance', 'closeGlance', e); }
            try { bar.webContents.close?.(); } catch (e) { log.debug('glance', 'closeGlance', e); }
        }
        if (this.glanceBackdrop) {
            const bd = this.glanceBackdrop;
            this.glanceBackdrop = null;
            try { this.mainWindow.contentView.removeChildView(bd); } catch (e) { log.debug('glance', 'closeGlance', e); }
            try { bd.webContents.close?.(); } catch (e) { log.debug('glance', 'closeGlance', e); }
        }
        if (!this.glanceView)
            return;
        const v = this.glanceView;
        this.glanceView = null;
        this.glanceUrl = null;
        try { this.mainWindow.contentView.removeChildView(v); } catch (e) { log.debug('glance', 'closeGlance', e); }
        try { v.webContents.close?.(); } catch (e) { log.debug('glance', 'closeGlance', e); }
        try { this.tabMap.get(this.activeTabIndex)?.webContents.focus(); } catch (e) { log.debug('glance', 'closeGlance', e); }
    },
    // Expand: the glanced page takes over the tab it was opened from, so the
    // preview grows into the page card instead of spawning a second tab.
    //
    // The glance's view is ADOPTED as that tab's view rather than the URL being
    // loaded again — the page is already rendered, so expanding is instant and
    // costs no second fetch. The old view is torn down in its place.
    promoteGlance() {
        const view = this.glanceView;
        const target = this.activeTabIndex;
        // Whatever the preview actually ended up on (it may have redirected),
        // not the URL it was opened with.
        let url = this.glanceUrl;
        try {
            const live = view?.webContents.getURL();
            if (live && /^https?:/i.test(live))
                url = live;
        }
        catch (e) { log.debug('glance', 'promoteGlance', e); }
        if (!url) {
            this.closeGlance();
            return;
        }
        if (view && this.tabMap.has(target)) {
            this.glanceView = null; // closeGlance must not tear down the view we keep
            this.glanceUrl = null;
            this.closeGlance(); // bar + backdrop only
            try {
                this._adoptViewAsTab(target, view, url);
                return;
            }
            catch {
                try { this.mainWindow.contentView.removeChildView(view); } catch (e) { log.debug('glance', 'promoteGlance', e); }
                try { view.webContents.close?.(); } catch (e) { log.debug('glance', 'promoteGlance', e); }
            }
        }
        else {
            this.closeGlance();
        }
        if (this.tabMap.has(target))
            this.loadUrl(target, url);
        else {
            const idx = this.createTab(target, true, false);
            this.loadUrl(idx, url);
        }
    },
    /** Make an already-loaded overlay view the view backing tab `index`. */
    _adoptViewAsTab(index, view, url) {
        const old = this.tabMap.get(index);
        // Drop the glance-only behaviours (Esc to close, click-away, promote).
        for (const ev of ['before-input-event', 'focus', 'blur'])
            try { view.webContents.removeAllListeners(ev); } catch (e) { log.debug('glance', '_adoptViewAsTab', e); }
        view.isPrivate = old ? old.isPrivate : this.privateTabs.has(index);
        view.containerId = old ? old.containerId : (this.tabContainers.get(index) || null);
        // The private session belongs to the tab, not the view — carry it over so
        // destroying the old view doesn't wipe the session this page is using.
        if (old && old.privateSession) {
            view.privateSession = old.privateSession;
            old.privateSession = null;
        }
        view.lazyLoaded = true;
        view.slept = false;
        try { view.setBorderRadius(this._pageRadius()); } catch (e) { log.debug('glance', '_adoptViewAsTab', e); }
        view.webContents.on('context-menu', async (_event, params) => {
            let menuParams = params;
            if (params?.linkURL) {
                try {
                    await view.webContents.executeJavaScript('try { const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges(); } catch {}', true);
                }
                catch (e) { log.debug('glance', '_adoptViewAsTab', e); }
                menuParams = { ...params, selectionText: '' };
            }
            const menu = Menu.buildFromTemplate(new contextMenu(view, menuParams, this).getTemplate());
            if (this.mainWindow && !this.mainWindow.isDestroyed())
                menu.popup({ window: this.mainWindow });
        });
        this.tabMap.set(index, view);
        this.tabUrls.set(index, url);
        if (old)
            this.destroyTab(old);
        this._applyTabBackground(view, url);
        if (!view.isPrivate)
            extensions.addTab(view.webContents, this.mainWindow);
        // Back/forward run off this tree (goBack loads the entry itself), so the
        // expanded page is just the next entry after the page it was glanced
        // from — Back returns there, and the rest of the tab's history survives.
        // Re-initialising here would throw that away.
        this.navigationHistory.addEntry(index, url);
        this.setupTabListeners(index, view);
        let title = url;
        try { title = view.webContents.getTitle() || url; }
        catch (e) { log.debug('glance', '_adoptViewAsTab', e); }
        this.sendTabUpdate(index, view, url, title);
        this.showTab(index);
        try { view.webContents.focus(); } catch (e) { log.debug('glance', '_adoptViewAsTab', e); }
    },
    isGlancing() { return !!this.glanceView; },
};
