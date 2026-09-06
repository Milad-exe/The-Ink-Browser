/**
 * Watch-mode development loop — `npm run dev`.
 *
 * There's no build step anymore (plain JS runs directly), so this just:
 *   - launches Electron with --dev (main.js's --dev block reloads panels and
 *     internal pages, and hot-swaps the chrome's STYLESHEETS, when files under
 *     renderer/ change)
 *   - restarts Electron for anything that cannot be applied in place: all
 *     MAIN-process code (features/ ipc/ preload/ main.js app-paths.js), and
 *     the chrome window's own scripts and markup.
 *
 * WHY THE CHROME IS SPECIAL. main.js's --dev block deliberately does not
 * reload renderer/Browser/index.html: the tab strip is built entirely from
 * pushed IPC events and there is no resync, so a reload comes back with an
 * empty sidebar. It cache-busts the stylesheets instead. That is correct for
 * CSS and silently does nothing for everything else — so an edit to
 * renderer.js, to the chrome's markup, or to renderer/lib/*.js reflected
 * NOWHERE, because renderer/ was not watched here either. Those get a restart.
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const log = (msg) => console.log(`[dev] ${msg}`);

// Spawn the electron BINARY directly, not `npx electron` through a shell. With
// shell:true on Windows the child is cmd.exe and kill() only terminates that
// wrapper, orphaning the real electron.exe — which keeps holding the profile's
// single-instance lock, so every restart leaked a process and the next launch
// lost the lock. `require('electron')` from Node returns the executable path, so
// kill() now hits electron.exe itself (a graceful quit that also ends its
// helpers and releases the lock).
const ELECTRON = require('electron');

// The dev build runs on your REAL profile (your tabs/history/settings), so what
// you see matches the installed app. That profile has a single-instance lock, so
// the INSTALLED app must be closed first — main.js's --dev lock-failure branch
// prints a clear message if it is still open, instead of silently quitting.

let electron = null;
let restarting = false;

let startedAt = 0;
let lockRetries = 0;
function start() {
    startedAt = Date.now();
    electron = spawn(ELECTRON, ['.', '--dev'], { cwd: ROOT, stdio: 'inherit' });
    electron.on('exit', (code) => {
        if (restarting) {
            restarting = false;
            // Wait for the OLD instance to release the single-instance lock before
            // the new one asks for it — otherwise the restart loses the race, the
            // fresh instance sees the lock held and quits, and dev dies.
            setTimeout(start, 700);
            return;
        }
        // A brand-new instance that exits almost immediately did not lose to a
        // watcher restart — it lost the single-instance lock to a still-dying
        // sibling. Retry a few times instead of tearing the whole dev loop down
        // (this is what made `npm run dev` "just stop" on a fast re-save).
        if (Date.now() - startedAt < 2500 && lockRetries < 5) {
            lockRetries++;
            log(`electron exited early (lock contention) — retrying (${lockRetries}/5)`);
            setTimeout(start, 900);
            return;
        }
        if (lockRetries >= 5)
            log('gave up: another Northstar is holding the profile lock. Close the installed app, then re-run `npm run dev`.');
        else
            log(`electron exited (${code})`);
        process.exit(code ?? 0);
    });
    electron.on('spawn', () => { setTimeout(() => { if (electron && electron.exitCode === null) lockRetries = 0; }, 3000); });
    log('electron started (real profile — close the installed app if a window does not appear)');
}

let timer = null;
function scheduleRestart(reason) {
    clearTimeout(timer);
    timer = setTimeout(() => {
        log(`restarting (${reason})`);
        restarting = true;
        /* SIGTERM is a graceful quit now (main.js routes signals through
           app.quit()), so the session snapshot is written before we go. Give it
           a moment, then insist — a hung renderer must not wedge the loop. */
        try { electron.kill('SIGTERM'); } catch {}
        const child = electron;
        setTimeout(() => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch {} }, 4000);
    }, 300);
}

/* Only restart on a REAL edit. On Windows fs.watch fires 'change' for file-access
   and attribute touches too — and electron reads all its preload/feature files at
   launch — so a bare event count restarted forever ("app keeps closing and
   reopening"). Gate on two things: a settle window right after a (re)start, and
   the file's mtime actually being newer than when this instance started. */
const SETTLE_MS = 1800;
function maybeRestart(reason, fullPath) {
    if (Date.now() - startedAt < SETTLE_MS)
        return; // startup read-noise, not an edit
    let mtime = 0;
    try { mtime = fs.statSync(fullPath).mtimeMs; }
    catch { return; } // vanished/temp file — ignore
    if (mtime < startedAt)
        return; // touched but not modified since we launched → spurious
    scheduleRestart(reason);
}

// Main-process code — none of it can hot-reload.
for (const dir of ['features', 'ipc', 'preload']) {
    try { fs.watch(path.join(ROOT, dir), { recursive: true }, (_e, rel) => rel && maybeRestart(`${dir}/${rel}`, path.join(ROOT, dir, rel))); } catch {}
}
try { fs.watch(ROOT, (_e, rel) => { if (rel === 'main.js' || rel === 'app-paths.js') maybeRestart(rel, path.join(ROOT, rel)); }); } catch {}

/* The files the CHROME window loads (see renderer/Browser/index.html's script
   tags). Everything else under renderer/ — panels, internal pages — is reloaded
   in place by main.js's --dev block, which is faster and keeps the app running,
   so only these need the heavier restart. CSS is excluded at the callsite: it
   hot-swaps live for every page including the chrome. */
const CHROME_SOURCES = /^(renderer\.js|lib\/.+\.js|Browser\/.+\.(js|html))$/;
try {
    fs.watch(path.join(ROOT, 'renderer'), { recursive: true }, (_e, rel) => {
        if (!rel)
            return;
        const p = rel.split(path.sep).join('/');
        if (p.endsWith('.css') || !CHROME_SOURCES.test(p))
            return;
        maybeRestart(`renderer/${p}`, path.join(ROOT, 'renderer', rel));
    });
}
catch {}

// Ctrl-C: let Electron finish its own quit (and save the session) before we go.
process.on('SIGINT', () => {
    try { electron?.kill('SIGTERM'); } catch {}
    setTimeout(() => process.exit(0), 1500);
});
start();
