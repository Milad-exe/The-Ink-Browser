/**
 * FocusMode — per-window focus state.
 * Responsibilities:
 *  - Track whether focus mode is on for a given window's tabs instance
 *  - Apply / remove grayscale CSS on all tabs
 *  - Inject distraction-blocking scripts on page load (YouTube, Shorts, TikTok, Instagram)
 */

const GRAYSCALE_CSS = 'html { filter: grayscale(100%) !important; }';
const GRAYSCALE_KEY = '__ink_grayscale__';

// JS injected into YouTube watch pages — removes sidebar recommendations and end-screen cards
const YT_BLOCK_JS = `
(function inkFocus() {
  if (window.__inkFocusYT) return;
  window.__inkFocusYT = true;

  const SELECTORS = [
    '#related',                      // sidebar "Up next" / recommendations
    '#secondary',                    // whole right column on watch page
    'ytd-endscreen-element-renderer',// end-screen cards
    'ytd-compact-video-renderer',    // compact video items in sidebar
    '#chips-wrapper',                // category chips on home
    'ytd-rich-grid-renderer',        // home feed grid
    'ytd-browse[page-subtype="home"]',// home page content
  ];

  function hide() {
    SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      });
    });
  }

  hide();

  const obs = new MutationObserver(hide);
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
`;

// JS injected into YouTube Shorts — disables the infinite scroll feed
const YT_SHORTS_BLOCK_JS = `
(function inkFocusShorts() {
  if (window.__inkFocusShorts) return;
  window.__inkFocusShorts = true;

  // Prevent swipe/scroll navigation between shorts
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');

  // Hide the shorts feed scroll container
  const SELECTORS = [
    'ytd-shorts',
    'ytd-reel-video-renderer',
    '#shorts-container',
  ];
  function hide() {
    SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('pointer-events', 'none', 'important');
      });
    });
    // Show a message instead
    if (!document.getElementById('__ink_shorts_block')) {
      const msg = document.createElement('div');
      msg.id = '__ink_shorts_block';
      msg.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-size:20px;';
      msg.textContent = '🎯 Shorts are blocked during Focus Mode';
      document.body.appendChild(msg);
    }
  }
  hide();
  new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

// JS injected into TikTok — hides the feed and blocks scrolling
const TIKTOK_BLOCK_JS = `
(function inkFocusTikTok() {
  if (window.__inkFocusTT) return;
  window.__inkFocusTT = true;

  document.documentElement.style.setProperty('overflow', 'hidden', 'important');

  function block() {
    ['[class*="DivMainContainer"]','[class*="feed"]','[data-e2e="recommend-list-item-container"]'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('pointer-events', 'none', 'important');
      });
    });
    if (!document.getElementById('__ink_tt_block')) {
      const msg = document.createElement('div');
      msg.id = '__ink_tt_block';
      msg.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-size:20px;';
      msg.textContent = '🎯 TikTok feed is blocked during Focus Mode';
      document.body.appendChild(msg);
    }
  }
  block();
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

// JS injected into Instagram — hides the reels / explore feed
const INSTAGRAM_BLOCK_JS = `
(function inkFocusIG() {
  if (window.__inkFocusIG) return;
  window.__inkFocusIG = true;

  document.documentElement.style.setProperty('overflow', 'hidden', 'important');

  function block() {
    // Reels feed, explore grid, stories tray
    ['[role="presentation"]','._aajz','._aabd','section main > div'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.setProperty('pointer-events', 'none', 'important');
      });
    });
    if (!document.getElementById('__ink_ig_block')) {
      const msg = document.createElement('div');
      msg.id = '__ink_ig_block';
      msg.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-size:20px;';
      msg.textContent = '🎯 Instagram feed is blocked during Focus Mode';
      document.body.appendChild(msg);
    }
  }
  block();
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

function getHostname(url) {
    try { return new URL(url).hostname; } catch { return ''; }
}

function getInjectionForUrl(url) {
    const host = getHostname(url);
    const path = (() => { try { return new URL(url).pathname; } catch { return ''; } })();

    if (host.includes('youtube.com')) {
        if (path.startsWith('/shorts')) return YT_SHORTS_BLOCK_JS;
        return YT_BLOCK_JS;
    }
    if (host.includes('tiktok.com')) return TIKTOK_BLOCK_JS;
    if (host.includes('instagram.com')) return INSTAGRAM_BLOCK_JS;
    return null;
}

class FocusMode {
    constructor() {
        // keyed by window id → { active: bool }
        this._state = new Map();
    }

    isActive(windowData) {
        return this._state.get(windowData.id)?.active ?? false;
    }

    enable(windowData) {
        this._state.set(windowData.id, { active: true });
        this._applyToAll(windowData, true);
        if (windowData.window && !windowData.window.isDestroyed()) {
            windowData.window.webContents.send('focus-mode-changed', true);
        }
    }

    disable(windowData) {
        this._state.set(windowData.id, { active: false });
        this._applyToAll(windowData, false);
        if (windowData.window && !windowData.window.isDestroyed()) {
            windowData.window.webContents.send('focus-mode-changed', false);
        }
    }

    toggle(windowData) {
        if (this.isActive(windowData)) {
            this.disable(windowData);
        } else {
            this.enable(windowData);
        }
    }

    /** Called from Tabs when a new tab finishes loading — apply if active */
    applyToTab(windowData, tabWebContents, url) {
        if (!this.isActive(windowData)) return;
        this._applyGrayscale(tabWebContents);
        this._injectDistraction(tabWebContents, url);
    }

    _applyGrayscale(wc) {
        try {
            wc.insertCSS(GRAYSCALE_CSS, { cssOrigin: 'user' });
        } catch {}
    }

    _removeGrayscale(wc) {
        // CSS inserted via insertCSS can't be easily removed; reload will drop it.
        // We toggle a body class and use a CSS override trick instead:
        try {
            wc.executeJavaScript(`
                (function(){
                    const id = '${GRAYSCALE_KEY}';
                    let el = document.getElementById(id);
                    if (el) el.remove();
                })();
            `);
        } catch {}
    }

    _injectDistraction(wc, url) {
        const js = getInjectionForUrl(url || '');
        if (js) {
            try { wc.executeJavaScript(js); } catch {}
        }
    }

    _pauseMedia(wc) {
        try {
            wc.executeJavaScript(
                `document.querySelectorAll('video,audio').forEach(m => { try { m.pause(); } catch {} });`
            );
        } catch {}
    }

    _applyToAll(windowData, enable) {
        if (!windowData.tabs) return;
        windowData.tabs.TabMap.forEach((tab) => {
            if (!tab.webContents || tab.webContents.isDestroyed()) return;
            if (enable) {
                this._applyGrayscale(tab.webContents);
                this._pauseMedia(tab.webContents);
                const url = tab.webContents.getURL ? tab.webContents.getURL() : '';
                this._injectDistraction(tab.webContents, url);
            } else {
                // Reload to strip injected CSS/JS (cleanest approach)
                try {
                    const url = tab.webContents.getURL ? tab.webContents.getURL() : '';
                    if (url && !url.startsWith('file://')) {
                        tab.webContents.reload();
                    } else {
                        tab.webContents.loadFile('renderer/NewTab/index.html');
                    }
                } catch {}
            }
        });
    }
}

module.exports = new FocusMode(); // singleton
