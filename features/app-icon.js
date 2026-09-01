/**
 * The dock/taskbar icon.
 *
 * ONE mark, ONE palette, everywhere. It used to follow the theme — a rendered
 * PNG per ground, cached by colour — which was a nice mechanism and the wrong
 * idea: an app icon is how the app is recognised in a dock, a switcher and a
 * search result, and an icon that changes with a preference is one the user
 * cannot learn. It also meant the icon differed from the one in the About page
 * and from the window icon, because those read a file while the dock read a
 * render.
 *
 * So the palette is fixed here, the binaries beside renderer/assets/logo.svg
 * are built from it (`npm run icons`), and this module only hands the right
 * file to the right platform API.
 */
const { app, nativeImage } = require('electron');
const { resolveAppFile } = require('../app-paths');
const log = require('./log');

/* The mark's colours. Change them here, then run `npm run icons` — nothing
   reads them at runtime, they are the source for the build. */
const FIELD = '#2d6ad6';
const MARK = '#ffffff';

let cached = null;

// Windows ships its own mark (logo-win.png — padded for the taskbar's square
// slot); macOS/Linux use logo.png. window-manager creates the window with the
// same per-platform file, so both entry points agree and editing the Windows
// logo actually changes the Windows icon.
const ICON_FILE = process.platform === 'win32' ? 'logo-win.png' : 'logo.png';

/** The one icon, loaded once. */
function icon() {
    if (cached === null) {
        const img = nativeImage.createFromPath(resolveAppFile(ICON_FILE));
        cached = img.isEmpty() ? false : img;
    }
    return cached || null;
}

function setEverywhere(img, wm) {
    if (!img)
        return;
    try {
        if (process.platform === 'darwin') {
            app.dock?.setIcon(img);
            return;
        }
        wm?.getAllWindows?.().forEach(wd => {
            try { wd.window.setIcon(img); }
            catch (e) { log.debug('app-icon', 'setIcon', e); }
        });
    }
    catch (e) {
        log.warn('app-icon', 'apply', e);
    }
}

/**
 * Point the dock (macOS) or every window (Windows/Linux) at the icon.
 * `theme` is accepted and ignored — callers still pass it, and keeping the
 * signature means the theme plumbing did not have to learn that the icon
 * stopped caring.
 */
function apply(_theme, wm) {
    const img = icon();
    if (!img) {
        log.warn('app-icon', `${ICON_FILE} missing or unreadable`);
        return false;
    }
    setEverywhere(img, wm);
    return true;
}

/** A window created later starts on the bundle icon; give it ours. */
function applyToWindow(win) {
    if (process.platform === 'darwin')
        return;
    const img = icon();
    if (!img)
        return;
    try { win.setIcon(img); }
    catch (e) { log.debug('app-icon', 'applyToWindow', e); }
}

module.exports = { apply, applyToWindow, FIELD, MARK };
