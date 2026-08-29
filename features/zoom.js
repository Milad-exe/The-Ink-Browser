/**
 * Northstar — per-site zoom
 *
 * Zoom used to be per-webContents and forgotten the moment you navigated: a
 * site you always read at 125% needed re-zooming every single visit, and a tab
 * restored from the last session came back at 100%.
 *
 * browsers remember the level per ORIGIN, so that is the key
 * here. Levels are Chromium's logarithmic scale (0 = 100%, ±0.5 steps), stored
 * as-is; only non-default levels are kept, so the file stays small and clearing
 * a site's zoom really removes it.
 *
 * Private tabs read the remembered level but never write one — a private
 * session should leave no trace of where you have been, and a zoom entry is a
 * record of a visit.
 */
'use strict';
const log = require('./log');

let persistence = null;
let levels = Object.create(null); // origin → zoom level

function originOf(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return null;
        return u.origin;
    }
    catch {
        return null;
    }
}

function init(p) {
    persistence = p;
    try {
        const stored = p.get('siteZoom');
        levels = (stored && typeof stored === 'object') ? { ...stored } : Object.create(null);
    }
    catch (e) {
        log.warn('zoom', 'could not read saved zoom levels', e);
        levels = Object.create(null);
    }
}

function save() {
    try { persistence?.set('siteZoom', { ...levels }); }
    catch (e) { log.warn('zoom', 'could not save zoom levels', e); }
}

/** Remembered level for a url, or 0 (100%). */
function levelFor(url) {
    const origin = originOf(url);
    if (!origin)
        return 0;
    const v = levels[origin];
    return Number.isFinite(v) ? v : 0;
}

/** Record the level the user just set. `remember` is false for private tabs. */
function remember(url, level, remember_ = true) {
    const origin = originOf(url);
    if (!origin || !remember_)
        return;
    if (!Number.isFinite(level) || Math.abs(level) < 0.001) {
        if (origin in levels) {
            delete levels[origin];
            save();
        }
        return;
    }
    if (levels[origin] === level)
        return;
    levels[origin] = level;
    save();
}

/** Apply the remembered level to a webContents showing `url`. */
function apply(wc, url) {
    if (!wc || wc.isDestroyed())
        return;
    const level = levelFor(url);
    try {
        if (wc.getZoomLevel() !== level)
            wc.setZoomLevel(level);
    }
    catch (e) { log.debug('zoom', 'apply', e); }
}

function all() {
    return Object.entries(levels)
        .map(([origin, level]) => ({ origin, level, percent: Math.round(Math.pow(1.2, level) * 100) }))
        .sort((a, b) => a.origin.localeCompare(b.origin));
}

function clear(origin) {
    if (origin) {
        delete levels[origin];
    }
    else {
        levels = Object.create(null);
    }
    save();
}

module.exports = { init, levelFor, remember, apply, all, clear, originOf };
