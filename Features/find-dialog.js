const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

class FindDialog {
    constructor(parentWindow) {
        this.parentWindow = parentWindow;
        this.findWindow = null;
        this.activeTab = null;
        this.currentSearchTerm = '';
        this.setupIPC();
    }

    show(activeTab) {
        this.activeTab = activeTab;
        
        if (this.findWindow) {
            this.findWindow.focus();
            return;
        }

        this.findWindow = new BrowserWindow({
            width: 270,
            height: 110,
            frame: false,
            alwaysOnTop: true,
            resizable: false,
            transparent: true,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, '../preload/find-preload.js')
            }
        });

        this.findWindow.loadFile('renderer/FindDialog/index.html');

        const parentBounds = this.parentWindow.getBounds();
        const x = parentBounds.x + parentBounds.width - 300;
        const y = parentBounds.y + 60;
        this.findWindow.setPosition(x, y);

        this.findWindow.on('closed', () => {
            this.findWindow = null;
            if (this.activeTab) {
                this.activeTab.webContents.stopFindInPage('clearSelection');
            }
        });

        this.findWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'Escape') {
                this.close();
            }
        });
    }

    close() {
        if (this.findWindow) {
            this.findWindow.close();
        }
    }

    setupIPC() {
        ipcMain.handle('find-search', (event, searchTerm) => {
            this.currentSearchTerm = searchTerm;
            if (this.activeTab && searchTerm) {
                this.activeTab.webContents.findInPage(searchTerm, { findNext: false });
            }
        });

        ipcMain.handle('find-next', () => {
            if (this.activeTab && this.currentSearchTerm) {
                this.activeTab.webContents.findInPage(this.currentSearchTerm, { findNext: true });
            }
        });

        ipcMain.handle('find-previous', () => {
            if (this.activeTab && this.currentSearchTerm) {
                this.activeTab.webContents.findInPage(this.currentSearchTerm, { findNext: true, forward: false });
            }
        });

        ipcMain.handle('find-clear', () => {
            if (this.activeTab) {
                this.activeTab.webContents.stopFindInPage('clearSelection');
            }
        });

        ipcMain.handle('find-close', () => {
            this.close();
        });
    }

    handleFindResult(result) {
        if (this.findWindow) {
            this.findWindow.webContents.send('find-matches-updated', result.activeMatchOrdinal, result.matches);
        }
    }
}

module.exports = FindDialog;