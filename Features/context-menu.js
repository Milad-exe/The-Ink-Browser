const { WebContentsView}  = require('electron');

class ContextMenu {
    constructor(tab, params, tabManager) {
        this.tab = tab;
        this.tabManager = tabManager;
        this.contextTemplate = [
            {
                label: "Reload",
                click: () => tab.webContents.reload(),
            },
            {
                label: "Inspect Element",
                click: () => tab.webContents.inspectElement(params.x, params.y),
            },
            { type: "separator" }
        ];

        this.addSelectionMenuItems(params);
        this.addEditableMenuItems(params);
        this.addLinkMenuItems(params);
        this.addImageMenuItems(params);
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
                        // Open in new tab
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

    addLinkMenuItems(params) {
        if (params.linkURL) {
            this.contextTemplate.push(
                { type: "separator" },
                {
                    label: "Open Link in New Tab",
                    click: () => {
                        // Create a new tab and load the link
                        this.tabManager.CreateTab();
                        // Get the newly created tab and load the URL
                        const newTabIndex = this.tabManager.activeTabIndex;
                        this.tabManager.loadUrl(newTabIndex, params.linkURL);
                    },
                },
                {
                    label: "Copy Link Address",
                    click: () => require("electron").clipboard.writeText(params.linkURL),
                }
            );
        }
    }

    addImageMenuItems(params) {
        if (params.srcURL) {
            this.contextTemplate.push(
                { type: "separator" },
                {
                    label: "Open Image in New Tab",
                    click: () => {
                        // Create a new tab and load the image
                        this.tabManager.CreateTab();
                        const newTabIndex = this.tabManager.activeTabIndex;
                        this.tabManager.loadUrl(newTabIndex, params.srcURL);
                    },
                },
                {
                    label: "Copy Image Address",
                    click: () => require("electron").clipboard.writeText(params.srcURL),
                }
            );
        }
    }
}

module.exports = ContextMenu;