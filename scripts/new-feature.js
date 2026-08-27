#!/usr/bin/env node
'use strict';
/**
 * Scaffold a new feature — `node scripts/new-feature.js <name> [--panel]`.
 *
 * Writes the boilerplate the same shape every feature already uses, so a new
 * one starts from the house pattern rather than a copy-paste of whatever file
 * you happened to open:
 *
 *   features/<name>.js   main-process logic (a small module with an init hook)
 *   ipc/<name>.js        register(ipcMain, deps) — auto-loaded, no main.js edit
 *   preload snippet      printed for you to paste into preload/preload.js
 *
 * With --panel it also writes a renderer/<Name>/ overlay (html + css + a
 * sandboxed preload) and prints the one line to add to features/overlay-
 * registry.js so the view raises and resolves correctly.
 *
 * Nothing here touches main.js: ipc/index.js loads every ipc/*.js that exports
 * register(), so the handlers are live as soon as the file exists.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const [, , rawName, ...flags] = process.argv;
const PANEL = flags.includes('--panel');

if (!rawName || !/^[a-z][a-z0-9-]*$/.test(rawName)) {
    console.error('usage: node scripts/new-feature.js <kebab-name> [--panel]');
    console.error('  name must be lower-kebab-case, e.g. reading-list');
    process.exit(1);
}

const kebab = rawName;
const camel = kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const Pascal = camel[0].toUpperCase() + camel.slice(1);

function write(rel, contents) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) {
        console.error(`  SKIP ${rel} (already exists)`);
        return false;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents);
    console.log(`  wrote ${rel}`);
    return true;
}

// ── features/<name>.js ───────────────────────────────────────────────────────
write(`features/${kebab}.js`, `'use strict';
/**
 * ${Pascal} — main-process logic.
 *
 * Keep the browser-facing surface here; ipc/${kebab}.js is only the wiring that
 * lets the renderer call in. Log errors through features/log rather than
 * swallowing them (CLAUDE.md invariant 11).
 */
const log = require('./log');

// Persisted settings must be declared in features/persistence.js DEFAULTS, or
// Persistence.set() drops them silently (invariant 1).

function doSomething(input) {
    // TODO: real logic.
    log.debug('${kebab}', 'doSomething', input);
    return { ok: true, echo: input };
}

module.exports = { doSomething };
`);

// ── ipc/<name>.js ────────────────────────────────────────────────────────────
write(`ipc/${kebab}.js`, `'use strict';
/**
 * IPC — ${kebab}. Auto-loaded by ipc/index.js; no edit to main.js.
 *
 * \`deps\` carries { wm, ... } — the same object every ipc module gets. Resolve
 * the calling window with wm.getWindowByWebContents(_e.sender).
 */
const log = require('../features/log');
const ${camel} = require('../features/${kebab}');

function register(ipcMain, { wm }) {
    ipcMain.handle('${kebab}:do', (_e, input) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return null;
        try { return ${camel}.doSomething(input); }
        catch (e) { log.warn('${kebab}', 'do failed', e); return null; }
    });
}

module.exports = { register };
`);

// ── preload snippet ──────────────────────────────────────────────────────────
const bridge = `
// ── ${Pascal} ──
exposeInternal('${camel}', {
    do: (input) => ipcRenderer.invoke('${kebab}:do', input),
});`;

// ── optional overlay panel ───────────────────────────────────────────────────
if (PANEL) {
    write(`renderer/${Pascal}/index.html`, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>${Pascal}</title>
  <link rel="stylesheet" href="../styles/ui.css">
  <link rel="stylesheet" href="../styles/surface.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="surface-card" id="panel">
    <div class="surface-head"><span data-i18n="${camel}.title">${Pascal}</span></div>
    <div class="surface-body" id="body"></div>
  </div>
  <script src="panel.js"></script>
</body>
</html>
`);
    write(`renderer/${Pascal}/styles.css`, `@layer components {
  /* Specific to ${Pascal} only — the shared panel anatomy is in surface.css. */
  #panel { min-width: 260px; }
}
`);
    write(`renderer/${Pascal}/panel.js`, `"use strict";
(() => {
    const api = window.${camel};
    if (!api) return;
    // TODO: build the panel. Overlay preloads are sandboxed — this file runs in
    // the panel's own page and talks to main only through \`api\`.
})();
`);
    write(`preload/${kebab}-preload.js`, `const { contextBridge, ipcRenderer } = require('electron');
// Overlay preloads are SANDBOXED: require('electron') and nothing else — no
// relative modules, no node built-ins (CLAUDE.md invariant 13).
contextBridge.exposeInMainWorld('${camel}', {
    do: (input) => ipcRenderer.invoke('${kebab}:do', input),
});
`);
}

// ── what's left, printed ─────────────────────────────────────────────────────
console.log('\nAlmost there — two manual steps (both one-liners):\n');
console.log('1. Add the bridge to preload/preload.js (near the other exposeInternal calls):');
console.log(bridge.split('\n').map(l => '     ' + l).join('\n'));
if (PANEL) {
    console.log(`\n2. If the panel is a WebContentsView overlay, add its view to`);
    console.log(`   features/overlay-registry.js so it raises and resolves (invariant 4):`);
    console.log(`     wd.${camel}Panel,   // in the wd.* list inside overlayViewsOf()`);
    console.log(`\n   Create the view with preload preload/${kebab}-preload.js and`);
    console.log(`   loadFile(resolveAppFile('renderer/${Pascal}/index.html')).`);
} else {
    console.log('\n2. Call it from the renderer: window.' + camel + '.do(...)');
}
console.log('\nThe ipc handlers are already live (ipc/index.js auto-loads them).');
console.log('Verify with:  npm run test:unit  &&  npm run smoke\n');
