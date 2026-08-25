'use strict';
/**
 * The palette, as seen from features/.
 *
 * The palette's window lives in `ipc/palette.js`, a layer ABOVE this one, but
 * three things down here need to raise or hide it: the tab manager, the
 * shortcut handler and the window context menu. They each did
 * `require('../ipc/palette')` inline, which made features depend on ipc — the
 * inverse of how these layers sit, and the same shape as the circular
 * dependency that used to run through features/extensions.
 *
 * ipc/palette registers itself here when it loads; callers go through this and
 * never name the layer above them. Calls before registration are no-ops rather
 * than throws: nothing can raise a palette before the ipc layer exists anyway.
 */
let impl = null;

function provide(api) {
    impl = api || null;
}
function openFor(wd) {
    try { return impl && impl.openFor ? impl.openFor(wd) : false; }
    catch { return false; }
}
function hidePalette(wd) {
    try { return impl && impl.hidePalette ? impl.hidePalette(wd) : false; }
    catch { return false; }
}

module.exports = { provide, openFor, hidePalette };
