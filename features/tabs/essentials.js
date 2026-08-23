'use strict';
/**
 * Tabs — Essentials (mixed into Tabs.prototype by features/tabs.js).
 *
 * An Essential IS a tab. The tile is the tab's only representation: clicking it
 * lands you in the tab it owns — wherever you had browsed to inside it — and
 * only opens one if it has none. Clicking the one you are already in is the
 * "take me back" gesture, which returns it to its `home`.
 *
 * The tile is GLOBAL (the same one in every space, like Arc's Favourites); the
 * TAB it owns is not, so the binding is keyed by space. What each rule is
 * modelled on is written down in features/tabs/essential-rules.js.
 *
 * The Essential itself (url, title, home, icon) lives in features/profiles.js;
 * this file is only the binding between a tile and a live tab, which is
 * per-window and dies with it.
 */
const log = require('../log');
const rules = require('./essential-rules');

/** The Essentials as stored, or [] — read lazily so unit tests need no Electron. */
function stored() {
    try { return require('../profiles').essentials() || []; }
    catch (e) { log.debug('essentials', 'stored', e); return []; }
}

module.exports = {
    /* The tile is global, its tab is not: binding by the Essential's key alone
       meant clicking a tile in space B showed the tab it had opened in space A
       — an Essential behaving like a pinned tab that roams between spaces. */
    _essentialKey(key) {
        return rules.bindingKey(this.profileId || '1', key);
    },
    _essentialMap() {
        if (!this.essentialTabs)
            this.essentialTabs = new Map();
        return this.essentialTabs;
    },
    /** The live tab this Essential owns IN THIS SPACE, or null. */
    essentialTabIndex(key) {
        const idx = this._essentialMap().get(this._essentialKey(key));
        return (idx != null && this.tabMap.has(idx)) ? idx : null;
    },
    /** The Essential (identity key) that owns tab `index`, or null. */
    essentialKeyOfTab(index) {
        for (const [composite, idx] of this._essentialMap())
            if (idx === index)
                return rules.keyOfBinding(composite);
        return null;
    },
    /** The page tab `index` goes back to, if an Essential owns it. */
    _essentialHomeOfTab(index) {
        if (!this.essentialTabs || !this.essentialTabs.size)
            return null;
        const key = this.essentialKeyOfTab(index);
        if (!key)
            return null;
        const it = stored().find(e => rules.identity(e.url, e.profile) === key);
        return it ? (it.home || it.url) : null;
    },
    bindEssentialTab(key, index) {
        if (typeof index !== 'number')
            return null;
        this._essentialMap().set(this._essentialKey(key), index);
        this.sendEssentialTabs();
        return index;
    },
    /**
     * Give up a tile's claim on its tab — in every space, since the tile is
     * global. Removing an Essential has to do this or its tab is orphaned: the
     * strip hides the row of a tab a tile owns, so the row would stay hidden
     * with no tile left to reach it by.
     */
    unbindEssential(key) {
        const map = this._essentialMap();
        let hit = false;
        for (const composite of [...map.keys()])
            if (rules.keyOfBinding(composite) === key) { map.delete(composite); hit = true; }
        if (hit)
            this.sendEssentialTabs();
        return hit;
    },
    /**
     * A tab that is already sitting on this Essential's page and belongs to no
     * other tile. Session restore rebuilds the tab but not the binding, and
     * "add to essentials" makes a tile out of a tab that is already open —
     * without this, both end in a second copy of a page you already have.
     */
    adoptEssentialTab(key, home) {
        if (this.essentialTabIndex(key) != null)
            return this.essentialTabIndex(key);
        const own = rules.urlOfIdentity(key);
        const wanted = new Set([home, own].filter(Boolean));
        const space = String(this.profileId || '1');
        const taken = new Set(this._essentialMap().values());
        for (const idx of this.tabOrder) {
            if (!this.tabMap.has(idx) || taken.has(idx))
                continue;
            if (String(this.tabProfiles.get(idx) || '1') !== space)
                continue;
            if (this.privateTabs.has(idx))
                continue;
            if (!wanted.has(this.tabUrls.get(idx)))
                continue;
            return this.bindEssentialTab(key, idx);
        }
        return null;
    },
    /**
     * Land in an Essential's tab, creating it if it has none.
     *
     * @param {string} key   `${url}|${profile ?? ''}` — the Essential's identity
     * @param {string} home  the page it points at
     * @param {string|null} container  container id, when it is bound to one
     * @returns {number|null} the tab index it landed on
     */
    openEssential(key, home, container = null) {
        const bound = this.essentialTabIndex(key);
        if (bound != null) {
            const alreadyHere = bound === this.activeTabIndex;
            const wandered = home && this.tabUrls.get(bound) !== home;
            this.showTab(bound);
            // Clicking the one you are already in is the "take me back" gesture.
            if (alreadyHere && wandered)
                this.loadUrl(bound, home);
            return bound;
        }
        const adopted = this.adoptEssentialTab(key, home);
        if (adopted != null) {
            this.showTab(adopted);
            return adopted;
        }
        // createTab() opens a BLANK tab — it takes an insert position, not a
        // url, and loads nothing. Handing it `home` opened an empty page and
        // left the Essential pointing at it.
        /* Mark the create as an Essential's BEFORE it happens. The chrome builds
           a strip row the moment `tab-created` arrives, and the binding that
           tells it to hide that row is a second message a few milliseconds
           later — so a "New tab" row appeared and vanished on every click. An
           Essential's view should never have a visible row at all, not even for
           a frame. */
        this._creatingEssential = true;
        let idx;
        try {
            idx = container
                ? this.openInContainer(home, container)
                : this.createTab(null, true, false);
        }
        finally {
            this._creatingEssential = false;
        }
        if (typeof idx !== 'number')
            return null;
        if (!container && home)
            this.loadUrl(idx, home);
        this.bindEssentialTab(key, idx);
        return idx;
    },
    /** Take it back to its page, opening its tab first if it has none. */
    goHomeEssential(key, home, container = null) {
        const idx = this.openEssential(key, home, container);
        if (typeof idx !== 'number')
            return false;
        if (home && this.tabUrls.get(idx) !== home)
            this.loadUrl(idx, home);
        return true;
    },
    /** Send the chrome the set of Essentials that currently have a tab. */
    sendEssentialTabs() {
        try {
            const live = [];
            const prefix = rules.bindingKey(this.profileId || '1', '');
            for (const [composite, idx] of this._essentialMap()) {
                // Only THIS space's bindings — a tile shows "has a tab" for the
                // space you are in, not for one you left.
                if (!composite.startsWith(prefix) || !this.tabMap.has(idx))
                    continue;
                live.push({ key: composite.slice(prefix.length), index: idx, active: idx === this.activeTabIndex });
            }
            this.mainWindow.webContents.send('essential-tabs', live);
        }
        catch (e) { log.debug('essentials', 'sendEssentialTabs', e); }
    },
    /** Drop bindings whose tab is gone (called from removeTab). */
    _forgetEssentialTab(index) {
        if (!this.essentialTabs)
            return;
        for (const [key, idx] of this.essentialTabs)
            if (idx === index)
                this.essentialTabs.delete(key);
        this.sendEssentialTabs();
    },
    /**
     * Re-bind the tabs a session restore brought back.
     *
     * Restore rebuilds tabs, not the bindings that died with the last window,
     * so every tile came back claiming no tab — and clicking one opened a
     * second copy of a page that was already there. Serialisation puts an
     * Essential's tab back at its own page (see buildSerializableState), so the
     * match is exact. Only session restore creates tabs lazily; every other
     * caller of createLazyTab loads eagerly, so nothing the user opens by hand
     * is ever swallowed by a tile.
     */
    _scheduleEssentialRebind() {
        if (this._essentialRebindPending)
            return;
        this._essentialRebindPending = true;
        setImmediate(() => {
            this._essentialRebindPending = false;
            try { this._rebindRestoredEssentials(); }
            catch (e) { log.debug('essentials', 'rebind', e); }
        });
    },
    _rebindRestoredEssentials() {
        const items = stored();
        if (!items.length || !this.tabMap.size)
            return;
        const map = this._essentialMap();
        const taken = new Set(map.values());
        let hit = false;
        for (const idx of this.tabOrder) {
            if (!this.tabMap.has(idx) || taken.has(idx) || this.privateTabs.has(idx))
                continue;
            const url = this.tabUrls.get(idx);
            if (!url || url === 'newtab')
                continue;
            const space = String(this.tabProfiles.get(idx) || '1');
            const it = items.find(e => (url === (e.home || e.url) || url === e.url)
                && !map.has(rules.bindingKey(space, rules.identity(e.url, e.profile))));
            if (!it)
                continue;
            map.set(rules.bindingKey(space, rules.identity(it.url, it.profile)), idx);
            taken.add(idx);
            hit = true;
        }
        if (hit)
            this.sendEssentialTabs();
    },
    /**
     * Should this navigation be shown as a glance over the Essential instead of
     * taking it off its site? (Arc calls the preview a Peek, Zen a Glance.)
     */
    _essentialPeek(index, target) {
        if (!this.essentialTabs || !this.essentialTabs.size)
            return false;
        if (index !== this.activeTabIndex || this.isGlancing?.())
            return false;
        if (this.persistence && this.persistence.get('essentialsPeek') === false)
            return false;
        const home = this._essentialHomeOfTab(index);
        if (!home)
            return false;
        return rules.shouldPeek(home, this.tabUrls.get(index) || '', target);
    },
};
