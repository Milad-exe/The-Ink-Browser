/**
 * Northstar — update check
 *
 * A browser that can't tell you it's out of date can't ship a security fix.
 * This checks the project's GitHub releases and reports what it finds; it does
 * NOT download or install anything. Silent self-updating needs signed builds
 * and a release channel to be trustworthy — until those exist, telling the user
 * plainly and linking to the release is the honest version of this feature.
 *
 * Network use is opt-in-shaped: the check runs when the user opens Settings →
 * About or presses the button, never on a timer in the background.
 */
'use strict';
const { app, net } = require('electron');
const log = require('./log');

const REPO = 'Milad-exe/Northstar';
const FEED = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = 8000;

let lastResult = null; // cached for the session

/** "v1.2.10" / "1.2.10-beta.1" → [1,2,10] (pre-release suffix ignored) */
function parseVersion(v) {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 1 if a > b, -1 if a < b, 0 if equal or unparseable. */
function compareVersions(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y)
        return 0;
    for (let i = 0; i < 3; i++) {
        if (x[i] !== y[i])
            return x[i] > y[i] ? 1 : -1;
    }
    return 0;
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
        const request = net.request({ url, method: 'GET' });
        request.setHeader('Accept', 'application/vnd.github+json');
        request.setHeader('User-Agent', `Northstar/${app.getVersion()}`);
        const timer = setTimeout(() => {
            done(reject, new Error('update check timed out'));
            try { request.abort(); } catch (e) { log.debug('updates', 'done', e); }
        }, TIMEOUT_MS);
        request.on('response', (response) => {
            const chunks = [];
            response.on('data', (c) => chunks.push(c));
            response.on('end', () => {
                clearTimeout(timer);
                if (response.statusCode === 404) {
                    done(reject, new Error('no releases published'));
                    return;
                }
                if (response.statusCode >= 400) {
                    done(reject, new Error(`update feed returned ${response.statusCode}`));
                    return;
                }
                try { done(resolve, JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
                catch (e) { done(reject, e); }
            });
        });
        request.on('error', (e) => { clearTimeout(timer); done(reject, e); });
        request.end();
    });
}

/**
 * @returns {{ status, current, latest?, url?, notes?, publishedAt?, error? }}
 *   status: 'current' | 'update-available' | 'unknown'
 */
async function check({ force = false } = {}) {
    if (lastResult && !force)
        return lastResult;
    const current = app.getVersion();
    try {
        const release = await fetchJson(FEED);
        const latest = String(release?.tag_name || release?.name || '').replace(/^v/i, '');
        if (!parseVersion(latest)) {
            lastResult = { status: 'unknown', current, error: 'could not read the latest version' };
            return lastResult;
        }
        const newer = compareVersions(latest, current) > 0;
        lastResult = {
            status: newer ? 'update-available' : 'current',
            current,
            latest,
            url: release?.html_url || `https://github.com/${REPO}/releases`,
            notes: typeof release?.body === 'string' ? release.body.slice(0, 2000) : '',
            publishedAt: release?.published_at || null,
        };
        log.info('updates', `checked: running ${current}, latest ${latest}`);
        return lastResult;
    }
    catch (e) {
        log.warn('updates', 'update check failed', e);
        lastResult = { status: 'unknown', current, error: e?.message || 'check failed' };
        return lastResult;
    }
}

module.exports = { check, compareVersions, parseVersion, REPO };
