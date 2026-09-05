'use strict';
/**
 * Build identity — so it is always obvious WHICH build is running.
 *
 * The recurring "I can't see my changes" trap is running one build while a newer
 * one was produced elsewhere (a stale `npm start`, or the packaged app vs the
 * source). This surfaces a stamp everywhere it helps: logged once at startup (so
 * the `npm start` / `npm run dev` terminal shows it), and in Settings → About.
 *
 *   - packaged: reads build-stamp.json, written by scripts/dist.js at pack time.
 *   - dev:      derives the short commit (+ "+" if the tree is dirty) from git.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let _cache = null;

function get() {
    if (_cache)
        return _cache;
    const info = {
        version: '',
        commit: 'unknown',
        builtAt: '',
        mode: app.isPackaged ? 'packaged' : 'dev',
    };
    try { info.version = app.getVersion(); }
    catch (e) { /* not ready */ }
    // Packaged builds carry a stamp written at pack time.
    try {
        const stampPath = path.join(app.getAppPath(), 'build-stamp.json');
        if (fs.existsSync(stampPath)) {
            const s = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
            if (s.commit) info.commit = String(s.commit);
            if (s.builtAt) info.builtAt = String(s.builtAt);
        }
    }
    catch (e) { /* no stamp */ }
    // Dev: ask git directly (the packed build has no .git).
    if (info.commit === 'unknown' && !app.isPackaged) {
        try {
            const { execSync } = require('child_process');
            const cwd = app.getAppPath();
            const rev = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            let dirty = '';
            try { if (execSync('git status --porcelain', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) dirty = '+'; }
            catch (e) { /* ignore */ }
            info.commit = rev + dirty;
            if (!info.builtAt) info.builtAt = 'dev';
        }
        catch (e) { /* not a git checkout */ }
    }
    _cache = info;
    return info;
}

// One-line human label, e.g. "Northstar 1.0.0 (e3fa1cb+) dev [dev]".
function label() {
    const i = get();
    return `Northstar ${i.version} (${i.commit})${i.builtAt ? ' ' + i.builtAt : ''} [${i.mode}]`;
}

module.exports = { get, label };
