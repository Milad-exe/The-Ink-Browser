/**
 * chrome.proxy — maps the extension proxy API onto Electron's session.setProxy.
 *
 * Scope is per SESSION, which lines up with Chrome's per-profile proxy: setting
 * it from an extension in one space does not reroute the others.
 *
 * Chrome's ProxyConfig has four modes. Three map cleanly onto Electron:
 *   direct        → proxyRules 'direct://'
 *   auto_detect   → mode 'pac_script' with WPAD
 *   pac_script    → pacScript url/data
 *   fixed_servers → proxyRules built from the singleProxy/per-scheme rules
 * `system` hands control back to Electron's default (system settings).
 */
'use strict';
const log = require('./log');

// extension id → { session, config } so clear() can put the session back.
const applied = new Map();

/** Build Electron proxyRules from Chrome's fixed_servers shape. */
function rulesFromFixedServers(rules = {}) {
    const spec = (s) => {
        if (!s)
            return null;
        const scheme = s.scheme && s.scheme !== 'http' ? `${s.scheme}://` : '';
        return `${scheme}${s.host}${s.port ? ':' + s.port : ''}`;
    };
    if (rules.singleProxy)
        return spec(rules.singleProxy);
    const parts = [];
    for (const [key, prefix] of [['proxyForHttp', 'http'], ['proxyForHttps', 'https'], ['proxyForFtp', 'ftp']]) {
        const v = spec(rules[key]);
        if (v)
            parts.push(`${prefix}=${v}`);
    }
    const fallback = spec(rules.fallbackProxy);
    if (fallback)
        parts.push(fallback);
    return parts.join(';') || null;
}

function electronConfigFor(config = {}) {
    switch (config.mode) {
        case 'direct':
            return { proxyRules: 'direct://' };
        case 'auto_detect':
            return { mode: 'pac_script' };
        case 'pac_script': {
            const pac = config.pacScript || {};
            // Electron takes a URL; an inline PAC body is passed as a data: URL.
            if (pac.url)
                return { pacScript: pac.url };
            if (pac.data)
                return { pacScript: 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac.data).toString('base64') };
            return { mode: 'direct' };
        }
        case 'fixed_servers': {
            const proxyRules = rulesFromFixedServers(config.rules);
            if (!proxyRules)
                return { mode: 'direct' };
            const bypass = config.rules?.bypassList;
            return {
                proxyRules,
                ...(Array.isArray(bypass) && bypass.length ? { proxyBypassRules: bypass.join(',') } : {}),
            };
        }
        case 'system':
        default:
            return { mode: 'system' };
    }
}

async function set(extensionId, session, value = {}) {
    if (!session)
        throw new Error('no session for this extension');
    const config = value.value || value.config || value;
    const electronConfig = electronConfigFor(config);
    await session.setProxy(electronConfig);
    applied.set(extensionId, { session, config });
    log.debug('ext-proxy', `${extensionId} set mode=${config.mode || 'system'}`);
    return true;
}

function get(extensionId) {
    const rec = applied.get(extensionId);
    return {
        value: rec?.config || { mode: 'system' },
        levelOfControl: rec ? 'controlled_by_this_extension' : 'controllable_by_this_extension',
    };
}

async function clear(extensionId) {
    const rec = applied.get(extensionId);
    if (!rec)
        return true;
    applied.delete(extensionId);
    try { await rec.session.setProxy({ mode: 'system' }); }
    catch (e) { log.debug('ext-proxy', 'clear', e); }
    return true;
}

module.exports = { set, get, clear, electronConfigFor, rulesFromFixedServers };
