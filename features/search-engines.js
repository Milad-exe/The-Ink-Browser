/**
 * Northstar — search engines
 *
 * Was: three hardcoded engines and no way to add a fourth, so anyone whose
 * search lives somewhere else (Kagi, Brave, a company wiki, an internal Jira)
 * had to leave the omnibox behind entirely.
 *
 * Now the built-ins are just the seeded rows of a list the user can extend, and
 * every engine can carry a KEYWORD: type `w electron` and the query goes to
 * Wikipedia while `electron` alone still goes to the default engine. That
 * keyword form is why this module owns query resolution rather than the omnibox
 * — the same rule has to apply to the address bar, the new-tab field and the
 * command palette.
 *
 * A `%s` placeholder in the URL is the de-facto standard (OpenSearch,
 * Chrome, Firefox), so that is what custom engines use.
 */
'use strict';
const log = require('./log');

const BUILT_INS = [
    { id: 'google', name: 'Google', keyword: 'g', url: 'https://www.google.com/search?q=%s', builtIn: true },
    { id: 'duckduckgo', name: 'DuckDuckGo', keyword: 'd', url: 'https://duckduckgo.com/?q=%s', builtIn: true },
    { id: 'bing', name: 'Bing', keyword: 'b', url: 'https://www.bing.com/search?q=%s', builtIn: true },
];

let persistence = null;
let custom = [];

function init(p) {
    persistence = p;
    try {
        const stored = p.get('customEngines');
        custom = Array.isArray(stored) ? stored.filter(isUsable) : [];
    }
    catch (e) {
        log.warn('search', 'could not read custom engines', e);
        custom = [];
    }
}

function isUsable(engine) {
    return !!(engine && typeof engine.url === 'string' && engine.url.includes('%s') && engine.name);
}

function save() {
    try { persistence?.set('customEngines', custom); }
    catch (e) { log.warn('search', 'could not save custom engines', e); }
}

function all() {
    return [...BUILT_INS, ...custom];
}

function byId(id) {
    return all().find(e => e.id === id) || BUILT_INS[0];
}

/** Add or update a custom engine. Returns the stored record. */
function upsert({ id, name, keyword, url, suggest }) {
    if (!isUsable({ name, url }))
        throw new Error('A search engine needs a name and a URL containing %s');
    const clean = {
        id: id && !BUILT_INS.some(b => b.id === id) ? id : `e${Date.now().toString(36)}`,
        name: String(name).slice(0, 40),
        keyword: String(keyword || '').trim().toLowerCase().slice(0, 12).replace(/\s+/g, ''),
        url: String(url),
        suggest: typeof suggest === 'string' ? suggest : '',
    };
    const i = custom.findIndex(e => e.id === clean.id);
    if (i === -1)
        custom.push(clean);
    else
        custom[i] = clean;
    save();
    return clean;
}

function remove(id) {
    const before = custom.length;
    custom = custom.filter(e => e.id !== id);
    if (custom.length !== before)
        save();
    return custom.length !== before;
}

function buildUrl(engine, query) {
    return engine.url.replace(/%s/g, encodeURIComponent(query));
}

/**
 * Turn typed text into a search URL.
 *
 * `input` is assumed to already be known NOT to be a URL (the omnibox decides
 * that). Returns { url, engine, query, viaKeyword }.
 */
function resolve(input, defaultEngineId) {
    const text = String(input || '').trim();
    const fallback = byId(defaultEngineId);
    if (!text)
        return { url: buildUrl(fallback, ''), engine: fallback, query: '', viaKeyword: false };
    // `<keyword> <rest>` — only when there IS a rest, so typing a bare "g"
    // searches for "g" rather than opening an empty Google.
    const space = text.indexOf(' ');
    if (space > 0) {
        const head = text.slice(0, space).toLowerCase();
        const rest = text.slice(space + 1).trim();
        if (rest) {
            const match = all().find(e => e.keyword && e.keyword === head);
            if (match)
                return { url: buildUrl(match, rest), engine: match, query: rest, viaKeyword: true };
        }
    }
    return { url: buildUrl(fallback, text), engine: fallback, query: text, viaKeyword: false };
}

/** The engine a keyword prefix would use, for the omnibox's inline hint. */
function keywordMatch(input) {
    const text = String(input || '');
    const space = text.indexOf(' ');
    if (space <= 0)
        return null;
    const head = text.slice(0, space).toLowerCase();
    if (!text.slice(space + 1).trim())
        return null;
    return all().find(e => e.keyword && e.keyword === head) || null;
}

module.exports = { init, all, byId, upsert, remove, resolve, keywordMatch, buildUrl, BUILT_INS };
