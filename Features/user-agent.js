const os = require('os');

class UserAgent {

    static generate() {
        return `Mozilla/5.0 (${_platformString()}; rv:124.0) Gecko/20100101 Firefox/124.0`;
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
     */
    static setupSession(session) {
        const ua = this.generate();
        session.setUserAgent(ua);

        session.webRequest.onBeforeSendHeaders((details, callback) => {
            const headers = { ...details.requestHeaders };

            // Firefox doesn't send Sec-CH-UA headers by default, strip them
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase().startsWith('sec-ch-ua')) {
                    delete headers[key];
                }
            }

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
        case 'darwin': return 'Macintosh; Intel Mac OS X 10.15';
        case 'win32':  return os.arch() === 'x64' ? 'Windows NT 10.0; Win64; x64' : 'Windows NT 10.0; WOW64';
        case 'linux':  return os.arch() === 'arm64' ? 'X11; Linux aarch64' : 'X11; Linux x86_64';
        default:       return 'X11; Linux x86_64';
    }
}

module.exports = UserAgent;
