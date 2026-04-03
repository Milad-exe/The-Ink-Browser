const os = require('os');

// Keep in sync with Electron 38's bundled Chromium build
const CHROME_MAJOR   = '134';
const CHROME_VERSION = '134.0.0.0';
const CHROME_FULL    = '134.0.6998.165'; // actual Chrome 134 stable build number

class UserAgent {

    static generate() {
        return `Mozilla/5.0 (${_platformString()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
    }

    /**
     * Set the UA on a single tab.
     * All header interception is handled once at the session level via setupSession().
     */
    static setupTab(tab) {
        tab.webContents.setUserAgent(this.generate());
    }

    /**
     * Call ONCE in app.whenReady(), before any window is created.
     *
     * Fixes all three Google detection vectors:
     *
     *  1. User-Agent — no Electron/ token (generate() handles this)
     *
     *  2. Sec-CH-UA / Sec-CH-UA-Full-Version-List — Electron only derives the
     *     "Chromium" brand from setUserAgent(); it never synthesises the
     *     "Google Chrome" brand.  Google explicitly checks for "Google Chrome"
     *     in the brand list and blocks the sign-in if it is absent.
     *     We inject the full three-brand list on every request.
     *
     *  3. Sec-CH-UA-Platform / Mobile — must match what real Chrome sends so
     *     Google's high-entropy hint checks are consistent.
     *
     * Note: injecting Sec-* headers via onBeforeSendHeaders works because the
     * forbidden-header restriction only applies to renderer-side Fetch/XHR, not
     * to the browser-process network delegate where this interceptor runs.
     */
    static setupSession(session) {
        const ua = this.generate();
        session.setUserAgent(ua);

        const chUA         = `"Not A(Brand";v="8", "Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}"`;
        const chUAFull     = `"Not A(Brand";v="8.0.0.0", "Chromium";v="${CHROME_FULL}", "Google Chrome";v="${CHROME_FULL}"`;
        const chPlatform   = `"${_chPlatform()}"`;

        session.webRequest.onBeforeSendHeaders((details, callback) => {
            const headers = { ...details.requestHeaders };

            // ── Client Hints (fix missing "Google Chrome" brand) ──────────────
            // Injected on ALL request types — Google checks these on XHR/fetch
            // OAuth sub-requests, not just top-level navigations.
            headers['Sec-CH-UA']                  = chUA;
            headers['Sec-CH-UA-Mobile']            = '?0';
            headers['Sec-CH-UA-Platform']          = chPlatform;
            headers['Sec-CH-UA-Full-Version-List'] = chUAFull;
            headers['Sec-CH-UA-Arch']              = '"x86"';
            headers['Sec-CH-UA-Bitness']           = '"64"';
            headers['Sec-CH-UA-Wow64']             = '?0';

            // ── Privacy headers (top-level navigations only) ──────────────────
            if (details.resourceType === 'mainFrame') {
                headers['DNT']             = '1';
                headers['Accept-Language'] = 'en-US,en;q=0.9';
            }

            callback({ requestHeaders: headers });
        });
    }

    static getPlatformInfo() {
        return { platform: os.platform(), arch: os.arch(), release: os.release(), type: os.type() };
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _platformString() {
    switch (os.platform()) {
        case 'darwin': return 'Macintosh; Intel Mac OS X 10_15_7';
        case 'win32':  return os.arch() === 'x64' ? 'Windows NT 10.0; Win64; x64' : 'Windows NT 10.0; WOW64';
        case 'linux':  return os.arch() === 'arm64' ? 'X11; Linux aarch64' : 'X11; Linux x86_64';
        default:       return 'X11; Linux x86_64';
    }
}

/** Returns the Sec-CH-UA-Platform value (unquoted — caller adds quotes). */
function _chPlatform() {
    switch (os.platform()) {
        case 'darwin': return 'macOS';
        case 'win32':  return 'Windows';
        case 'linux':  return 'Linux';
        default:       return 'Linux';
    }
}

module.exports = UserAgent;
