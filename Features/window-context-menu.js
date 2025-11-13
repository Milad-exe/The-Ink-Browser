const { WebContentsView}  = require('electron');

class ContextMenu {
    constructor(window, params, windowManager) {
        this.window = window;
        this.windowManager = windowManager;
        this.contextTemplate = [];
        this.addSelectionMenuItems(params);
        this.addEditableMenuItems(params);
        this.addTabMenuItems(params);
    }

    getTemplate() {
        return this.contextTemplate;
    }

    addSelectionMenuItems(params) {
        if (params.selectionText) {
            this.contextTemplate.push(
                {
                    label: "Copy",
                    role: "copy",
                    enabled: params.editFlags.canCopy,
                },
                {
                    label: `Search Google for "${params.selectionText}"`,
                    click: () => {
                        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`;
                        this.tabManager.CreateTab();
                        const newTabIndex = this.tabManager.activeTabIndex;
                        this.tabManager.loadUrl(newTabIndex, searchUrl);
                    },
                }
            );
        }
    }

    addEditableMenuItems(params) {
        if (params.isEditable) {
            this.contextTemplate.push(
                {
                    label: "Undo",
                    role: "undo",
                    enabled: params.editFlags.canUndo,
                },
                {
                    label: "Redo",
                    role: "redo",
                    enabled: params.editFlags.canRedo,
                },
                { type: "separator" },
                {
                    label: "Cut",
                    role: "cut",
                    enabled: params.editFlags.canCut,
                },
                {
                    label: "Copy",
                    role: "copy",
                    enabled: params.editFlags.canCopy,
                },
                {
                    label: "Paste",
                    role: "paste",
                    enabled: params.editFlags.canPaste,
                },
                {
                    label: "Select All",
                    role: "selectAll",
                }
            );
        }
    }

    addTabMenuItems(params) {
        if (params && (params.isTabButton || params.targetElementId === 'tab-button')) {
            this.contextTemplate.push(
                //refresh tab option
                {
                    label: "Refresh Tab",
                    click: () => {
                        try {
                            const windowData = this.windowManager.getWindowByWebContents(this.window.webContents);
                            if (windowData && windowData.tabs) {
                                const activeIndex = windowData.tabs.activeTabIndex;
                                windowData.tabs.reload(activeIndex);
                            }
                        } catch (e) {
                            // no-op
                        }
                    },
                    enabled: true,
                },

                //close tab option
                { label: "Close Tab",
                    click: () => {
                        try {
                            const windowData = this.windowManager.getWindowByWebContents(this.window.webContents);
                            if (windowData && windowData.tabs) {
                                const activeIndex = windowData.tabs.activeTabIndex;
                                windowData.tabs.removeTab(activeIndex);
                            }
                        } catch (e) {
                        }
                    },
                    enabled: true,
                },
                //mute tab option
                { label: "Mute/Unmute Tab",
                    click: () => {
                        try {
                            const windowData = this.windowManager.getWindowByWebContents(this.window.webContents);
                            if (windowData && windowData.tabs) {
                                const activeIndex = windowData.tabs.activeTabIndex;
                                windowData.tabs.muteTab(activeIndex);
                            }
                        } catch (e) {
                        }
                    },
                    enabled: true,
                },
                //pin tab option
                { label: "Pin Tab",
                    click: () => {
                        try {
                            const windowData = this.windowManager.getWindowByWebContents(this.window.webContents);
                            if (windowData && windowData.tabs) {
                                const activeIndex = windowData.tabs.activeTabIndex;
                                windowData.tabs.pinTab(activeIndex);
                            }
                        } catch (e) {
                        }
                    },
                    enabled: true,
                }
            );
        }

    }
}

module.exports = ContextMenu;