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

    const clampInto = (menu, x, y, parentRect) => {
        const w = menu.offsetWidth, h = menu.offsetHeight;
        let left = x;
        // Submenus flip to the parent's left edge when they'd leave the window.
        if (parentRect && left + w > window.innerWidth - 6) left = parentRect.left - w + 2;
        const vw = window.innerWidth, vh = window.innerHeight;
        // A degenerate viewport must not clamp, or every bound collapses to the
        // margin and the menu lands in the corner instead of under the cursor.
        menu.style.left = (vw > w ? Math.max(6, Math.min(left, vw - w - 6)) : Math.max(6, left)) + 'px';
        menu.style.top = (vh > h ? Math.max(6, Math.min(y, vh - h - 6)) : Math.max(6, y)) + 'px';
    };

    const place = (menu, x, y, parentRect) => {
        surface.appendChild(menu);
        clampInto(menu, x, y, parentRect);
        /* The first menu of a session is measured before the web font has
           loaded, so it is shorter than it will be — and a clamp computed from
           that height let it hang off the bottom of the window with its last
           row cut off. Re-run once layout has settled. */
        const again = () => { if (menu.isConnected) clampInto(menu, x, y, parentRect); };
        requestAnimationFrame(again);
        try { document.fonts?.ready.then(again); }
        catch (e) { /* re-clamp is best effort; the first pass already placed it */ }
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
            /* `disabled` and `checked` come from Electron menu templates routed
               through features/overlay-menu.js — a page or bookmark menu can
               have a greyed row or a tick, and dropping them would have made
               those menus lie. */
            b.className = 'ctx-menu-item' + (r.cls ? ' ' + r.cls : '')
                + (r.sub ? ' has-sub' : '') + (r.checked ? ' is-checked' : '');
            if (r.disabled)
                b.disabled = true;
            b.appendChild(document.createTextNode(r.label));
            if (r.checked) {
                const tick = document.createElement('span');
                tick.className = 'ctx-check';
                tick.textContent = '✓';
                b.appendChild(tick);
            }
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

    let shownAt = 0;   // when the current menu went up, for the blur guard
    let shownSeq = 0;  // which open it was, so push and pull don't both build it

    const open = (data) => {
        if (!data)
            return;
        // The push and the pull below can both deliver the FIRST menu. Building
        // it twice is not just wasted work: the rebuild moves keyboard focus
        // back to the first row under a user who has already pressed Down.
        if (data.seq && data.seq === shownSeq)
            return;
        shownSeq = data.seq || 0;
        clear();
        const root = data.kind === 'emoji' ? buildEmoji(data) : build(data.rows, 0, []);
        chain.push(root);
        place(root, data.x, data.y);
        shownAt = Date.now();
        armKeys();
    };

    window.overlayMenu.onOpen(open);
    /* …and ask what is already pending. This view is created BY the first
       right-click, so that click's data can be sent before this script is
       listening — which is why the first right-click of a session opened an
       empty menu and the second one worked. */
    try { window.overlayMenu.ready?.().then(open); }
    catch (e) { /* the push above is the normal path */ }

    // Clear the chain as well as telling main to hide us, so the view never
    // holds a stale menu that could flash on the next open.
    const dismiss = () => { clear(); window.overlayMenu.dismiss(); };
    // A press anywhere outside the open menu chain closes it. Listen on the
    // document in CAPTURE so it fires whichever element takes the event — the
    // bare surface, a submenu gutter, the search field — rather than relying on
    // the press landing on #surface specifically (a left-click just outside a
    // menu was landing on nothing the surface listener saw, so it never closed).
    // pointerdown covers mouse, pen and touch in one.
    document.addEventListener('pointerdown', (e) => {
        if (!chain.some(m => m.contains(e.target))) dismiss();
    }, true);
    // A context menu you can only click is half a menu: arrows move, Enter
    // activates, Escape closes, and typing jumps by first letter. Re-armed on
    // every open because the rows are rebuilt each time.
    const armKeys = () => {
        const top = chain[chain.length - 1];
        // No focusFirst: opening a menu with the mouse should not pre-select a
        // row (right-clicking the sidebar highlighting the first item read as a
        // stray selection). Arrow keys still start from the top/bottom.
        window.Northstar?.keys?.rows(top || document, { selector: '.ctx-menu-item', onEscape: dismiss });
    };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') dismiss();
    });
    /* The window losing focus should not leave a menu stranded on screen, but
       two kinds of blur are not the user leaving, and acting on either told main
       to hide the menu that had since taken this one's place — which is why
       every other right-click drew nothing. One: opening focuses this view, and
       raising it churns focus for a frame. Two: main hands focus back to the
       chrome when it hides us, so every dismissal echoes back here. A click on
       the surface is different — that one always dismisses, or a full-window
       overlay would be left eating clicks. */
    window.addEventListener('blur', () => {
        if (!chain.length || Date.now() - shownAt < 250)
            return;
        dismiss();
    });
})();
