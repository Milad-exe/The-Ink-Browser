'use strict';
/**
 * "Is this webContents' render frame actually there right now?"
 *
 * send(), executeJavaScript() and insertCSS() all throw
 *   "Render frame was disposed before WebFrameMain could be accessed"
 * when the target frame is mid-teardown — a navigation, a reload, a crash, or
 * the dev hot-reload. isDestroyed() is NOT enough: the webContents object
 * outlives the frame, so it returns false during that window. Electron also
 * prints that error to the console even when the call's own rejection is caught,
 * so the only way to stay quiet AND correct is to not call at all when the frame
 * is gone. Accessing a property of a disposed WebFrameMain throws, so a live
 * frame is one whose mainFrame exposes a numeric routingId.
 */
function frameAlive(wc) {
    try {
        if (!wc || wc.isDestroyed() || wc.isCrashed())
            return false;
        const f = wc.mainFrame;
        return !!f && typeof f.routingId === 'number';
    }
    catch (e) {
        return false;
    }
}

module.exports = { frameAlive };
