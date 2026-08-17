"use strict";
// The blank tab's only job: name the key that brings the palette back, in the
// platform's own notation. Everything else this page used to do (greeting,
// clock, its own search field) belongs to the palette now.
(() => {
    const hint = document.getElementById('hint');
    if (!hint)
        return;
    const mac = navigator.platform.toUpperCase().includes('MAC');
    const t = (key, fallback) => {
        try { return window.Ink?.i18n?.t(key) !== key ? window.Ink.i18n.t(key) : fallback; }
        catch { return fallback; }
    };
    hint.innerHTML = '';
    hint.append(t('newtab.hint', 'Press'), ' ');
    const kbd = document.createElement('kbd');
    kbd.textContent = mac ? '⌘T' : 'Ctrl+T';
    hint.append(kbd, ' ', t('newtab.hintTail', 'to open anything'));
})();
