/**
 * Preload for the first-launch window.
 *
 * One message: the animation has finished. Main closes the window and reveals
 * the browser — and closes it on its own timeout too, so a splash that never
 * reports back cannot hold the browser hostage.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
    done: () => ipcRenderer.send('splash:done'),
});
