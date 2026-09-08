'use strict';
/**
 * Internal pages addressable via the northstar:// scheme (Settings, History,
 * Bookmarks) and the helpers that translate between a northstar:// URL, the
 * file:// URL it loads, and the short "token" stored/shown for the tab.
 *
 * Lives in its own module because both features/tabs.js and its mixin
 * features/tabs/listeners.js need it: putting it in tabs.js and reaching for it
 * from the mixin threw `internalTokenFor is not defined` on every internal-page
 * navigation. A shared leaf module avoids that and the circular require that
 * requiring tabs.js back would create.
 */
const log = require('../log');

// Internal pages addressable via the northstar:// scheme, e.g. northstar://settings
// or northstar://settings/appearance. Shown in the omnibox and typeable to navigate.
const INTERNAL_PAGES = {
    settings: { file: 'renderer/Settings/index.html', title: 'Settings' },
    history: { file: 'renderer/History/index.html', title: 'History' },
    bookmarks: { file: 'renderer/Bookmarks/index.html', title: 'Bookmarks' },
};
const SETTINGS_SECTIONS = ['general', 'appearance', 'focus', 'privacy', 'passwords', 'extensions', 'data', 'about'];

// Parse a northstar:// URL → { type, section } (section only for settings), or null.
function parseNorthstarUrl(raw) {
    const m = /^northstar:\/\/([a-z]+)(?:\/([a-z]+))?\/?$/i.exec((raw || '').trim());
    if (!m)
        return null;
    const type = m[1].toLowerCase();
    if (!INTERNAL_PAGES[type])
        return null;
    let section = m[2] ? m[2].toLowerCase() : null;
    if (!(type === 'settings' && section && SETTINGS_SECTIONS.includes(section)))
        section = null;
    return { type, section };
}

// Parse a bare stored TOKEN → { type, section }, or null. This is the form kept
// in tabUrls and persisted to the session ('history', 'settings/appearance'),
// as opposed to the typed northstar:// URL. Restore reads tokens back, so every
// place that loads a tab must recognise them or it tries to fetch e.g. "history"
// as a web address and gets a 404.
function parseInternalToken(raw) {
    const m = /^([a-z]+)(?:\/([a-z]+))?$/i.exec((raw || '').trim());
    if (!m)
        return null;
    const type = m[1].toLowerCase();
    if (!INTERNAL_PAGES[type])
        return null;
    let section = m[2] ? m[2].toLowerCase() : null;
    if (!(type === 'settings' && section && SETTINGS_SECTIONS.includes(section)))
        section = null;
    return { type, section };
}

// The stored/display "url token" for an internal tab: 'settings', 'settings/appearance', …
function internalTokenFor(fileUrl) {
    let type = null;
    if (fileUrl.includes('/Settings/index.html'))
        type = 'settings';
    else if (fileUrl.includes('/Bookmarks/index.html'))
        type = 'bookmarks';
    else if (fileUrl.includes('/History/index.html'))
        type = 'history';
    if (!type)
        return null;
    let section = '';
    if (type === 'settings') {
        try {
            section = new URL(fileUrl).hash.replace(/^#/, '').toLowerCase();
        }
        catch (e) { log.debug('tabs', 'if', e); }
        // 'general' is the default section — it stays the bare northstar://settings.
        if (!SETTINGS_SECTIONS.includes(section) || section === 'general')
            section = '';
    }
    return section ? `${type}/${section}` : type;
}

module.exports = { INTERNAL_PAGES, SETTINGS_SECTIONS, parseNorthstarUrl, parseInternalToken, internalTokenFor };
