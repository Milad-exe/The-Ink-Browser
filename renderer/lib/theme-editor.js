/* renderer/lib/theme-editor.js
 *
 * The theme picker and editor, as one mountable instrument.
 *
 * It exists as a module because it is used in two frames: the Appearance
 * section of the Settings page, and the popup that opens from the sidebar's
 * context menu. The logic — the gradient canvas, the draggable pools, the
 * palette, the controls, the save path — is identical in both, and a copy in
 * each would drift the moment one of them got a fix.
 *
 * The model is Zen's: a theme is a set of COLOURS, each pooled at an XY
 * POSITION on a canvas, and the browser wears the blend of them. Position is
 * layout (where a colour pools), which is a different thing from the colour —
 * you drag a pool to move it and pick its colour from the palette. The ground,
 * accent and text tokens are still DERIVED from the colours in the main process
 * (features/theme-derive.js), so a gradient can never make the browser
 * unreadable; positions only shape the wash it wears.
 *
 * Mount it with:
 *
 *   Northstar.themeEditor.mount({
 *     picker,        // element the swatch row is built into
 *     editor,        // element holding the editor markup (see either page)
 *     api,           // the northstarThemes bridge: list/preview/save/remove
 *     setTheme(id),  // how THIS page applies a chosen theme
 *     toast(msg),    // how THIS page reports
 *     currentTheme,  // optional: the id to start selected on
 *     alwaysOpen,    // the editor IS the frame (the popup), not a section
 *     onCancel,      // what "Done" means when alwaysOpen
 *   })
 *
 * Nothing here computes a token. Every colour that reaches the browser is
 * derived in the main process (features/theme-derive.js) — this only needs
 * enough OKLCH to draw the wheel, place a dot and paint a track, and that maths
 * is inlined below because these pages are sandboxed and cannot require it.
 */
(function () {
    'use strict';
    window.Northstar = window.Northstar || {};

    function mount(ctx) {
        const picker = ctx.picker;
        const editor = ctx.editor;
        const root = ctx.root || document;
        if (!picker || !editor || !ctx.api)
            return null;

        const el = id => root.querySelector('#' + id);
        // `root` may be a document or a fragment; only some of those carry
        // activeElement, and the picker's arrow keys need whichever does.
        const active = () => root.activeElement || document.activeElement;
        const T = ctx.api;
        let current = ctx.currentTheme || 'default';
        let list = [];
        let editing = null; // the custom theme being edited, or null for a new one

        const svg = (paths, w = 24) => {
            const s = `<svg viewBox="0 0 ${w} ${w}" fill="none" stroke="currentColor"
                stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
            const t = document.createElement('template');
            t.innerHTML = s.trim();
            return t.content.firstChild;
        };

        /* ── The picker ──────────────────────────────────────────────────────
         *
         * WHAT WAS WRONG. A selected swatch was a hairline ring inset in the
         * disc plus a 6% scale-up. Both fail for the same reason: they are
         * differences of DEGREE on a row whose whole job is to show differences
         * of colour. On the black swatch in a dark card the ring is invisible;
         * on a light theme it disappears into the disc; and 6% is not a size
         * change anyone reads as state. Nothing anywhere named the theme you
         * were actually wearing, so the row answered "what colours exist" and
         * never "which one is on".
         *
         * WHAT COMPARABLE PRODUCTS DO.
         *   · Apple's HIG says to indicate status with SHAPE PLUS COLOUR — a
         *     checkmark, not a tint — and a menu marks its selected value with
         *     a checkmark rather than by drawing it differently.
         *   · macOS System Settings → Appearance shows three previews and names
         *     the selected one underneath it, in words.
         *   · Chrome's Customize panel, iOS's wallpaper and icon-tint pickers
         *     and Google Photos all badge the chosen swatch with a tick.
         *   · VS Code's theme picker is a NAMED list: you never wonder which
         *     theme is on, because it says so.
         *   · WCAG 2.2 SC 1.4.1 makes the ring version a real defect, not a
         *     taste one — colour must not be the only visual means of
         *     distinguishing an element, and a ring whose visibility depends on
         *     the swatch's own colour is exactly that.
         *
         * SO: three signals, none of which is a colour.
         *   1. a TICK inside the selected disc, drawn in black or white chosen
         *      against that swatch's own ground, so it is legible on Slate and
         *      on Clay alike;
         *   2. a ring OUTSIDE the disc with a gap, drawn in --text — never in
         *      the theme's own colour, which is what made the old one vanish;
         *   3. a caption under the row NAMING the selected theme and saying
         *      whether it is built-in or yours. That is the half of the answer
         *      a row of discs cannot give, and it is where "Customise" lives.
         */

        /* Black or white, whichever can be seen on this swatch. Relative
           luminance, so it is the same test the contrast floors use. */
        const inkOn = (hex) => {
            const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
            if (!m)
                return '#ffffff';
            const v = parseInt(m[1], 16);
            const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
            const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
            return L > 0.34 ? '#000000' : '#ffffff';
        };

        const paintSwatch = (node, sw) => {
            // The card is a tiny browser in the theme: a sidebar band (shell), a
            // page (page/bg), an accent dot and a couple of text bars — so you can
            // SEE what a theme looks like instead of guessing from one colour.
            node.style.setProperty('--tp-shell', sw.shell);
            node.style.setProperty('--tp-page', sw.page || sw.bg || sw.shell);
            node.style.setProperty('--tp-accent', sw.accent);
            node.style.setProperty('--tp-text', sw.text || inkOn(sw.shell));
            node.style.setProperty('--tp-ink', inkOn(sw.shell));
        };

        const optionFor = (t) => {
            const b = document.createElement('button');
            b.className = 'theme-option';
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.dataset.themeValue = t.id;
            b.setAttribute('aria-checked', String(t.id === current));
            b.tabIndex = t.id === current ? 0 : -1;
            // The swatch shows the colours, so the name is the accessible name.
            b.setAttribute('aria-label', t.name);
            b.title = t.name;
            const sw = document.createElement('span');
            sw.className = 'theme-swatch';
            paintSwatch(sw, t.swatch);
            // A miniature of the browser wearing this theme: sidebar + accent
            // dot on the left, page with text bars on the right, tick when chosen.
            sw.innerHTML =
                '<span class="tsw-side"><span class="tsw-dot"></span></span>' +
                '<span class="tsw-page"><span class="tsw-line"></span><span class="tsw-line short"></span></span>';
            sw.appendChild(svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'));
            b.appendChild(sw);
            // No name label — the preview shows the theme and hover previews it
            // live; the name is the button's accessible name and its tooltip.
            b.addEventListener('click', () => choose(t.id));
            // Hover to preview: paint the whole UI in this theme live (no save),
            // so switching is a look, not a leap. Leaving the row (below) drops
            // the preview back to the committed theme. Skip the one already on and
            // any theme with no wheel seed (the plain built-ins apply on click).
            b.addEventListener('mouseenter', () => {
                if (t.id === current || !t.seed) return;
                try { T.live?.(t.seed); } catch (e) { }
            });
            return b;
        };

        const options = () => [...picker.querySelectorAll('.theme-option')];

        /* Built once, at mount. The "+" is NOT a theme, so it sits outside the
           radiogroup rather than being the last radio in it — and outside the
           scroller, so it cannot be pushed off the end by the themes the way it
           was (with six themes in a 340px popup it was already half cut off,
           which is a poor home for the only way to make a new one). */
        const row = document.createElement('div');
        row.className = 'theme-row';
        picker.parentNode.insertBefore(row, picker);
        row.appendChild(picker);
        // Leaving the swatch row drops any hover preview back to the committed
        // theme. (Clicking a swatch commits before the pointer leaves, so the
        // choice sticks; this only undoes an un-chosen hover.)
        row.addEventListener('mouseleave', () => { try { T.live?.(null); } catch (e) { } });
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'theme-add';
        addBtn.title = 'New theme';
        addBtn.setAttribute('aria-label', 'New theme');
        addBtn.appendChild(svg('<path d="M12 5.5v13M5.5 12h13"/>'));
        addBtn.addEventListener('click', () => newTheme());
        // Sits as the last card in the grid, not adrift at the end of a row.
        picker.appendChild(addBtn);

        const caption = document.createElement('div');
        caption.className = 'theme-current';
        /* The name is a BUTTON when the theme is yours. Custom themes are named
           from their hue, so three blue ones came out "Blue", "Blue 2",
           "Blue 3" and nothing told them apart — and there was no way to change
           that. Clicking the name renames it in place, which is where a name
           is. Built-ins stay a plain label: their names are not yours to edit. */
        const capName = document.createElement('button');
        capName.type = 'button';
        capName.className = 'theme-current-name';
        const capKind = document.createElement('span');
        capKind.className = 'theme-current-kind';
        const capEdit = document.createElement('button');
        capEdit.type = 'button';
        capEdit.className = 'btn btn-ghost btn-sm theme-current-edit';
        capEdit.textContent = 'Customise';
        /* In the popup the editor is always up, so there is nothing to open. */
        capEdit.hidden = !!ctx.alwaysOpen;
        capEdit.addEventListener('click', () => {
            const t = list.find(x => x.id === current);
            openEditor(t && t.kind === 'custom' ? t : null, t || null);
            editor.scrollIntoView({ block: 'nearest' });
        });
        /* Rename in place: the label becomes a field, Enter commits, Escape
           puts it back. The save carries the theme's existing seed — a rename
           must not re-derive the palette from whatever the wheel happens to be
           showing. */
        let renaming = false;
        const commitRename = async (t, value, field) => {
            const next = String(value || '').trim().slice(0, 40);
            renaming = false;
            field.remove();
            capName.hidden = false;
            if (!next || next === t.name) {
                paint(current);
                return;
            }
            try {
                const r = await T.save({ id: t.id, name: next, seed: t.seed });
                if (!r || r.ok === false)
                    warn('That name could not be saved.');
            }
            catch (e) {
                warn('That name could not be saved.');
                window.northstarLog?.debug('theme-editor', 'rename: ' + e);
            }
            refresh();
        };
        capName.addEventListener('click', () => {
            const t = list.find(x => x.id === current);
            if (!t || t.kind !== 'custom' || renaming)
                return;
            renaming = true;
            const field = document.createElement('input');
            field.type = 'text';
            field.className = 'theme-current-name-input';
            field.value = t.name;
            field.maxLength = 40;
            field.setAttribute('aria-label', 'Theme name');
            capName.hidden = true;
            capName.parentNode.insertBefore(field, capName);
            field.focus();
            field.select();
            field.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(t, field.value, field); }
                else if (e.key === 'Escape') { e.preventDefault(); commitRename(t, t.name, field); }
            });
            field.addEventListener('blur', () => { if (renaming) commitRename(t, field.value, field); });
        });
        caption.append(capName, capKind, capEdit);
        row.parentNode.insertBefore(caption, row.nextSibling);
        /* In the popup the editor is always open, so the caption's right side is
           empty — there is nothing to "Customise". The mode toggle moves into
           it: dark/light is a property of the theme whose name is right there,
           and above the wheel it was an unlabelled pair of glyphs floating in
           their own 36px band, which is exactly the height that pushed the Grain
           slider under the foot. The Settings column keeps it inside the editor,
           where the editor is a block you open rather than the whole panel. */
        if (ctx.alwaysOpen) {
            const modes = document.getElementById('te-mode-seg');
            if (modes)
                caption.appendChild(modes);
        }

        /* Which end of the swatch row still has themes behind it. Set from the
           scroll position so a row scrolled to its start does not pretend there
           is something to its left. */
        function syncPickerOverflow() {
            if (!picker)
                return;
            const over = picker.scrollWidth - picker.clientWidth > 1;
            picker.classList.toggle('overflowing', over);
            picker.classList.toggle('at-start', !over || picker.scrollLeft <= 1);
            picker.classList.toggle('at-end', !over || picker.scrollLeft >= picker.scrollWidth - picker.clientWidth - 1);
            if (picker.dataset.overflowBound)
                return;
            picker.dataset.overflowBound = '1';
            picker.addEventListener('scroll', syncPickerOverflow, { passive: true });
            // A vertical wheel scrolls the row sideways, so a mouse can reach the
            // themes an overflowing row hides (a trackpad's sideways swipe already
            // can). Without this the row looked stuck once it outgrew its width.
            picker.addEventListener('wheel', (e) => {
                if (picker.scrollWidth - picker.clientWidth <= 1)
                    return;
                const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
                if (!d)
                    return;
                e.preventDefault();
                picker.scrollLeft += d;
            }, { passive: false });
            try { new ResizeObserver(syncPickerOverflow).observe(picker); }
            catch (e) { /* the scroll listener alone still covers the common case */ }
        }

        const paint = (value) => {
            for (const o of options()) {
                const on = o.dataset.themeValue === value;
                o.setAttribute('aria-checked', String(on));
                o.tabIndex = on ? 0 : -1;
                /* Keep the selected swatch in view. The row scrolls sideways, so
                   a theme created at the end of it — which is where a new one
                   always lands — was selected off-screen. */
                if (on)
                    o.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            syncPickerOverflow();
            const t = list.find(x => x.id === value);
            capName.textContent = t ? t.name : '';
            const mine = !!t && t.kind === 'custom';
            capName.classList.toggle('is-editable', mine);
            capName.disabled = !mine;
            capName.title = mine ? 'Rename this theme' : '';
            capKind.textContent = t ? (t.kind === 'custom' ? 'Your theme' : 'Built-in') : '';
            /* Say what "+" will copy. "New theme" alone left the one thing
               people asked for — that it starts from what they are wearing —
               invisible until they pressed it. */
            const from = t ? `New theme, from ${t.name}` : 'New theme';
            addBtn.title = from;
            addBtn.setAttribute('aria-label', from);
            capEdit.textContent = t && t.kind === 'custom' ? 'Customise' : 'Customise a copy';
        };

        const choose = async (value) => {
            if (value === current)
                return;
            current = value;
            paint(value);
            /* Drop the live preview FIRST. A preview is inline custom properties
               on documentElement, which beat the injected stylesheet by
               specificity — so picking a theme applied it underneath colours
               that were still painted on top, and the chrome kept whatever the
               wheel had last been dragged to. */
            try { await T.live?.(null); }
            catch (e) { /* the repaint below is still authoritative */ }
            await ctx.setTheme(value);
            /* Load the chosen theme's OWN seed into the editor. Without this the
               editor kept whatever was on the wheel, so the next drag wrote one
               theme's colours onto another — edits appeared to carry across
               themes because they literally did. */
            if (ctx.alwaysOpen) {
                const t = list.find(x => x.id === value);
                openEditor(t && t.kind === 'custom' ? t : null, t || null);
            }
            ctx.toast('Theme updated');
        };

        /* The HOST owns which theme is current — it is the one that knows whether
           this editor is looking at a space or at the global setting. `themes-list`
           reports the global one, and taking it here overwrote the space's on
           every refresh: the picker showed Slate while the space wore Clay, and
           the next click compared against the wrong value. */
        const hostOwnsCurrent = ctx.currentTheme != null;

        /* Rebuilding the row is only worth it when the row has CHANGED. Saving
           broadcasts `themes-changed`, and a save lands every 260ms while you
           drag — so the swatches were being torn down and recreated four times
           a second, under a pointer that was busy elsewhere. */
        let signature = null;
        const signatureOf = ts => ts.map(t => `${t.id}~${t.name}~${t.swatch.shell}~${t.swatch.accent}`).join('|');

        async function refresh() {
            const res = await T.list();
            list = res?.themes || [];
            if (!hostOwnsCurrent)
                current = res?.current || current;
            // A theme that no longer exists (deleted while Settings was open)
            // must not leave the picker with nothing checked.
            if (!list.some(t => t.id === current))
                current = 'default';
            const sig = signatureOf(list);
            if (sig !== signature) {
                signature = sig;
                picker.textContent = '';
                for (const t of list)
                    picker.appendChild(optionFor(t));
                // Keep the "New" card as the last cell (a refresh clears the grid).
                picker.appendChild(addBtn);
            }
            paint(current);
        }

        // ── Editor ────────────────────────────────────────────────────────
        // The seed is a list of dots plus three amounts. Everything the
        // palette needs is derived from that in the main process, so this
        // never computes a colour it then has to keep in step.

        /* Mirrored from features/theme-derive.js — change one, change both.
           WHEEL_L is the lightness a newly-added pool colour is minted at, so a
           second colour comes in as a real tint rather than near-black; how dark
           the GROUND sits is its own value on the seed (`level`). */
        const WHEEL_L = 0.72;
        const GROUND_L = { dark: [0.06, 0.30], light: [0.88, 0.98] };
        const GROUND_C_MAX = 0.060;
        const DEFAULT_LEVEL = 0.5;

        let seed = { mode: 'dark', colors: ['#3a6ea5'], positions: [], intensity: 0.7, grain: 0, level: DEFAULT_LEVEL };
        let activeDot = 0;

        /* The canvas's rendered size is MEASURED, never assumed — it is a square
           that fills the frame, narrower in the popup than in the Settings
           column, and a dot's position is a FRACTION of it. */
        const canvasSize = () => {
            const c = el('te-canvas');
            return { w: c?.clientWidth || 260, h: c?.clientHeight || 260 };
        };
        const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

        /* Where the dots pool when a seed carries no positions — mirrored from
           DEFAULT_POS in features/theme-derive.js. Spread toward the corners so
           the centre, where the toolbar and omnibox sit, stays the calm part. */
        const DEFAULT_POS = [
            [{ x: 0.30, y: 0.28 }],
            [{ x: 0.24, y: 0.22 }, { x: 0.80, y: 0.82 }],
            [{ x: 0.22, y: 0.20 }, { x: 0.82, y: 0.34 }, { x: 0.48, y: 0.86 }],
        ];
        const defaultPositions = (n) =>
            (DEFAULT_POS[Math.max(1, Math.min(3, n)) - 1] || DEFAULT_POS[0]).map(p => ({ ...p }));

        /* Make seed.positions as long as seed.colors, filling any gap from the
           defaults — so an older theme (saved before positions existed) and a
           freshly added dot both land somewhere sensible. */
        function ensurePositions() {
            const n = seed.colors.length;
            const fb = defaultPositions(n);
            const out = [];
            for (let i = 0; i < n; i++) {
                const p = seed.positions && seed.positions[i];
                out.push(p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
                    ? { x: clamp01(p.x), y: clamp01(p.y) }
                    : (fb[i] || fb[fb.length - 1] || { x: 0.5, y: 0.5 }));
            }
            seed.positions = out;
            return out;
        }

        /* The gradient the canvas shows — mirrored from gradientCss() in
           features/theme-derive.js so the editor's field is the field the
           browser will wear. Painted locally (not read off --shell-wash) so it
           is right from the instant the editor opens, before any live paint. */
        function localGradient() {
            const cols = seed.colors || [];
            // One colour is a flat ground (its hue already tints the chrome); the
            // gradient begins at two pools. Mirrors the ≥2 gate in theme-derive.js.
            if (cols.length < 2)
                return 'none';
            const inten = clamp01(seed.intensity == null ? 0.7 : seed.intensity);
            const pos = ensurePositions();
            const a = seed.mode === 'light' ? 0.40 : 0.50;
            const asRgba = (hex, al) => {
                const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
                const v = m ? parseInt(m[1], 16) : 0;
                return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${al})`;
            };
            return cols.map((hex, i) => {
                const { L, C, h } = rgbToOklch(hex);
                const lifted = toHex(oklchToRgb(L, C * (0.55 + inten * 0.75), h));
                const p = pos[i] || { x: 0.5, y: 0.5 };
                const x = (p.x * 100).toFixed(1), y = (p.y * 100).toFixed(1);
                return `radial-gradient(ellipse 85% 85% at ${x}% ${y}%, ${asRgba(lifted, a)} 0%, ${asRgba(lifted, 0)} 62%)`;
            }).join(', ');
        }

        /* Paint the canvas with the live gradient and a ground that matches what
           the chrome will sit on, so the field reads like a small browser. */
        function paintCanvas() {
            const c = el('te-canvas');
            if (!c)
                return;
            c.style.setProperty('--te-ground', groundAt(seed.level, seed.intensity));
            c.style.setProperty('--te-grad', localGradient());
        }

        /* A curated palette to pick a pool's colour from — the row you click
           instead of hunting a hue on a wheel. A spread of vivid and muted tones
           across the circle, plus the native picker at the end for anything else. */
        const PRESETS = [
            '#e5484d', '#f76808', '#f2cd37', '#46a758', '#12a594', '#0091ff',
            '#3a6ea5', '#6e56cf', '#8e4ec6', '#d6409f', '#ad7f58', '#f5c2c7',
            '#2b2f36', '#8b95a1', '#e6e1d7', '#ffffff',
        ];

        /* The same OKLab maths the main process uses, inlined: these are
           sandboxed pages and cannot require features/theme-derive.js. Only the
           wheel and the tracks need it — every colour that reaches a token
           still comes from the main process. */
        function oklchToRgb(L, C, hDeg) {
            const h = hDeg * Math.PI / 180;
            const a = Math.cos(h) * C, b = Math.sin(h) * C;
            const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
            const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
            const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
            const l = l_ ** 3, m = m_ ** 3, s2 = s_ ** 3;
            const lin = [
                +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2,
                -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s2,
            ];
            return lin.map(v => {
                const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
                return Math.round(Math.min(1, Math.max(0, c)) * 255);
            });
        }
        const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

        /* In the Zen model a dot's position is WHERE its colour pools, not the
           colour itself — so a screen point becomes a 0..1 fraction of the
           canvas, and a stored fraction becomes a pixel offset for the dot. */
        const posToFrac = (x, y) => {
            const { w, h } = canvasSize();
            return { x: clamp01(x / (w || 1)), y: clamp01(y / (h || 1)) };
        };
        const fracToPx = (p) => {
            const { w, h } = canvasSize();
            return { x: (p?.x ?? 0.5) * w, y: (p?.y ?? 0.5) * h };
        };
        function rgbToOklch(hex) {
            const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
            if (!m) return { L: 0, C: 0, h: 0 };
            const v = parseInt(m[1], 16);
            const to = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
            const R = to((v >> 16) & 255), G = to((v >> 8) & 255), B = to(v & 255);
            const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
            const mm = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
            const s2 = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
            const a = 1.9779984951 * l - 2.4285922050 * mm + 0.4505937099 * s2;
            const b = 0.0259040371 * l + 0.7827717662 * mm - 0.8086757660 * s2;
            return {
                L: 0.2104542553 * l + 0.7936177850 * mm - 0.0040720468 * s2,
                C: Math.hypot(a, b),
                h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360,
            };
        }

        /* Arrange snaps the pools back to their spread-out default positions —
           the "tidy this up" button for when a few drags have bunched them into
           a corner. Colours are untouched; only where they pool changes. */
        function arrange() {
            seed.positions = defaultPositions(seed.colors.length);
            renderDots();
            paintCanvas();
            schedulePreview();
        }

        /* WHICH DOT IS THE ACCENT is the one thing about this wheel you cannot
           see by looking at it, and the labels used to get it wrong: dot two
           was called "Accent" and dot three "Highlight" regardless. The ramp
           picks the MOST SATURATED of the dots that are not the ground
           (features/theme-derive.js, rolesFromColors), so dragging dot three
           further out silently made it the accent while the label still said
           otherwise. This is the same rule, read the same way. */
        function accentIndex() {
            if (seed.colors.length < 2)
                return 0;
            let best = 1;
            for (let i = 2; i < seed.colors.length; i++) {
                if (rgbToOklch(seed.colors[i]).C > rgbToOklch(seed.colors[best]).C)
                    best = i;
            }
            return best;
        }
        function roleOf(i) {
            if (seed.colors.length < 2)
                return { key: 'both', name: 'Ground and accent' };
            if (i === 0)
                return { key: 'ground', name: 'Ground' };
            return i === accentIndex()
                ? { key: 'accent', name: 'Accent' }
                : { key: 'extra', name: 'Highlight' };
        }

        function renderDots() {
            const host = el('te-dots');
            const focused = active()?.closest?.('.te-dot');
            const focusedIndex = focused ? Number(focused.dataset.i) : -1;
            /* Update in place when the count has not changed. Rebuilding threw
               away the element that had focus, so an arrow-key nudge moved a dot
               exactly once and then went nowhere — the dot a keyboard user was
               holding stopped existing between keystrokes. */
            if (host.children.length !== seed.colors.length) {
                host.textContent = '';
                seed.colors.forEach((_, i) => host.appendChild(dotEl(i)));
            }
            const pos = ensurePositions();
            seed.colors.forEach((hex, i) => {
                const d = host.children[i];
                const p = fracToPx(pos[i]);
                const role = roleOf(i);
                d.style.left = p.x + 'px';
                d.style.top = p.y + 'px';
                d.style.background = hex;
                d.classList.toggle('on', i === activeDot);
                d.dataset.role = role.key;
                d.setAttribute('aria-label', `${role.name}, ${hex}`);
                d.title = `${role.name} · ${hex}`;
            });
            if (focusedIndex >= 0 && host.children[focusedIndex])
                host.children[focusedIndex].focus({ preventScroll: true });
            renderRoles();
            renderPalette();
            syncTools();
        }

        function dotEl(i) {
            const d = document.createElement('button');
            d.type = 'button';
            d.className = 'te-dot';
            d.dataset.i = String(i);
            d.addEventListener('focus', () => setActiveDot(i));
            d.addEventListener('pointerdown', () => setActiveDot(i));
            // Arrows nudge the pool — a dot only a mouse can move is not a control.
            d.addEventListener('keydown', (e) => {
                const step = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] }[e.key];
                if (!step) return;
                e.preventDefault();
                const p = ensurePositions()[i] || { x: 0.5, y: 0.5 };
                setDotPos(i, { x: clamp01(p.x + step[0]), y: clamp01(p.y + step[1]) });
            });
            return d;
        }

        const setActiveDot = (i) => {
            activeDot = Math.max(0, Math.min(i, seed.colors.length - 1));
            const host = el('te-dots');
            if (host)
                [...host.children].forEach((d, j) => d.classList.toggle('on', j === activeDot));
            renderRoles();
            renderPalette();
        };

        /* The roles, named, beside the tools. The wheel showed one to three
           anonymous discs and marked the accent with a ring inside it — a
           legend nobody has, for a distinction that decides what every selected
           row in the browser will look like. Naming them costs one row (shared
           with the tools) and makes the model legible: this one is the chrome,
           this one is the highlight. Clicking a chip focuses its dot, which is
           also the only pointer-free way to choose WHICH dot the arrows move. */
        function renderRoles() {
            const host = el('te-roles');
            if (!host)
                return;
            host.textContent = '';
            seed.colors.forEach((hex, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'te-chip' + (i === activeDot ? ' on' : '');
                b.dataset.i = String(i);
                const sw = document.createElement('span');
                sw.className = 'te-chip-dot';
                sw.style.background = hex;
                const label = document.createElement('span');
                label.className = 'te-chip-name';
                label.textContent = roleOf(i).name;
                b.append(sw, label);
                b.title = `${roleOf(i).name} · ${hex}`;
                b.addEventListener('click', () => {
                    setActiveDot(i);
                    el('te-dots')?.children[i]?.focus();
                });
                host.appendChild(b);
            });
        }

        /* The tools reflect the dot count: you cannot go below one colour
           or above three, and the buttons say so rather than failing. */
        function syncTools() {
            el('te-add').disabled = seed.colors.length >= 3;
            el('te-remove').disabled = seed.colors.length <= 1;
            el('te-scatter').disabled = seed.colors.length < 2;
        }

        /* Setting a pool's COLOUR re-derives the palette (colours are what the
           ramp reads); setting its POSITION only moves where it pools in the
           gradient — the two are separate, which is the whole point of the
           model. Both repaint the canvas and preview live. */
        function setDotColor(i, hex) {
            seed.colors[i] = hex;
            setActiveDot(i);
            renderDots();
            paintCanvas();
            paintControls();
            schedulePreview();
        }
        function setDotPos(i, frac) {
            ensurePositions();
            seed.positions[i] = { x: clamp01(frac.x), y: clamp01(frac.y) };
            // Move only the one dot — a full renderDots() rebuilds the palette
            // and roles on every pointer frame, which is churn under the drag.
            const d = el('te-dots')?.children[i];
            if (d) {
                const px = fracToPx(seed.positions[i]);
                d.style.left = px.x + 'px';
                d.style.top = px.y + 'px';
            }
            paintCanvas();
            schedulePreview();
        }

        /* Pointer drag on the canvas MOVES a pool. Grabbing a dot drags it;
           pressing bare canvas picks up the active pool and drops it where you
           pressed, so a click places the selected colour. */
        (() => {
            const canvas = el('te-canvas');
            let dragging = -1;
            const at = (e) => {
                const r = canvas.getBoundingClientRect();
                return { x: e.clientX - r.left, y: e.clientY - r.top };
            };
            canvas.addEventListener('pointerdown', (e) => {
                const dot = e.target.closest('.te-dot');
                const p = at(e);
                if (dot) {
                    dragging = Number(dot.dataset.i);
                    setActiveDot(dragging);
                }
                else {
                    dragging = Math.min(activeDot, seed.colors.length - 1);
                    setDotPos(dragging, posToFrac(p.x, p.y));
                    el('te-dots')?.children[dragging]?.focus({ preventScroll: true });
                }
                canvas.setPointerCapture(e.pointerId);
            });
            canvas.addEventListener('pointermove', (e) => {
                if (dragging < 0) return;
                const p = at(e);
                setDotPos(dragging, posToFrac(p.x, p.y));
            });
            const stop = () => { dragging = -1; };
            canvas.addEventListener('pointerup', stop);
            canvas.addEventListener('pointercancel', stop);
        })();

        // Mode. Two buttons, one on.
        el('te-mode-seg').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-m]');
            if (!b) return;
            setMode(b.dataset.m);
        });
        /* Arrows move within the group, the way a two-way segmented control is
           expected to: it was two ordinary buttons, so reaching Light meant
           tabbing past Dark, and neither reported that they were a pair. */
        el('te-mode-seg').addEventListener('keydown', (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
                return;
            e.preventDefault();
            setMode(seed.mode === 'dark' ? 'light' : 'dark');
            [...el('te-mode-seg').children].find(c => c.dataset.m === seed.mode)?.focus();
        });
        function setMode(m) {
            if (seed.mode === m)
                return;
            seed.mode = m;
            paintMode();
            paintControls();
            schedulePreview();
        }
        function paintMode() {
            [...el('te-mode-seg').children].forEach((c) => {
                const on = c.dataset.m === seed.mode;
                c.classList.toggle('on', on);
                c.setAttribute('aria-checked', String(on));
                c.tabIndex = on ? 0 : -1;
            });
        }

        el('te-add').addEventListener('click', () => {
            if (seed.colors.length >= 3) return;
            const { C, h } = rgbToOklch(seed.colors[0]);
            seed.colors.push(toHex(oklchToRgb(WHEEL_L, Math.max(C, 0.06), (h + 140) % 360)));
            // A new pool lands at its spread-out default slot, not on top of
            // an existing one — so the added colour is visible straight away.
            seed.positions = defaultPositions(seed.colors.length);
            setActiveDot(seed.colors.length - 1);
            renderDots(); paintCanvas(); paintControls(); schedulePreview();
        });
        el('te-remove').addEventListener('click', () => {
            if (seed.colors.length <= 1) return;
            seed.colors.pop();
            if (seed.positions) seed.positions.pop();
            setActiveDot(seed.colors.length - 1);
            renderDots(); paintCanvas(); paintControls(); schedulePreview();
        });
        el('te-scatter').addEventListener('click', arrange);

        /* ── The palette ─────────────────────────────────────────────────────
         *
         * A pool's colour is CHOSEN, not dragged for — the row of swatches sets
         * the active dot's colour, and the native picker at the end covers the
         * ones the row does not. The selected dot's own colour is marked so it
         * is clear which pool a click will recolour. */
        function renderPalette() {
            const host = el('te-palette');
            if (!host)
                return;
            const activeHex = (seed.colors[activeDot] || '').toLowerCase();
            // Build the fixed swatch row once; only the selected mark changes after.
            if (!host.dataset.built) {
                host.dataset.built = '1';
                for (const hex of PRESETS) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'te-sw';
                    b.dataset.hex = hex.toLowerCase();
                    b.style.background = hex;
                    b.title = hex;
                    b.setAttribute('aria-label', `Set the selected colour to ${hex}`);
                    b.addEventListener('click', () => setDotColor(activeDot, hex.toLowerCase()));
                    host.appendChild(b);
                }
                const pick = document.createElement('label');
                pick.className = 'te-sw te-sw-custom';
                pick.title = 'Custom colour';
                pick.setAttribute('aria-label', 'Custom colour');
                const input = document.createElement('input');
                input.type = 'color';
                input.id = 'te-color-input';
                input.addEventListener('input', (e) => setDotColor(activeDot, e.target.value.toLowerCase()));
                pick.appendChild(input);
                host.appendChild(pick);
            }
            for (const b of host.querySelectorAll('.te-sw'))
                b.classList.toggle('on', b.dataset.hex === activeHex);
            const input = el('te-color-input');
            if (input)
                input.value = /^#[0-9a-f]{6}$/.test(activeHex) ? activeHex : '#000000';
        }

        /* ── The three amounts ───────────────────────────────────────────────
         *
         * Shade, Intensity and Grain were a bespoke 58px dial with a bare
         * number in it and an unlabelled slider whose track was invisible. Two
         * controls, no names, no units, and one of them — the dial — had a
         * drag mapping (a 280° sweep starting at -140°) that nothing on screen
         * explained. Neither said what it did.
         *
         * They are now one anatomy repeated three times: name, track, value.
         * The track of each IS its own quantity — Shade runs through the actual
         * grounds you are choosing between, Intensity from neutral to the
         * fullest tint that survives the chroma ceiling, Grain draws the
         * texture as a wave that flattens at nothing and chops at full. A
         * control that renders its own range needs no legend, and it makes the
         * ceiling visible rather than hidden: past the point where the ground's
         * chroma is capped the Intensity track stops changing, which is the
         * truth about what that end of the slider does.
         *
         * All three are real <input type="range">, so they are keyboard-native
         * — the dial was a <div role="presentation"> with a visually hidden
         * range beside it doing the actual work.
         */
        const bandFor = mode => GROUND_L[mode === 'light' ? 'light' : 'dark'];

        /* The ground a given level and intensity produce — the same expression
           as rolesFromColors + the ground chroma cap in features/theme-derive.js. */
        function groundAt(level, intensity) {
            const [lo, hi] = bandFor(seed.mode);
            const { C, h } = rgbToOklch(seed.colors[0] || '#888888');
            return toHex(oklchToRgb(
                lo + (hi - lo) * clamp01(level),
                Math.min(C * clamp01(intensity), GROUND_C_MAX),
                h));
        }
        const rampCss = (at) => 'linear-gradient(90deg,' +
            [0, 0.25, 0.5, 0.75, 1].map(t => `${at(t)} ${t * 100}%`).join(',') + ')';

        function bindRange(id, key, onPaint) {
            el(id).addEventListener('input', (e) => {
                seed[key] = Number(e.target.value) / 100;
                onPaint();
                paintControls();
                schedulePreview();
            });
        }
        bindRange('te-shade', 'level', () => {});
        bindRange('te-intensity', 'intensity', () => {});
        bindRange('te-grain', 'grain', () => {});

        function paintControls() {
            const set = (id, v) => {
                const input = el(id);
                if (!input) return;
                input.value = String(Math.round(clamp01(v) * 100));
                const out = el(id + '-val');
                if (out) out.textContent = String(Math.round(clamp01(v) * 100));
            };
            set('te-shade', seed.level);
            set('te-intensity', seed.intensity);
            set('te-grain', seed.grain);
            const shade = el('te-shade-track');
            if (shade)
                shade.style.background = rampCss(t => groundAt(t, seed.intensity));
            const chroma = el('te-intensity-track');
            if (chroma)
                chroma.style.background = rampCss(t => groundAt(seed.level, t));
            paintWave();
            // Shade and Intensity both change the field, so keep it in step.
            paintCanvas();
        }

        /* The wave IS the value. It used to be a fixed squiggle — flat at one
           end, choppy at the other — that never moved, so it decorated the
           track rather than reporting it, and switching themes left it showing
           the last theme's texture. Amplitude now follows the grain: none is a
           straight line, full is a hard chop. */
        function paintWave() {
            const art = root.querySelector('.te-wave-art path');
            if (!art)
                return;
            const amp = 9 * clamp01(seed.grain);
            const W = 240, MID = 12, STEP = 8;
            let d = `M0 ${MID}`;
            for (let x = STEP; x <= W; x += STEP) {
                const dir = (x / STEP) % 2 ? -1 : 1;
                d += ` Q${(x - STEP / 2).toFixed(1)} ${(MID + dir * amp).toFixed(1)} ${x} ${MID}`;
            }
            art.setAttribute('d', d);
        }

        /* Every change goes STRAIGHT to the browser. There is no Save: a theme is
           a thing you look at, and a colour picker whose result only appears
           after you commit is one you have to guess at. Editing a theme of your
           own writes through to it; touching a built-in forks it into one of
           yours on the first change, because a built-in is not yours to alter
           and refusing to move would be the wrong answer to a dragged dot. */
        let commitTimer = null;
        let committing = false;

        /* A change paints IMMEDIATELY and saves LATER.
           The paint is inline custom properties on every surface of this window
           (see previewLive in features/theme-runtime.js) — same frame, no
           stylesheet swap, no disk. The save is the real thing, and it waits
           for you to stop moving. Saving on every frame was a stylesheet swap
           and a disk write per pointer move, which is what made the whole UI
           strobe while you dragged. */
        const schedulePreview = () => {
            try { T.live?.(seed); }
            catch (e) { /* the save below is still the source of truth */ }
            clearTimeout(commitTimer);
            commitTimer = setTimeout(commit, 260);
        };

        /* An unusable palette used to fail in SILENCE. `theme-live` refuses to
           paint one and `commit` returned before saving, so dragging into a
           region the contrast floors reject looked exactly like dragging into a
           region that had stopped responding — same wheel, same dot, nothing
           moving. The floors are worth keeping; not saying so is not. */
        function warn(message) {
            const w = el('te-warn');
            if (!w)
                return;
            w.textContent = message || '';
            w.hidden = !message;
        }

        async function commit() {
            if (committing)
                return;
            const res = await T.preview(seed);
            if (!res?.ok) {
                warn(res?.errors?.[0] ? `Not saved: ${res.errors[0]}.` : 'Not saved: this palette cannot be read.');
                return;  // unusable palette: leave the browser on the last good one
            }
            warn('');
            committing = true;
            try {
                /* The name is RE-DERIVED on every save, not fixed at creation.
                   A theme is named for its hue, and the name is now on screen
                   under the row — so a theme created in pink and dragged to
                   green sat there labelled "Pink", which is worse than no
                   caption at all. */
                const saved = await T.save({
                    id: editing?.id || null,
                    name: nameFor(seed, editing?.id),
                    seed,
                });
                if (!saved?.ok)
                    return;
                const isNew = !editing;
                editing = { id: saved.theme.id, name: saved.theme.name, seed: saved.theme.seed, kind: 'custom' };
                el('te-delete').hidden = false;
                await refresh();
                if (isNew || current !== saved.theme.id) {
                    current = saved.theme.id;
                    paint(current);
                    await ctx.setTheme(current);
                }
            }
            finally {
                committing = false;
            }
        }

        /* Themes are not named by hand — the swatch is the name. But a theme
           still needs one for the caption, its tooltip and its accessible
           label, so it takes the colour family of its first dot. Hue names, not
           "Custom 3": "Teal" tells you which swatch you are on, a number does
           not. Now that the name is ON SCREEN under the row, a second Teal has
           to be distinguishable from the first, so a clash takes a number. */
        const HUES = [
            [15, 'Red'], [45, 'Amber'], [75, 'Olive'], [110, 'Green'], [160, 'Teal'],
            [200, 'Cyan'], [240, 'Blue'], [280, 'Indigo'], [320, 'Violet'], [350, 'Pink'], [361, 'Red'],
        ];
        function nameFor(s, selfId = null) {
            const first = (s.colors || [])[0];
            const { C, h } = rgbToOklch(first || '#888888');
            const base = C < 0.02
                ? (s.mode === 'light' ? 'Paper' : 'Graphite')
                : (HUES.find(([max]) => h < max) || HUES[HUES.length - 1])[1];
            // A theme does not clash with itself: without this, re-saving
            // "Green" while still green renamed it "Green 2", then "Green 3".
            const taken = new Set(list.filter(t => t.id !== selfId).map(t => t.name));
            if (!taken.has(base))
                return base;
            for (let n = 2; n < 99; n++) {
                if (!taken.has(`${base} ${n}`))
                    return `${base} ${n}`;
            }
            return base;
        }

        /* A built-in has no wheel seed of its own, so the registry solves one
           backwards for it (features/themes.js, wheelSeedFor) and reports it as
           `wheelSeed`. This is the fallback for anything that arrives without
           one — the swatch's two colours, which is a rough copy rather than a
           faithful one. */
        function seedFromTheme(t) {
            if (!t?.swatch)
                return null;
            const colors = [t.swatch.shell];
            if (t.swatch.accent && t.swatch.accent !== t.swatch.shell)
                colors.push(t.swatch.accent);
            return { mode: t.mode || 'dark', colors, positions: [], intensity: 0.7, grain: 0 };
        }

        /**
         * `theme` is the CUSTOM theme being edited, or null for none.
         * `from` is what to start the wheel on when there is nothing to edit —
         * the theme you are about to fork. Selecting a built-in leaves you
         * looking at its colours, and the first drag turns that into a theme of
         * your own rather than refusing to move.
         */
        function openEditor(theme, from = null) {
            editing = theme;
            /* `wheelSeed` comes from the registry (features/themes.js) and is
               SOLVED backwards so the wheel draws what the browser is already
               wearing. Prefer it over the local swatch guess, which re-derived
               a ground from the dot's own lightness and landed a fork two
               elevation steps off the theme it was copying. */
            const src = theme?.seed || from?.wheelSeed || seedFromTheme(from);
            const colors = (src?.colors || ['#3a6ea5']).slice(0, 3);
            seed = src
                ? { mode: src.mode || 'dark',
                    colors,
                    positions: (Array.isArray(src.positions) ? src.positions : []).slice(0, colors.length),
                    intensity: src.intensity == null ? 0.7 : src.intensity,
                    grain: src.grain || 0,
                    level: src.level == null ? DEFAULT_LEVEL : src.level }
                : { mode: 'dark', colors: ['#3a6ea5'], positions: [], intensity: 0.7, grain: 0, level: DEFAULT_LEVEL };
            ensurePositions();
            activeDot = 0;
            warn('');
            resetDelete();
            paintMode();
            el('te-delete').hidden = !theme;
            editor.hidden = false;
            caption.classList.add('with-editor');
            renderDots();
            paintCanvas();
            paintControls();
            /* Focus the field itself, not a control below it: focusing
               something further down scrolled the canvas — the thing you opened
               this for — off the top of a panel. */
            el('te-dots')?.firstElementChild?.focus({ preventScroll: true });
            /* NO commit, and no live paint. Opening the editor is not a change:
               committing on open meant merely SELECTING a built-in forked it
               into a copy of your own, and painting on open meant opening the
               popup recoloured the whole browser before you had touched
               anything. The browser is already wearing what the canvas shows. */
        }

        /* In the Settings page the editor is a section you open; in the popup it
           IS the panel, so hiding it left a card containing nothing but a row
           of swatches. `alwaysOpen` keeps it up and hands Done to the host —
           there, the thing to dismiss is the panel, not the editor inside it. */
        const closeEditor = () => {
            if (ctx.alwaysOpen) {
                ctx.onCancel?.();
                return;
            }
            editor.hidden = true;
            caption.classList.remove('with-editor');
            editing = null;
        };
        el('te-cancel').addEventListener('click', closeEditor);

        /* "New theme" COPIES the theme you are wearing and hands you that to
           edit — starting from a hardcoded blue threw away the thing you had
           just chosen. It is not saved until you actually change something:
           opening an editor is not an edit, and committing here would create a
           theme every time the button was pressed. */
        function newTheme() {
            openEditor(null, list.find(t => t.id === current) || null);
            editor.scrollIntoView({ block: 'nearest' });
        }

        /* Delete asks once. It sits a few pixels from Done, it is the only
           control here that destroys something, and everything else in this
           editor is undoable by dragging back. Two clicks, and the button says
           what the second one will do. */
        let deleteArmed = 0;
        function resetDelete() {
            const b = el('te-delete');
            if (!b)
                return;
            deleteArmed = 0;
            b.textContent = 'Delete';
            b.classList.remove('armed');
        }
        el('te-delete').addEventListener('blur', resetDelete);
        el('te-delete').addEventListener('click', async () => {
            if (!editing)
                return;
            const b = el('te-delete');
            if (Date.now() > deleteArmed) {
                deleteArmed = Date.now() + 5000;
                b.textContent = 'Delete for good?';
                b.classList.add('armed');
                return;
            }
            resetDelete();
            const name = editing.name;
            await T.remove(editing.id);
            await refresh();
            if (ctx.alwaysOpen)
                openEditor(null, list.find(t => t.id === current) || null);
            else
                closeEditor();
            ctx.toast(`${name} deleted`);
        });

        // A radiogroup is one tab stop; arrows move within it.
        picker.addEventListener('keydown', (e) => {
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (!step)
                return;
            const opts = options();
            if (!opts.length)
                return;
            e.preventDefault();
            /* Move from what has FOCUS, not from what is checked. They are the
               same until you arrow onto something without committing to it, and
               then every further press jumped back to the checked swatch. */
            const from = opts.indexOf(active());
            const i = from >= 0 ? from : opts.findIndex(o => o.getAttribute('aria-checked') === 'true');
            const next = opts[(i + step + opts.length) % opts.length];
            next.focus();
            choose(next.dataset.themeValue);
        });

        T.onChanged?.(() => refresh());
        refresh().then(() => {
            if (!ctx.alwaysOpen)
                return;
            /* The popup opens straight into the editor, on the theme you are
               wearing: yours to edit in place, or a built-in ready to be forked
               by the first drag. It used to seed the wheel from that theme's
               ACCENT and paint it live, so opening the panel while wearing
               Slate turned the whole browser red-brown before anything had been
               touched. */
            const t = list.find(x => x.id === current);
            openEditor(t && t.kind === 'custom' ? t : null, t || null);
        });
        return { refresh, openEditor };
    }

    window.Northstar.themeEditor = { mount };
})();
