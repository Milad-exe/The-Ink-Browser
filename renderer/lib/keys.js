/**
 * Keyboard behaviour for overlay panels.
 *
 * A menu you can only click is half a menu. Every floating panel in the browser
 * wants the same three things — arrows move between rows, Enter activates the
 * focused one, Escape closes — and each was either reimplementing that or
 * (mostly) doing without. This is that behaviour, once.
 *
 * `rows(root, opts)` treats the visible rows under `root` as a roving-tabindex
 * group: the group is a single tab stop, arrows move inside it, Home/End jump
 * to the ends, and typing a letter jumps to the next row starting with it (the
 * type-ahead every native menu has).
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.Ink = root.Ink || {};
    root.Ink.keys = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const visible = (el) => el.offsetParent !== null && !el.hasAttribute('disabled');

    /**
     * @param {Element} root      container to listen on
     * @param {object}  opts
     * @param {string}  opts.selector  which descendants are rows
     * @param {Function} [opts.onEscape]  called when Escape is pressed
     * @param {boolean} [opts.focusFirst] focus the first row on wire-up
     * @param {boolean} [opts.typeahead]  jump to a row by first letter (default true)
     */
    function rows(root, opts) {
        if (!root)
            return;
        const { selector, onEscape, focusFirst = false, typeahead = true } = opts || {};
        const list = () => [...root.querySelectorAll(selector)].filter(visible);

        const focusAt = (items, i) => {
            const next = items[(i + items.length) % items.length];
            if (!next)
                return;
            for (const el of items)
                el.tabIndex = -1;
            next.tabIndex = 0;
            next.focus();
        };
        const sync = () => {
            const items = list();
            if (!items.length)
                return items;
            const focused = items.findIndex(el => el === document.activeElement);
            for (const el of items)
                el.tabIndex = -1;
            items[focused === -1 ? 0 : focused].tabIndex = 0;
            return items;
        };

        root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (onEscape) {
                    e.preventDefault();
                    onEscape();
                }
                return;
            }
            const items = list();
            if (!items.length)
                return;
            const i = items.findIndex(el => el === document.activeElement || el.contains(document.activeElement));
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                focusAt(items, i === -1 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1));
            }
            else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                focusAt(items, e.key === 'Home' ? 0 : items.length - 1);
            }
            else if (typeahead && e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const ch = e.key.toLowerCase();
                const from = (i === -1 ? 0 : i + 1);
                const order = [...items.slice(from), ...items.slice(0, from)];
                const hit = order.find(el => (el.textContent || '').trim().toLowerCase().startsWith(ch));
                if (hit) {
                    e.preventDefault();
                    focusAt(items, items.indexOf(hit));
                }
            }
        });

        const items = sync();
        if (focusFirst && items.length)
            focusAt(items, 0);
    }

    return { rows };
});
