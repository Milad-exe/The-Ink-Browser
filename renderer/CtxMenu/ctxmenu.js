"use strict";
// Context-menu overlay. Runs in its own WebContentsView so menus paint ABOVE the
// page (chrome DOM cannot: the page view is composited over it). The whole chain
// lives in this one view, so submenus need no extra views.
//
// Rows arrive as plain data — functions can't cross IPC — and a pick is reported
// back as a path of indices ([2] or [4, 1]) that the chrome maps to its handler.
(() => {
    const surface = document.getElementById('surface');
    let chain = []; // menu elements, root first

    const clear = () => { chain.forEach(m => m.remove()); chain = []; };

    const place = (menu, x, y, parentRect) => {
        surface.appendChild(menu);
        const w = menu.offsetWidth, h = menu.offsetHeight;
        let left = x;
        // Submenus flip to the parent's left edge when they'd leave the window.
        if (parentRect && left + w > window.innerWidth - 6) left = parentRect.left - w + 2;
        menu.style.left = Math.max(6, Math.min(left, window.innerWidth - w - 6)) + 'px';
        menu.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 6)) + 'px';
    };

    const closeFrom = (depth) => { while (chain.length > depth) chain.pop().remove(); };

    const build = (rows, depth, path) => {
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';
        rows.forEach((r, i) => {
            if (r.sep) {
                const s = document.createElement('div');
                s.className = 'ctx-menu-sep';
                menu.appendChild(s);
                return;
            }
            const here = path.concat(i);
            const b = document.createElement('button');
            b.className = 'ctx-menu-item' + (r.cls ? ' ' + r.cls : '') + (r.sub ? ' has-sub' : '');
            b.appendChild(document.createTextNode(r.label));
            if (r.sub) {
                const ar = document.createElement('span');
                ar.className = 'ctx-sub-arrow';
                ar.textContent = '›';
                b.appendChild(ar);
            }
            b.addEventListener('mouseenter', () => {
                closeFrom(depth + 1);
                if (!r.sub || !r.sub.length) return;
                const rc = b.getBoundingClientRect();
                const child = build(r.sub, depth + 1, here);
                chain.push(child);
                place(child, rc.right - 2, rc.top - 5, rc);
            });
            b.addEventListener('click', (e) => {
                if (r.sub) { e.stopPropagation(); return; }
                clear();
                window.overlayMenu.pick(here);
            });
            menu.appendChild(b);
        });
        return menu;
    };

    // Emoji picker shares the overlay so it also paints above the page.
    const buildEmoji = (data) => {
        const menu = document.createElement('div');
        menu.className = 'ctx-menu emoji-pop';
        const search = document.createElement('input');
        search.className = 'emoji-search';
        search.type = 'text';
        search.placeholder = 'Search emojis';
        const grid = document.createElement('div');
        grid.className = 'emoji-pop-grid';
        const paint = (q) => {
            grid.innerHTML = '';
            const needle = (q || '').trim().toLowerCase();
            if (data.allowNone && !needle) {
                const none = document.createElement('button');
                none.className = 'emoji-opt emoji-none';
                none.title = 'No emoji (dot)';
                none.addEventListener('click', () => { clear(); window.overlayMenu.pick({ emoji: '' }); });
                grid.appendChild(none);
            }
            for (const [e, kw] of data.emojis) {
                if (needle && !kw.includes(needle)) continue;
                const b = document.createElement('button');
                b.className = 'emoji-opt';
                b.textContent = e;
                b.title = kw.split(' ')[0];
                b.addEventListener('click', () => { clear(); window.overlayMenu.pick({ emoji: e }); });
                grid.appendChild(b);
            }
        };
        paint('');
        search.addEventListener('input', () => paint(search.value));
        search.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { clear(); window.overlayMenu.dismiss(); }
            if (e.key === 'Enter') grid.querySelector('.emoji-opt')?.click();
        });
        menu.appendChild(search);
        menu.appendChild(grid);
        setTimeout(() => search.focus(), 0);
        return menu;
    };

    window.overlayMenu.onOpen((data) => {
        clear();
        const root = data.kind === 'emoji' ? buildEmoji(data) : build(data.rows, 0, []);
        chain.push(root);
        place(root, data.x, data.y);
        armKeys();
    });

    // Clear the chain as well as telling main to hide us, so the view never
    // holds a stale menu that could flash on the next open.
    const dismiss = () => { clear(); window.overlayMenu.dismiss(); };
    // A click that reaches the surface missed every menu.
    surface.addEventListener('mousedown', (e) => {
        if (!chain.some(m => m.contains(e.target))) dismiss();
    });
    // A context menu you can only click is half a menu: arrows move, Enter
    // activates, Escape closes, and typing jumps by first letter. Re-armed on
    // every open because the rows are rebuilt each time.
    const armKeys = () => {
        const top = chain[chain.length - 1];
        window.Ink?.keys?.rows(top || document, { selector: '.ctx-menu-item', onEscape: dismiss, focusFirst: true });
    };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') dismiss();
    });
    // The window losing focus should not leave a menu stranded on screen.
    window.addEventListener('blur', dismiss);
})();
