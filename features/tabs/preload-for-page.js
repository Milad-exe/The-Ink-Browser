/**
 * Which preload a page gets.
 *
 * The Settings page needs privileged APIs (passwords, extension management)
 * that must NOT be exposed to ordinary web pages, so it uses a dedicated
 * preload. Every other page (web content, History, Bookmarks, New Tab) uses the
 * general one.
 *
 * Its own module because both features/tabs.js and the glance mixin choose a
 * preload at view-creation time, and neither should require the other.
 */
'use strict';
const path = require('path');

module.exports = function preloadForPage(kind) {
    const base = path.join(__dirname, '../../preload');
    if (kind === 'settings' || (typeof kind === 'string' && kind.includes('/Settings/')))
        return path.join(base, 'settings-preload.js');
    return path.join(base, 'preload.js');
};
