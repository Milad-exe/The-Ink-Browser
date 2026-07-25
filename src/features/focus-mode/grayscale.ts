// Focus-mode grayscale. We set the filter directly on the CSSOM
// (documentElement.style) via executeJavaScript rather than webContents
// insertCSS/removeInsertedCSS: the latter's removeInsertedCSS resolves without
// error yet leaves USER-origin CSS applied (Electron quirk), so cancelling
// focus mode left tabs stuck in black & white. CSSOM writes are not governed by
// the page CSP and reverse cleanly. Re-applied on load by applyToTab while
// focus mode is active, so it survives navigations.
const APPLY_JS  = "document.documentElement.style.setProperty('filter','grayscale(100%)','important')";
const REMOVE_JS = "document.documentElement.style.removeProperty('filter')";

function applyGrayscale(wc) {
    try { wc.executeJavaScript(APPLY_JS, true).catch(() => {}); } catch {}
}

function removeGrayscale(wc) {
    try { wc.executeJavaScript(REMOVE_JS, true).catch(() => {}); } catch {}
}

export { applyGrayscale, removeGrayscale };
