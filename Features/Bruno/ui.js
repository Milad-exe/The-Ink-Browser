// ============================================================================
// Bruno UI Management - Main browser window iframe/view management
// ============================================================================
const { WebContentsView } = require('electron');
const path = require('path');

const BRUNO_RATIO = 0.42; // Bruno takes 42% of window width

class BrunoUI {
  constructor() {}

  _getBrunoBounds(win) {
    const bounds = win.getContentBounds();
    const topOffset = 104; // utility-bar (56px) + tab-bar (48px)
    const brunoWidth = Math.floor(bounds.width * BRUNO_RATIO);
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
      if (!windowData) {
        console.error('Could not get window data');
        return false;
      }

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

        // Register Bruno's webContents with the shortcuts system
        if (windowData.shortcuts) {
          windowData.shortcuts.registerWebContents(windowData.bruno.webContents);
        }

        // Keep Bruno sized correctly on window resize
        windowData._brunoResizeHandler = () => {
          if (windowData.bruno) {
            const brunoBounds = this._getBrunoBounds(windowData.window);
            windowData.bruno.setBounds(brunoBounds);
            if (windowData.tabs) {
              windowData.tabs.brunoWidth = brunoBounds.width;
              windowData.tabs.resizeAllTabs();
            }
          }
        };
        windowData.window.on('resize', windowData._brunoResizeHandler);
      }

      // Set Bruno as right panel and shrink tabs to the left
      const brunoBounds = this._getBrunoBounds(windowData.window);
      windowData.bruno.setBounds(brunoBounds);
      if (windowData.tabs) {
        windowData.tabs.brunoWidth = brunoBounds.width;
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
      const windowData = global.inkInstance?.windowManager?.getWindowByWebContents(event.sender);
      if (windowData && windowData.bruno) {
        if (windowData.shortcuts) {
          windowData.shortcuts.unregisterWebContents(windowData.bruno.webContents);
        }
        if (windowData._brunoResizeHandler) {
          windowData.window.off('resize', windowData._brunoResizeHandler);
          windowData._brunoResizeHandler = null;
        }
        windowData.window.contentView.removeChildView(windowData.bruno);
        windowData.bruno = null;

        // Restore tabs to full width
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
}

module.exports = BrunoUI;

