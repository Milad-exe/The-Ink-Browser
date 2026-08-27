'use strict';
/**
 * IPC registrar.
 *
 * Every ipc/<area>.js that exports `register(ipcMain, deps)` is wired up
 * automatically — dropping a file in this directory is all it takes to make its
 * handlers live. No edit to main.js, and nothing to forget.
 *
 * Files that do not export `register` (helpers like utils.js, and this index)
 * are skipped. Order is not significant: a register() only installs ipcMain
 * handlers and, where relevant, hands a lazy provider to a bridge module —
 * nothing here calls into another module's handlers at registration time.
 */
const fs = require('fs');
const path = require('path');
const log = require('../features/log');

function registerAll(ipcMain, deps) {
    const names = [];
    for (const file of fs.readdirSync(__dirname)) {
        if (file === 'index.js' || !file.endsWith('.js'))
            continue;
        try {
            const mod = require(path.join(__dirname, file));
            if (typeof mod.register === 'function') {
                mod.register(ipcMain, deps);
                names.push(file.replace(/\.js$/, ''));
            }
        }
        catch (e) {
            log.error('ipc', `could not register ipc/${file}`, e);
        }
    }
    log.debug('ipc', `registered ${names.length} ipc modules: ${names.sort().join(', ')}`);
    return names;
}

module.exports = { registerAll };
