/**
 * FolderDropdown — renderer-side controller
 *
 * Rendered inside a transparent WebContentsView that floats above the browser
 * chrome. Main process opens it via `folder-dropdown-open` IPC and sends data
 * via the `window.folderDropdown` context-bridge API defined in
 * preload/folder-dropdown-preload.js.
 *
 * Layout: a horizontal row of cascading `.list` panels. Each panel represents
 * one folder depth level. Opening a sub-folder appends a new panel to the right;
 * moving away closes it. Panels share the same DOM container and are never
 * re-created from scratch when only their contents change — `rebuildPanel()`
 * replaces a single panel in-place.
 *
 * Data flow:
 *   main.js  →  folder-dropdown-init         → onInit()
 *   main.js  →  folder-dropdown-refresh-panel → onRefreshPanel()
 *   main.js  →  folder-dropdown-start-rename  → onStartRename()
 *   user     →  drag / click / contextmenu    → IPC back to main.js
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="11"
  viewBox="0 0 24 20" fill="currentColor">
  <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0
           22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
</svg>`;

/** Delay (ms) before a hovered folder opens its sub-panel on mouse hover. */
const HOVER_OPEN_DELAY  = 200;

/** Delay (ms) before sub-panels collapse when the cursor leaves a panel. */
const HOVER_CLOSE_DELAY = 300;

/** Delay (ms) a dragged item must hover over a folder before it spring-opens. */
const DRAG_SPRING_DELAY = 600;

/** Maximum dropdown height in pixels before it clips. */
const MAX_HEIGHT = 480;

/** Width of each panel column in pixels (used to compute total WebContentsView width). */
const PANEL_WIDTH = 220;

/** Gap between panels + trailing padding reserved in the WebContentsView. */
const PANEL_GAP_PADDING = 28;


// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parallel arrays tracking open panels.
 * panels[i]   — the `.list` DOM element for depth level i
 * panelData[i] — { folderId, title, children } for depth level i
 */
let panels    = [];
let panelData = [];

// Hover timers (normal navigation, not drag)
let hoverOpenTimer  = null; // fires to open a sub-panel on folder mouseenter
let hoverCloseTimer = null; // fires to collapse sub-panels on panel mouseleave

// Drag state
let dragId         = null;  // id of the item being dragged
let dragFolderId   = null;  // id of the folder that owns the dragged item
let dragSpringTimer = null; // fires to spring-open a folder during drag
let insideList     = false; // true once drag has entered the list area
let leftDropdown   = false; // true once drag leaves the WebContentsView boundary

// Rename state
let renamingId = null; // id of the item currently in inline-rename mode


// ─────────────────────────────────────────────────────────────────────────────
// IPC event handlers (from main process)
// ─────────────────────────────────────────────────────────────────────────────

/** Initial data sent when the dropdown first opens. */
window.folderDropdown.onInit(({ children, folderId, title }) => {
    document.getElementById('container').innerHTML = '';
    panels    = [];
    panelData = [];
    hoverOpenTimer  = null;
    hoverCloseTimer = null;
    dragId = null; dragFolderId = null;
    dragSpringTimer = null;
    insideList = false; leftDropdown = false;
    renamingId = null;
    appendPanel(0, children || [], folderId, title || 'Folder');
});

/**
 * Refresh a single panel's contents in-place (without closing the dropdown).
 * Called after Create / Delete / Reorder operations that affect a specific folder.
 * If `renameId` is provided the new item enters inline-rename mode immediately.
 */
window.folderDropdown.onRefreshPanel(({ folderId, children, renameId }) => {
    const level = panelData.findIndex(p => p.folderId === folderId);
    if (level === -1) return;

    panelData[level].children = children;
    collapseFrom(level + 1);  // discard stale sub-panels
    rebuildPanel(level);

    if (renameId) {
        requestAnimationFrame(() => startInlineRename(renameId, ''));
    }
});

/** Trigger inline rename for any currently visible item. */
window.folderDropdown.onStartRename(({ id, title }) => {
    startInlineRename(id, title || '');
});


// ─────────────────────────────────────────────────────────────────────────────
// Panel management
// ─────────────────────────────────────────────────────────────────────────────

/** Remove all panels at depth >= `level`, collapsing the cascade. */
function collapseFrom(level) {
    while (panels.length > level) {
        panels.pop().remove();
        panelData.pop();
    }
    updateSize();
}

/** Append a new panel at `level` (replacing any deeper panels). */
function appendPanel(level, children, folderId, title) {
    const list = buildList(children, folderId, title, level);
    panelData.push({ folderId, title: title || 'Folder', children });
    panels.push(list);
    document.getElementById('container').appendChild(list);
    updateSize();
}

/** Open a sub-panel at level + 1, collapsing any currently open sibling. */
function openSubPanel(level, children, folderId, title) {
    collapseFrom(level + 1);
    appendPanel(level + 1, children, folderId, title);
}

/**
 * Rebuild the DOM for an existing panel from panelData without touching
 * adjacent levels. Used after in-place content changes (reorder, delete, add).
 */
function rebuildPanel(level) {
    const { children, folderId, title } = panelData[level];
    const newList = buildList(children, folderId, title, level);
    panels[level].replaceWith(newList);
    panels[level] = newList;
    updateSize();
}

/**
 * Tell the main process the new pixel dimensions so it can resize the
 * WebContentsView to exactly fit the rendered content.
 */
function updateSize() {
    requestAnimationFrame(() => {
        if (!panels.length) return;
        const tallest = Math.max(...panels.map(p => p.scrollHeight));
        const h = Math.min(tallest + 8, MAX_HEIGHT);
        const w = panels.length * (PANEL_WIDTH + 4) + PANEL_GAP_PADDING;
        window.folderDropdown.updateBounds(w, h);
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// Inline rename
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace a visible item's label with a text input.
 * Enter / blur → commit (saves via IPC). Escape → cancel (restores label).
 */
function startInlineRename(itemId, currentTitle) {
    // Find the button across all open panels
    let btn = null;
    for (const panel of panels) {
        btn = panel.querySelector(`.item[data-id="${itemId}"]`);
        if (btn) break;
    }
    if (!btn || renamingId === itemId) return;

    renamingId = itemId;

    const lbl = btn.querySelector('.item-label');
    if (!lbl) return;

    // Swap label for input
    const input = document.createElement('input');
    input.className = 'inline-rename-input';
    input.value = currentTitle || lbl.textContent || '';
    lbl.style.display = 'none';
    btn.appendChild(input);

    // Block the button's click/mouseup handlers while the input is active
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
            lbl.textContent = newTitle; // optimistic update
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
// Drag helpers
// ─────────────────────────────────────────────────────────────────────────────

function clearDragVisuals() {
    document.querySelectorAll('.drag-into, .drop-before')
        .forEach(el => el.classList.remove('drag-into', 'drop-before'));
}

function clearDragSpringTimer() {
    if (dragSpringTimer !== null) {
        clearTimeout(dragSpringTimer);
        dragSpringTimer = null;
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// List (panel) builder
// ─────────────────────────────────────────────────────────────────────────────

function buildList(children, folderId, folderTitle, level) {
    const list = document.createElement('div');
    list.className = 'list';

    if (!children || !children.length) {
        const empty = document.createElement('div');
        empty.className  = 'empty';
        empty.textContent = '(empty)';
        list.appendChild(empty);
    } else {
        children.forEach(entry => {
            list.appendChild(buildItem(entry, folderId, level, list));
        });
    }

    attachListEvents(list, folderId, folderTitle, level);
    return list;
}

/** Attach mouse and drag listeners to the list panel element itself. */
function attachListEvents(list, folderId, folderTitle, level) {
    // Right-click on the panel background (not on an item) → folder context menu
    list.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        window.folderDropdown.showCtxMenu({
            type: 'folder-bg',
            id: folderId,
            title: folderTitle || 'Folder',
            parentFolderId: folderId,
        });
    });

    // Cancel any pending collapse when the cursor re-enters this panel
    list.addEventListener('mouseenter', () => {
        if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
    });

    // Schedule collapse of deeper panels when the cursor leaves this panel,
    // but only if it did not move into the next panel.
    list.addEventListener('mouseleave', (e) => {
        if (dragId) return;
        const nextPanel = panels[level + 1];
        if (nextPanel && (nextPanel === e.relatedTarget || nextPanel.contains(e.relatedTarget))) return;
        if (hoverOpenTimer)  { clearTimeout(hoverOpenTimer);  hoverOpenTimer  = null; }
        hoverCloseTimer = setTimeout(() => collapseFrom(level + 1), HOVER_CLOSE_DELAY);
    });

    // Drag: mark that the cursor is now inside a list (needed for dragleave detection)
    list.addEventListener('dragenter', () => {
        if (dragId) insideList = true;
    });

    // Drag: accept drops on the panel background → append to end of this folder
    list.addEventListener('dragover', (e) => {
        if (!dragId || e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    list.addEventListener('drop', async (e) => {
        if (!dragId || e.target.closest('.item[data-id]')) return;
        e.preventDefault();

        const srcId = dragId;
        resetDragState();

        await window.folderDropdown.moveIntoFolder(srcId, folderId, null);

        // Remove item from local cache and rebuild panel in-place
        if (panelData[level]) {
            panelData[level].children = (panelData[level].children || [])
                .filter(c => c.id !== srcId);
            collapseFrom(level + 1);
            rebuildPanel(level);
        }
    });
}

function resetDragState() {
    dragId = null;
    dragFolderId = null;
    insideList   = false;
    leftDropdown = false;
}


// ─────────────────────────────────────────────────────────────────────────────
// Item builder
// ─────────────────────────────────────────────────────────────────────────────

function buildItem(entry, folderId, level, list) {
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
        buildFolderItem(btn, entry, level);
    } else {
        buildBookmarkItem(btn, entry);
    }

    attachItemContextMenu(btn, entry, folderId);
    attachItemDragHandlers(btn, entry, folderId, level, list);

    return btn;
}

/** Populate a folder-type item and attach hover-open behaviour. */
function buildFolderItem(btn, entry, level) {
    const icon  = document.createElement('span');
    icon.className = 'folder-icon-left';
    icon.innerHTML = FOLDER_SVG;

    const lbl   = document.createElement('span');
    lbl.className  = 'item-label';
    lbl.textContent = entry.title || 'Folder';

    const arrow = document.createElement('span');
    arrow.className  = 'submenu-arrow';
    arrow.textContent = '▶';

    btn.append(icon, lbl, arrow);

    // Mouseenter — start timer to open sub-panel
    btn.addEventListener('mouseenter', () => {
        if (dragId || renamingId === entry.id) return;

        if (hoverCloseTimer) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
        if (hoverOpenTimer)  { clearTimeout(hoverOpenTimer);  hoverOpenTimer  = null; }

        // Mark this folder as having its submenu open (used for CSS highlight)
        panels[level]?.querySelectorAll('.item.has-submenu-open')
            .forEach(el => el.classList.remove('has-submenu-open'));
        btn.classList.add('has-submenu-open');

        hoverOpenTimer = setTimeout(() => {
            openSubPanel(level, entry.children || [], entry.id, entry.title || 'Folder');
        }, HOVER_OPEN_DELAY);
    });

    // Mouseleave — cancel pending open; schedule close unless moving into sub-panel
    btn.addEventListener('mouseleave', (e) => {
        if (dragId) return;
        if (hoverOpenTimer) { clearTimeout(hoverOpenTimer); hoverOpenTimer = null; }

        const nextPanel = panels[level + 1];
        if (nextPanel && (nextPanel === e.relatedTarget || nextPanel.contains(e.relatedTarget))) return;

        hoverCloseTimer = setTimeout(() => collapseFrom(level + 1), HOVER_CLOSE_DELAY);
    });
}

/** Populate a bookmark-type item and attach navigation behaviour. */
function buildBookmarkItem(btn, entry) {
    try {
        const img   = document.createElement('img');
        img.src     = `https://www.google.com/s2/favicons?domain=${new URL(entry.url).hostname}`;
        img.onerror = () => img.remove();
        btn.appendChild(img);
    } catch {}

    const lbl   = document.createElement('span');
    lbl.className  = 'item-label';
    try { lbl.textContent = entry.title || new URL(entry.url).hostname; }
    catch { lbl.textContent = entry.url; }
    btn.appendChild(lbl);

    // Left-click or Cmd/Ctrl-click to navigate
    btn.addEventListener('mouseup', (e) => {
        if (dragId || renamingId || e.button === 2) return;
        if (e.metaKey || e.ctrlKey || e.button === 1) {
            window.folderDropdown.openNewTab(entry.url);
        } else {
            window.folderDropdown.navigate(entry.url);
        }
        window.folderDropdown.close();
    });

    // Middle-click to open in background tab
    btn.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        window.folderDropdown.openNewTab(entry.url);
        window.folderDropdown.close();
    });
}

/** Attach the right-click context menu to any item type. */
function attachItemContextMenu(btn, entry, folderId) {
    btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation(); // prevent the list background handler from firing
        window.folderDropdown.showCtxMenu({
            type: entry.type,
            id:   entry.id,
            url:  entry.url,
            title: entry.title,
            parentFolderId: folderId,
        });
    });
}

/**
 * Attach all drag-and-drop event handlers to an item button.
 *
 * Drag mechanics:
 *   - dragstart   : set drag state; call raise() to keep the view above tab WebContentsViews
 *   - dragover    : show drop indicator; for folders, start spring-open timer
 *   - dragleave   : clear visuals and cancel spring timer
 *   - drop        : reorder within panel OR move into a sub-folder
 *   - dragend     : clean up; if drag left the dropdown, send IPC to bar renderer
 */
function attachItemDragHandlers(btn, entry, folderId, level, list) {
    btn.addEventListener('dragstart', (e) => {
        if (renamingId) { e.preventDefault(); return; }

        dragId       = entry.id;
        dragFolderId = folderId;
        insideList   = false;
        leftDropdown = false;

        btn.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', entry.id);

        // Re-insert the WebContentsView as the last contentView child so it
        // renders above the active tab during a drag operation.
        window.folderDropdown.raise();
    });

    btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        clearDragSpringTimer();
        clearDragVisuals();

        if (!dragId) return; // already handled by a drop handler

        const id   = dragId;
        const fid  = dragFolderId;
        const left = leftDropdown;
        resetDragState();

        if (left) {
            // dragleave already called dragStart (started cursor poll + closed view).
            // Now fire dragEnd so the bar renderer can execute the move.
            window.folderDropdown.dragEnd();
        } else {
            // Drag ended inside the dropdown without hitting a drop target.
            window.folderDropdown.dragStart(id, fid);
            window.folderDropdown.dragEnd();
            window.folderDropdown.close();
        }
    });

    btn.addEventListener('dragover', (e) => {
        if (!dragId || dragId === entry.id) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        clearDragVisuals();

        if (entry.type === 'folder') {
            btn.classList.add('drag-into');
            // Spring-open: expand folder if cursor stays here long enough
            if (dragSpringTimer === null) {
                dragSpringTimer = setTimeout(() => {
                    dragSpringTimer = null;
                    openSubPanel(level, entry.children || [], entry.id, entry.title || 'Folder');
                }, DRAG_SPRING_DELAY);
            }
        } else {
            btn.classList.add('drop-before');
        }
    });

    btn.addEventListener('dragleave', () => {
        btn.classList.remove('drag-into', 'drop-before');
        clearDragSpringTimer();
    });

    btn.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('drag-into', 'drop-before');
        clearDragSpringTimer();

        if (!dragId || dragId === entry.id) return;

        const srcId = dragId;
        resetDragState();

        if (entry.type === 'folder') {
            await dropIntoFolder(srcId, entry, level);
        } else {
            await dropReorder(srcId, entry.id, folderId, level, list);
        }
    });
}

/** Move `srcId` into a folder item and rebuild the current panel in-place. */
async function dropIntoFolder(srcId, folderEntry, level) {
    await window.folderDropdown.moveIntoFolder(srcId, folderEntry.id, null);
    if (panelData[level]) {
        panelData[level].children = (panelData[level].children || [])
            .filter(c => c.id !== srcId);
        collapseFrom(level + 1);
        rebuildPanel(level);
    }
}

/** Reorder `srcId` to just before `targetId` within the current panel. */
async function dropReorder(srcId, targetId, folderId, level, list) {
    const ids  = Array.from(list.querySelectorAll('.item[data-id]')).map(el => el.dataset.id);
    const from = ids.indexOf(srcId);
    const to   = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;

    ids.splice(from, 1);
    ids.splice(to, 0, srcId);

    await window.folderDropdown.reorderInFolder(folderId, ids);

    if (panelData[level]) {
        const childMap = new Map((panelData[level].children || []).map(c => [c.id, c]));
        panelData[level].children = ids.map(id => childMap.get(id)).filter(Boolean);
        collapseFrom(level + 1);
        rebuildPanel(level);
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// Global drag-leave detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect when a drag leaves the WebContentsView boundary entirely.
 * We intentionally keep dragId alive here — dragend still needs it to call
 * dragEnd() IPC on the main process, which signals the bar renderer to execute
 * the move.
 */
document.addEventListener('dragleave', (e) => {
    if (!dragId || !insideList) return;

    const exitedView = e.relatedTarget === null
        || e.clientX <= 2
        || e.clientY <= 2
        || e.clientX >= window.innerWidth  - 3
        || e.clientY >= window.innerHeight - 3;

    if (exitedView) {
        leftDropdown = true;
        window.folderDropdown.dragStart(dragId, dragFolderId);
        window.folderDropdown.close();
    }
});
