'use strict';
/**
 * Native messaging hosts — chrome.runtime.connectNative / sendNativeMessage.
 *
 * Electron implements neither, which is why desktop password managers
 * (1Password, KeePassXC, Bitwarden) can't reach their companion app: the
 * extension works standalone but "unlock from the desktop app" needs this.
 *
 * The protocol is small and stable: find a JSON manifest by host name in the
 * browser's well-known directories, spawn the binary it points at, then
 * exchange UTF-8 JSON framed by a 4-byte native-endian length prefix over
 * stdin/stdout.
 *
 * We read CHROME's manifest directories as well as our own, because that is
 * where every existing host is already installed — an installer for this
 * browser does not exist, so requiring one would mean no hosts at all.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app } = require('electron');

// Chrome's documented search paths, plus ours. User dirs beat system dirs.
function searchDirs() {
    const home = os.homedir();
    const dirs = [];
    if (process.platform === 'darwin') {
        const appSup = path.join(home, 'Library', 'Application Support');
        dirs.push(
            path.join(appSup, 'Northstar', 'NativeMessagingHosts'),
            path.join(appSup, 'Google', 'Chrome', 'NativeMessagingHosts'),
            path.join(appSup, 'Chromium', 'NativeMessagingHosts'),
            path.join(appSup, 'Microsoft Edge', 'NativeMessagingHosts'),
            path.join(appSup, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
            path.join(appSup, 'Vivaldi', 'NativeMessagingHosts'),
            '/Library/Google/Chrome/NativeMessagingHosts',
            '/Library/Application Support/Chromium/NativeMessagingHosts',
            '/Library/Application Support/Microsoft/Edge/NativeMessagingHosts',
        );
    }
    else if (process.platform === 'linux') {
        const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
        dirs.push(
            path.join(cfg, 'northstar', 'NativeMessagingHosts'),
            path.join(cfg, 'google-chrome', 'NativeMessagingHosts'),
            path.join(cfg, 'chromium', 'NativeMessagingHosts'),
            '/etc/opt/chrome/native-messaging-hosts',
            '/etc/chromium/native-messaging-hosts',
        );
    }
    try { dirs.unshift(path.join(app.getPath('userData'), 'NativeMessagingHosts')); }
    catch { }
    return dirs;
}

/** Locate and validate a host manifest for `name`, for a given extension id. */
function findHost(name, extensionId) {
    if (!/^[a-z0-9_.]+$/i.test(name || ''))
        return { error: 'invalid host name' };
    for (const dir of searchDirs()) {
        const file = path.join(dir, `${name}.json`);
        let manifest;
        try {
            if (!fs.existsSync(file))
                continue;
            manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
        catch {
            continue;
        }
        if (manifest?.type !== 'stdio' || !manifest.path)
            continue;
        // Honour allowed_origins — a host declares which extensions may talk to
        // it, and ignoring that would let any extension drive any host.
        const origins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
        const origin = `chrome-extension://${extensionId}/`;
        if (extensionId && origins.length && !origins.includes(origin))
            return { error: `host ${name} does not allow ${origin}` };
        const bin = path.isAbsolute(manifest.path) ? manifest.path : path.join(dir, manifest.path);
        if (!fs.existsSync(bin))
            return { error: `host binary missing: ${bin}` };
        return { manifest, bin };
    }
    return { error: `no native messaging host named ${name}` };
}

let _nextPort = 1;
const ports = new Map(); // portId → { child, onMessage, onDisconnect, buffer }

/**
 * Spawn a host and stream messages. `handlers.onMessage(msg)` fires per decoded
 * message; `handlers.onDisconnect(error)` once, when the host goes away.
 */
function connect(name, extensionId, handlers = {}) {
    const found = findHost(name, extensionId);
    if (found.error)
        throw new Error(found.error);
    const child = spawn(found.bin, [`chrome-extension://${extensionId}/`], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const id = _nextPort++;
    const rec = { child, buffer: Buffer.alloc(0), ...handlers };
    ports.set(id, rec);

    child.stdout.on('data', (chunk) => {
        rec.buffer = Buffer.concat([rec.buffer, chunk]);
        // 4-byte length prefix, then that many bytes of UTF-8 JSON.
        for (;;) {
            if (rec.buffer.length < 4)
                return;
            const len = rec.buffer.readUInt32LE(0);
            if (len > 64 * 1024 * 1024) { // Chrome's cap; a runaway host is a bug
                disconnect(id, 'message too large');
                return;
            }
            if (rec.buffer.length < 4 + len)
                return;
            const body = rec.buffer.subarray(4, 4 + len).toString('utf-8');
            rec.buffer = rec.buffer.subarray(4 + len);
            try { rec.onMessage?.(JSON.parse(body)); }
            catch { /* a host that emits non-JSON is not ours to fix */ }
        }
    });
    child.on('error', (err) => disconnect(id, err.message));
    child.on('exit', () => disconnect(id, 'host exited'));
    // Hosts use stderr for their own logging; surface it without killing the port.
    child.stderr.on('data', (d) => console.warn(`[native-messaging] ${name}:`, String(d).trim().slice(0, 300)));
    return id;
}

function post(portId, message) {
    const rec = ports.get(portId);
    if (!rec)
        return false;
    const body = Buffer.from(JSON.stringify(message), 'utf-8');
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    try { rec.child.stdin.write(Buffer.concat([head, body])); }
    catch { return false; }
    return true;
}

function disconnect(portId, error) {
    const rec = ports.get(portId);
    if (!rec)
        return;
    ports.delete(portId);
    try { rec.child.kill(); }
    catch { }
    try { rec.onDisconnect?.(error || null); }
    catch { }
}

/** One-shot request/response, as chrome.runtime.sendNativeMessage does it. */
function sendOnce(name, extensionId, message, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let id = null;
        const done = (fn, v) => { if (!settled) { settled = true; if (id) disconnect(id); fn(v); } };
        try {
            id = connect(name, extensionId, {
                onMessage: (msg) => done(resolve, msg),
                onDisconnect: (err) => done(reject, new Error(err || 'host disconnected')),
            });
        }
        catch (e) {
            return reject(e);
        }
        post(id, message);
        setTimeout(() => done(reject, new Error('native host timed out')), timeoutMs);
    });
}

module.exports = { findHost, connect, post, disconnect, sendOnce, searchDirs };
