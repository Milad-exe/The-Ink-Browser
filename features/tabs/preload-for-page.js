/**
 * Which preload a page gets.
 *
 * The Settings page needs privileged APIs (passwords, extension management)
 * that must NOT be exposed to ordinary web pages, so it uses a dedicated
 * preload. Every other page (web content, History, Bookmarks, New Tab) uses the
 * general one.
 *
 * SECURITY: the privileged preload is selected ONLY for the internal Settings
 * page — identified by its page-type token ('settings') or by a genuine file://
 * path that resolves inside the app's own renderer/Settings directory. It is
 * NEVER selected from an arbitrary URL: a substring match on '/Settings/' used
 * to hand the privileged preload to any remote page whose path contained that
 * segment (e.g. https://evil.com/Settings/), reachable via Glance previews and
 * session restore — a plaintext-password exfiltration vector.
 *
 * Its own module because both features/tabs.js and the glance mixin choose a
 * preload at view-creation time, and neither should require the other.
 */
'use strict';
const path = require('path');

const base = path.join(__dirname, '../../preload');
// The one file:// location the Settings page is ever served from.
const settingsDir = path.normalize(path.join(__dirname, '../../renderer/Settings'));

function isInternalSettingsFile(kind) {
    if (typeof kind !== 'string')
        return false;
    let filePath = null;
    if (kind.startsWith('file:')) {
        try { filePath = decodeURIComponent(new URL(kind).pathname); }
        catch { return false; }
    }
    else if (path.isAbsolute(kind)) {
        filePath = kind;
    }
    else {
        return false;
    }
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath))
        filePath = filePath.slice(1);
    const rel = path.relative(settingsDir, path.normalize(filePath));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

module.exports = function preloadForPage(kind) {
    // 'settings' is the internal page-type token (createTabWithPage); the file
    // form is the resolved renderer/Settings path. Anything else — every http(s)
    // URL — gets the general, unprivileged preload.
    if (kind === 'settings' || isInternalSettingsFile(kind))
        return path.join(base, 'settings-preload.js');
    return path.join(base, 'preload.js');
};
