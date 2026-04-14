/**
 * FolderDropdown — single-panel drill-down renderer
 *
 * Tree navigation model:
 *   rootData    — the folder opened from the bookmark bar (never changes)
 *   currentNode — null means "show rootData", a folder entry means "show that folder"
 *   backStack   — array of folder entries for click-based back navigation
 *
 * During drag, spring-hover over a folder sets currentNode to that entry and
 * swaps the items list in-place. No WebContentsView resize happens — width is
 * fixed — so no spurious dragend is triggered on macOS.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="11"
  viewBox="0 0 24 20" fill="currentColor">
  <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0
           22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
</svg>`;

const DRAG_SPRING_DELAY = 500;
const MAX_HEIGHT        = 480;
const PANEL_WIDTH       = 240;
const PANEL_PADDING     = 16;


// ─────────────────────────────────────────────────────────────────────────────
// Tree state
// ─────────────────────────────────────────────────────────────────────────────

let rootData    = null;   // { folderId, title, children[] } — set on init, never mutated
let currentNode = null;   // null = rootData, else a folder entry reference
let backStack   = [];     // stack of folder entries for click-based back nav

function currentFolder() {
    return currentNode || rootData;
}


// ─────────────────────────────────────────────────────────────────────────────
// Drag state
// ─────────────────────────────────────────────────────────────────────────────

let dragId            = null;
let dragFolderId      = null;
let dragSpringTimer   = null;
let dragSpringBtn     = null;
let insidePanel       = false;
let leftDropdown      = false;
let pendingResize     = false;
let renamingId        = null;
let suppressDragEnd   = false; // true immediately after a spring-navigate fires


// ─────────────────────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────────────────────

window.folderDropdown.onInit(({ children, folderId, title }) => {
    rootData    = { folderId, title: title || 'Folder', children: children || [] };
    currentNode = null;
    backStack   = [];
    dragId = null; dragFolderId = null;
    dragSpringTimer = null; dragSpringBtn = null;
    insidePanel = false; leftDropdown = false;
    pendingResize = false; suppressDragEnd = false; renamingId = null;
    renderPanel();
});

window.folderDropdown.onRefreshPanel(({ folderId, children, renameId }) => {
    // Update data tree
    if (rootData && rootData.folderId === folderId) {
        rootData = { ...rootData, children };
    }
    for (let i = 0; i < backStack.length; i++) {
        if (backStack[i]?.id === folderId) backStack[i] = { ...backStack[i], children };
    }
    if (currentNode && currentNode.id === folderId) {
        currentNode = { ...currentNode, children };
    }

    // After a drag-drop the spring may have left currentNode pointing at a subfolder.
    // Reset back to root so the user sees the updated parent folder.
    if (!dragId && currentNode) {
        currentNode = null;
        backStack   = [];
    }

    renderPanel();
    if (renameId) requestAnimationFrame(() => startInlineRename(renameId, ''));
});

window.folderDropdown.onStartRename(({ id, title }) => {
    startInlineRename(id, title || '');
});


// ─────────────────────────────────────────────────────────────────────────────
// Navigation (click-based, uses backStack)
// ─────────────────────────────────────────────────────────────────────────────

function clickInto(entry) {
    if (currentNode) backStack.push(currentNode);
    else backStack.push(null); // null sentinel = "back to root"
    currentNode = entry;
    renderPanel();
}

function clickBack() {
    if (!backStack.length) return;
    const prev  = backStack.pop();
    currentNode = prev; // null restores root
    renderPanel();
}


// ─────────────────────────────────────────────────────────────────────────────
// Spring navigation (drag-based, direct pointer swap, no backStack)
// ─────────────────────────────────────────────────────────────────────────────

function springInto(entry) {
    console.log('[drag] springInto', entry.id, entry.title, '| dragId=', dragId);

    // Suppress the dragend that fires immediately after swapItemsList mutates the DOM.
    // The OS ends the drag session when hit-testing is disturbed by the swap, then
    // restarts it — the dragend listener must not call close() in that window.
    suppressDragEnd = true;
    setTimeout(() => { suppressDragEnd = false; }, 150);

    // Move drag source to document.body ATOMICALLY before any DOM changes.
    if (dragId) {
        const src = document.querySelector(`.item[data-id="${dragId}"]`);
        if (src) {
            src.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
            document.body.appendChild(src);
        }
    }

    currentNode = entry;
    swapItemsList();
}


// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full panel render — rebuilds the entire container.
 * Only called outside of drag (init, click nav, refresh).
 */
function renderPanel() {
    // Park drag source atomically before wiping the container
    if (dragId) {
        const src = document.querySelector(`.item[data-id="${dragId}"]`);
        if (src) {
            src.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
            document.body.appendChild(src);
        }
    }

    const container = document.getElementById('container');
    container.innerHTML = '';

    const folder = currentFolder();
    const depth  = backStack.length + (currentNode ? 1 : 0);

    if (depth > 0) {
        const parentTitle = backStack.length
            ? (backStack[backStack.length - 1]?.title || rootData.title)
            : rootData.title;
        container.appendChild(buildBackButton(parentTitle));

        const header = document.createElement('div');
        header.className   = 'folder-header';
        header.textContent = folder.title || folder.id;
        container.appendChild(header);
    }

    container.appendChild(buildList(folder));
    updateSize();
}

/**
 * Swap only the items list in-place — used during drag spring-navigation.
 * The container chrome (back button, header) is intentionally left alone.
 */
function swapItemsList() {
    const folder  = currentFolder();
    const newList = buildList(folder);
    const oldList = document.querySelector('.items-list');
    if (oldList) oldList.replaceWith(newList);
    else document.getElementById('container').appendChild(newList);
    updateSize();
}

function buildList(folder) {
    const folderId = folder.folderId || folder.id;
    const children = folder.children || [];

    const list = document.createElement('div');
    list.className        = 'items-list';
    list.dataset.folderId = folderId;

    if (!children.length) {
        const empty = document.createElement('div');
        empty.className   = 'empty';
        empty.textContent = '(empty)';
        list.appendChild(empty);
    } else {
        children.forEach(entry => {
            if (entry.id === dragId) return; // skip parked source
            list.appendChild(buildItem(entry, folderId, list));
        });
    }

    attachListDragHandlers(list, folderId);
    return list;
}


// ─────────────────────────────────────────────────────────────────────────────
// Back button
// ─────────────────────────────────────────────────────────────────────────────

function buildBackButton(parentTitle) {
    const btn = document.createElement('button');
    btn.className = 'back-btn';

    const arrow = document.createElement('span');
    arrow.className   = 'back-arrow';
    arrow.textContent = '‹';

    const lbl = document.createElement('span');
    lbl.className   = 'back-label';
    lbl.textContent = parentTitle;

    btn.append(arrow, lbl);
    btn.addEventListener('click', () => { if (!dragId) clickBack(); });

    // Drop target: move item into the parent folder then go back
    btn.addEventListener('dragenter', (e) => { if (!dragId) return; e.preventDefault(); btn.classList.add('drag-over'); });
    btn.addEventListener('dragover',  (e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    btn.addEventListener('dragleave', (e) => { if (!btn.contains(e.relatedTarget)) btn.classList.remove('drag-over'); });
    btn.addEventListener('drop', async (e) => {
        e.preventDefault();
        btn.classList.remove('drag-over');
        clearDragSpringTimer();
        clearDragVisuals();
        if (!dragId) return;

        const srcId = dragId;
        resetDragState();

        const parentFolderId = backStack.length
            ? (backStack[backStack.length - 1]?.id || rootData.folderId)
            : rootData.folderId;
        await window.folderDropdown.moveIntoFolder(srcId, parentFolderId, null);
        currentNode = backStack.pop() || null;
        renderPanel();
    });

    return btn;
}


// ─────────────────────────────────────────────────────────────────────────────
// updateSize
// ─────────────────────────────────────────────────────────────────────────────

function updateSize() {
    if (dragId) { pendingResize = true; return; }
    pendingResize = false;
    const container = document.getElementById('container');
    if (!container) return;
    const h = Math.min(container.scrollHeight + 8, MAX_HEIGHT);
    window.folderDropdown.updateBounds(PANEL_WIDTH + PANEL_PADDING, h);
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
    btn.addEventListener('click', () => { if (!dragId && !renamingId) clickInto(entry); });
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
            type: entry.type, id: entry.id,
            url: entry.url, title: entry.title,
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
    const id = dragId;
    dragId = null; dragFolderId = null;
    insidePanel = false; leftDropdown = false;
    if (id) document.querySelector(`.item[data-id="${id}"]`)?.remove();
    if (pendingResize) updateSize();
}


// ─────────────────────────────────────────────────────────────────────────────
// List drag handlers (drop on empty space)
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
        // onRefreshPanel will re-render when the IPC broadcast arrives
    });

    list.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        const f = currentFolder();
        window.folderDropdown.showCtxMenu({
            type: 'folder-bg',
            id: f.folderId || f.id,
            title: f.title,
            parentFolderId: f.folderId || f.id,
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
        console.log('[drag] dragstart', entry.id);
    });

    btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        clearDragSpringTimer();
        clearDragVisuals();
        if (!dragId) return;
        // Spurious dragend fired by macOS when swapItemsList mutated the DOM.
        // The OS drag session is still live — do nothing at all.
        if (suppressDragEnd) {
            return;
        }
        const left = leftDropdown;
        resetDragState();
        console.log('[drag] dragend real — left=', left);
        if (left) window.folderDropdown.dragEnd();
        else window.folderDropdown.close();
    });

    // dragenter is reliable on macOS; dragover is often dispatched to the list
    // container instead of the child button, so spring logic lives here.
    btn.addEventListener('dragenter', (e) => {
        if (!dragId || dragId === entry.id) return;
        e.preventDefault();
        if (dragSpringBtn === btn) return;

        clearDragVisuals();
        clearDragSpringTimer();

        if (entry.type === 'folder') {
            btn.classList.add('drag-into');
            dragSpringBtn   = btn;
            dragSpringTimer = setTimeout(() => {
                dragSpringTimer = null;
                if (dragSpringBtn !== btn) return;
                dragSpringBtn = null;
                console.log('[drag] spring firing for', entry.id);
                springInto(entry);
            }, DRAG_SPRING_DELAY);
            console.log('[drag] spring armed for', entry.id);
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
        if (btn.contains(e.relatedTarget)) return;
        // Only cancel if cursor moved to another item — not to list background or null.
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
            await window.folderDropdown.moveIntoFolder(srcId, entry.id, null);
        } else {
            const ids  = Array.from(list.querySelectorAll('.item[data-id]')).map(el => el.dataset.id);
            const from = ids.indexOf(srcId);
            const to   = ids.indexOf(entry.id);
            if (from !== -1 && to !== -1) {
                ids.splice(from, 1);
                ids.splice(to, 0, srcId);
                await window.folderDropdown.reorderInFolder(folderId, ids);
            } else {
                await window.folderDropdown.moveIntoFolder(srcId, folderId, entry.id);
            }
        }
        // onRefreshPanel will re-render when the IPC broadcast arrives
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// Inline rename
// ─────────────────────────────────────────────────────────────────────────────

function startInlineRename(itemId, currentTitle) {
    const btn = document.querySelector(`.item[data-id="${itemId}"]`);
    if (!btn || renamingId === itemId) return;

    renamingId    = itemId;
    const lbl     = btn.querySelector('.item-label');
    if (!lbl) return;

    const input = document.createElement('input');
    input.className = 'inline-rename-input';
    input.value     = currentTitle || lbl.textContent || '';
    lbl.style.display = 'none';
    btn.appendChild(input);

    const block = (e) => e.stopPropagation();
    btn.addEventListener('mouseup', block, true);
    btn.addEventListener('click',   block, true);
    requestAnimationFrame(() => { input.focus(); input.select(); });

    let done = false;

    async function commit() {
        if (done) return; done = true;
        renamingId = null;
        btn.removeEventListener('mouseup', block, true);
        btn.removeEventListener('click',   block, true);
        const newTitle = input.value.trim() || currentTitle || 'New Folder';
        input.remove(); lbl.style.display = '';
        if (newTitle !== (currentTitle || lbl.textContent)) {
            lbl.textContent = newTitle;
            await window.folderDropdown.updateById(itemId, { title: newTitle });
        }
    }

    function cancel() {
        if (done) return; done = true;
        renamingId = null;
        btn.removeEventListener('mouseup', block, true);
        btn.removeEventListener('click',   block, true);
        input.remove(); lbl.style.display = '';
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        e.stopPropagation();
    });
    input.addEventListener('blur', commit, { once: true });
}


// ─────────────────────────────────────────────────────────────────────────────
// Global drag-leave (cursor exits WebContentsView)
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('dragleave', (e) => {
    if (!dragId || !insidePanel) return;
    const exited = e.clientX <= 2 || e.clientY <= 2
        || e.clientX >= window.innerWidth  - 3
        || e.clientY >= window.innerHeight - 3;
    if (exited) {
        leftDropdown = true;
        window.folderDropdown.dragStart(dragId, dragFolderId);
        window.folderDropdown.close();
    }
});
