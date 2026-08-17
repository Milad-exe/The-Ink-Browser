/**
 * Northstar — TLS certificate errors
 *
 * Electron's default for `certificate-error` is to cancel the load, which used
 * to leave the generic "can't reach this page" screen: the user couldn't tell a
 * mistyped hostname from an expired certificate from an actual interception,
 * and had no way through even when they knew the cause (a lab box with a
 * self-signed cert).
 *
 * This shows a real interstitial instead — what the fault is, which host, the
 * certificate's fingerprint and dates — and lets the user accept the risk for
 * that host if they choose to.
 *
 * Exceptions are keyed by host + the certificate's fingerprint, so accepting a
 * lab box's certificate does NOT keep you quiet when that host later presents a
 * DIFFERENT bad certificate — which is exactly the case where something is
 * wrong. They are held in memory only: an accepted risk lasts for the session,
 * never silently across restarts. Private windows never contribute exceptions.
 */
'use strict';
const path = require('path');
const log = require('./log');
const i18n = require('./i18n');
const { resolveAppFile } = require('../app-paths');

// key: `${host}|${fingerprint}` → true
const accepted = new Map();

const keyFor = (host, fingerprint) => `${host || ''}|${fingerprint || ''}`;

/**
 * Chromium's error string → the pair of catalogue keys that explain it. Keys,
 * not text, so a translated locale covers the interstitial's headline too.
 */
const EXPLANATIONS = {
    'net::ERR_CERT_DATE_INVALID': 'date',
    'net::ERR_CERT_AUTHORITY_INVALID': 'authority',
    'net::ERR_CERT_COMMON_NAME_INVALID': 'name',
    'net::ERR_CERT_REVOKED': 'revoked',
    'net::ERR_CERT_WEAK_SIGNATURE_ALGORITHM': 'weak',
    'net::ERR_CERT_SYMANTEC_LEGACY': 'authority',
};

function explain(error) {
    const kind = EXPLANATIONS[error] || 'generic';
    return [i18n.t(`cert.err.${kind}.title`), i18n.t(`cert.err.${kind}.detail`)];
}

/** Has the user already accepted this exact certificate for this host? */
function isAccepted(host, fingerprint) {
    return accepted.get(keyFor(host, fingerprint)) === true;
}

function accept(host, fingerprint) {
    if (!host)
        return;
    accepted.set(keyFor(host, fingerprint), true);
    log.warn('cert', `user accepted an untrusted certificate for ${host}`);
}

function clear() {
    accepted.clear();
}

/** Show the interstitial in the webContents that hit the error. */
function showWarning(wc, { url, error, certificate }) {
    if (!wc || wc.isDestroyed())
        return;
    let host = '';
    try { host = new URL(url).host; }
    catch (e) { log.debug('cert-errors', 'showWarning', e); }
    const [title, detail] = explain(error);
    const params = new URLSearchParams({
        url: url || '',
        host,
        error: error || '',
        title,
        detail,
        issuer: certificate?.issuerName || '',
        subject: certificate?.subjectName || '',
        fingerprint: certificate?.fingerprint || '',
        validFrom: certificate?.validStart ? new Date(certificate.validStart * 1000).toISOString() : '',
        validTo: certificate?.validExpiry ? new Date(certificate.validExpiry * 1000).toISOString() : '',
    });
    try {
        wc.loadFile(resolveAppFile('renderer/CertWarning/index.html'), { search: '?' + params.toString() });
    }
    catch (e) {
        log.error('cert', 'could not show the certificate warning', e);
    }
}

/**
 * Wire the app-wide handler. Electron fires this for every webContents, so it
 * covers tabs, glances and split panes alike.
 */
function register(app) {
    app.on('certificate-error', (event, wc, url, error, certificate, callback) => {
        let host = '';
        try { host = new URL(url).host; }
        catch (e) { log.debug('cert-errors', 'register', e); }
        event.preventDefault();
        if (isAccepted(host, certificate?.fingerprint)) {
            callback(true);
            return;
        }
        log.warn('cert', `${error} for ${host}`);
        callback(false);
        // Subresource failures must not replace the page the user is reading;
        // only a main-frame failure gets the interstitial.
        let current = '';
        try { current = wc.getURL(); }
        catch (e) { log.debug('cert-errors', 'register', e); }
        const isMainFrame = !current || current === url || !current.startsWith('http');
        if (isMainFrame)
            showWarning(wc, { url, error, certificate });
    });
}

module.exports = { register, accept, isAccepted, clear, explain };
