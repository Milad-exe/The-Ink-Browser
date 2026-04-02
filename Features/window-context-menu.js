const { clipboard } = require('electron');

class WindowContextMenu {
    constructor(window, params, windowManager) {
        this.window = window;
        this.windowManager = windowManager;
        this.contextTemplate = [];

        this._addSelectionItems(params);
        this._addEditableItems(params);
        this._addTabItems(params);
        this._addTabBarItems(params);
    }

    getTemplate() {
        return this.contextTemplate;
    }

    _sep() {
        const last = this.contextTemplate[this.contextTemplate.length - 1];
        if (last && last.type !== 'separator') {
            this.contextTemplate.push({ type: 'separator' });
        }
    }

    _getWindowData() {
        return this.windowManager.getWindowByWebContents(this.window.webContents);
    }

    _addSelectionItems(params) {
        if (!params.selectionText) return;
        const windowData = this._getWindowData();
        this.contextTemplate.push(
            {
                label: 'Copy',
                role: 'copy',
                enabled: params.editFlags.canCopy,
            },
            {
                label: `Search Google for "${params.selectionText.slice(0, 40)}${params.selectionText.length > 40 ? '…' : ''}"`,
                click: () => {
                    if (!windowData) return;
                    const newIndex = windowData.tabs.CreateTab();
                    windowData.tabs.loadUrl(newIndex, `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`);
                },
            },
        );
    }

    _addEditableItems(params) {
        if (!params.isEditable) return;
        this._sep();
        this.contextTemplate.push(
            { label: 'Undo',       role: 'undo',      enabled: params.editFlags.canUndo },
            { label: 'Redo',       role: 'redo',      enabled: params.editFlags.canRedo },
            { type: 'separator' },
            { label: 'Cut',        role: 'cut',       enabled: params.editFlags.canCut },
            { label: 'Copy',       role: 'copy',      enabled: params.editFlags.canCopy },
            { label: 'Paste',      role: 'paste',     enabled: params.editFlags.canPaste },
            { label: 'Select All', role: 'selectAll' },
        );
    }

    _addTabItems(params) {
        if (!params.isTabButton) return;

        const windowData = this._getWindowData();
        if (!windowData) return;

        // Use the right-clicked tab's index; fall back to active tab
        const tabIndex = (params.rightClickedTabIndex != null && windowData.tabs.TabMap.has(params.rightClickedTabIndex))
            ? params.rightClickedTabIndex
            : windowData.tabs.activeTabIndex;

        const isPinned = windowData.tabs.pinnedTabs.has(tabIndex);
        const isMuted = (() => {
            try { return windowData.tabs.TabMap.get(tabIndex)?.webContents?.isAudioMuted() ?? false; } catch { return false; }
        })();

        this._sep();
        this.contextTemplate.push(
            {
                label: 'New Tab',
                click: () => windowData.tabs.CreateTab(),
            },
            { type: 'separator' },
            {
                label: 'Reload Tab',
                click: () => windowData.tabs.reload(tabIndex),
            },
            {
                label: 'Duplicate Tab',
                click: () => {
                    const url = windowData.tabs.tabUrls.get(tabIndex);
                    if (url && url !== 'newtab') {
                        const newIndex = windowData.tabs.CreateTab();
                        windowData.tabs.loadUrl(newIndex, url);
                    } else {
                        windowData.tabs.CreateTab();
                    }
                },
            },
            {
                label: isPinned ? 'Unpin Tab' : 'Pin Tab',
                click: () => windowData.tabs.pinTab(tabIndex),
            },
            {
                label: isMuted ? 'Unmute Tab' : 'Mute Tab',
                click: () => windowData.tabs.muteTab(tabIndex),
            },
            { type: 'separator' },
            {
                label: 'Close Tab',
                click: () => windowData.tabs.removeTab(tabIndex),
            },
            {
                label: 'Close Other Tabs',
                enabled: windowData.tabs.TabMap.size > 1,
                click: () => {
                    const toClose = Array.from(windowData.tabs.TabMap.keys()).filter(i => i !== tabIndex);
                    // Switch to the right-clicked tab first so focus is preserved
                    windowData.tabs.showTab(tabIndex);
                    toClose.forEach(i => windowData.tabs.removeTab(i));
                },
            },
        );

        // Reopen last closed tab if any
        const closed = windowData.tabs._closedTabHistory;
        if (closed && closed.length > 0) {
            this._sep();
            this.contextTemplate.push({
                label: 'Reopen Closed Tab',
                click: () => {
                    const last = closed.pop();
                    if (last && last.url && last.url !== 'newtab') {
                        const newIndex = windowData.tabs.CreateTab();
                        windowData.tabs.loadUrl(newIndex, last.url);
                    } else {
                        windowData.tabs.CreateTab();
                    }
                },
            });
        }
    }

    _addTabBarItems(params) {
        // Show when right-clicking on empty tab bar space (not on a tab button)
        if (params.isTabButton) return;
        if (params.targetElementId !== 'tab-bar' && params.targetAreaIsTabBar !== true) return;

        const windowData = this._getWindowData();
        if (!windowData) return;

        this._sep();
        this.contextTemplate.push(
            {
                label: 'New Tab',
                click: () => windowData.tabs.CreateTab(),
            },
        );

        const closed = windowData.tabs._closedTabHistory;
        if (closed && closed.length > 0) {
            this.contextTemplate.push({
                label: 'Reopen Closed Tab',
                click: () => {
                    const last = closed.pop();
                    if (last && last.url && last.url !== 'newtab') {
                        const newIndex = windowData.tabs.CreateTab();
                        windowData.tabs.loadUrl(newIndex, last.url);
                    } else {
                        windowData.tabs.CreateTab();
                    }
                },
            });
        }
    }
}

module.exports = WindowContextMenu;
