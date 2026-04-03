/**
 * chrome-spoof.js
 * Injected via session.registerPreloadScript({ type: 'frame' }) into every
 * frame before any page script runs.
 *
 * Fixes three Google sign-in detection vectors that cannot be addressed from
 * the main process alone:
 *
 *  1. navigator.webdriver — Electron sets this to true.  The app-level switch
 *     --disable-blink-features=AutomationControlled is the primary fix; this
 *     is belt-and-suspenders.
 *
 *  2. window.chrome — Real Chrome exposes chrome.runtime / chrome.app.
 *     Without it Google classifies the client as an unsupported WebView.
 *
 *  3. navigator.userAgentData — The JS-side equivalent of Sec-CH-UA.
 *     Electron's userAgentData.brands only contains "Chromium", never
 *     "Google Chrome".  Google's login page calls getHighEntropyValues()
 *     and checks the brand list.  We override the entire object to match
 *     what real Chrome 134 returns.
 */

(function () {
    'use strict';

    const CHROME_MAJOR = '134';
    const CHROME_FULL  = '134.0.6998.165';

    // ── 1. Remove webdriver flag ─────────────────────────────────────────────
    try {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
        });
    } catch (_) {}

    // ── 2. Add window.chrome ─────────────────────────────────────────────────
    try {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) window.chrome.runtime = {};
        if (!window.chrome.app) {
            window.chrome.app = {
                InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                getDetails:     function () { return null; },
                getIsInstalled: function () { return false; },
                installState:   function () {}
            };
        }
    } catch (_) {}

    // ── 3. Override navigator.userAgentData ──────────────────────────────────
    // Detect platform from the existing UA string (no Node.js access here)
    try {
        let platform = 'Linux';
        const ua = navigator.userAgent || '';
        if (ua.includes('Macintosh') || ua.includes('Mac OS X')) platform = 'macOS';
        else if (ua.includes('Windows'))                          platform = 'Windows';

        // Platform version guesses that match the platform string in the UA
        const platformVersionMap = { macOS: '13.6.0', Windows: '15.0.0', Linux: '6.6.0' };
        const platformVersion = platformVersionMap[platform] || '0.0.0';

        const brands = [
            { brand: 'Not A(Brand',   version: CHROME_MAJOR },
            { brand: 'Chromium',      version: CHROME_MAJOR },
            { brand: 'Google Chrome', version: CHROME_MAJOR }
        ];

        const fullVersionList = [
            { brand: 'Not A(Brand',   version: '8.0.0.0'    },
            { brand: 'Chromium',      version: CHROME_FULL   },
            { brand: 'Google Chrome', version: CHROME_FULL   }
        ];

        const uaDataValue = {
            brands,
            mobile:   false,
            platform,

            /** Called by Google's login page to verify the browser brand */
            getHighEntropyValues: function (hints) {
                const map = {
                    brands,
                    mobile:          false,
                    platform,
                    platformVersion,
                    architecture:    'x86',
                    bitness:         '64',
                    wow64:           false,
                    uaFullVersion:   CHROME_FULL,
                    fullVersionList
                };
                const result = {};
                for (const hint of (hints || [])) {
                    if (Object.prototype.hasOwnProperty.call(map, hint)) {
                        result[hint] = map[hint];
                    }
                }
                return Promise.resolve(result);
            },

            toJSON: function () {
                return { brands, mobile: false, platform };
            }
        };

        Object.defineProperty(navigator, 'userAgentData', {
            get:          () => uaDataValue,
            configurable: true,
            enumerable:   true
        });
    } catch (_) {}
})();
