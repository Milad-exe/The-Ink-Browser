'use strict';
/**
 * IPC — reading-list. Auto-loaded by ipc/index.js; no edit to main.js.
 *
 * `deps` carries { wm, ... } — the same object every ipc module gets. Resolve
 * the calling window with wm.getWindowByWebContents(_e.sender).
 */
const log = require('../features/log');
const readingList = require('../features/reading-list');

function register(ipcMain, { wm }) {
    ipcMain.handle('reading-list:do', (_e, input) => {
        const wd = wm.getWindowByWebContents(_e.sender);
        if (!wd)
            return null;
        try { return readingList.doSomething(input); }
        catch (e) { log.warn('reading-list', 'do failed', e); return null; }
    });
}

module.exports = { register };
