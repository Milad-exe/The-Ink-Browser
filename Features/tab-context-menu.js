const { clipboard, shell } = require('electron');

class TabContextMenu {
    constructor(tab, params, tabManager) {
        this.tab = tab;
        this.tabManager = tabManager;
        this.contextTemplate = [];

        this._addPageItems(params);
        this._addSelectionItems(params);
        this._addEditableItems(params);
        this._addLinkItems(params);
        this._addImageItems(params);
        this._addMediaItems(params);
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

    _openInNewTab(url) {
        const newIndex = this.tabManager.CreateTab();
        this.tabManager.loadUrl(newIndex, url);
    }

    _addPageItems(params) {
        const wc = this.tab.webContents;
        const currentUrl = wc.getURL ? wc.getURL() : '';
        const isRealPage = currentUrl && !currentUrl.startsWith('file://');

        this.contextTemplate.push(
            {
                label: 'Back',
                enabled: wc.canGoBack ? wc.canGoBack() : false,
                click: () => { try { wc.goBack(); } catch {} },
            },
            {
                label: 'Forward',
                enabled: wc.canGoForward ? wc.canGoForward() : false,
                click: () => { try { wc.goForward(); } catch {} },
            },
            {
                label: 'Reload',
                click: () => wc.reload(),
            },
            { type: 'separator' },
        );

        if (isRealPage) {
            this.contextTemplate.push(
                {
                    label: 'Save Page As…',
                    click: () => wc.downloadURL(currentUrl),
                },
                {
                    label: 'Print…',
                    click: () => wc.print(),
                },
                {
                    label: 'View Page Source',
                    click: () => this._openInNewTab(`view-source:${currentUrl}`),
                },
                { type: 'separator' },
                {
                    label: 'Copy Page URL',
                    click: () => clipboard.writeText(currentUrl),
                },
                { type: 'separator' },
            );
        }

        this.contextTemplate.push(
            {
                label: 'Inspect Element',
                click: () => wc.inspectElement(params.x, params.y),
            },
        );
    }

    _addSelectionItems(params) {
        if (!params.selectionText) return;
        this._sep();
        const truncated = params.selectionText.length > 40
            ? params.selectionText.slice(0, 40) + '…'
            : params.selectionText;
        this.contextTemplate.push(
            {
                label: 'Copy',
                role: 'copy',
                enabled: params.editFlags.canCopy,
            },
            {
                label: `Search Google for "${truncated}"`,
                click: () => this._openInNewTab(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`),
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

    _addLinkItems(params) {
        if (!params.linkURL) return;
        this._sep();
        this.contextTemplate.push(
            {
                label: 'Open Link in New Tab',
                click: () => this._openInNewTab(params.linkURL),
            },
            {
                label: 'Open Link in New Window',
                click: () => shell.openExternal(params.linkURL),
            },
            {
                label: 'Copy Link Address',
                click: () => clipboard.writeText(params.linkURL),
            },
            {
                label: 'Save Link As…',
                click: () => this.tab.webContents.downloadURL(params.linkURL),
            },
        );
    }

    _addImageItems(params) {
        if (!params.srcURL || params.mediaType !== 'image') return;
        this._sep();
        this.contextTemplate.push(
            {
                label: 'Open Image in New Tab',
                click: () => this._openInNewTab(params.srcURL),
            },
            {
                label: 'Save Image As…',
                click: () => this.tab.webContents.downloadURL(params.srcURL),
            },
            {
                label: 'Copy Image Address',
                click: () => clipboard.writeText(params.srcURL),
            },
            {
                label: 'Search Google for Image',
                click: () => this._openInNewTab(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(params.srcURL)}`),
            },
        );
    }

    _addMediaItems(params) {
        if (!params.srcURL || (params.mediaType !== 'video' && params.mediaType !== 'audio')) return;
        const label = params.mediaType === 'video' ? 'Video' : 'Audio';
        this._sep();
        this.contextTemplate.push(
            {
                label: `Open ${label} in New Tab`,
                click: () => this._openInNewTab(params.srcURL),
            },
            {
                label: `Save ${label} As…`,
                click: () => this.tab.webContents.downloadURL(params.srcURL),
            },
            {
                label: 'Copy Media Address',
                click: () => clipboard.writeText(params.srcURL),
            },
        );
    }
}

module.exports = TabContextMenu;
