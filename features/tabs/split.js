/**
 * Tabs — split view (mixed into Tabs.prototype by features/tabs.js).
 *
 * Two tabs share the page card: `splitPair` is [first, second] — left/right in
 * 'row', top/bottom in 'col' — and `splitRatio` is the first pane's share.
 * The page is a native view, so every control here (the divider, the per-pane
 * reposition handles, the drag drop sheet) is its own overlay WebContentsView:
 * chrome DOM can never paint on top of a page.
 */
'use strict';
const log = require('../log');
const path = require('path');
const { WebContentsView } = require('electron');
const { resolveAppFile } = require('../../app-paths');

const SPLIT_GAP = 6; // breathing room between the two panes
const SPLIT_GRIP = 14; // divider hit area, centred on that gap
const SPLIT_HANDLE_W = 108; // pane reposition handle (top centre of a pane)
const SPLIT_HANDLE_H = 26;
const SPLIT_MIN = 0.2; // how small a pane may be dragged
const SPLIT_MAX = 0.8;
const SPLIT_DROP_IDLE_MS = 8000; // how long the drop sheet stays parked

module.exports = {
    // ── Split view (two tabs sharing the page card) ───────────────────────────
    // The pair is [first, second]: left/right in 'row', top/bottom in 'col'.
    // splitRatio is the first pane's share, dragged on the divider overlay.
    _splitHalves() {
        const b = this.getTabBounds();
        const gap = SPLIT_GAP;
        const r = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, this.splitRatio || 0.5));
        if (this.splitOrient === 'col') {
            const h = Math.max(0, Math.round((b.height - gap) * r));
            return [
                { x: b.x, y: b.y, width: b.width, height: h },
                { x: b.x, y: b.y + h + gap, width: b.width, height: Math.max(0, b.height - h - gap) },
            ];
        }
        const w = Math.max(0, Math.round((b.width - gap) * r));
        return [
            { x: b.x, y: b.y, width: w, height: b.height },
            { x: b.x + w + gap, y: b.y, width: Math.max(0, b.width - w - gap), height: b.height },
        ];
    },
    _layoutSplit() {
        if (!this.splitPair)
            return;
        const [l, r] = this.splitPair;
        if (!this.tabMap.has(l) || !this.tabMap.has(r)) {
            this._clearSplit();
            return;
        }
        const halves = this._splitHalves();
        const radius = this._pageRadius();
        const place = (idx, bounds) => {
            const tab = this.tabMap.get(idx);
            if (tab.slept)
                this._wakeTab(tab);
            tab.setBounds(bounds);
            try { tab.setBorderRadius(radius); } catch (e) { log.debug('split', 'place', e); }
            tab.setVisible(true);
        };
        place(l, halves[0]);
        place(r, halves[1]);
        this._layoutSplitControls(halves);
        this.raiseFloatingViews();
    },
    // Divider + the two pane handles are separate overlay views because the page
    // is a native view: chrome DOM can never paint on top of it.
    _splitControlView(hash) {
        const view = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, '../preload/split-preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        view.setBackgroundColor('#00000000');
        this.mainWindow.contentView.addChildView(view);
        view.webContents.loadFile(resolveAppFile('renderer/SplitBar/index.html'), { hash });
        view.webContents.once('did-finish-load', () => {
            try { view.webContents.send('split:orient', this.splitOrient); } catch (e) { log.debug('split', '_splitControlView', e); }
        });
        return view;
    },
    _sendSplitOrient() {
        for (const v of [this.splitDivider, ...this.splitHandles]) {
            try { v?.webContents.send('split:orient', this.splitOrient); } catch (e) { log.debug('split', '_sendSplitOrient', e); }
        }
    },
    _ensureSplitControls() {
        try {
            if (!this.splitDivider)
                this.splitDivider = this._splitControlView('divider');
            for (let i = 0; i < 2; i++)
                if (!this.splitHandles[i])
                    this.splitHandles[i] = this._splitControlView('pane' + i);
        }
        catch (e) { log.debug('split', '_ensureSplitControls', e); }
    },
    _destroySplitControls() {
        const views = [this.splitDivider, ...this.splitHandles];
        this.splitDivider = null;
        this.splitHandles = [null, null];
        for (const v of views) {
            if (!v)
                continue;
            try { this.mainWindow.contentView.removeChildView(v); } catch (e) { log.debug('split', '_destroySplitControls', e); }
            try { v.webContents.close?.(); } catch (e) { log.debug('split', '_destroySplitControls', e); }
        }
    },
    _layoutSplitControls(halves) {
        this._ensureSplitControls();
        this._sendSplitOrient();
        const gap = SPLIT_GAP;
        const T = SPLIT_GRIP; // divider hit area, centred on the gap
        const [a, b] = halves;
        try {
            if (this.splitOrient === 'col') {
                this.splitDivider?.setBounds({
                    x: a.x, y: Math.round(a.y + a.height + gap / 2 - T / 2),
                    width: a.width, height: T,
                });
            }
            else {
                this.splitDivider?.setBounds({
                    x: Math.round(a.x + a.width + gap / 2 - T / 2), y: a.y,
                    width: T, height: a.height,
                });
            }
        }
        catch (e) { log.debug('split', '_layoutSplitControls', e); }
        const hw = SPLIT_HANDLE_W, hh = SPLIT_HANDLE_H;
        halves.forEach((p, i) => {
            const w = Math.min(hw, p.width);
            try {
                this.splitHandles[i]?.setBounds({
                    x: Math.round(p.x + (p.width - w) / 2), y: p.y,
                    width: Math.max(0, w), height: Math.min(hh, p.height),
                });
            }
            catch (e) { log.debug('split', '_layoutSplitControls', e); }
        });
    },
    /** Drop the split without changing which tab is showing. */
    _clearSplit() {
        this.splitPair = null;
        // Any divider drag in flight is watching pane input streams (ipc/tabs.js).
        if (this._splitResize) {
            for (const { wc, onInput } of this._splitResize)
                try { wc.removeListener('input-event', onInput); } catch (e) { log.debug('split', '_clearSplit', e); }
            this._splitResize = null;
        }
        this._destroySplitControls();
        try { this.mainWindow.webContents.send('split-changed', null); } catch (e) { log.debug('split', '_clearSplit', e); }
    },
    /**
     * Pair `otherIdx` with the active tab. `position` says where the ACTIVE tab
     * lands ('right' | 'left' | 'bottom' | 'top'), so dropping a tab on the right
     * edge of the page puts it on the right.
     */
    splitWithActive(otherIdx, position = 'right') {
        const a = this.activeTabIndex;
        if (otherIdx == null || otherIdx === a || !this.tabMap.has(otherIdx) || !this.tabMap.has(a))
            return;
        // Split only within one workspace, and not private tabs.
        if ((this.tabProfiles.get(a) || '1') !== (this.tabProfiles.get(otherIdx) || '1'))
            return;
        if (this.privateTabs.has(a) || this.privateTabs.has(otherIdx))
            return;
        this.splitOrient = (position === 'top' || position === 'bottom') ? 'col' : 'row';
        this.splitRatio = 0.5;
        this.splitPair = (position === 'left' || position === 'top') ? [a, otherIdx] : [otherIdx, a];
        this.showTab(a); // lays out the split (see showTab tail)
        this._sendSplitState();
    },
    /**
     * A tab was dropped on an edge of the page card. Its partner is the page the
     * user was looking at — the most recently active other tab, since the drag
     * itself switched to the tab being dragged.
     */
    splitDropped(draggedIdx, zone) {
        if (!['left', 'right', 'top', 'bottom'].includes(zone))
            return;
        if (draggedIdx == null || !this.tabMap.has(draggedIdx))
            return;
        const ws = this.tabProfiles.get(draggedIdx) || '1';
        let partner = null, bestAt = -1;
        for (const [idx] of this.tabMap) {
            if (idx === draggedIdx || (this.tabProfiles.get(idx) || '1') !== ws)
                continue;
            if (this.privateTabs.has(idx) || this.privateTabs.has(draggedIdx))
                continue;
            const at = this.tabLastActive.get(idx) || 0;
            if (at > bestAt) {
                bestAt = at;
                partner = idx;
            }
        }
        if (partner === null)
            return;
        if (this.activeTabIndex !== draggedIdx)
            this.showTab(draggedIdx);
        this.splitWithActive(partner, zone);
    },
    /** Move one pane to a side; the other takes what's left. */
    moveSplitPane(pane, dir) {
        if (!this.splitPair || (pane !== 0 && pane !== 1))
            return;
        if (!['left', 'right', 'top', 'bottom'].includes(dir))
            return;
        const [a, b] = this.splitPair;
        const me = pane === 0 ? a : b, other = pane === 0 ? b : a;
        const wantFirst = (dir === 'left' || dir === 'top');
        const orient = (dir === 'top' || dir === 'bottom') ? 'col' : 'row';
        const next = wantFirst ? [me, other] : [other, me];
        // Same slot in the same orientation → nothing to do.
        if (this.splitOrient === orient && next[0] === a && next[1] === b)
            return;
        // Keep the pane's own share of the card when it swaps ends.
        if (next[0] !== a)
            this.splitRatio = 1 - this.splitRatio;
        this.splitOrient = orient;
        this.splitPair = next;
        this._layoutSplit();
        this._sendSplitState();
    },
    setSplitRatio(r) {
        if (!this.splitPair || !Number.isFinite(r))
            return;
        const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r));
        if (Math.abs(next - this.splitRatio) < 0.001)
            return;
        this.splitRatio = next;
        this._layoutSplit();
    },
    _sendSplitState() {
        try {
            this.mainWindow.webContents.send('split-changed', this.splitPair ? this.splitPair.slice() : null);
        }
        catch (e) { log.debug('split', '_sendSplitState', e); }
    },
    closeSplit() {
        if (!this.splitPair)
            return;
        const keep = this.splitPair.includes(this.activeTabIndex) ? this.activeTabIndex : this.splitPair[0];
        this._clearSplit();
        this.showTab(keep);
    },
    isSplit() { return !!this.splitPair; },
    // ── Drop zones (drag a tab onto the page card to split) ───────────────────
    // The page is a native view, so a drag that leaves the chrome stops sending
    // it pointer events. This transparent overlay takes the drag over the page:
    // it paints the target half and reports the drop back.
    showSplitDrop(draggedIdx) {
        this._dragTabIndex = draggedIdx;
        if (!this.tabMap.size)
            return;
        // Standing a view up costs ~9ms of main-process time, which would be a
        // hitch at the start of every drag — including plain reorders. Keep the
        // sheet parked (hidden) for a short while instead, so back-to-back drags
        // are free, and let it go when the user has clearly stopped dragging.
        clearTimeout(this._splitDropIdle);
        if (this.splitDrop) {
            try {
                this.splitDrop.setBounds(this.getTabBounds());
                this.splitDrop.webContents.send('split-drop:reset');
                this.splitDrop.setVisible(true);
            }
            catch (e) { log.debug('split', 'showSplitDrop', e); }
            this.raiseFloatingViews();
            return;
        }
        try {
            const view = new WebContentsView({
                webPreferences: {
                    preload: path.join(__dirname, '../preload/split-drop-preload.js'),
                    contextIsolation: true,
                    nodeIntegration: false,
                },
            });
            try { view.setBorderRadius(this._pageRadius()); } catch (e) { log.debug('split', 'showSplitDrop', e); }
            view.setBackgroundColor('#00000000');
            this.mainWindow.contentView.addChildView(view);
            view.setBounds(this.getTabBounds());
            view.webContents.loadFile(resolveAppFile('renderer/SplitDrop/index.html'));
            this.splitDrop = view;
            this.raiseFloatingViews();
        }
        catch (e) { log.debug('split', 'showSplitDrop', e); }
    },
    /**
     * Same sheet, but for a window the drag is only VISITING: it gets no pointer
     * events of its own (the drag stays with the window it started in), so the
     * cursor poll in ipc/tabs.js feeds it the zone. The drop itself is resolved
     * by the source window in 'tab-drag-drop'.
     */
    hintSplitDrop(zone) {
        let visible = false;
        try { visible = !!this.splitDrop?.getVisible(); }
        catch (e) { log.debug('split', 'hintSplitDrop', e); }
        if (!visible) {
            this.showSplitDrop(null);
            this._splitDropHint = undefined;
        }
        if (this._splitDropHint === (zone || null))
            return; // the poll repeats; only send on a change
        this._splitDropHint = zone || null;
        const send = () => {
            try { this.splitDrop?.webContents.send('split-drop:hint', this._splitDropHint); }
            catch (e) { log.debug('split', 'send', e); }
        };
        if (this.splitDrop?.webContents.isLoading())
            this.splitDrop.webContents.once('did-finish-load', send);
        else
            send();
    },
    hideSplitDrop() {
        this._dragTabIndex = null;
        this._splitDropHint = undefined;
        if (!this.splitDrop)
            return;
        const v = this.splitDrop;
        // Hidden AND zero-sized: a parked sheet must not sit in front of the page
        // for the rest of its idle window, whatever hit-testing does with
        // visibility alone.
        try { v.setVisible(false); } catch (e) { log.debug('split', 'hideSplitDrop', e); }
        try { v.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (e) { log.debug('split', 'hideSplitDrop', e); }
        clearTimeout(this._splitDropIdle);
        this._splitDropIdle = setTimeout(() => this._destroySplitDrop(), SPLIT_DROP_IDLE_MS);
    },
    _destroySplitDrop() {
        clearTimeout(this._splitDropIdle);
        const v = this.splitDrop;
        this.splitDrop = null;
        if (!v)
            return;
        try { this.mainWindow.contentView.removeChildView(v); } catch (e) { log.debug('split', '_destroySplitDrop', e); }
        try { v.webContents.close?.(); } catch (e) { log.debug('split', '_destroySplitDrop', e); }
    },
    /** Called when the drag was released over the page card. */
    handleSplitDrop(zone) {
        const dragged = this._dragTabIndex;
        this._splitDropAt = Date.now(); // see the same-window branch in tab-drag-drop
        this.hideSplitDrop();
        if (dragged != null && zone)
            this.splitDropped(dragged, zone);
    },
    /**
     * Split/unsplit from a single keystroke.
     *
     * Split view was previously reachable only by right-clicking a tab, which
     * meant most people never found it. With no explicit partner to pair with,
     * the sensible one is the tab you were on last — tabLastActive already
     * tracks that for the sleep scan.
     */
    toggleSplit() {
        if (this.splitPair) {
            this.closeSplit();
            return;
        }
        const active = this.activeTabIndex;
        let best = null;
        let bestAt = -1;
        for (const [idx] of this.tabMap) {
            if (idx === active)
                continue;
            // Same workspace, and never private — splitWithActive enforces this
            // too, but picking a candidate it would reject just no-ops.
            if ((this.tabProfiles.get(idx) || '1') !== (this.tabProfiles.get(active) || '1'))
                continue;
            if (this.privateTabs.has(idx) || this.privateTabs.has(active))
                continue;
            const at = this.tabLastActive.get(idx) || 0;
            if (at > bestAt) {
                bestAt = at;
                best = idx;
            }
        }
        if (best !== null)
            this.splitWithActive(best);
    },
};
