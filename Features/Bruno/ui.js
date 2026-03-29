// ============================================================================
// Bruno UI Management - Main browser window iframe/view management
// ============================================================================
const { WebContentsView } = require('electron');
const path = require('path');

class BrunoUI {
  constructor() {
    this.brunoViews = new Map(); // windowId -> bruno WebContentsView
  }

  open(event) {
    try {
      // Get window data from event sender
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
      }

      const bounds = windowData.window.getBounds();
      const topOffset = 80;

      windowData.bruno.setBounds({
        x: 0,
        y: topOffset,
        width: bounds.width,
        height: bounds.height - topOffset
      });

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
        windowData.window.contentView.removeChildView(windowData.bruno);
        windowData.bruno = null;
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

