'use strict';
/**
 * Import wizard — the dialog other browsers show on first run.
 *
 * A frameless, modal child window (the same child-window pattern as the Find
 * dialog) that lists every browser found on this machine and lets the user pick
 * a source, a profile and what to bring over (bookmarks, history, search
 * engines; passwords via the CSV path). Detection and reading live in
 * features/import.js — this file is the window + the IPC glue.
 *
 * Opened from Settings ("Import from another browser…") and once on first launch.
 */
const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');
const { resolveAppFile } = require('../app-paths');
const log = require('../features/log');
const importer = require('../features/import');
const engines = require('../features/search-engines');

const WIZ_W = 600;
const WIZ_H = 664;

let _wm = null;
let _BrowserWindow = null;
let _webContents = null;
const wizards = new Map(); // wizard webContents id → { win, parentWindow, profileId }

// Open (or focus) the wizard over a parent window, importing into that window's
// active profile.
function open(parentWindow, profileId) {
    if (!_BrowserWindow) return null;
    for (const rec of wizards.values())
        if (rec.parentWindow === parentWindow && rec.win && !rec.win.isDestroyed()) { rec.win.focus(); return rec.win; }
    const win = new _BrowserWindow({
        width: WIZ_W,
        height: WIZ_H,
        parent: parentWindow || undefined,
        modal: !!parentWindow,
        frame: false,
        transparent: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        skipTaskbar: true,
        backgroundColor: '#00000000',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, '../preload/import-preload.js'),
        },
    });
    win.loadFile(resolveAppFile('renderer/ImportWizard/index.html'));
    win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });
    win.webContents.on('before-input-event', (e, input) => {
        if (input.key === 'Escape' && input.type === 'keyDown') { win.close(); e.preventDefault(); }
    });
    // Capture the id now: in the 'closed' handler win.webContents is already
    // destroyed, so reading it there throws "Object has been destroyed".
    const wcId = win.webContents.id;
    const rec = { win, parentWindow, profileId: String(profileId || '1') };
    wizards.set(wcId, rec);
    win.on('closed', () => wizards.delete(wcId));
    return win;
}

function recFor(e) { return wizards.get(e.sender.id) || null; }
function profileFor(e) {
    const rec = recFor(e);
    if (rec) return rec.profileId;
    try { return _wm.profileOf(e.sender); } catch (err) { return '1'; }
}
function broadcast(channel, ...args) {
    try {
        for (const wc of _webContents.getAllWebContents()) { try { wc.send(channel, ...args); } catch (e) { /* window gone */ } }
    }
    catch (e) { log.debug('import-wizard', 'broadcast', e); }
}

function register(ipcMain, deps) {
    _wm = deps.wm;
    _BrowserWindow = deps.BrowserWindow;
    _webContents = deps.webContents;

    // Open the wizard for the sender's window (Settings button).
    ipcMain.handle('import-wizard:open', (e) => {
        const wd = _wm.getWindowByWebContents(e.sender);
        if (wd) open(wd.window, wd.profileId || '1');
        return { ok: !!wd };
    });

    // The detected browsers, without any on-disk paths.
    ipcMain.handle('import-wizard:sources', () => {
        try { return importer.listSources(); }
        catch (e) { log.debug('import-wizard', 'sources', e); return []; }
    });

    // Import the chosen data types from one source into the wizard's profile.
    // `types` ⊆ ['bookmarks','history','engines'].
    ipcMain.handle('import-wizard:run', async (e, id, types) => {
        const pid = profileFor(e);
        try {
            const src = importer.findSource(id);
            if (!src) return { ok: false, error: 'not-found' };
            const want = Array.isArray(types) && types.length ? types : ['bookmarks', 'history'];
            const result = { ok: true, browser: src.browser };
            if (want.includes('bookmarks')) {
                const tree = importer.getBookmarks(src);
                result.bookmarks = await _wm.bookmarksFor(pid).importTree(`Imported from ${src.browser}`, tree);
                broadcast('bookmarks-changed');
            }
            if (want.includes('history')) {
                const entries = importer.getHistory(src, 10000);
                result.history = await _wm.historyFor(pid).importEntries(entries, null);
            }
            if (want.includes('engines')) {
                let n = 0;
                for (const eng of importer.getEngines(src)) { try { engines.upsert(eng); n++; } catch (err) { /* skip bad engine */ } }
                result.engines = n;
                if (n) broadcast('engines-changed', engines.all());
            }
            return result;
        }
        catch (err) { log.warn('import-wizard', 'run', err); return { ok: false, error: 'read-failed' }; }
    });

    // Import bookmarks from an HTML export (any browser, incl. Firefox/Safari).
    ipcMain.handle('import-wizard:html', async (e) => {
        const pid = profileFor(e);
        const rec = recFor(e);
        try {
            const res = await dialog.showOpenDialog(rec?.win || undefined, {
                title: 'Import bookmarks from HTML',
                properties: ['openFile'],
                filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }],
            });
            if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };
            const html = fs.readFileSync(res.filePaths[0], 'utf8');
            const tree = importer.parseHtmlBookmarks(html);
            const count = await _wm.bookmarksFor(pid).importTree('Imported bookmarks', tree);
            broadcast('bookmarks-changed');
            return { ok: true, bookmarks: count };
        }
        catch (err) { log.warn('import-wizard', 'html', err); return { ok: false, error: 'read-failed' }; }
    });

    ipcMain.handle('import-wizard:close', (e) => {
        const rec = recFor(e);
        if (rec && rec.win && !rec.win.isDestroyed()) rec.win.close();
    });
}

module.exports = { register, open };
