'use strict';
/**
 * IPC sender validation.
 *
 * Privileged IPC handlers (password reveal, settings mutation, extension
 * management, data export, …) must only ever answer the browser's OWN trusted
 * surfaces — the chrome window and the internal `file://` pages it ships. Every
 * one of those is served from a `file://` URL under the app root
 * (`app.getAppPath()`); web content is http(s) or chrome-extension://, and a
 * malicious HTML file a user opens from disk is `file://` but NOT under the app
 * root. So "trusted internal" is: a `file://` URL whose real path sits inside the
 * app directory.
 *
 * This is defence-in-depth behind the preload gates: even if a preload wrongly
 * exposes a bridge to some context, the handler still refuses to act for it.
 */
const path = require('path');
let cachedRoot = null;

function appRoot() {
    if (cachedRoot)
        return cachedRoot;
    try {
        const { app } = require('electron');
        // Real path so a symlinked dev checkout still matches.
        cachedRoot = path.normalize(app.getAppPath());
    }
    catch {
        cachedRoot = null;
    }
    return cachedRoot;
}

/** True when `url` is a file:// page shipped inside the app (chrome / internal). */
function isTrustedInternalUrl(url) {
    if (!url || typeof url !== 'string')
        return false;
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return false;
    }
    if (parsed.protocol !== 'file:')
        return false;
    const root = appRoot();
    if (!root)
        return false;
    let filePath;
    try {
        filePath = path.normalize(decodeURIComponent(parsed.pathname));
    }
    catch {
        return false;
    }
    // On Windows a file URL path is "/C:/…"; strip the leading slash before a drive.
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath))
        filePath = filePath.slice(1);
    const rel = path.relative(root, filePath);
    // Inside the root, and not escaping it via "..".
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** True when an IPC sender webContents is one of the app's trusted surfaces. */
function isTrustedInternalSender(sender) {
    try {
        return isTrustedInternalUrl(sender?.getURL?.());
    }
    catch {
        return false;
    }
}

module.exports = { isTrustedInternalUrl, isTrustedInternalSender };
