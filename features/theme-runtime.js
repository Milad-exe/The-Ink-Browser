/**
 * Making a theme actually appear, everywhere, at once.
 *
 * The original four themes need none of this: their tokens are in the
 * stylesheets every surface already links, so setting data-theme on the root is
 * the whole mechanism. A derived theme (a new ground, or one the user made) has
 * no CSS anywhere, and the app has ~12 surfaces — the chrome, the internal
 * pages, and every overlay panel — each loaded into its own WebContentsView
 * with a SANDBOXED preload that cannot require a shared module (see invariant
 * 13 in CLAUDE.md). Inlining a token-applying bridge into all of them would be
 * twelve copies of the same code drifting apart.
 *
 * So the tokens are injected from the main process with insertCSS, which needs
 * nothing from the preload and reaches every surface the same way. The rule is
 * emitted as html[data-theme="<id>"] rather than :root so it has the same
 * specificity as the built-in blocks it sits beside, and lands later in the
 * cascade — a plain :root would LOSE to html[data-theme="dune"] and a theme
 * switch away from a built-in would leave half the old palette behind.
 *
 * Only the app's own surfaces are touched. Injecting a palette into whatever
 * page a tab happens to be showing would be restyling the web.
 */
const { app, nativeTheme, webContents } = require('electron');
const themes = require('./themes');
const log = require('./log');

/* wc.id → the insertCSS key currently applied, so a switch removes the old
   palette instead of stacking a new one on top of it. */
let bound = false;
const applied = new Map();
/* wc.id → the CSS text currently applied. Live editing repaints on every drag
   frame, and re-inserting an identical sheet is work the compositor can see. */
const lastCss = new Map();

let currentId = 'default';   // the global setting
let resolveWindow = null;    // (wc) → windowData, injected by bind()
let readProfileTheme = null; // (profileId) → theme id | null

/**
 * Tell the runtime how to find the window a surface belongs to, and what theme
 * that window's space wears. Without this every surface gets the global theme —
 * which is the right fallback, and was the only behaviour before spaces could
 * carry one.
 */
function bind({ wm, profiles }) {
    /* Paint every surface the moment it exists, not only when the theme next
       changes. Overlays are created LAZILY — the context menu on your first
       right-click, the downloads panel the first time you open it — so a panel
       first opened after the last theme change was painted with the DEFAULT
       palette and stayed that way: the right-click menu came up in the stock
       colours while the chrome around it wore your theme.

       Doing it here rather than in each of the nineteen places that construct a
       view means it also covers the next one somebody adds. attach() paints on
       dom-ready and applyCssTo re-checks isAppSurface, so a tab showing a
       website is left alone. */
    if (!bound) {
        bound = true;
        try { app.on('web-contents-created', (_e, wc) => attach(wc)); }
        catch (e) { log.debug('theme-runtime', 'web-contents-created', e); }
    }
    resolveWindow = (wc) => {
        try { return wm.getWindowByWebContents(wc); }
        catch { return null; }
    };
    readProfileTheme = (profileId) => {
        try { return profiles.meta(profileId)?.theme || null; }
        catch { return null; }
    };
}

/** The theme a given surface should wear: its space's, else the global one. */
function themeFor(wc) {
    if (!resolveWindow || !readProfileTheme)
        return currentId;
    const wd = resolveWindow(wc);
    return (wd && readProfileTheme(wd.profileId)) || currentId;
}

/** Is this one of ours, or a web page? */
function isAppSurface(wc) {
    try {
        if (wc.isDestroyed())
            return false;
        // Every surface of ours is a file:// page under the app directory.
        // A tab showing a website is not, and must never be restyled.
        return (wc.getURL() || '').startsWith('file://');
    }
    catch {
        return false;
    }
}

async function applyCssTo(wc, id) {
    if (!isAppSurface(wc))
        return;
    const css = themes.themeCss(id);
    const prev = applied.get(wc.id);
    if (css && lastCss.get(wc.id) === css)
        return;  // nothing changed: live editing fires this on every drag frame
    try {
        /* INSERT FIRST, then remove the old sheet. Removing first left a frame
           with neither applied, so the surface fell back to the stylesheet's
           default palette and back again — which is the flicker you get on
           every drag once editing is live. Both are applied for an instant
           instead, and the later one wins by cascade order. */
        const next = css ? await wc.insertCSS(css) : null;
        if (prev)
            await wc.removeInsertedCSS(prev);
        if (next) {
            applied.set(wc.id, next);
            lastCss.set(wc.id, css);
        }
        else {
            applied.delete(wc.id);
            lastCss.delete(wc.id);
        }
    }
    catch (e) {
        // A view torn down mid-switch is normal, not an error worth shouting about.
        log.debug('theme-runtime', 'applyCssTo', e);
    }
}

/** Give a surface the current palette as soon as it has a document. */
function attach(wc) {
    if (!wc || wc.isDestroyed())
        return;
    // Resolved per surface, not once globally: two windows can be in two
    // spaces wearing two different themes.
    const paint = () => {
        const id = themeFor(wc);
        try { wc.send('theme-changed', id); }
        catch (e) { log.debug('theme-runtime', 'attach send', e); }
        applyCssTo(wc, id);
    };
    wc.on('dom-ready', paint);
    wc.once('destroyed', () => { applied.delete(wc.id); lastCss.delete(wc.id); });
    if (!wc.isLoading())
        paint();
}

/**
 * Switch every window, panel and internal page to `id`.
 * Returns the resolved theme so callers can report what actually happened —
 * an unknown id resolves to the default rather than failing silently.
 */
function apply(id, wm) {
    const theme = themes.resolve(id);
    currentId = theme.id;
    repaintAll(wm);
    return theme;
}

/**
 * Re-resolve every surface. Called when the global theme changes and when a
 * space's own theme does — a space switch does not move any window, it changes
 * which theme the windows in that space resolve to.
 */
function repaintAll(wm) {
    /* nativeTheme is one global switch and windows can now disagree, so it
       follows the FOCUSED window: it drives native widgets (scrollbars,
       pickers, the colour of a native menu), and the window you are looking at
       is the one those belong to. */
    let lead = currentId;
    try {
        const focused = wm?.getAllWindows?.().find(w => w.window?.isFocused?.());
        if (focused && readProfileTheme)
            lead = readProfileTheme(focused.profileId) || currentId;
    }
    catch (e) { log.debug('theme-runtime', 'focused window', e); }
    nativeTheme.themeSource = themes.resolve(lead).mode === 'light' ? 'light' : 'dark';

    for (const wc of webContents.getAllWebContents()) {
        const id = themeFor(wc);
        try { wc.send('theme-changed', id); }
        catch (e) { log.debug('theme-runtime', 'broadcast', e); }
        applyCssTo(wc, id);
    }

    /* Page views paint their own background before a site does, so they carry
       the theme too — otherwise a theme change leaves every open tab flashing
       the old ground on its next navigation. */
    try {
        for (const wd of (wm?.getAllWindows?.() || [])) {
            try { wd.tabs?.repaintTabBackgrounds?.(); }
            catch (e) { log.debug('theme-runtime', 'tab backgrounds', e); }
        }
    }
    catch (e) { log.debug('theme-runtime', 'repaintAll tabs', e); }
}

/* wc.id → true while a live preview override is on it, so it can be taken off
   again without touching surfaces that never had one. */
const previewing = new Set();
/* Exactly which custom properties a preview has written, so clearing one puts
   back what it took and leaves everything else on documentElement alone. */
const previewKeys = new Set();

/**
 * Paint a palette on a window's surfaces WITHOUT saving or touching stylesheets.
 *
 * Live editing repaints on every pointer move. Doing that through insertCSS
 * means a stylesheet swap per frame — the compositor sees each one, which is
 * the flicker — plus an IPC round trip and a disk write per frame. Inline
 * custom properties on documentElement cost none of that: they beat every rule
 * by specificity, apply in the same frame, and are removed by clearing them.
 *
 * So a drag paints inline, and the real save happens once on release.
 */
function previewLive(wm, wd, tokens) {
    if (!wd || !tokens)
        return;
    const entries = Object.entries(tokens).filter(([k]) => /^--[a-z0-9-]+$/i.test(k));
    for (const [k] of entries)
        previewKeys.add(k);
    const decls = entries
        .map(([k, v]) => `s.setProperty(${JSON.stringify(k)}, ${JSON.stringify(String(v))});`)
        .join('');
    const js = `(()=>{const s=document.documentElement.style;${decls}})()`;
    for (const wc of surfacesOf(wm, wd)) {
        try {
            wc.executeJavaScript(js, true);
            previewing.add(wc.id);
        }
        catch (e) { log.debug('theme-runtime', 'previewLive', e); }
    }
}

/**
 * Drop any live overrides so the saved stylesheet is what shows again.
 *
 * Removes ONLY the properties a preview sets. The first version cleared every
 * inline custom property on documentElement, which also took `--sidebar-w` with
 * it — the chrome sets that inline when you drag the sidebar. The DOM sidebar
 * snapped back to the stylesheet's 256px while the main process kept
 * positioning the page view at the real width, so the page covered the sidebar.
 * A preview must put back exactly what it took, and nothing else.
 */
function clearPreview(wm, wd) {
    const names = JSON.stringify([...previewKeys]);
    const js = `(()=>{const s=document.documentElement.style;
        for (const n of ${names}) s.removeProperty(n);})()`;
    /* Runs on EVERY surface, not only ones this process believes it painted.
       The `previewing` bookkeeping was an optimisation and it made the clear
       unreliable: a surface that reloaded, or that was painted before an
       earlier clear emptied the set, kept its inline overrides — and inline
       custom properties beat the injected stylesheet, so the chrome stayed on
       whatever the wheel was last dragged to no matter which theme you picked.
       Removing a property that was never set is free; getting this wrong is
       not. `previewKeys` is what keeps this off --sidebar-w and anything else
       the chrome owns. */
    for (const wc of surfacesOf(wm, wd)) {
        previewing.delete(wc.id);
        try { wc.executeJavaScript(js, true); }
        catch (e) { log.debug('theme-runtime', 'clearPreview', e); }
    }
}

/** Every app surface belonging to one window. */
function surfacesOf(wm, wd) {
    const out = [];
    for (const wc of webContents.getAllWebContents()) {
        if (!isAppSurface(wc))
            continue;
        if (!resolveWindow || resolveWindow(wc) === wd)
            out.push(wc);
    }
    return out;
}

const current = () => currentId;

module.exports = { apply, attach, current, bind, repaintAll, themeFor, previewLive, clearPreview };
