'use strict';
/**
 * Moving a tab through its own history.
 *
 * Back/forward run off features/navigation-history.js, NOT the webContents'
 * own history — goBack() loads the previous entry itself (CLAUDE.md invariant
 * 9). Anything that replaces a tab's view must append to that tree rather than
 * reinitialising it, which is the reason this is its own file: the rule is
 * easy to miss when it is buried in a 2400-line class.
 */
 /* Mixed into Tabs.prototype at the bottom of features/tabs.js — `this` is the
    Tabs instance and nothing here requires Tabs back. */
const log = require('../log');

/* When the custom history tree and Chromium's own session history agree on the
   adjacent entry, move through it with the NATIVE navigation — that restores the
   page from the back/forward cache instantly (no refetch, scroll and form state
   preserved) instead of a full reload. The custom tree stays the source of truth:
   it has already advanced by one step (goBack/goForward mutated it), so we only
   take the fast path when the native entry at that offset is exactly the same
   URL. Any mismatch — a tree that outlived a view replacement (reader/split), a
   restored tab whose native history holds a single entry, a divergent
   forward-truncation — falls through to loadURL, i.e. the previous behaviour.
   So the fast path can only ever make a correct navigation faster, never change
   where it lands. */
function nativeHistoryHas(tab, url, dir) {
    try {
        const nav = tab.webContents.navigationHistory;
        if (!nav)
            return false;
        if (dir < 0 && !nav.canGoBack())
            return false;
        if (dir > 0 && !nav.canGoForward())
            return false;
        const target = nav.getActiveIndex() + dir;
        const len = typeof nav.length === 'function' ? nav.length() : nav.length;
        if (target < 0 || target >= len)
            return false;
        const entry = nav.getEntryAtIndex(target);
        return !!entry && entry.url === url;
    }
    catch {
        return false;
    }
}

module.exports = {
    goBack(index) {
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            const previousUrl = this.navigationHistory.goBack(index);
            const isPriv = this.privateTabs.has(index);
            if (previousUrl && previousUrl !== 'newtab') {
                tab.setNavigatingProgrammatically(true);
                if (nativeHistoryHas(tab, previousUrl, -1))
                    tab.webContents.navigationHistory.goBack();
                else
                    tab.webContents.loadURL(previousUrl);
                this.tabUrls.set(index, previousUrl);
            }
            else if (previousUrl === 'newtab') {
                tab.setNavigatingProgrammatically(true);
                this._loadBlank(tab);
                this.tabUrls.set(index, 'newtab');
            }
            else {
                this._loadBlank(tab);
                this.tabUrls.set(index, 'newtab');
            }
            this.sendNavigationUpdate(index);
        }
    },
    goForward(index) {
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            const nextUrl = this.navigationHistory.goForward(index);
            const isPriv = this.privateTabs.has(index);
            if (nextUrl && nextUrl !== 'newtab') {
                tab.setNavigatingProgrammatically(true);
                if (nativeHistoryHas(tab, nextUrl, 1))
                    tab.webContents.navigationHistory.goForward();
                else
                    tab.webContents.loadURL(nextUrl);
                this.tabUrls.set(index, nextUrl);
            }
            else if (nextUrl === 'newtab') {
                tab.setNavigatingProgrammatically(true);
                this._loadBlank(tab);
                this.tabUrls.set(index, 'newtab');
            }
            this.sendNavigationUpdate(index);
        }
    },
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
            // This tab now has somewhere to be, so the palette's question is
            // answered — whether it was answered IN the palette or elsewhere
            // (a link opened in a new tab, a bookmark, a restored session).
            if (index === this.activeTabIndex) {
                try {
                    const wd = this.getWindowData();
                    if (wd?.paletteOpen)
                        require('./palette-bridge').hidePalette(wd);
                }
                catch (e) { log.debug('tabs', 'hide palette on load', e); }
            }
        }
        else {
            const isPriv = this.privateTabs.has(index);
            this._loadBlank(tab);
            this.tabUrls.set(index, 'newtab');
        }
        this.sendTabUpdate(index, tab, this.tabUrls.get(index));
        this.sendNavigationUpdate(index);
    },
    reload(index) {
        if (this.tabMap.has(index)) {
            const tab = this.tabMap.get(index);
            tab.webContents.reload();
            setTimeout(() => {
                this.sendNavigationUpdate(index);
            }, 100);
        }
    },
    canGoBack(index) {
        if (this.tabMap.has(index)) {
            const canGoBack = this.navigationHistory.canGoBack(index);
            return canGoBack;
        }
        return false;
    },
    canGoForward(index) {
        if (this.tabMap.has(index)) {
            const canGoForward = this.navigationHistory.canGoForward(index);
            return canGoForward;
        }
        return false;
    },
};
