const FOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="11" viewBox="0 0 24 20" fill="currentColor"><path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/></svg>`;

// ── State ────────────────────────────────────────────────────────────────────
let _panels     = [];  // DOM .list elements, one per open level
let _panelData  = [];  // { folderId, title, children } per level

let _hoverTimer   = null; // open sub-panel after hovering a folder
let _closeTimer   = null; // collapse sub-panel after leaving a panel

let _dragId       = null;
let _dragFolderId = null;
let _dragHoverTimer = null; // spring-open timer while dragging over a folder
let _insideList   = false;
let _leftDropdown = false;

let _renamingId   = null;

// ── Init ──────────────────────────────────────────────────────────────────────
window.folderDropdown.onInit(({ children, folderId, title }) => {
    document.getElementById('container').innerHTML = '';
    _panels = []; _panelData = [];
    _dragId = null; _dragFolderId = null;
    _insideList = false; _leftDropdown = false; _renamingId = null;
    appendPanel(0, children || [], folderId, title || 'Folder');
});

// Refresh a specific panel's contents in-place.
// If renameId is provided, immediately start inline rename for that item.
window.folderDropdown.onRefreshPanel(({ folderId, children, renameId }) => {
    const level = _panelData.findIndex(p => p.folderId === folderId);
    if (level === -1) return;
    _panelData[level].children = children;
    collapseFrom(level + 1);
    rebuildPanel(level);
    if (renameId) requestAnimationFrame(() => startInlineItemRename(renameId, ''));
});

window.folderDropdown.onStartRename(({ id, title }) => {
    startInlineItemRename(id, title || '');
});

// ── Panel management ──────────────────────────────────────────────────────────
function collapseFrom(level) {
    while (_panels.length > level) {
        _panels.pop().remove();
        _panelData.pop();
    }
    updateSize();
}

function appendPanel(level, children, folderId, title) {
    const list = buildList(children, folderId, title, level);
    _panelData.push({ folderId, title: title || 'Folder', children });
    _panels.push(list);
    document.getElementById('container').appendChild(list);
    updateSize();
}

function openSubPanel(level, children, folderId, title) {
    collapseFrom(level + 1);
    appendPanel(level + 1, children, folderId, title);
}

// Rebuild a panel at `level` from _panelData without touching other levels.
function rebuildPanel(level) {
    const { children, folderId, title } = _panelData[level];
    const newList = buildList(children, folderId, title, level);
    _panels[level].replaceWith(newList);
    _panels[level] = newList;
    updateSize();
}

function clearDragVisuals() {
    document.querySelectorAll('.drag-into, .drop-before')
        .forEach(n => n.classList.remove('drag-into', 'drop-before'));
}

// ── Inline rename ─────────────────────────────────────────────────────────────
function startInlineItemRename(itemId, currentTitle) {
    let btn = null;
    for (const panel of _panels) {
        btn = panel.querySelector(`.item[data-id="${itemId}"]`);
        if (btn) break;
    }
    if (!btn || _renamingId === itemId) return;
    _renamingId = itemId;

    const lbl = btn.querySelector('.item-label');
    if (!lbl) return;

    const input = document.createElement('input');
    input.className = 'inline-rename-input';
    input.value = currentTitle || lbl.textContent || '';
    lbl.style.display = 'none';
    btn.appendChild(input);

    const blockClick = (e) => e.stopPropagation();
    btn.addEventListener('mouseup', blockClick, true);
    btn.addEventListener('click',   blockClick, true);

    requestAnimationFrame(() => { input.focus(); input.select(); });

    let committed = false;

    async function commit() {
        if (committed) return;
        committed = true;
        _renamingId = null;
        btn.removeEventListener('mouseup', blockClick, true);
        btn.removeEventListener('click',   blockClick, true);
        const newTitle = input.value.trim() || currentTitle || 'New Folder';
        input.remove();
        lbl.style.display = '';
        if (newTitle !== (currentTitle || lbl.textContent)) {
            lbl.textContent = newTitle;
            await window.folderDropdown.updateById(itemId, { title: newTitle });
        }
    }

    function cancel() {
        if (committed) return;
        committed = true;
        _renamingId = null;
        btn.removeEventListener('mouseup', blockClick, true);
        btn.removeEventListener('click',   blockClick, true);
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

// ── List builder ───────────────────────────────────────────────────────────────
function buildList(children, folderId, folderTitle, level) {
    const list = document.createElement('div');
    list.className = 'list';

    if (!children || !children.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '(empty)';
        list.appendChild(empty);
    } else {
        children.forEach(entry => list.appendChild(buildItem(entry, folderId, level, list)));
    }

    list.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        window.folderDropdown.showCtxMenu({
            type: 'folder-bg', id: folderId,
            title: folderTitle || 'Folder', parentFolderId: folderId,
        });
    });

    // Cancel pending close when the cursor enters this panel (e.g. from parent panel)
    list.addEventListener('mouseenter', () => {
        if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
    });
    // Close deeper panels when cursor leaves this panel (unless going into a sub-panel)
    list.addEventListener('mouseleave', (e) => {
        if (_dragId) return;
        const nextPanel = _panels[level + 1];
        if (nextPanel && (nextPanel === e.relatedTarget || nextPanel.contains(e.relatedTarget))) return;
        if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
        _closeTimer = setTimeout(() => collapseFrom(level + 1), 300);
    });

    list.addEventListener('dragenter', () => { if (_dragId) _insideList = true; });
    list.addEventListener('dragover', (e) => {
        if (!_dragId || e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });
    list.addEventListener('drop', async (e) => {
        if (!_dragId || e.target.closest('.item[data-id]')) return;
        e.preventDefault();
        const srcId = _dragId;
        _dragId = null; _dragFolderId = null; _insideList = false; _leftDropdown = false;
        await window.folderDropdown.moveIntoFolder(srcId, folderId, null);
        // Remove from local data and rebuild panel in-place
        if (_panelData[level]) {
            _panelData[level].children = (_panelData[level].children || []).filter(c => c.id !== srcId);
            collapseFrom(level + 1);
            rebuildPanel(level);
        }
    });

    return list;
}

function buildItem(entry, folderId, level, list) {
    if (entry.type === 'divider') {
        const sep = document.createElement('div');
        sep.className = 'sep';
        return sep;
    }

    const btn = document.createElement('button');
    btn.className = 'item';
    btn.dataset.id = entry.id;
    btn.draggable = true;

    if (entry.type === 'folder') {
        const icon = document.createElement('span');
        icon.className = 'folder-icon-left';
        icon.innerHTML = FOLDER_SVG;
        btn.appendChild(icon);

        const lbl = document.createElement('span');
        lbl.className = 'item-label';
        lbl.textContent = entry.title || 'Folder';
        btn.appendChild(lbl);

        const arrow = document.createElement('span');
        arrow.className = 'submenu-arrow';
        arrow.textContent = '▶';
        btn.appendChild(arrow);

        // Hover to open sub-panel
        btn.addEventListener('mouseenter', () => {
            if (_dragId || _renamingId === entry.id) return;
            if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
            if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
            _panels[level]?.querySelectorAll('.item.has-submenu-open')
                .forEach(el => el.classList.remove('has-submenu-open'));
            btn.classList.add('has-submenu-open');
            _hoverTimer = setTimeout(() => {
                openSubPanel(level, entry.children || [], entry.id, entry.title || 'Folder');
            }, 200);
        });
        btn.addEventListener('mouseleave', (e) => {
            if (_dragId) return;
            if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
            const nextPanel = _panels[level + 1];
            if (nextPanel && (nextPanel === e.relatedTarget || nextPanel.contains(e.relatedTarget))) return;
            // Start close timer; cancelled if cursor enters the sub-panel
            _closeTimer = setTimeout(() => collapseFrom(level + 1), 300);
        });

    } else {
        try {
            const img = document.createElement('img');
            img.src = `https://www.google.com/s2/favicons?domain=${new URL(entry.url).hostname}`;
            img.onerror = () => img.remove();
            btn.appendChild(img);
        } catch {}

        const lbl = document.createElement('span');
        lbl.className = 'item-label';
        try { lbl.textContent = entry.title || new URL(entry.url).hostname; }
        catch { lbl.textContent = entry.url; }
        btn.appendChild(lbl);

        btn.addEventListener('mouseup', (e) => {
            if (_dragId || _renamingId || e.button === 2) return;
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

    btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.folderDropdown.showCtxMenu({
            type: entry.type, id: entry.id,
            url: entry.url, title: entry.title,
            parentFolderId: folderId,
        });
    });

    // ── Drag ──────────────────────────────────────────────────────────────────
    btn.addEventListener('dragstart', (e) => {
        if (_renamingId) { e.preventDefault(); return; }
        _dragId = entry.id; _dragFolderId = folderId;
        _insideList = false; _leftDropdown = false;
        btn.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', entry.id);
        // Re-lift the dropdown WebContentsView above the active tab view.
        // Electron's drag system can silently demote the view in z-order.
        window.folderDropdown.raise();
    });

    btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        if (_dragHoverTimer !== null) { clearTimeout(_dragHoverTimer); _dragHoverTimer = null; }
        clearDragVisuals();
        if (_dragId) {
            const id = _dragId, fid = _dragFolderId, left = _leftDropdown;
            _dragId = null; _dragFolderId = null; _insideList = false; _leftDropdown = false;
            if (left) {
                window.folderDropdown.dragEnd();
            } else {
                window.folderDropdown.dragStart(id, fid);
                window.folderDropdown.dragEnd();
                window.folderDropdown.close();
            }
        }
    });

    btn.addEventListener('dragover', (e) => {
        if (!_dragId || _dragId === entry.id) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        clearDragVisuals();
        if (entry.type === 'folder') {
            btn.classList.add('drag-into');
            // Spring-open: hover for 600ms while dragging to expand the folder
            if (_dragHoverTimer === null) {
                _dragHoverTimer = setTimeout(() => {
                    _dragHoverTimer = null;
                    openSubPanel(level, entry.children || [], entry.id, entry.title || 'Folder');
                }, 600);
            }
        } else {
            btn.classList.add('drop-before');
        }
    });

    btn.addEventListener('dragleave', () => {
        btn.classList.remove('drag-into', 'drop-before');
        if (_dragHoverTimer !== null) { clearTimeout(_dragHoverTimer); _dragHoverTimer = null; }
    });

    btn.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        btn.classList.remove('drag-into', 'drop-before');
        if (!_dragId || _dragId === entry.id) return;

        const srcId = _dragId;
        _dragId = null; _dragFolderId = null; _insideList = false; _leftDropdown = false;

        if (entry.type === 'folder') {
            // Move source into this sub-folder — remove from current panel, rebuild
            await window.folderDropdown.moveIntoFolder(srcId, entry.id, null);
            if (_panelData[level]) {
                _panelData[level].children = (_panelData[level].children || []).filter(c => c.id !== srcId);
                collapseFrom(level + 1);
                rebuildPanel(level);
            }
        } else {
            // Reorder within this panel
            const ids = Array.from(list.querySelectorAll('.item[data-id]')).map(el => el.dataset.id);
            const from = ids.indexOf(srcId), to = ids.indexOf(entry.id);
            if (from === -1 || to === -1) return;
            ids.splice(from, 1); ids.splice(to, 0, srcId);
            await window.folderDropdown.reorderInFolder(folderId, ids);
            // Rebuild from new order without closing
            if (_panelData[level]) {
                const childMap = new Map((_panelData[level].children || []).map(c => [c.id, c]));
                _panelData[level].children = ids.map(id => childMap.get(id)).filter(Boolean);
                collapseFrom(level + 1);
                rebuildPanel(level);
            }
        }
    });

    return btn;
}

// ── Size ──────────────────────────────────────────────────────────────────────
function updateSize() {
    requestAnimationFrame(() => {
        if (!_panels.length) return;
        const h = Math.min(Math.max(..._panels.map(p => p.scrollHeight)) + 8, 480);
        const w = _panels.length * 224 + 24;
        window.folderDropdown.updateBounds(w, h);
    });
}

// ── Drag leave — cursor exited WebContentsView ────────────────────────────────
document.addEventListener('dragleave', (e) => {
    if (!_dragId || !_insideList) return;
    if (e.relatedTarget === null || e.clientX <= 2 || e.clientY <= 2 ||
        e.clientX >= window.innerWidth - 3 || e.clientY >= window.innerHeight - 3) {
        _leftDropdown = true;
        window.folderDropdown.dragStart(_dragId, _dragFolderId);
        window.folderDropdown.close();
    }
});
