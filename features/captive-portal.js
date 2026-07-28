'use strict';
/**
 * Captive-portal detection.
 *
 * Public Wi-Fi (hotels, airports, cafés) puts you behind a "captive portal":
 * requests are intercepted and redirected to a sign-in page until you
 * authenticate. We detect this by probing a small, well-known endpoint that
 * returns a fixed body over PLAIN HTTP (portals can't MITM HTTPS, so they
 * redirect HTTP) and checking whether we got the expected answer:
 *
 *   - exact expected body        → online, no portal
 *   - 3xx redirect / wrong body  → a portal intercepted us (its login is the
 *                                  redirect target, or served at the probe URL)
 *   - request error              → simply offline (not a portal)
 *
 * The probe endpoint is Mozilla's detectportal (neutral, privacy-respecting) —
 * deliberately NOT Google's gstatic generate_204, to match the app's no-Google
 * stance. It sends no cookies and isn't cached.
 *
 * On detection we call onPortal(loginUrl) once (the caller opens a sign-in tab),
 * then poll quietly until connectivity returns so a future network re-triggers.
 */
const { net } = require('electron');

const PROBE_URL = 'http://detectportal.firefox.com/success.txt';
const EXPECT = 'success';
const FALLBACK_LOGIN = 'http://neverssl.com/'; // plain-HTTP page portals reliably intercept

let checking = false;
let signInOpen = false; // a sign-in tab is already open for the current portal
let monitorTimer = null;

/** One probe → { online, portal, portalUrl }. Never rejects. */
function probe() {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        try {
            const req = net.request({ url: PROBE_URL, useSessionCookies: false, cache: 'no-cache', redirect: 'manual' });
            req.on('response', (res) => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400) {
                    const loc = res.headers.location || res.headers.Location;
                    res.on('data', () => { });
                    res.on('end', () => finish({ online: false, portal: true, portalUrl: Array.isArray(loc) ? loc[0] : loc || null }));
                    return;
                }
                let body = '';
                res.on('data', (c) => { if (body.length < 4096) body += c.toString(); });
                res.on('end', () => {
                    if (status === 200 && body.trim() === EXPECT)
                        finish({ online: true, portal: false, portalUrl: null });
                    else
                        finish({ online: false, portal: true, portalUrl: null }); // 200 w/ wrong body = portal page
                });
            });
            req.on('error', () => finish({ online: false, portal: false, portalUrl: null })); // no network → not a portal
            setTimeout(() => finish({ online: false, portal: false, portalUrl: null }), 6000);
            req.end();
        }
        catch {
            finish({ online: false, portal: false, portalUrl: null });
        }
    });
}

function startMonitor() {
    if (monitorTimer)
        return;
    monitorTimer = setInterval(async () => {
        const r = await probe();
        if (r.online) {
            signInOpen = false;
            clearInterval(monitorTimer);
            monitorTimer = null;
        }
    }, 5000);
}

/**
 * Probe once; if a captive portal is detected and we haven't already opened a
 * sign-in tab for it, call onPortal(loginUrl). Safe to call repeatedly (deduped).
 */
async function check(onPortal) {
    if (checking)
        return;
    checking = true;
    try {
        const r = await probe();
        if (r.portal) {
            if (!signInOpen && typeof onPortal === 'function') {
                signInOpen = true;
                onPortal(r.portalUrl || FALLBACK_LOGIN);
                startMonitor();
            }
        }
        else if (r.online) {
            signInOpen = false;
        }
        return r;
    }
    finally {
        checking = false;
    }
}

module.exports = { probe, check };
