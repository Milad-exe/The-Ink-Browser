// Focus mode injections (grayscale + recommendations + shortform blocking)
const log = require('../log');
const YT_BLOCK_JS = `
(function northstarFocus() {
  if (window.__northstarFocusYT) return;
  window.__northstarFocusYT = true;

  const SELECTORS = [
    '#related',
    '#secondary',
    'ytd-endscreen-element-renderer',
    'ytd-compact-video-renderer',
    '#chips-wrapper',
    'ytd-rich-grid-renderer',
    'ytd-browse[page-subtype="home"]',
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
const YT_SHORTS_BLOCK_JS = `
(function northstarFocusShorts() {
  if (window.__northstarFocusShorts) return;
  window.__northstarFocusShorts = true;

  const STYLE_KEYS = ['overflow', 'overscroll-behavior', 'height', 'touch-action'];
  const _savedStyles = { root: null, body: null };

  function saveStyles(el, key) {
    if (_savedStyles[key]) return;
    const store = {};
    STYLE_KEYS.forEach(prop => {
      store[prop] = el.style.getPropertyValue(prop) || '';
    });
    _savedStyles[key] = store;
  }

  function restoreStyles(el, key) {
    const store = _savedStyles[key];
    if (store) {
      STYLE_KEYS.forEach(prop => {
        const value = store[prop];
        if (value) el.style.setProperty(prop, value);
        else el.style.removeProperty(prop);
      });
      _savedStyles[key] = null;
      return;
    }
    STYLE_KEYS.forEach(prop => el.style.removeProperty(prop));
  }

  function lockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      saveStyles(el, key);
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('overscroll-behavior', 'none', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('touch-action', 'none', 'important');
    });
  }

  function unlockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      restoreStyles(el, key);
    });
  }

  function isActivePath() {
    return location.pathname.startsWith('/shorts');
  }

  let _active = isActivePath();

  function refreshActive() {
    const next = isActivePath();
    if (next === _active) return;
    _active = next;
    if (_active) lockScroll();
    else unlockScroll();
  }

  function blockEvent(e) {
    if (!_active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }

  const blockKeys = new Set(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End']);

  function onKeydown(e) {
    if (!_active) return;
    if (blockKeys.has(e.key)) blockEvent(e);
  }

  if (!window.__northstarFocusShortsScrollLock) {
    window.__northstarFocusShortsScrollLock = true;
    document.addEventListener('wheel', blockEvent, { passive: false, capture: true });
    document.addEventListener('touchmove', blockEvent, { passive: false, capture: true });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('pointerdown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('auxclick', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('mousemove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
    document.addEventListener('pointermove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
  }

  if (!window.__inkAutoplayBlocked) {
    window.__inkAutoplayBlocked = true;
    // _gesture tracks whether the NEXT play() was directly triggered by a user click.
    // Reset whenever a video element appears (player init), so page-load autoplay is blocked
    // even if a navigation gesture window is still open.
    let _gesture = false;
    const _markGesture = () => {
      _gesture = true;
      requestAnimationFrame(() => { _gesture = false; });
    };
    document.addEventListener('click',    _markGesture, { capture: true, passive: true });
    document.addEventListener('keydown',  _markGesture, { capture: true, passive: true });
    document.addEventListener('pointerup',_markGesture, { capture: true, passive: true });
    try {
      const _origPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        if (!_gesture) return Promise.resolve();
        return _origPlay.apply(this, arguments);
      };
    } catch (e) { }
    function _pauseVid(v) { try { v.removeAttribute('autoplay'); if (!v.paused) v.pause(); } catch (e) { } }
    document.querySelectorAll('video').forEach(_pauseVid);
    // Watch for new videos — pause them AND reset gesture so player init can't ride a navigation click
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (!n || n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO') { _gesture = false; _pauseVid(n); }
      else if (n.querySelectorAll) {
        const vids = n.querySelectorAll('video');
        if (vids.length) { _gesture = false; vids.forEach(_pauseVid); }
      }
    }))).observe(document.documentElement, { childList: true, subtree: true });
  }

  function shouldBlockNav(target) {
    if (!target) return false;
    const id = target.id || '';
    if (id === 'navigation-button-down' || id === 'navigation-button-up') return true;
    if (!target.closest || !target.closest('ytd-shorts')) return false;
    const label = (target.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('next') || label.includes('previous') || label.includes('up') || label.includes('down');
  }

  function onNavClick(e) {
    if (!_active) return;
    const target = e.target && e.target.closest ? e.target.closest('button,yt-icon-button,a,[role="button"]') : null;
    if (!shouldBlockNav(target)) return;
    blockEvent(e);
  }

  if (!window.__northstarFocusShortsNavBlock) {
    window.__northstarFocusShortsNavBlock = true;
    document.addEventListener('click', onNavClick, true);
    document.addEventListener('pointerdown', onNavClick, true);
  }

  function block() {
    refreshActive();
    if (_active) lockScroll();
  }
  block();
  setInterval(refreshActive, 500);
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
const TIKTOK_BLOCK_JS = `
(function northstarFocusTikTok() {
  if (window.__northstarFocusTT) return;
  window.__northstarFocusTT = true;

  const STYLE_KEYS = ['overflow', 'overscroll-behavior', 'height', 'touch-action'];
  const _savedStyles = { root: null, body: null };

  function saveStyles(el, key) {
    if (_savedStyles[key]) return;
    const store = {};
    STYLE_KEYS.forEach(prop => {
      store[prop] = el.style.getPropertyValue(prop) || '';
    });
    _savedStyles[key] = store;
  }

  function restoreStyles(el, key) {
    const store = _savedStyles[key];
    if (store) {
      STYLE_KEYS.forEach(prop => {
        const value = store[prop];
        if (value) el.style.setProperty(prop, value);
        else el.style.removeProperty(prop);
      });
      _savedStyles[key] = null;
      return;
    }
    STYLE_KEYS.forEach(prop => el.style.removeProperty(prop));
  }

  function lockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      saveStyles(el, key);
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('overscroll-behavior', 'none', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('touch-action', 'none', 'important');
    });
  }

  function unlockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      restoreStyles(el, key);
    });
  }

  function isActivePath() {
    const path = location.pathname || '';
    if (path === '/' || path.startsWith('/@')) return true;
    if (path.startsWith('/foryou') || path.startsWith('/following')) return true;
    if (path.startsWith('/t/') || path.startsWith('/discover')) return true;
    if (path.startsWith('/search') || path.startsWith('/tag') || path.startsWith('/music')) return true;
    return !!document.querySelector('video');
  }

  let _active = isActivePath();

  function refreshActive() {
    const next = isActivePath();
    if (next === _active) return;
    _active = next;
    if (_active) lockScroll();
    else unlockScroll();
  }

  function blockEvent(e) {
    if (!_active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }

  const blockKeys = new Set(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End']);

  function onKeydown(e) {
    if (!_active) return;
    if (blockKeys.has(e.key)) blockEvent(e);
  }

  if (!window.__northstarFocusTTScrollLock) {
    window.__northstarFocusTTScrollLock = true;
    document.addEventListener('wheel', blockEvent, { passive: false, capture: true });
    document.addEventListener('touchmove', blockEvent, { passive: false, capture: true });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('pointerdown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('auxclick', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('mousemove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
    document.addEventListener('pointermove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
  }

  if (!window.__inkAutoplayBlocked) {
    window.__inkAutoplayBlocked = true;
    // _gesture tracks whether the NEXT play() was directly triggered by a user click.
    // Reset whenever a video element appears (player init), so page-load autoplay is blocked
    // even if a navigation gesture window is still open.
    let _gesture = false;
    const _markGesture = () => {
      _gesture = true;
      requestAnimationFrame(() => { _gesture = false; });
    };
    document.addEventListener('click',    _markGesture, { capture: true, passive: true });
    document.addEventListener('keydown',  _markGesture, { capture: true, passive: true });
    document.addEventListener('pointerup',_markGesture, { capture: true, passive: true });
    try {
      const _origPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        if (!_gesture) return Promise.resolve();
        return _origPlay.apply(this, arguments);
      };
    } catch (e) { }
    function _pauseVid(v) { try { v.removeAttribute('autoplay'); if (!v.paused) v.pause(); } catch (e) { } }
    document.querySelectorAll('video').forEach(_pauseVid);
    // Watch for new videos — pause them AND reset gesture so player init can't ride a navigation click
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (!n || n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO') { _gesture = false; _pauseVid(n); }
      else if (n.querySelectorAll) {
        const vids = n.querySelectorAll('video');
        if (vids.length) { _gesture = false; vids.forEach(_pauseVid); }
      }
    }))).observe(document.documentElement, { childList: true, subtree: true });
  }

  function shouldBlockNav(target) {
    if (!target) return false;
    const label = (target.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('next') || label.includes('previous') || label.includes('up') || label.includes('down');
  }

  function onNavClick(e) {
    if (!_active) return;
    const target = e.target && e.target.closest ? e.target.closest('button,a,[role="button"]') : null;
    if (!shouldBlockNav(target)) return;
    blockEvent(e);
  }

  if (!window.__northstarFocusTTNavBlock) {
    window.__northstarFocusTTNavBlock = true;
    document.addEventListener('click', onNavClick, true);
    document.addEventListener('pointerdown', onNavClick, true);
  }

  function block() {
    refreshActive();
    if (_active) lockScroll();
  }
  block();
  setInterval(refreshActive, 500);
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
const INSTAGRAM_BLOCK_JS = `
(function northstarFocusIG() {
  if (window.__northstarFocusIG) return;
  window.__northstarFocusIG = true;

  const STYLE_KEYS = ['overflow', 'overscroll-behavior', 'height', 'touch-action'];
  const _savedStyles = { root: null, body: null };

  function saveStyles(el, key) {
    if (_savedStyles[key]) return;
    const store = {};
    STYLE_KEYS.forEach(prop => {
      store[prop] = el.style.getPropertyValue(prop) || '';
    });
    _savedStyles[key] = store;
  }

  function restoreStyles(el, key) {
    const store = _savedStyles[key];
    if (store) {
      STYLE_KEYS.forEach(prop => {
        const value = store[prop];
        if (value) el.style.setProperty(prop, value);
        else el.style.removeProperty(prop);
      });
      _savedStyles[key] = null;
      return;
    }
    STYLE_KEYS.forEach(prop => el.style.removeProperty(prop));
  }

  function lockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      saveStyles(el, key);
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('overscroll-behavior', 'none', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('touch-action', 'none', 'important');
    });
  }

  function unlockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      restoreStyles(el, key);
    });
  }

  function isActivePath() {
    const path = location.pathname || '';
    return path.startsWith('/reel') || path.startsWith('/reels') || path.startsWith('/explore');
  }

  let _active = isActivePath();

  function refreshActive() {
    const next = isActivePath();
    if (next === _active) return;
    _active = next;
    if (_active) lockScroll();
    else unlockScroll();
  }

  function blockEvent(e) {
    if (!_active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }

  const blockKeys = new Set(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End']);

  function onKeydown(e) {
    if (!_active) return;
    if (blockKeys.has(e.key)) blockEvent(e);
  }

  if (!window.__northstarFocusIGScrollLock) {
    window.__northstarFocusIGScrollLock = true;
    document.addEventListener('wheel', blockEvent, { passive: false, capture: true });
    document.addEventListener('touchmove', blockEvent, { passive: false, capture: true });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('pointerdown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('auxclick', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('mousemove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
    document.addEventListener('pointermove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
  }

  if (!window.__inkAutoplayBlocked) {
    window.__inkAutoplayBlocked = true;
    // _gesture tracks whether the NEXT play() was directly triggered by a user click.
    // Reset whenever a video element appears (player init), so page-load autoplay is blocked
    // even if a navigation gesture window is still open.
    let _gesture = false;
    const _markGesture = () => {
      _gesture = true;
      requestAnimationFrame(() => { _gesture = false; });
    };
    document.addEventListener('click',    _markGesture, { capture: true, passive: true });
    document.addEventListener('keydown',  _markGesture, { capture: true, passive: true });
    document.addEventListener('pointerup',_markGesture, { capture: true, passive: true });
    try {
      const _origPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        if (!_gesture) return Promise.resolve();
        return _origPlay.apply(this, arguments);
      };
    } catch (e) { }
    function _pauseVid(v) { try { v.removeAttribute('autoplay'); if (!v.paused) v.pause(); } catch (e) { } }
    document.querySelectorAll('video').forEach(_pauseVid);
    // Watch for new videos — pause them AND reset gesture so player init can't ride a navigation click
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (!n || n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO') { _gesture = false; _pauseVid(n); }
      else if (n.querySelectorAll) {
        const vids = n.querySelectorAll('video');
        if (vids.length) { _gesture = false; vids.forEach(_pauseVid); }
      }
    }))).observe(document.documentElement, { childList: true, subtree: true });
  }

  function shouldBlockNav(target) {
    if (!target) return false;
    const label = (target.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('next') || label.includes('previous') || label.includes('up') || label.includes('down');
  }

  function onNavClick(e) {
    if (!_active) return;
    const target = e.target && e.target.closest ? e.target.closest('button,a,[role="button"]') : null;
    if (!shouldBlockNav(target)) return;
    blockEvent(e);
  }

  if (!window.__northstarFocusIGNavBlock) {
    window.__northstarFocusIGNavBlock = true;
    document.addEventListener('click', onNavClick, true);
    document.addEventListener('pointerdown', onNavClick, true);
  }

  function block() {
    refreshActive();
    if (_active) lockScroll();
  }
  block();
  setInterval(refreshActive, 500);
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
// Shortform-only injections (no recommendations removal)
const YT_SHORTS_ONLY_JS = `
(function northstarShortformYT() {
  if (window.__northstarShortformYTShorts) return;
  window.__northstarShortformYTShorts = true;

  const STYLE_KEYS = ['overflow', 'overscroll-behavior', 'height', 'touch-action'];
  const _savedStyles = { root: null, body: null };

  function saveStyles(el, key) {
    if (_savedStyles[key]) return;
    const store = {};
    STYLE_KEYS.forEach(prop => {
      store[prop] = el.style.getPropertyValue(prop) || '';
    });
    _savedStyles[key] = store;
  }

  function restoreStyles(el, key) {
    const store = _savedStyles[key];
    if (store) {
      STYLE_KEYS.forEach(prop => {
        const value = store[prop];
        if (value) el.style.setProperty(prop, value);
        else el.style.removeProperty(prop);
      });
      _savedStyles[key] = null;
      return;
    }
    STYLE_KEYS.forEach(prop => el.style.removeProperty(prop));
  }

  function lockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      saveStyles(el, key);
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('overscroll-behavior', 'none', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('touch-action', 'none', 'important');
    });
  }

  function unlockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      restoreStyles(el, key);
    });
  }

  function isActivePath() {
    return location.pathname.startsWith('/shorts');
  }

  let _active = isActivePath();

  function refreshActive() {
    const next = isActivePath();
    if (next === _active) return;
    _active = next;
    if (_active) lockScroll();
    else unlockScroll();
  }

  function blockEvent(e) {
    if (!_active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }

  const blockKeys = new Set(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End']);

  function onKeydown(e) {
    if (!_active) return;
    if (blockKeys.has(e.key)) blockEvent(e);
  }

  if (!window.__northstarShortformShortsScrollLock) {
    window.__northstarShortformShortsScrollLock = true;
    document.addEventListener('wheel', blockEvent, { passive: false, capture: true });
    document.addEventListener('touchmove', blockEvent, { passive: false, capture: true });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('pointerdown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('auxclick', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('mousemove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
    document.addEventListener('pointermove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
  }

  if (!window.__inkAutoplayBlocked) {
    window.__inkAutoplayBlocked = true;
    // _gesture tracks whether the NEXT play() was directly triggered by a user click.
    // Reset whenever a video element appears (player init), so page-load autoplay is blocked
    // even if a navigation gesture window is still open.
    let _gesture = false;
    const _markGesture = () => {
      _gesture = true;
      requestAnimationFrame(() => { _gesture = false; });
    };
    document.addEventListener('click',    _markGesture, { capture: true, passive: true });
    document.addEventListener('keydown',  _markGesture, { capture: true, passive: true });
    document.addEventListener('pointerup',_markGesture, { capture: true, passive: true });
    try {
      const _origPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        if (!_gesture) return Promise.resolve();
        return _origPlay.apply(this, arguments);
      };
    } catch (e) { }
    function _pauseVid(v) { try { v.removeAttribute('autoplay'); if (!v.paused) v.pause(); } catch (e) { } }
    document.querySelectorAll('video').forEach(_pauseVid);
    // Watch for new videos — pause them AND reset gesture so player init can't ride a navigation click
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (!n || n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO') { _gesture = false; _pauseVid(n); }
      else if (n.querySelectorAll) {
        const vids = n.querySelectorAll('video');
        if (vids.length) { _gesture = false; vids.forEach(_pauseVid); }
      }
    }))).observe(document.documentElement, { childList: true, subtree: true });
  }

  function shouldBlockNav(target) {
    if (!target) return false;
    const id = target.id || '';
    if (id === 'navigation-button-down' || id === 'navigation-button-up') return true;
    if (!target.closest || !target.closest('ytd-shorts')) return false;
    const label = (target.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('next') || label.includes('previous') || label.includes('up') || label.includes('down');
  }

  function onNavClick(e) {
    if (!_active) return;
    const target = e.target && e.target.closest ? e.target.closest('button,yt-icon-button,a,[role="button"]') : null;
    if (!shouldBlockNav(target)) return;
    blockEvent(e);
  }

  if (!window.__northstarShortformShortsNavBlock) {
    window.__northstarShortformShortsNavBlock = true;
    document.addEventListener('click', onNavClick, true);
    document.addEventListener('pointerdown', onNavClick, true);
  }

  function block() {
    refreshActive();
    if (_active) lockScroll();
  }
  block();
  setInterval(refreshActive, 500);
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
const TIKTOK_SHORTFORM_JS = `
(function northstarShortformTikTok() {
  if (window.__northstarShortformTT) return;
  window.__northstarShortformTT = true;

  const STYLE_KEYS = ['overflow', 'overscroll-behavior', 'height', 'touch-action'];
  const _savedStyles = { root: null, body: null };

  function saveStyles(el, key) {
    if (_savedStyles[key]) return;
    const store = {};
    STYLE_KEYS.forEach(prop => {
      store[prop] = el.style.getPropertyValue(prop) || '';
    });
    _savedStyles[key] = store;
  }

  function restoreStyles(el, key) {
    const store = _savedStyles[key];
    if (store) {
      STYLE_KEYS.forEach(prop => {
        const value = store[prop];
        if (value) el.style.setProperty(prop, value);
        else el.style.removeProperty(prop);
      });
      _savedStyles[key] = null;
      return;
    }
    STYLE_KEYS.forEach(prop => el.style.removeProperty(prop));
  }

  function lockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      saveStyles(el, key);
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('overscroll-behavior', 'none', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('touch-action', 'none', 'important');
    });
  }

  function unlockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      restoreStyles(el, key);
    });
  }

  function isActivePath() {
    const path = location.pathname || '';
    if (path === '/' || path.startsWith('/@')) return true;
    if (path.startsWith('/foryou') || path.startsWith('/following')) return true;
    if (path.startsWith('/t/') || path.startsWith('/discover')) return true;
    if (path.startsWith('/search') || path.startsWith('/tag') || path.startsWith('/music')) return true;
    return !!document.querySelector('video');
  }

  let _active = isActivePath();

  function refreshActive() {
    const next = isActivePath();
    if (next === _active) return;
    _active = next;
    if (_active) lockScroll();
    else unlockScroll();
  }

  function blockEvent(e) {
    if (!_active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }

  const blockKeys = new Set(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End']);

  function onKeydown(e) {
    if (!_active) return;
    if (blockKeys.has(e.key)) blockEvent(e);
  }

  if (!window.__northstarShortformTTScrollLock) {
    window.__northstarShortformTTScrollLock = true;
    document.addEventListener('wheel', blockEvent, { passive: false, capture: true });
    document.addEventListener('touchmove', blockEvent, { passive: false, capture: true });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('pointerdown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('auxclick', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('mousemove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
    document.addEventListener('pointermove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
  }

  if (!window.__inkAutoplayBlocked) {
    window.__inkAutoplayBlocked = true;
    // _gesture tracks whether the NEXT play() was directly triggered by a user click.
    // Reset whenever a video element appears (player init), so page-load autoplay is blocked
    // even if a navigation gesture window is still open.
    let _gesture = false;
    const _markGesture = () => {
      _gesture = true;
      requestAnimationFrame(() => { _gesture = false; });
    };
    document.addEventListener('click',    _markGesture, { capture: true, passive: true });
    document.addEventListener('keydown',  _markGesture, { capture: true, passive: true });
    document.addEventListener('pointerup',_markGesture, { capture: true, passive: true });
    try {
      const _origPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        if (!_gesture) return Promise.resolve();
        return _origPlay.apply(this, arguments);
      };
    } catch (e) { }
    function _pauseVid(v) { try { v.removeAttribute('autoplay'); if (!v.paused) v.pause(); } catch (e) { } }
    document.querySelectorAll('video').forEach(_pauseVid);
    // Watch for new videos — pause them AND reset gesture so player init can't ride a navigation click
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (!n || n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO') { _gesture = false; _pauseVid(n); }
      else if (n.querySelectorAll) {
        const vids = n.querySelectorAll('video');
        if (vids.length) { _gesture = false; vids.forEach(_pauseVid); }
      }
    }))).observe(document.documentElement, { childList: true, subtree: true });
  }

  function shouldBlockNav(target) {
    if (!target) return false;
    const label = (target.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('next') || label.includes('previous') || label.includes('up') || label.includes('down');
  }

  function onNavClick(e) {
    if (!_active) return;
    const target = e.target && e.target.closest ? e.target.closest('button,a,[role="button"]') : null;
    if (!shouldBlockNav(target)) return;
    blockEvent(e);
  }

  if (!window.__northstarShortformTTNavBlock) {
    window.__northstarShortformTTNavBlock = true;
    document.addEventListener('click', onNavClick, true);
    document.addEventListener('pointerdown', onNavClick, true);
  }

  function block() {
    refreshActive();
    if (_active) lockScroll();
  }
  block();
  setInterval(refreshActive, 500);
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
const INSTAGRAM_SHORTFORM_JS = `
(function northstarShortformIG() {
  if (window.__northstarShortformIG) return;
  window.__northstarShortformIG = true;

  const STYLE_KEYS = ['overflow', 'overscroll-behavior', 'height', 'touch-action'];
  const _savedStyles = { root: null, body: null };

  function saveStyles(el, key) {
    if (_savedStyles[key]) return;
    const store = {};
    STYLE_KEYS.forEach(prop => {
      store[prop] = el.style.getPropertyValue(prop) || '';
    });
    _savedStyles[key] = store;
  }

  function restoreStyles(el, key) {
    const store = _savedStyles[key];
    if (store) {
      STYLE_KEYS.forEach(prop => {
        const value = store[prop];
        if (value) el.style.setProperty(prop, value);
        else el.style.removeProperty(prop);
      });
      _savedStyles[key] = null;
      return;
    }
    STYLE_KEYS.forEach(prop => el.style.removeProperty(prop));
  }

  function lockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      saveStyles(el, key);
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('overscroll-behavior', 'none', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('touch-action', 'none', 'important');
    });
  }

  function unlockScroll() {
    const root = document.documentElement;
    const body = document.body;
    [[root, 'root'], [body, 'body']].forEach(([el, key]) => {
      if (!el) return;
      restoreStyles(el, key);
    });
  }

  function isActivePath() {
    const path = location.pathname || '';
    return path.startsWith('/reel') || path.startsWith('/reels') || path.startsWith('/explore');
  }

  let _active = isActivePath();

  function refreshActive() {
    const next = isActivePath();
    if (next === _active) return;
    _active = next;
    if (_active) lockScroll();
    else unlockScroll();
  }

  function blockEvent(e) {
    if (!_active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }

  const blockKeys = new Set(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End']);

  function onKeydown(e) {
    if (!_active) return;
    if (blockKeys.has(e.key)) blockEvent(e);
  }

  if (!window.__northstarShortformIGScrollLock) {
    window.__northstarShortformIGScrollLock = true;
    document.addEventListener('wheel', blockEvent, { passive: false, capture: true });
    document.addEventListener('touchmove', blockEvent, { passive: false, capture: true });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('pointerdown', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('auxclick', (e) => { if (e.button === 1) blockEvent(e); }, true);
    document.addEventListener('mousemove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
    document.addEventListener('pointermove', (e) => { if (e.buttons & 4) blockEvent(e); }, { passive: false, capture: true });
  }

  if (!window.__inkAutoplayBlocked) {
    window.__inkAutoplayBlocked = true;
    // _gesture tracks whether the NEXT play() was directly triggered by a user click.
    // Reset whenever a video element appears (player init), so page-load autoplay is blocked
    // even if a navigation gesture window is still open.
    let _gesture = false;
    const _markGesture = () => {
      _gesture = true;
      requestAnimationFrame(() => { _gesture = false; });
    };
    document.addEventListener('click',    _markGesture, { capture: true, passive: true });
    document.addEventListener('keydown',  _markGesture, { capture: true, passive: true });
    document.addEventListener('pointerup',_markGesture, { capture: true, passive: true });
    try {
      const _origPlay = HTMLVideoElement.prototype.play;
      HTMLVideoElement.prototype.play = function() {
        if (!_gesture) return Promise.resolve();
        return _origPlay.apply(this, arguments);
      };
    } catch (e) { }
    function _pauseVid(v) { try { v.removeAttribute('autoplay'); if (!v.paused) v.pause(); } catch (e) { } }
    document.querySelectorAll('video').forEach(_pauseVid);
    // Watch for new videos — pause them AND reset gesture so player init can't ride a navigation click
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (!n || n.nodeType !== 1) return;
      if (n.tagName === 'VIDEO') { _gesture = false; _pauseVid(n); }
      else if (n.querySelectorAll) {
        const vids = n.querySelectorAll('video');
        if (vids.length) { _gesture = false; vids.forEach(_pauseVid); }
      }
    }))).observe(document.documentElement, { childList: true, subtree: true });
  }

  function shouldBlockNav(target) {
    if (!target) return false;
    const label = (target.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('next') || label.includes('previous') || label.includes('up') || label.includes('down');
  }

  function onNavClick(e) {
    if (!_active) return;
    const target = e.target && e.target.closest ? e.target.closest('button,a,[role="button"]') : null;
    if (!shouldBlockNav(target)) return;
    blockEvent(e);
  }

  if (!window.__northstarShortformIGNavBlock) {
    window.__northstarShortformIGNavBlock = true;
    document.addEventListener('click', onNavClick, true);
    document.addEventListener('pointerdown', onNavClick, true);
  }

  function block() {
    refreshActive();
    if (_active) lockScroll();
  }
  block();
  setInterval(refreshActive, 500);
  new MutationObserver(block).observe(document.documentElement, { childList: true, subtree: true });
})();
`;
function parseUrl(url) {
    try {
        const u = new URL(url);
        return { host: u.hostname || '', path: u.pathname || '' };
    }
    catch {
        return { host: '', path: '' };
    }
}
function isInstagramShortformPath(path) {
    return path.startsWith('/reel') || path.startsWith('/reels') || path.startsWith('/explore');
}
function getFocusInjectionForUrl(url) {
    const { host, path } = parseUrl(url);
    if (host.includes('youtube.com')) {
        if (path.startsWith('/shorts'))
            return YT_SHORTS_BLOCK_JS;
        return YT_BLOCK_JS;
    }
    if (host.includes('tiktok.com'))
        return TIKTOK_BLOCK_JS;
    if (host.includes('instagram.com'))
        return INSTAGRAM_BLOCK_JS;
    return null;
}
function getShortformInjectionForUrl(url) {
    const { host, path } = parseUrl(url);
    if (host.includes('youtube.com') && path.startsWith('/shorts'))
        return YT_SHORTS_ONLY_JS;
    if (host.includes('tiktok.com'))
        return TIKTOK_SHORTFORM_JS;
    if (host.includes('instagram.com') && isInstagramShortformPath(path))
        return INSTAGRAM_SHORTFORM_JS;
    return null;
}

module.exports = { getFocusInjectionForUrl, getShortformInjectionForUrl };