/**
 * Northstar — logging
 *
 * The codebase leans on `try { … } catch { }` to keep one broken feature from
 * taking the window down. That is the right instinct, but it also means a
 * half-working feature leaves no trace at all. This gives those handlers
 * somewhere to put the error: a rotating file under `userData/logs` plus the
 * console, so a bug report can be more than "it just didn't work".
 *
 * Never log page content, URLs' query strings, credentials or cookies — the log
 * is a diagnostic aid, not a browsing record. Callers pass a short scope and a
 * message; the Error's stack is included, its message is not trusted to be
 * short.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024; // rotate at half a megabyte
const KEEP = 2; // current + one previous
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let logDir = null;
let logPath = null;
let stream = null;
let minLevel = LEVELS.info;
let failed = false; // a broken log must never break the browser

function init() {
    if (logDir || failed)
        return;
    try {
        const { app } = require('electron');
        logDir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        logPath = path.join(logDir, 'northstar.log');
        if (process.env.NORTHSTAR_LOG_LEVEL && LEVELS[process.env.NORTHSTAR_LOG_LEVEL])
            minLevel = LEVELS[process.env.NORTHSTAR_LOG_LEVEL];
    }
    catch {
        failed = true;
    }
}

function rotate() {
    try {
        const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
        if (size < MAX_BYTES)
            return;
        if (stream) {
            stream.end();
            stream = null;
        }
        for (let i = KEEP - 1; i >= 1; i--) {
            const from = i === 1 ? logPath : `${logPath}.${i - 1}`;
            const to = `${logPath}.${i}`;
            if (fs.existsSync(from))
                fs.renameSync(from, to);
        }
    }
    catch { /* rotation is best-effort */ }
}

function write(level, scope, message, err) {
    init();
    if (failed || LEVELS[level] < minLevel)
        return;
    const stamp = new Date().toISOString();
    let line = `${stamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
    if (err) {
        const detail = err instanceof Error ? (err.stack || err.message) : String(err);
        line += `\n    ${String(detail).split('\n').join('\n    ')}`;
    }
    if (level === 'error' || level === 'warn')
        console[level === 'error' ? 'error' : 'warn'](line);
    else if (process.env.NORTHSTAR_LOG_LEVEL)
        console.log(line);
    try {
        rotate();
        if (!stream)
            stream = fs.createWriteStream(logPath, { flags: 'a' });
        stream.write(line + '\n');
    }
    catch {
        failed = true; // disk full / read-only profile — stop trying
    }
}

const log = {
    debug: (scope, message, err) => write('debug', scope, message, err),
    info: (scope, message, err) => write('info', scope, message, err),
    warn: (scope, message, err) => write('warn', scope, message, err),
    error: (scope, message, err) => write('error', scope, message, err),
    /** Path of the current log file, for Settings → "Open log". */
    path() {
        init();
        return logPath;
    },
    /** Last `n` lines, for the About page's diagnostics box. */
    tail(n = 200) {
        init();
        try {
            const text = fs.readFileSync(logPath, 'utf-8');
            const lines = text.split('\n');
            return lines.slice(Math.max(0, lines.length - n)).join('\n');
        }
        catch {
            return '';
        }
    },
};

module.exports = log;
