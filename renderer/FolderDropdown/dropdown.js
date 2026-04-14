/**
 * FolderDropdown — single-panel drill-down renderer
 *
 * One panel at a time. Clicking a folder navigates into it; a back button at
 * the top navigates out. The back button is also a drop target — dropping an
 * item on it moves it into the parent folder.
 *
 * During drag, hovering over a folder spring-opens it (navigates in) after
 * DRAG_SPRING_DELAY ms without any WebContentsView resize, because the panel
 * width is fixed and height changes are suppressed until drag ends.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="11"
  viewBox="0 0 24 20" fill="currentColor">
  <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0
           22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
</svg>`;

const DRAG_SPRING_DELAY = 500;   // ms hover before folder spring-opens during drag
const MAX_HEIGHT        = 480;   // px
const PANEL_WIDTH       = 240;   // px — fixed, never changes during drag
const PANEL_PADDING     = 16;    // px — shadow/border space in WebContentsView


// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

// navStack[i] = { folderId, title, children[] }
// navStack[0]  = root folder opened from the bookmark bar
// navStack[-1] = currently visible level
let navStack = [];

let dragId          = null;  // id of item being dragged
let dragFolderId    = null;  // folder that owns the dragged item
let dragSpringTimer = null;  // pending spring-open timer
let dragSpringBtn   = null;  // button the spring timer is targeting
let insidePanel     = false; // true once drag enters the panel area
let leftDropdown    = false; // true once drag exits the WebContentsView
let pendingResize   = false; // deferred updateSize (suppressed during drag)
let renamingId      = null;


// ─────────────────────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────────────────────

window.folderDropdown.onInit(({ children, folderId, title }) => {
    navStack      = [{ folderId, title: title || 'Folder', children: children || [] }];
    dragId        = null; dragFolderId = null;
    dragSpringTimer = null; dragSpringBtn = null;
    insidePanel   = false; leftDropdown = false;
    pendingResize = false; renamingId   = null;
    renderPanel();
});

window.folderDropdown.onRefreshPanel(({ folderId, children, renameId }) => {
    const idx = navStack.findIndex(n => n.folderId === folderId);
    if (idx === -1) return;
    navStack[idx].children = children;
    if (idx === navStack.length - 1) {
        renderPanel();
        if (renameId) requestAnimationFrame(() => startInlineRename(renameId, ''));
    }
});

window.folderDropdown.onStartRename(({ id, title }) => {
    startInlineRename(id, title || '');
});


// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

function currentLevel() {
    return navStack[navStack.length - 1];
}

function navigateInto(entry) {
    navStack.push({ folderId: entry.id, title: entry.title || 'Folder', children: entry.children || [] });
    renderPanel();
}

/**
 * Spring-navigate into a subfolder during a drag without touching the DOM
 * outside the items list. Replaces only the list contents in-place so the
 * OS drag session (which is tied to the drag source element) is not disturbed.
 * The navStack root entry is mutated to point at the subfolder so drop
 * handlers use the right folderId.
 */
function springInto(entry) {
    console.log('[drag] springInto', entry.id, 'children=', (entry.children||[]).length, 'dragId=', dragId);

    // Move the drag source to document.body BEFORE touching the list DOM.
    // This is a single atomic DOM move — the element is never parentless.
    // Calling .remove() first creates an orphan phase during which macOS fires
    // dragend synchronously, killing the drag session before springInto finishes.
    if (dragId) {
        const src = document.querySelector(`.item[data-id="${dragId}"]`);
        if (src) {
            src.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
            document.body.appendChild(src); // atomic move, never orphaned
        }
    }

    // Replace the root navStack entry with the subfolder — no push, no back button.
    navStack[0] = { folderId: entry.id, title: entry.title || 'Folder', children: entry.children || [] };

    const folderId = entry.id;
    const children = entry.children || [];

    const newList = document.createElement('div');
    newList.className = 'items-list';
    newList.dataset.folderId = folderId;

    if (!children.length) {
        const empty = document.createElement('div');
        empty.className   = 'empty';
        empty.textContent = '(empty)';
        newList.appendChild(empty);
    } else {
        children.forEach(e => {
            if (e.id === dragId) return; // skip — parked off-screen
            newList.appendChild(buildItem(e, folderId, newList));
        });
    }

    attachListDragHandlers(newList, folderId);

    const oldList = document.querySelector('.items-list');
    if (oldList) oldList.replaceWith(newList);
    else document.getElementById('container').appendChild(newList);

    updateSize();
}

function navigateBack() {
    if (navStack.length <= 1) return;
    navStack.pop();
    renderPanel();
}


// ─────────────────────────────────────────────────────────────────────────────
// Panel render
// ─────────────────────────────────────────────────────────────────────────────

function renderPanel() {
    const container = document.getElementById('container');

    // ── Drag-safe re-render ──────────────────────────────────────────────────
    // Removing the drag-source element from the DOM (via innerHTML='') ends the
    // OS drag session immediately on macOS/Chromium. To survive a spring-navigate
    // re-render mid-drag we:
    //   1. Detach the source element before clearing the container.
    //   2. Park it off-screen in document.body — drag session stays alive.
    //   3. Don't re-render it as a normal item (skip it in the child list).
    //   4. resetDragState() removes the parked element when drag ends.
    if (dragId) {
        const src = document.querySelector(`.item[data-id="${dragId}"]`);
        if (src) {
            src.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
            document.body.appendChild(src); // atomic move — never orphaned
        }
    }

    container.innerHTML = '';

    const depth = navStack.length - 1;
    const { folderId, title, children } = currentLevel();

    // Back button + current folder title (shown when inside a sub-folder)
    if (depth > 0) {
        const parentTitle = navStack[depth - 1].title;
        container.appendChild(buildBackButton(parentTitle));

        const header = document.createElement('div');
        header.className = 'folder-header';
        header.textContent = title;
        container.appendChild(header);
    }

    // Items
    const list = document.createElement('div');
    list.className = 'items-list';
    list.dataset.folderId = folderId;

    if (!children || !children.length) {
        const empty = document.createElement('div');
        empty.className   = 'empty';
        empty.textContent = '(empty)';
        list.appendChild(empty);
    } else {
        children.forEach(entry => {
            if (entry.id === dragId) return; // skip — parked off-screen
            list.appendChild(buildItem(entry, folderId, list));
        });
    }

    attachListDragHandlers(list, folderId);
    container.appendChild(list);

    updateSize();
}


// ─────────────────────────────────────────────────────────────────────────────
// Back button
// ─────────────────────────────────────────────────────────────────────────────

function buildBackButton(parentTitle) {
    const btn = document.createElement('button');
    btn.className = 'back-btn';

    const arrow = document.createElement('span');
    arrow.className = 'back-arrow';
    arrow.textContent = '‹';

    const lbl = document.createElement('span');
    lbl.className = 'back-label';
    lbl.textContent = parentTitle;

    btn.append(arrow, lbl);

    btn.addEventListener('click', () => {
        if (!dragId) navigateBack();
    });

    // Drop target: move dragged item into the parent folder, then navigate back
    btn.addEventListener('dragenter', (e) => {
        if (!dragId) return;
        e.preventDefault();
        btn.classList.add('drag-over');
    });
    btn.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.classList.add('drag-over');
    });
    btn.addEventListener('dragleave', (e) => {
        if (!btn.contains(e.relatedTarget)) btn.classList.remove('drag-over');
    });
    btn.addEventListener('drop', async (e) => {
        e.preventDefault();
        btn.classList.remove('drag-over');
        clearDragSpringTimer();
        clearDragVisuals();
        if (!dragId) return;

        const srcId = dragId;
        resetDragState();

        const parentFolderId = navStack[navStack.length - 2].folderId;
        await window.folderDropdown.moveIntoFolder(srcId, parentFolderId, null);
        // Remove from current level cache and navigate back
        navStack[navStack.length - 1].children =
            navStack[navStack.length - 1].children.filter(c => c.id !== srcId);
        navigateBack();
    });

    return btn;
}


// ─────────────────────────────────────────────────────────────────────────────
// updateSize — width is fixed; suppress height changes during drag
// ─────────────────────────────────────────────────────────────────────────────

function updateSize() {
    if (dragId) { pendingResize = true; return; }
    pendingResize = false;
    const container = document.getElementById('container');
    if (!container) return;
    const h = Math.min(container.scrollHeight + 8, MAX_HEIGHT);
    const w = PANEL_WIDTH + PANEL_PADDING;
    window.folderDropdown.updateBounds(w, h);
}


// ─────────────────────────────────────────────────────────────────────────────
// Item builder
// ─────────────────────────────────────────────────────────────────────────────

function buildItem(entry, folderId, list) {
    if (entry.type === 'divider') {
        const sep = document.createElement('div');
        sep.className = 'sep';
        return sep;
    }

    const btn = document.createElement('button');
    btn.className  = 'item';
    btn.dataset.id = entry.id;
    btn.draggable  = true;

    if (entry.type === 'folder') {
        buildFolderItem(btn, entry);
    } else {
        buildBookmarkItem(btn, entry);
    }

    attachItemContextMenu(btn, entry, folderId);
    attachItemDragHandlers(btn, entry, folderId, list);

    return btn;
}

function buildFolderItem(btn, entry) {
    const icon = document.createElement('span');
    icon.className = 'folder-icon-left';
    icon.innerHTML = FOLDER_SVG;

    const lbl = document.createElement('span');
    lbl.className   = 'item-label';
    lbl.textContent = entry.title || 'Folder';

    const arrow = document.createElement('span');
    arrow.className   = 'submenu-arrow';
    arrow.textContent = '▶';

    btn.append(icon, lbl, arrow);

    // Click navigates in (not during drag)
    btn.addEventListener('click', () => {
        if (dragId || renamingId) return;
        navigateInto(entry);
    });
}

function buildBookmarkItem(btn, entry) {
    try {
        const img   = document.createElement('img');
        img.src     = `https://www.google.com/s2/favicons?domain=${new URL(entry.url).hostname}`;
        img.onerror = () => img.remove();
        btn.appendChild(img);
    } catch {}

    const lbl = document.createElement('span');
    lbl.className = 'item-label';
    try { lbl.textContent = entry.title || new URL(entry.url).hostname; }
    catch { lbl.textContent = entry.url; }
    btn.appendChild(lbl);

    btn.addEventListener('mouseup', (e) => {
        if (dragId || renamingId || e.button === 2) return;
        if (e.metaKey || e.ctrlKey || e.button === 1) {
            window.folderDropdown.openNewTab(entry.url);
        } else {
            window.folderDropdown.navigate(entry.url);
        }
        window.folderDropdown.close();
    });

    btn.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        window.folderDropdown.openNewTab(entry.url);
        window.folderDropdown.close();
    });
}

function attachItemContextMenu(btn, entry, folderId) {
    btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.folderDropdown.showCtxMenu({
            type: entry.type,
            id:   entry.id,
            url:  entry.url,
            title: entry.title,
            parentFolderId: folderId,
        });
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// Drag helpers
// ─────────────────────────────────────────────────────────────────────────────

function clearDragVisuals() {
    document.querySelectorAll('.drag-into, .drop-before, .drag-over')
        .forEach(el => el.classList.remove('drag-into', 'drop-before', 'drag-over'));
}

function clearDragSpringTimer() {
    if (dragSpringTimer !== null) { clearTimeout(dragSpringTimer); dragSpringTimer = null; }
    dragSpringBtn = null;
}

function resetDragState() {
    const id  = dragId;
    dragId    = null; dragFolderId = null;
    insidePanel = false; leftDropdown = false;
    // Remove the off-screen parked element (kept alive during spring-navigate).
    if (id) document.querySelector(`.item[data-id="${id}"]`)?.remove();
    if (pendingResize) updateSize();
}


// ─────────────────────────────────────────────────────────────────────────────
// List-level drag handlers (drop on empty space)
// ─────────────────────────────────────────────────────────────────────────────

function attachListDragHandlers(list, folderId) {
    list.addEventListener('dragenter', () => { if (dragId) insidePanel = true; });

    list.addEventListener('dragover', (e) => {
        if (!dragId || e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    list.addEventListener('drop', async (e) => {
        if (!dragId || e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        clearDragSpringTimer();
        clearDragVisuals();

        const srcId = dragId;
        resetDragState();

        await window.folderDropdown.moveIntoFolder(srcId, folderId, null);
        // Optimistic: remove from cached children and re-render
        const lvl = navStack[navStack.length - 1];
        if (lvl.folderId === folderId) {
            const item = lvl.children.find(c => c.id === srcId);
            if (item) {
                lvl.children = [...lvl.children.filter(c => c.id !== srcId), item];
            }
            renderPanel();
        }
    });

    list.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        window.folderDropdown.showCtxMenu({
            type: 'folder-bg',
            id: folderId,
            title: currentLevel().title,
            parentFolderId: folderId,
        });
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// Item drag handlers
// ─────────────────────────────────────────────────────────────────────────────

function attachItemDragHandlers(btn, entry, folderId, list) {
    btn.addEventListener('dragstart', (e) => {
        if (renamingId) { e.preventDefault(); return; }

        dragId       = entry.id;
        dragFolderId = folderId;
        insidePanel  = false;
        leftDropdown = false;

        btn.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', entry.id);
        console.log('[drag] dragstart id=', entry.id);
    });

    btn.addEventListener('dragend', () => {
        console.log('[drag] dragend id=', entry.id, 'dragId=', dragId);
        btn.classList.remove('dragging');
        clearDragSpringTimer();
        clearDragVisuals();

        if (!dragId) return;

        const left = leftDropdown;
        resetDragState();

        if (left) {
            window.folderDropdown.dragEnd();
        } else {
            window.folderDropdown.close();
        }
    });

    btn.addEventListener('dragenter', (e) => {
        console.log('[drag] dragenter on', entry.id, entry.type, '| dragId=', dragId, '| dragSpringBtn===btn?', dragSpringBtn === btn);
        if (!dragId || dragId === entry.id) return;
        e.preventDefault();

        if (dragSpringBtn === btn) return;

        clearDragVisuals();
        clearDragSpringTimer();

        if (entry.type === 'folder') {
            btn.classList.add('drag-into');
            dragSpringBtn   = btn;
            console.log('[drag] spring timer set for', entry.id);
            dragSpringTimer = setTimeout(() => {
                console.log('[drag] spring timer fired for', entry.id, '| dragSpringBtn===btn?', dragSpringBtn === btn);
                dragSpringTimer = null;
                if (dragSpringBtn !== btn) return;
                dragSpringBtn = null;
                console.log('[drag] calling springInto', entry.id);
                springInto(entry);
            }, DRAG_SPRING_DELAY);
        } else {
            btn.classList.add('drop-before');
        }
    });

    btn.addEventListener('dragover', (e) => {
        if (!dragId || dragId === entry.id) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
    });

    btn.addEventListener('dragleave', (e) => {
        console.log('[drag] dragleave on', entry.id, '| relatedTarget=', e.relatedTarget, '| dragSpringBtn===btn?', dragSpringBtn === btn);
        if (btn.contains(e.relatedTarget)) return;
        // Only cancel the spring timer if the cursor moved to another item button.
        // Moving to the list background, a divider, or null (spurious macOS event)
        // does NOT count — the cursor is still effectively hovering this folder.
        const movedToItem = e.relatedTarget?.closest?.('.item[data-id]');
        if (movedToItem && movedToItem !== btn) {
            if (dragSpringBtn === btn) clearDragSpringTimer();
            btn.classList.remove('drag-into', 'drop-before');
        }
    });

    btn.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('drag-into', 'drop-before');
        clearDragSpringTimer();
        clearDragVisuals();

        if (!dragId || dragId === entry.id) return;

        const srcId = dragId;
        resetDragState();

        if (entry.type === 'folder') {
            // Move into folder, remove from current view, re-render
            const lvl = navStack[navStack.length - 1];
            lvl.children = lvl.children.filter(c => c.id !== srcId);
            await window.folderDropdown.moveIntoFolder(srcId, entry.id, null);
            renderPanel();
        } else {
            // Reorder within same panel
            const ids  = Array.from(list.querySelectorAll('.item[data-id]')).map(el => el.dataset.id);
            const from = ids.indexOf(srcId);
            const to   = ids.indexOf(entry.id);
            if (from !== -1 && to !== -1) {
                ids.splice(from, 1);
                ids.splice(to, 0, srcId);
                const lvl      = navStack[navStack.length - 1];
                const childMap = new Map(lvl.children.map(c => [c.id, c]));
                lvl.children   = ids.map(id => childMap.get(id)).filter(Boolean);
                await window.folderDropdown.reorderInFolder(folderId, ids);
                renderPanel();
            }
        }
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// Inline rename
// ─────────────────────────────────────────────────────────────────────────────

function startInlineRename(itemId, currentTitle) {
    const btn = document.querySelector(`.item[data-id="${itemId}"]`);
    if (!btn || renamingId === itemId) return;

    renamingId = itemId;
    const lbl  = btn.querySelector('.item-label');
    if (!lbl) return;

    const input = document.createElement('input');
    input.className = 'inline-rename-input';
    input.value     = currentTitle || lbl.textContent || '';
    lbl.style.display = 'none';
    btn.appendChild(input);

    const blockEvent = (e) => e.stopPropagation();
    btn.addEventListener('mouseup', blockEvent, true);
    btn.addEventListener('click',   blockEvent, true);

    requestAnimationFrame(() => { input.focus(); input.select(); });

    let done = false;

    async function commit() {
        if (done) return;
        done = true;
        renamingId = null;
        btn.removeEventListener('mouseup', blockEvent, true);
        btn.removeEventListener('click',   blockEvent, true);

        const newTitle = input.value.trim() || currentTitle || 'New Folder';
        input.remove();
        lbl.style.display = '';

        if (newTitle !== (currentTitle || lbl.textContent)) {
            lbl.textContent = newTitle;
            await window.folderDropdown.updateById(itemId, { title: newTitle });
        }
    }

    function cancel() {
        if (done) return;
        done = true;
        renamingId = null;
        btn.removeEventListener('mouseup', blockEvent, true);
        btn.removeEventListener('click',   blockEvent, true);
        input.remove();
        lbl.style.display = '';
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        e.stopPropagation();
    });
    input.addEventListener('blur', commit, { once: true });
}


// ─────────────────────────────────────────────────────────────────────────────
// Global drag-leave detection (cursor exits WebContentsView boundary)
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('dragleave', (e) => {
    if (!dragId || !insidePanel) return;

    const exitedView = e.clientX <= 2
        || e.clientY <= 2
        || e.clientX >= window.innerWidth  - 3
        || e.clientY >= window.innerHeight - 3;

    if (exitedView) {
        leftDropdown = true;
        window.folderDropdown.dragStart(dragId, dragFolderId);
        window.folderDropdown.close();
    }
});
