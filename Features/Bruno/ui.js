// ============================================================================
// Bruno UI Management
// ============================================================================
const { WebContentsView, ipcMain } = require('electron');
const path = require('path');

class BrunoUI {
  constructor() {
    // Per-window resize state
    this.resizing = new WeakMap();
  }

  getBrunoBounds(win, ratio) {
    const bounds = win.getContentBounds();
    const topOffset = 104;
    const brunoWidth = Math.floor(bounds.width * ratio);
    return {
      x: bounds.width - brunoWidth,
      y: topOffset,
      width: brunoWidth,
      height: bounds.height - topOffset
    };
  }

  open(event) {
    try {
      const windowData = global.inkInstance?.windowManager?.getWindowByWebContents(event.sender);
      if (!windowData) { console.error('Could not get window data'); return false; }

      if (!windowData.brunoRatio) windowData.brunoRatio = 0.42;

      if (!windowData.bruno) {
        windowData.bruno = new WebContentsView({
          webPreferences: {
            preload: path.join(__dirname, '../../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false
          }
        });
        windowData.window.contentView.addChildView(windowData.bruno);
        windowData.bruno.webContents.loadFile('renderer/Bruno/index.html');

        if (windowData.shortcuts) {
          windowData.shortcuts.registerWebContents(windowData.bruno.webContents);
        }

        windowData.brunoResizeHandler = () => {
          if (windowData.bruno) {
            const b = this.getBrunoBounds(windowData.window, windowData.brunoRatio);
            windowData.bruno.setBounds(b);
            if (windowData.tabs) {
              windowData.tabs.brunoWidth = b.width;
              windowData.tabs.resizeAllTabs();
            }
          }
        };
        windowData.window.on('resize', windowData.brunoResizeHandler);
      }

      const b = this.getBrunoBounds(windowData.window, windowData.brunoRatio);
      windowData.bruno.setBounds(b);
      if (windowData.tabs) {
        windowData.tabs.brunoWidth = b.width;
        windowData.tabs.resizeAllTabs();
      }

      console.log('✅ Bruno opened');
      return true;
    } catch (error) {
      console.error('Error opening Bruno UI:', error);
      return false;
    }
  }

  close(event) {
    try {
      // event may be null when called internally (e.g. from Bruno renderer IPC)
      const sender = event?.sender ?? event;
      const windowData = global.inkInstance?.windowManager?.getWindowByWebContents(sender);
      if (windowData && windowData.bruno) {
        if (windowData.shortcuts) {
          windowData.shortcuts.unregisterWebContents(windowData.bruno.webContents);
        }
        if (windowData.brunoResizeHandler) {
          windowData.window.off('resize', windowData.brunoResizeHandler);
          windowData.brunoResizeHandler = null;
        }
        windowData.window.contentView.removeChildView(windowData.bruno);
        windowData.bruno = null;

        if (windowData.tabs) {
          windowData.tabs.brunoWidth = 0;
          windowData.tabs.resizeAllTabs();
        }

        console.log('✅ Bruno closed');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error closing Bruno UI:', error);
      return false;
    }
  }

  // Called from IPC when drag starts — records mouse x at drag start
  startResize(event, startX) {
    try {
      const windowData = global.inkInstance?.windowManager?.getWindowByWebContents(event.sender);
      if (!windowData) return;
      this.resizing.set(windowData, { startX, startRatio: windowData.brunoRatio });
    } catch (e) {
      console.error('startResize error:', e);
    }
  }

  // Called repeatedly during drag with current mouse x
  doResize(event, currentX) {
    try {
      const windowData = global.inkInstance?.windowManager?.getWindowByWebContents(event.sender);
      if (!windowData || !this.resizing.has(windowData)) return;

      const { startX, startRatio } = this.resizing.get(windowData);
      const winWidth = windowData.window.getContentBounds().width;
      const delta = startX - currentX; // dragging left → delta positive → Bruno wider
      const newRatio = Math.min(0.75, Math.max(0.20, startRatio + delta / winWidth));
      windowData.brunoRatio = newRatio;

      const b = this.getBrunoBounds(windowData.window, newRatio);
      windowData.bruno?.setBounds(b);
      if (windowData.tabs) {
        windowData.tabs.brunoWidth = b.width;
        windowData.tabs.resizeAllTabs();
      }
    } catch (e) {
      console.error('doResize error:', e);
    }
  }

  endResize(event) {
    try {
      const windowData = global.inkInstance?.windowManager?.getWindowByWebContents(event.sender);
      if (windowData) this.resizing.delete(windowData);
    } catch (e) {
      console.error('endResize error:', e);
    }
  }
}

module.exports = BrunoUI;
