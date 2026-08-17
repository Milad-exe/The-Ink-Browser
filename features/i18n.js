/**
 * Northstar — localisation
 *
 * Two halves, and the second one is the one people notice first:
 *
 *  1. TRANSLATION. `t(key, vars)` looks a string up in `locales/<lang>.json`,
 *     falling back to English and then to the key itself, so a missing
 *     translation degrades to readable English rather than to a blank label.
 *     Catalogues are plain JSON keyed by a dotted name; adding a language means
 *     dropping in a file, no code change.
 *
 *  2. FORMATTING. Dates, times, numbers and file sizes went through hardcoded
 *     en-US-shaped code — the chrome clock was fixed 24-hour, sizes were always
 *     "1.5 MB" with a dot. Those are wrong in most of the world regardless of
 *     whether the UI text is translated, so they run through Intl with the
 *     resolved locale.
 *
 * The locale is the OS's (`app.getLocale()`) unless the user picks one in
 * Settings. Web pages are unaffected: this is the browser's own UI only, and
 * `Accept-Language` is deliberately left alone (it is a fingerprinting surface —
 * see features/privacy.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const log = require('./log');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const FALLBACK = 'en';

let catalogues = null; // lang → { key: string }
let available = null;  // [{ id, name, coverage }]
let current = FALLBACK;
let persistence = null;

function loadCatalogues() {
    if (catalogues)
        return catalogues;
    catalogues = {};
    available = [];
    let files = [];
    try { files = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json')); }
    catch (e) { log.warn('i18n', 'no locales directory', e); }
    for (const file of files) {
        const id = path.basename(file, '.json');
        try {
            const data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
            catalogues[id] = data.strings || {};
            available.push({
                id,
                name: data.name || id,
                // Honest about how far a translation goes, so nobody switches
                // into a half-translated UI without being told.
                coverage: data.coverage || 'partial',
            });
        }
        catch (e) {
            log.warn('i18n', `could not read locale ${id}`, e);
        }
    }
    if (!catalogues[FALLBACK])
        catalogues[FALLBACK] = {};
    return catalogues;
}

/** Best match for a BCP-47 tag among the catalogues we actually have. */
function resolve(tag) {
    loadCatalogues();
    const want = String(tag || '').toLowerCase();
    if (catalogues[want])
        return want;
    const base = want.split('-')[0];
    if (catalogues[base])
        return base;
    return FALLBACK;
}

function init(p) {
    persistence = p;
    loadCatalogues();
    let chosen = 'system';
    try { chosen = p?.get('language') || 'system'; }
    catch (e) { log.debug('i18n', 'language setting unreadable', e); }
    let tag = chosen;
    if (chosen === 'system') {
        try { tag = require('electron').app.getLocale(); }
        catch { tag = FALLBACK; }
    }
    current = resolve(tag);
    log.info('i18n', `interface language: ${current} (setting: ${chosen})`);
    return current;
}

function setLanguage(id) {
    try { persistence?.set('language', id || 'system'); }
    catch (e) { log.warn('i18n', 'could not save the language setting', e); }
    return init(persistence);
}

/** Translate. `vars` fills {name} placeholders. */
function t(key, vars) {
    loadCatalogues();
    const value = catalogues[current]?.[key] ?? catalogues[FALLBACK]?.[key] ?? key;
    if (!vars)
        return value;
    return String(value).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** The whole catalogue for the renderer (it resolves strings synchronously). */
function catalogue() {
    loadCatalogues();
    return { ...catalogues[FALLBACK], ...(catalogues[current] || {}) };
}

function locales() {
    loadCatalogues();
    return available.slice().sort((a, b) => a.id === FALLBACK ? -1 : a.name.localeCompare(b.name));
}

const currentLocale = () => current;

module.exports = { init, t, setLanguage, catalogue, locales, currentLocale, resolve, FALLBACK };
