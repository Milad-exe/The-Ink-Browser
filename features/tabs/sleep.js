'use strict';
/**
 * Tab sleeping — Chrome's "memory saver".
 *
 * This is a COLLABORATOR, not a prototype mixin like split/glance/reader. It
 * owns its own state (the scan timer) and holds an explicit reference back to
 * the Tabs instance, rather than being spread onto Tabs.prototype and sharing
 * `this`. That is the difference worth noticing: everything it touches on Tabs
 * is named here in one place (tabMap, activeTabIndex, pinnedTabs, tabUrls,
 * tabLastActive, persistence, mainWindow), so the coupling is visible and the
 * whole thing can be unit-tested against a stub Tabs. New tab subsystems should
 * prefer this shape over a mixin when they own a lifecycle of their own.
 *
 * A slept tab keeps its WebContentsView and navigation history; only the
 * renderer process is discarded. showTab()/loadUrl() revive it with a reload
 * (Tabs.wakeTab delegates here).
 */
const log = require('../log');

const SCAN_INTERVAL_MS = 60_000;
const DEFAULT_MINUTES = 30;

class TabSleeper {
    constructor(tabs) {
        this.tabs = tabs;
        this.timer = null;
    }

    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            try { this.scan(); }
            catch (e) { log.debug('tab-sleep', 'scan', e); }
        }, SCAN_INTERVAL_MS);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** Put every eligible idle tab to sleep. Never sleeps: the active tab, a
     *  pinned tab, one playing/audible, one with DevTools open, an unloaded lazy
     *  tab, or a non-web page. */
    scan() {
        const t = this.tabs;
        if (!t.mainWindow || t.mainWindow.isDestroyed()) {
            this.stop();
            return;
        }
        const p = t.persistence;
        if (p && p.get('tabSleepEnabled') === false)
            return;
        const mins = Math.max(1, Number(p?.get('tabSleepMinutes')) || DEFAULT_MINUTES);
        const cutoff = Date.now() - mins * 60_000;
        t.tabMap.forEach((tab, i) => {
            if (i === t.activeTabIndex || tab.slept)
                return;
            if (tab.lazyLoaded === false)
                return; // not loaded — nothing to free
            if (t.pinnedTabs.has(i))
                return;
            const url = t.tabUrls.get(i) || '';
            if (!/^https?:/i.test(url))
                return; // only real web pages
            if ((t.tabLastActive.get(i) || 0) > cutoff)
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
            catch (e) { log.debug('tab-sleep', 'scan tab', e); }
        });
    }

    /**
     * Revive a slept tab: the renderer process is gone, so the page has to be
     * reloaded.
     *
     * KNOWN GAP vs Chrome: its memory saver restores the scroll position, we
     * land at the top. Capturing the position needs an async read of the page
     * before the renderer is discarded, and deferring the discard behind that
     * read risks a page that never answers keeping its renderer alive — which
     * would defeat the point.
     */
    wake(tab) {
        if (!tab)
            return;
        tab.slept = false;
        try { tab.webContents.reload(); }
        catch (e) { log.debug('tab-sleep', 'wake', e); }
    }
}

module.exports = { TabSleeper };
