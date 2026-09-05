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

// Run against a SEPARATE profile from the installed app. Both share the appId
// com.northstar.browser, so without this the dev launch hits the installed app's
// single-instance lock (main.js), forwards its argv to it and quits — the dev
// build never actually runs, and you keep looking at the installed app ("I ran
// npm run dev but nothing changed"). Its own profile locks independently.
const DEV_PROFILE = path.join(ROOT, '.dev-profile');

let electron = null;
let restarting = false;

function start() {
    electron = spawn('npx', ['electron', '.', '--dev', `--user-data-dir=${DEV_PROFILE}`], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    electron.on('exit', (code) => {
        if (restarting) { restarting = false; start(); return; }
        log(`electron exited (${code})`);
        process.exit(code ?? 0);
    });
    log(`electron started (profile: ${DEV_PROFILE})`);
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

// Main-process code — none of it can hot-reload.
for (const dir of ['features', 'ipc', 'preload']) {
    try { fs.watch(path.join(ROOT, dir), { recursive: true }, (_e, rel) => rel && scheduleRestart(`${dir}/${rel}`)); } catch {}
}
try { fs.watch(ROOT, (_e, rel) => { if (rel === 'main.js' || rel === 'app-paths.js') scheduleRestart(rel); }); } catch {}

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
        scheduleRestart(`renderer/${p}`);
    });
}
catch {}

// Ctrl-C: let Electron finish its own quit (and save the session) before we go.
process.on('SIGINT', () => {
    try { electron?.kill('SIGTERM'); } catch {}
    setTimeout(() => process.exit(0), 1500);
});
start();
