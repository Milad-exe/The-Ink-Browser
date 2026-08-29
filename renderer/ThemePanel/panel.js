"use strict";
/* The theme popup. All behaviour is in renderer/lib/theme-editor.js — this
   file supplies the bridge, the panel's own affordances, and one decision the
   instrument does not make: WHAT it is editing.

   The panel edits either the global theme or one space's. A space's theme is
   stored on the space (features/profiles.js) and worn by every window in it;
   null there means "follow the global setting", which is what Reset writes. */
(() => {
    const api = window.northstarThemes;
    if (!api || !window.Northstar?.themeEditor)
        return;

    const close = () => window.overlayThemePanel?.close();

    (async () => {
        let scope = null;
        try { scope = (await window.overlayThemePanel?.context())?.scope || null; }
        catch (e) { /* global scope is the safe default */ }

        const title = document.getElementById('tp-title');
        const reset = document.getElementById('tp-reset');

        /* What the picker should show as selected, and where a choice goes. For
           a space that is its own theme; with none set it inherits, and the
           picker shows what it is actually inheriting rather than nothing. */
        let space = null;
        if (scope) {
            try { space = ((await window.northstarProfiles.list()) || []).find(p => String(p.id) === String(scope)); }
            catch (e) { /* fall back to global */ }
        }

        let current = null;
        if (space)
            current = space.theme || null;
        if (!current) {
            try { current = (await window.northstarSettings.get())?.theme || 'default'; }
            catch (e) { current = 'default'; }
        }

        if (title && space)
            title.textContent = `Theme · ${space.name}`;
        if (reset)
            reset.hidden = !space;

        const editor = window.Northstar.themeEditor.mount({
            picker: document.getElementById('theme-picker'),
            editor: document.getElementById('theme-editor'),
            api,
            currentTheme: current,
            setTheme: (id) => (space
                ? window.northstarProfiles.update(space.id, { theme: id })
                : window.northstarSettings.set('theme', id)),
            // The panel has no toast of its own; the chrome behind it does the
            // reporting by simply changing colour, which is the whole point.
            toast: () => {},
            /* The panel IS the editor — it opens straight into it rather than
               showing a row of swatches and hiding the tools behind a "+". */
            alwaysOpen: true,
            onCancel: close,
        });

        reset?.addEventListener('click', async () => {
            if (!space)
                return;
            await window.northstarProfiles.update(space.id, { theme: null });
            close();
        });

        // Reopened for a different space without the page reloading.
        window.overlayThemePanel?.onScope?.(() => { location.reload(); });
    })();

    document.getElementById('tp-close')?.addEventListener('click', close);

    // Escape closes wherever focus happens to be — the field, a dot, or nothing.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape')
            return;
        e.preventDefault();
        close();
    }, true);
})();
