/**
 * chrome-spoof.js
 *
 * Registered via session.defaultSession.registerPreloadScript({ type: 'frame' })
 * so it runs in every frame's ISOLATED world before page scripts execute.
 * We inject a <script> tag to patch the MAIN world.
 *
 * UA strategy: we present as Firefox in HTTP headers (user-agent.js).
 * To be consistent, the JS environment must also look like Firefox:
 *  - navigator.webdriver    → must be undefined (automation signal)
 *  - window.chrome          → must NOT exist (Chrome-only API, absent in Firefox)
 *  - navigator.userAgentData→ must NOT exist (Chrome 90+ only, absent in Firefox)
 *  - process.versions.electron → must not leak into page world
 *
 * If Google sees Firefox UA in headers but finds window.chrome or userAgentData
 * (Chrome-exclusive APIs) in JS, it detects the inconsistency and blocks sign-in.
 */

(function () {
    'use strict';

    const mainWorldScript = `(function () {
  'use strict';

  // ── 1. navigator.webdriver → undefined ────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: false,
      enumerable: true,
    });
  } catch (_) {}

  // ── 2. Hide window.chrome ─────────────────────────────────────────────────
  // Firefox does not have window.chrome. Electron's Chromium exposes it, so
  // we mask it to avoid a UA-vs-JS inconsistency that Google detects.
  try {
    Object.defineProperty(window, 'chrome', {
      get: () => undefined,
      configurable: false,
      enumerable: false,
    });
  } catch (_) {}

  // ── 3. Hide navigator.userAgentData ───────────────────────────────────────
  // This is a Chrome 90+ Client Hints JS API. Firefox does not implement it.
  // Electron's Chromium exposes it with Electron in the brands list.
  // Hiding it prevents Google from seeing Chrome brands on a "Firefox" UA.
  try {
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => undefined,
      configurable: false,
      enumerable: false,
    });
  } catch (_) {}

  // ── 4. navigator.plugins — non-empty list ─────────────────────────────────
  // An empty plugins list is a well-known automation/headless signal.
  // Firefox ships with a PDF viewer plugin, so we mimic that.
  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      const plugins = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: () => Object.assign(plugins, {
          item:      (i)    => plugins[i] || null,
          namedItem: (name) => plugins.find(p => p.name === name) || null,
          refresh:   ()     => {},
        }),
        configurable: true,
        enumerable: true,
      });
    }
  } catch (_) {}

  // ── 5. Mask process.versions.electron ─────────────────────────────────────
  try {
    if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
      Object.defineProperty(window, 'process', {
        get: () => ({ versions: {} }),
        configurable: false,
        enumerable: false,
      });
    }
  } catch (_) {}

})();`;

    try {
        const s = document.createElement('script');
        s.textContent = mainWorldScript;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
    } catch (_) {}
})();
