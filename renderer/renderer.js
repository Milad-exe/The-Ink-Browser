document.addEventListener("DOMContentLoaded", async () => {
    let _settings = {};
    try { _settings = await window.inkSettings.get(); } catch {}
    const getSearchEngine = () => _settings.searchEngine || 'google';
    const getPomSetting = (key, def) => (typeof _settings[key] === 'number' ? _settings[key] : def);
    const addBtn = document.getElementById("new-tab-btn");
    const tabBar = document.getElementById("tab-bar");
    const tabsContainer = document.getElementById("tabs-container");
    const searchBar = document.getElementById("searchBar");
    // Overlay-based suggestions: compute bounds for overlay
    function getSuggestionsBounds() {
        const rect = searchBar.getBoundingClientRect();
        return { left: rect.left, top: rect.bottom + 4, width: rect.width };
    }
    const backBtn = document.getElementById("back-btn");
    const forwardBtn = document.getElementById("forward-btn");
    const reloadBtn = document.getElementById("reload-btn");
    const menuBtn = document.getElementById("menu-btn");

    // ── Window controls ───────────────────────────────────────────────────────
    (function initWindowControls() {
        const container = document.getElementById('window-controls');
        if (!container || !window.windowControls) return;
        const platform = window.windowControls.platform;

        if (platform === 'darwin') {
            // Native macOS traffic lights handle this via titleBarStyle: 'hidden'.
            // We just add spacing so it doesn't overlap our other native header elements.
            container.innerHTML = ``;
            container.style.width = "72px"; // Reserve space for native traffic lights
            container.classList.add('wc-mac');
        } else {
            // Windows / Linux: right side
            container.innerHTML = `
                <button class="wc-btn wc-minimize" id="wc-minimize" title="Minimize">
                  <svg viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
                </button>
                <button class="wc-btn wc-maximize" id="wc-maximize" title="Maximize">
                  <svg viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>
                </button>
                <button class="wc-btn wc-close"    id="wc-close"    title="Close">
                  <svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
                </button>`;
            container.classList.add('wc-win');
        }

        document.getElementById('wc-close')?.addEventListener('click', () => window.windowControls.close());
        document.getElementById('wc-minimize')?.addEventListener('click', () => window.windowControls.minimize());
        document.getElementById('wc-maximize')?.addEventListener('click', async () => {
            await window.windowControls.maximize();
        });

        window.windowControls.onMaximizeChanged((isMax) => {
            const btn = document.getElementById('wc-maximize');
            if (!btn) return;
            if (platform !== 'darwin') {
                btn.querySelector('svg')?.setAttribute('viewBox', isMax ? '0 0 10 10' : '0 0 10 10');
                btn.title = isMax ? 'Restore' : 'Maximize';
                btn.innerHTML = isMax
                    ? `<svg viewBox="0 0 10 10" fill="none"><rect x="2" y="0" width="8" height="8" stroke="currentColor"/><rect x="0" y="2" width="8" height="8" stroke="currentColor" fill="var(--surface-container-lowest)"/></svg>`
                    : `<svg viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>`;
            }
        });
    })();

    let tabs = new Map();
    let tabUrls = new Map(); // index → url, kept in sync for switch-to-tab suggestions
    let activeTabIndex = 0;
    let menuOpen = false;
    
    window.pinActiveTab = () => window.tab.pin(activeTabIndex);

    window.addEventListener("click", (e) => {
        if (menuOpen) {
            window.electronAPI.windowClick({ x: e.clientX, y: e.clientY });
        }
    });

    window.menu.onClosed(() => { menuOpen = false; });

    backBtn.addEventListener("click", () => { window.tab.goBack(activeTabIndex); });
    forwardBtn.addEventListener("click", () => { window.tab.goForward(activeTabIndex); });
    reloadBtn.addEventListener("click", () => { window.tab.reload(activeTabIndex); });

    // Suggestions state
    let currentSuggestions = [];
    let activeSuggestionIndex = -1;
    let overlayPointerDown = false;
    let _userTyping = false; // only show suggestions when the user actually typed

    // Debounce helper — returns a function with a .cancel() method
    const debounce = (fn, delay = 150) => {
        let t;
        const debounced = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
        debounced.cancel = () => clearTimeout(t);
        return debounced;
    };

    // Position suggestions below the address bar
    function positionSuggestions() {
        if (!currentSuggestions.length) return;
        const b = getSuggestionsBounds();
        window.suggestions.update(b, currentSuggestions, activeSuggestionIndex);
    }

    function hideSuggestions() {
        _userTyping = false;
        updateSuggestions.cancel();
        window.suggestions.close();
        currentSuggestions = [];
        activeSuggestionIndex = -1;
    }

    function renderSuggestions(list) {
        if (!_userTyping) return;
        currentSuggestions = list;
        activeSuggestionIndex = list.length ? 0 : -1;
        if (!list.length) { hideSuggestions(); return; }
        const b = getSuggestionsBounds();
        window.suggestions.open(b, currentSuggestions, activeSuggestionIndex).catch(() => {});
    }

    function setActiveSuggestion(newIndex) {
        if (!currentSuggestions.length) return;
        if (newIndex < 0) newIndex = currentSuggestions.length - 1;
        if (newIndex >= currentSuggestions.length) newIndex = 0;
        activeSuggestionIndex = newIndex;
        // Fill the URL bar with the selected item's URL or query
        const item = currentSuggestions[newIndex];
        if (item) {
            if (item.url) searchBar.value = item.url;
            else if (item.query) searchBar.value = item.query;
        }
        // Push updated active index to overlay
        const b = getSuggestionsBounds();
        window.suggestions.update(b, currentSuggestions, activeSuggestionIndex);
    }

    function handleSuggestionSelect(index) {
        const item = currentSuggestions[index];
        if (!item) return;
        if (item.type === 'switch-tab') {
            window.tab.switch(item.tabIndex);
            hideSuggestions();
            searchBar.blur();
        } else if ((item.type === 'history' || item.type === 'bookmark') && item.url) {
            searchBar.value = item.url;
            loadUrlInActiveTab(item.url);
            hideSuggestions();
        } else if ((item.type === 'google' || item.type === 'duckduckgo' || item.type === 'bing' || item.type === 'action') && item.query) {
            searchBar.value = item.query;
            loadUrlInActiveTab(item.query);
            hideSuggestions();
        }
    }

    function getOpenTabSuggestions(q) {
        const results = [];
        const ql = q.toLowerCase();
        tabs.forEach((btn, index) => {
            if (index === activeTabIndex) return;
            const url = tabUrls.get(index) || '';
            const title = btn.querySelector('.tab-title')?.textContent || '';
            if (!url || url === 'newtab' || url.startsWith('file://')) return;
            if (url.toLowerCase().includes(ql) || title.toLowerCase().includes(ql)) {
                let favicon = null;
                try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}`; } catch {}
                results.push({ type: 'switch-tab', tabIndex: index, title: title || url, url, favicon });
            }
        });
        return results;
    }

    async function getBookmarkSuggestions(q, limit = 3) {
        try {
            const entries = await window.browserBookmarks.getAll();
            if (!Array.isArray(entries) || !q) return [];
            const results = [];
            const ql = q.toLowerCase();
            for (const e of entries) {
                const url = e.url || '';
                const title = e.title || '';
                if (!url) continue;
                if (url.toLowerCase().includes(ql) || title.toLowerCase().includes(ql)) {
                    let favicon = null;
                    try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}`; } catch {}
                    results.push({ type: 'bookmark', title: title || url, url, favicon });
                    if (results.length >= limit) break;
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    async function getHistorySuggestions(q, limit = 5) {
        try {
            // Prefer main-process filtered search for performance and consistent logic
            const entries = await (window.browserHistory.search ? window.browserHistory.search(q, limit * 3) : window.browserHistory.get());
            if (!Array.isArray(entries) || !q) return [];
            const results = [];
            const seen = new Set();
            function normalize(u) {
                try {
                    const nu = new URL(u);
                    return (nu.hostname + nu.pathname).toLowerCase().replace(/\/$/, '');
                } catch { return u.toLowerCase(); }
            }
            for (const e of entries) {
                const url = e.url || '';
                if (!url) continue;
                const key = normalize(url);
                if (seen.has(key)) continue;
                seen.add(key);
                // provide a favicon URL using Google's favicon service as a best-effort
                let favicon = null;
                try { const h = new URL(url).hostname; favicon = `https://www.google.com/s2/favicons?domain=${h}`; } catch {}
                results.push({ type: 'history', title: e.title || url, url, favicon });
                if (results.length >= limit) break;
            }
            return results;
        } catch {
            return [];
        }
    }

    async function getGoogleSuggestions(q, limit = 6) {
        if (!q) return [];
        try {
            const engine = getSearchEngine();
            const suggestUrls = {
                google: `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
                duckduckgo: `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
                bing: `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
            };
            const url = suggestUrls[engine] || suggestUrls.google;
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();
            const arr = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
            return arr.slice(0, limit).map(s => ({ type: engine, query: s }));
        } catch {
            return [];
        }
    }

    const updateSuggestions = debounce(async () => {
        const q = searchBar.value.trim();
        if (!q) { hideSuggestions(); return; }
        // Always include the direct search action first
        const base = [{ type: 'action', query: q }];
        // Render immediately to make UI feel responsive
        renderSuggestions(base);
        try {
            const openTabs = getOpenTabSuggestions(q);
            const [bkmk, hist, goog] = await Promise.all([
                getBookmarkSuggestions(q, 3),
                getHistorySuggestions(q, 5),
                getGoogleSuggestions(q, 6)
            ]);
            // Merge: open tabs first, then bookmarks, then action, then history, then search
            const merged = [];
            const seenUrls = new Set();
            const seenQueries = new Set();

            for (const t of openTabs) { merged.push(t); seenUrls.add(t.url); }
            for (const b of bkmk) { if (!seenUrls.has(b.url)) { merged.push(b); seenUrls.add(b.url); } }
            
            merged.push(...base); // base has .query, not .url
            for (const x of base) { if (x.query) seenQueries.add(x.query); }

            for (const h of hist) { if (!seenUrls.has(h.url)) { merged.push(h); seenUrls.add(h.url); } }
            for (const g of goog) { if (!seenQueries.has(g.query)) { merged.push(g); seenQueries.add(g.query); } }
            renderSuggestions(merged);
        } catch (_) {
            // keep base rendered
        }
    }, 120);

    searchBar.addEventListener('input', () => {
        _userTyping = true;
        updateSuggestions();
    });

    searchBar.addEventListener('focus', () => {
        if (_userTyping && searchBar.value.trim()) updateSuggestions();
    });

    searchBar.addEventListener('blur', () => {
        // Give overlayPointerDown time to be set, and allow renderSuggestions to restore focus
        setTimeout(() => {
            if (overlayPointerDown) return;
            if (document.activeElement === searchBar) return; // focus was restored (overlay creation race)
            hideSuggestions();
        }, 400);
    });

    if (window.contentInteraction) {
        window.contentInteraction.onClicked(() => {
            hideSuggestions();
            searchBar.blur();
        });
    }

    // Overlay view created — restore focus to search bar without triggering suggestions
    window.suggestions.onCreated(() => {
        _userTyping = true; // preserve typing state
        try { searchBar.focus(); } catch {}
    });

    searchBar.addEventListener("keydown", (e) => {
        const haveSuggestions = currentSuggestions.length > 0;
        if (haveSuggestions) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion(activeSuggestionIndex + 1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion(activeSuggestionIndex - 1); return; }
            if (e.key === 'Escape') { e.preventDefault(); hideSuggestions(); return; }
            if (e.key === 'Enter') {
                if (activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
                    e.preventDefault(); handleSuggestionSelect(activeSuggestionIndex); return;
                }
            }
        }
        if (e.key === 'Enter') {
            const url = searchBar.value.trim();
            if (url) loadUrlInActiveTab(url);
        }
    });

    // ── Bookmarks ────────────────────────────────────────────────────────────
    const bookmarkBtn      = document.getElementById('bookmark-btn');
    const bookmarkBar      = document.getElementById('bookmark-bar');
    const bookmarkBarItems = document.getElementById('bookmark-bar-items');
    let currentTabUrl   = '';
    let currentTabTitle = '';
    let bookmarkBarVisible = !!_settings.bookmarkBarVisible;
    let hasBookmarks       = false;

    function reportChromeHeight() {
        const showBar = bookmarkBarVisible && hasBookmarks;
        bookmarkBar.classList.toggle('hidden', !showBar);
        window.electronAPI.reportChromeHeight(showBar ? 28 : 0);
    }
    reportChromeHeight();

    async function updateBookmarkBtn(url) {
        if (!url || url === 'newtab' || url.startsWith('file://')) {
            bookmarkBtn.classList.remove('bookmarked');
            return;
        }
        try {
            const has = await window.browserBookmarks.has(url);
            bookmarkBtn.classList.toggle('bookmarked', has);
        } catch {}
    }

    // ── Shared dropdown helpers ───────────────────────────────────────────
    let _openDropdownId   = null; // id of anchor btn whose dropdown is open
    let _dropdownCleanup  = null;

    // Inline folder SVG icon (Material Design folder shape)
    const _FOLDER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="11" viewBox="0 0 24 20" fill="currentColor"><path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/></svg>';

    function makeFolderIcon(cls) {
        const span = document.createElement('span');
        span.className = cls || 'bookmark-folder-icon';
        span.innerHTML = _FOLDER_ICON_SVG;
        return span;
    }

    function closeDropdown() {
        document.getElementById('bm-dropdown')?.remove();
        document.getElementById('bm-subdropdown')?.remove();
        if (_dropdownCleanup) { _dropdownCleanup(); _dropdownCleanup = null; }
        _openDropdownId = null;
    }

    function openDropdown(anchorBtn, anchorId, buildFn) {
        if (_openDropdownId === anchorId) { closeDropdown(); return; }
        closeDropdown();
        _openDropdownId = anchorId;

        const panel = document.createElement('div');
        panel.id        = 'bm-dropdown';
        panel.className = 'bookmark-overflow-dropdown';
        buildFn(panel);
        document.body.appendChild(panel);

        const rect = anchorBtn.getBoundingClientRect();
        const panelW = 200;
        panel.style.left = Math.min(rect.left, window.innerWidth - panelW - 4) + 'px';
        panel.style.top  = rect.bottom + 'px';

        const handler = (e) => {
            if (!panel.contains(e.target) && e.target !== anchorBtn) {
                closeDropdown();
                document.removeEventListener('mousedown', handler, true);
            }
        };
        document.addEventListener('mousedown', handler, true);
        _dropdownCleanup = () => document.removeEventListener('mousedown', handler, true);
    }

    function makeDropdownItem(entry, parentFolderId) {
        if (entry.type === 'divider') {
            const sep = document.createElement('div');
            sep.className = 'bookmark-overflow-sep';
            return sep;
        }
        const item = document.createElement('button');
        item.className = 'bookmark-overflow-item';

        // Allow dragging items out of a folder onto the bar
        if (parentFolderId) {
            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                _dragSrcId       = entry.id;
                _dragSrcFolderId = parentFolderId;
                _bmDragActive    = true;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', entry.id);
                // Close dropdown so the bar drop targets are exposed
                closeDropdown();
            });
            item.addEventListener('dragend', () => {
                _dragSrcId       = null;
                _dragSrcFolderId = null;
                _bmDragActive    = false;
                _clearDragClasses();
                _clearSpring(true);
            });
        }

        if (entry.type === 'folder') {
            item.appendChild(makeFolderIcon('bookmark-overflow-folder-icon'));
            const lbl = document.createElement('span');
            lbl.textContent = entry.title || 'Folder';
            item.appendChild(lbl);
            const arrow = document.createElement('span');
            arrow.className = 'bookmark-overflow-submenu-arrow';
            arrow.textContent = '▶';
            item.appendChild(arrow);

            function openSub() {
                // Close any existing sub first
                document.querySelectorAll('#bm-dropdown .has-submenu-open')
                    .forEach(el => el.classList.remove('has-submenu-open'));
                document.getElementById('bm-subdropdown')?.remove();

                const sub = document.createElement('div');
                sub.id            = 'bm-subdropdown';
                sub.className     = 'bookmark-overflow-dropdown';
                sub.dataset.forId = entry.id;

                if (!entry.children?.length) {
                    const empty = document.createElement('div');
                    empty.className   = 'bookmark-overflow-empty';
                    empty.textContent = '(empty)';
                    sub.appendChild(empty);
                } else {
                    entry.children.forEach(child => sub.appendChild(makeDropdownItem(child, entry.id)));
                }
                document.body.appendChild(sub);
                const r = item.getBoundingClientRect();
                sub.style.left = r.right + 'px';
                sub.style.top  = r.top + 'px';
                item.classList.add('has-submenu-open');
            }

            // Click to toggle sub-panel — no hover timers
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const existing = document.getElementById('bm-subdropdown');
                if (existing && existing.dataset.forId === entry.id) {
                    existing.remove();
                    item.classList.remove('has-submenu-open');
                } else {
                    openSub();
                }
            });
        } else {
            let fav = '';
            try { fav = `https://www.google.com/s2/favicons?domain=${new URL(entry.url).hostname}`; } catch {}
            if (fav) {
                const img = document.createElement('img');
                img.className = 'bookmark-bar-favicon';
                img.src = fav; img.onerror = () => img.remove();
                item.appendChild(img);
            }
            const lbl = document.createElement('span');
            try { lbl.textContent = entry.title || new URL(entry.url).hostname; } catch { lbl.textContent = entry.url; }
            item.appendChild(lbl);
            item.addEventListener('click', () => { closeDropdown(); window.tab.loadUrl(activeTabIndex, entry.url); });
            item.addEventListener('auxclick', (e) => {
                if (e.button !== 1) return;
                e.preventDefault(); closeDropdown();
                window.browserBookmarks.openInNewTab(entry.url, false);
            });
        }
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            window.browserBookmarks.showBarContextMenu({ type: entry.type, id: entry.id, url: entry.url, title: entry.title });
        });
        return item;
    }

    // ── Drag-to-reorder / drop-into-folder / drag-out-of-folder ─────────
    let _dragSrcId       = null;
    let _externDragId    = null;
    let _dragSrcFolderId = null; // set when drag originates from inside a folder
    let _bmDragActive    = false;

    // Support dragging items out of the folder dropdown WebContentsView.
    // HTML5 drag events don't cross view boundaries, so main.js polls the cursor
    // and sends us x/y positions. We do element-from-point hit testing to highlight
    // targets, then on drag-end we perform the actual move based on last hovered target.
    let _externLastTarget = null; // last bar element hovered during an extern drag

    window.electronAPI.onExternBookmarkDragStart((id, folderId) => {
        _dragSrcId        = id;
        _dragSrcFolderId  = folderId;
        _bmDragActive     = true;
        _externDragId     = id;
        _externLastTarget = null;
    });

    window.electronAPI.onExternBookmarkDragPosition((x, y) => {
        if (!_externDragId) return;
        _clearDragClasses();
        const el = document.elementFromPoint(x, y);
        const barItem = el?.closest('.bookmark-bar-item, .bookmark-bar-divider');
        _externLastTarget = barItem || null;
        if (barItem) {
            const isFolder = barItem.classList.contains('bookmark-bar-folder');
            barItem.classList.add(isFolder ? 'drag-into' : 'drop-before');
        }
    });

    window.electronAPI.onExternBookmarkDragEnd(async () => {
        if (!_externDragId) return;
        const srcId      = _dragSrcId;
        const srcFolder  = _dragSrcFolderId;
        const target     = _externLastTarget;

        _dragSrcId       = null;
        _dragSrcFolderId = null;
        _bmDragActive    = false;
        _externDragId    = null;
        _externLastTarget = null;
        _clearDragClasses();
        _clearSpring(true);

        if (!target || !srcId) return;
        const targetId = target.dataset.id;
        if (!targetId || targetId === srcId) return;

        const isFolder = target.classList.contains('bookmark-bar-folder');
        if (isFolder) {
            await window.browserBookmarks.moveIntoFolder(srcId, targetId);
        } else if (srcFolder) {
            await window.browserBookmarks.moveOutOfFolder(srcId, srcFolder, targetId);
        } else {
            // reorder at top level — place before target
            const all  = await window.browserBookmarks.getAll();
            const ids  = all.map(b => b.id);
            const from = ids.indexOf(srcId);
            const to   = ids.indexOf(targetId);
            if (from !== -1 && to !== -1) {
                ids.splice(from, 1);
                ids.splice(to, 0, srcId);
                await window.browserBookmarks.reorder(ids);
            }
        }
    });

    // Spring-load state — folder opens automatically when hovering during a drag
    let _springTimer    = null;
    let _springFolderId = null; // bar item id of the folder being hovered
    let _springOpen     = false; // whether the spring dropdown is currently showing

    function _clearSpring(closePanel = false) {
        if (_springTimer) { clearTimeout(_springTimer); _springTimer = null; }
        _springFolderId = null;
        if (closePanel && _springOpen) { closeDropdown(); _springOpen = false; }
    }

    // Block bookmark drags from leaving the bookmark bar OR the open spring dropdown.
    // Do NOT call preventDefault here — that would signal "drop accepted".
    // stopPropagation silences the tab bar's own dragover (which calls preventDefault).
    document.addEventListener('dragover', (e) => {
        if (!_bmDragActive) return;
        const inBar      = !!e.target.closest('#bookmark-bar');
        const inDropdown = !!e.target.closest('#bm-dropdown');
        if (!inBar && !inDropdown) e.stopPropagation();
    }, true);

    function _clearDragClasses() {
        document.querySelectorAll('.drag-into, .drop-before').forEach(n => {
            n.classList.remove('drag-into', 'drop-before');
        });
    }

    // Build a spring-loaded dropdown panel where each row is a drop target for positional insertion
    function _buildSpringPanel(panel, folderEntry) {
        const children = folderEntry.children || [];

        function makeDropRow(child) {
            const row = makeDropdownItem(child, folderEntry.id);
            row.addEventListener('dragover', (e) => {
                if (!_bmDragActive || _dragSrcId === child.id) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                _clearDragClasses();
                row.classList.add(child.type === 'folder' ? 'drag-into' : 'drop-before');
            });
            row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drag-into'));
            row.addEventListener('drop', async (e) => {
                if (!_dragSrcId || _dragSrcId === child.id) return;
                e.preventDefault();
                e.stopPropagation();
                row.classList.remove('drop-before', 'drag-into');
                _clearSpring(true);
                if (child.type === 'folder') {
                    await window.browserBookmarks.moveIntoFolder(_dragSrcId, child.id, null);
                } else {
                    await window.browserBookmarks.moveIntoFolder(_dragSrcId, folderEntry.id, child.id);
                }
            });
            return row;
        }

        if (!children.length) {
            const empty = document.createElement('div');
            empty.className   = 'bookmark-overflow-empty';
            empty.textContent = '(empty)';
            panel.appendChild(empty);
        } else {
            children.forEach(child => panel.appendChild(makeDropRow(child)));
        }

        // Append-at-end drop zone: fires when dropping on the panel background (not on a row)
        panel.addEventListener('dragover', (e) => {
            if (!_bmDragActive) return;
            if (e.target.closest('.bookmark-overflow-item, .bookmark-overflow-sep')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        panel.addEventListener('drop', async (e) => {
            if (!_dragSrcId) return;
            if (e.target.closest('.bookmark-overflow-item, .bookmark-overflow-sep')) return;
            e.preventDefault();
            _clearSpring(true);
            await window.browserBookmarks.moveIntoFolder(_dragSrcId, folderEntry.id, null);
        });
    }

    function makeDraggable(el, item, getAll) {
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
            _dragSrcId       = item.id;
            _dragSrcFolderId = null;
            _bmDragActive    = true;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.id);
        });
        el.addEventListener('dragend', () => {
            _dragSrcId       = null;
            _dragSrcFolderId = null;
            _bmDragActive    = false;
            el.classList.remove('dragging');
            _clearDragClasses();
            _clearSpring(true);
        });
        el.addEventListener('dragover', (e) => {
            if (!_bmDragActive) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            _clearDragClasses();
            if (item.type === 'folder') {
                // Only show drag-into once spring has fired; until then show reorder indicator
                if (_springOpen && _springFolderId === item.id) {
                    el.classList.add('drag-into');
                } else {
                    el.classList.add('drop-before');
                    // Start spring timer so the user CAN drop inside by hovering longer
                    if (_springFolderId !== item.id) {
                        _clearSpring(false);
                        _springFolderId = item.id;
                        _springTimer = setTimeout(() => {
                            _springOpen = true;
                            el.classList.remove('drop-before');
                            el.classList.add('drag-into');
                            openDropdown(el, item.id, (panel) => _buildSpringPanel(panel, item));
                        }, 700);
                    }
                }
            } else {
                el.classList.add('drop-before');
            }
        });
        el.addEventListener('dragleave', (e) => {
            _clearDragClasses();
            if (item.type === 'folder' && _springFolderId === item.id) {
                const dropdown = document.getElementById('bm-dropdown');
                if (dropdown && dropdown.contains(e.relatedTarget)) return;
                _clearSpring(false);
            }
        });
        el.addEventListener('drop', async (e) => {
            e.preventDefault();
            _clearDragClasses();
            const wasSpringOpen = _springOpen;
            _clearSpring(true);
            if (!_dragSrcId || _dragSrcId === item.id) return;

            if (_dragSrcFolderId) {
                // Dragged out of a folder — place before this bar item
                await window.browserBookmarks.moveOutOfFolder(_dragSrcId, _dragSrcFolderId, item.id);
            } else if (item.type === 'folder' && wasSpringOpen) {
                // User hovered long enough to open the spring panel — move inside the folder
                await window.browserBookmarks.moveIntoFolder(_dragSrcId, item.id);
            } else {
                // Reorder at top level (works for folder→folder, bookmark→folder, bookmark→bookmark)
                const all  = getAll();
                const ids  = all.map(b => b.id);
                const from = ids.indexOf(_dragSrcId);
                const to   = ids.indexOf(item.id);
                if (from === -1 || to === -1) return;
                ids.splice(from, 1);
                ids.splice(to, 0, _dragSrcId);
                await window.browserBookmarks.reorder(ids);
            }
        });
    }

    // ── Render one bar element ────────────────────────────────────────────
    function makeBarElement(entry, bookmarks) {
        if (entry.type === 'divider') {
            const el = document.createElement('div');
            el.className  = 'bookmark-bar-divider';
            el.dataset.id = entry.id;
            makeDraggable(el, entry, () => bookmarks);
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                window.browserBookmarks.showBarContextMenu({ type: 'divider', id: entry.id });
            });
            return el;
        }

        const btn = document.createElement('button');
        btn.dataset.id = entry.id;

        if (entry.type === 'folder') {
            btn.className = 'bookmark-bar-item bookmark-bar-folder';
            btn.title     = entry.title || 'Folder';
            btn.appendChild(makeFolderIcon('bookmark-folder-icon'));
            const lbl = document.createElement('span');
            lbl.className   = 'bookmark-bar-label';
            lbl.textContent = entry.title || 'Folder';
            btn.appendChild(lbl);
            btn.addEventListener('click', () => {
                const rect = btn.getBoundingClientRect();
                window.electronAPI.openFolderDropdown(
                    { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                    entry
                );
            });
        } else {
            btn.className = 'bookmark-bar-item';
            btn.title     = entry.title || entry.url;
            let fav = '';
            try { fav = `https://www.google.com/s2/favicons?domain=${new URL(entry.url).hostname}`; } catch {}
            if (fav) {
                const img = document.createElement('img');
                img.className = 'bookmark-bar-favicon';
                img.src = fav; img.onerror = () => img.remove();
                btn.appendChild(img);
            }
            const lbl = document.createElement('span');
            lbl.className   = 'bookmark-bar-label';
            try { lbl.textContent = entry.title || new URL(entry.url).hostname; } catch { lbl.textContent = entry.url; }
            btn.appendChild(lbl);
            btn.addEventListener('click', () => window.tab.loadUrl(activeTabIndex, entry.url));
            btn.addEventListener('auxclick', (e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                window.browserBookmarks.openInNewTab(entry.url, false);
            });
        }

        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            window.browserBookmarks.showBarContextMenu({ type: entry.type, id: entry.id, url: entry.url, title: entry.title });
        });
        makeDraggable(btn, entry, () => bookmarks);
        return btn;
    }

    // ── Build / refresh the bar ───────────────────────────────────────────
    let _renamingFolderId = null;
    let _refreshSeq = 0;

    async function refreshBookmarkBar() {
        if (_renamingFolderId) return;
        closeDropdown();
        bookmarkBarItems.innerHTML = '';
        if (!bookmarkBarVisible) { hasBookmarks = false; reportChromeHeight(); return; }

        const seq = ++_refreshSeq;
        let bookmarks = [];
        try { bookmarks = await window.browserBookmarks.getAll(); } catch {}
        if (seq !== _refreshSeq) return; // a newer refresh started — discard these results

        hasBookmarks = bookmarks.length > 0;
        reportChromeHeight();
        if (!hasBookmarks) return;

        const rendered = [];
        bookmarks.forEach(entry => {
            const el = makeBarElement(entry, bookmarks);
            bookmarkBarItems.appendChild(el);
            rendered.push({ el, entry });
        });

        // Overflow detection after layout
        requestAnimationFrame(() => {
            const barRight   = bookmarkBarItems.getBoundingClientRect().right;
            const OVERFLOW_W = 40;

            // Pass 1: does anything overflow the full bar at all?
            const anyOverflow = rendered.some(r => r.el.getBoundingClientRect().right > barRight);
            if (!anyOverflow) return;

            // Pass 2: with overflow button space reserved, find first item that doesn't fit
            let overflowStart = -1;
            for (let i = 0; i < rendered.length; i++) {
                if (rendered[i].el.getBoundingClientRect().right > barRight - OVERFLOW_W) {
                    overflowStart = i; break;
                }
            }
            if (overflowStart !== -1) {
                for (let i = overflowStart; i < rendered.length; i++) rendered[i].el.style.display = 'none';
                const hidden = rendered.slice(overflowStart).map(r => r.entry);
                const count  = hidden.filter(e => e.type !== 'divider').length;
                const more   = document.createElement('button');
                more.className   = 'bookmark-bar-item bookmark-bar-more';
                more.textContent = `» ${count}`;
                more.title       = `${count} more`;
                more.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openDropdown(more, '__overflow__', (panel) => {
                        hidden.forEach(entry => panel.appendChild(makeDropdownItem(entry)));
                    });
                });
                bookmarkBarItems.appendChild(more);
            }
        });
    }

    // Bar background right-click (fires only when no item stopped propagation)
    bookmarkBar.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.bookmark-bar-item, .bookmark-bar-divider')) return;
        e.preventDefault();
        window.browserBookmarks.showBarContextMenu({ type: 'bar-bg', bookmarkBarVisible });
    });

    // Bar background drop zone — for dragging items out of folders onto empty bar space
    bookmarkBar.addEventListener('dragover', (e) => {
        if (!_bmDragActive || !_dragSrcFolderId) return;
        if (e.target.closest('.bookmark-bar-item, .bookmark-bar-divider')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });
    bookmarkBar.addEventListener('drop', async (e) => {
        if (!_dragSrcId || !_dragSrcFolderId) return;
        if (e.target.closest('.bookmark-bar-item, .bookmark-bar-divider')) return;
        e.preventDefault();
        await window.browserBookmarks.moveOutOfFolder(_dragSrcId, _dragSrcFolderId, null);
    });

    // Rebuild on resize
    new ResizeObserver(() => { if (bookmarkBarVisible && hasBookmarks) refreshBookmarkBar(); })
        .observe(bookmarkBarItems);

    // ── Bookmark button (★) ───────────────────────────────────────────────
    bookmarkBtn.addEventListener('click', async () => {
        if (!currentTabUrl || currentTabUrl === 'newtab' || currentTabUrl.startsWith('file://')) return;
        const rect = bookmarkBtn.getBoundingClientRect();
        let hasObj = false, bkmkTitle = currentTabTitle || currentTabUrl, bkmkId = null;
        try {
            const all = await window.browserBookmarks.getAll();
            const existing = all.find(b => b.type === 'bookmark' && b.url === currentTabUrl);
            if (existing) { hasObj = true; bkmkTitle = existing.title || existing.url; bkmkId = existing.id; }
        } catch {}
        try {
            await window.electronAPI.openBookmarkPrompt(
                { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                currentTabUrl, bkmkTitle, hasObj, bkmkId
            );
        } catch {}
    });

    // Events from main-process context menu actions
    window.electronAPI.onBookmarkAddPrompt(() => {
        if (!currentTabUrl || currentTabUrl === 'newtab' || currentTabUrl.startsWith('file://')) return;
        const rect = bookmarkBtn.getBoundingClientRect();
        window.electronAPI.openBookmarkPrompt(
            { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
            currentTabUrl, currentTabTitle, false, null
        );
    });
    window.electronAPI.onBookmarkEditPrompt(({ id, url, title }) => {
        const rect = bookmarkBtn.getBoundingClientRect();
        window.electronAPI.openBookmarkPrompt(
            { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
            url, title, true, id
        );
    });
    window.electronAPI.onBookmarkFolderRename(({ id, title }) => {
        const rect = bookmarkBtn.getBoundingClientRect();
        window.electronAPI.openBookmarkPrompt(
            { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
            null, title, true, id, 'folder-rename'
        );
    });
    function startInlineRename(folderId, defaultName) {
        const btn = bookmarkBarItems.querySelector(`[data-id="${folderId}"]`);
        if (!btn) return;
        const lbl = btn.querySelector('.bookmark-bar-label');
        if (!lbl) return;

        _renamingFolderId = folderId;
        lbl.style.display = 'none';
        const input = document.createElement('input');
        input.className = 'bookmark-bar-rename-input';
        input.value = defaultName || '';
        input.size = Math.max((defaultName || '').length, 8);
        btn.appendChild(input);

        // Prevent folder dropdown from opening while renaming
        btn.removeEventListener('click', btn._clickHandler);
        btn.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });

        requestAnimationFrame(() => { input.focus(); input.select(); });

        let done = false;

        async function commit() {
            if (done) return; done = true;
            const name = input.value.trim() || 'New Folder';
            _renamingFolderId = null;
            await window.browserBookmarks.updateById(folderId, { title: name });
            // refreshBookmarkBar will be triggered by the bookmarks-changed event
        }

        function cancel() {
            if (done) return; done = true;
            _renamingFolderId = null;
            input.removeEventListener('blur', commit);
            refreshBookmarkBar();
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', commit, { once: true });
    }

    window.electronAPI.onBookmarkNewFolderPrompt(async () => {
        // Close any open folder dropdown first so it doesn't cover the inline rename input
        window.electronAPI.closeFolderDropdown();
        const id = await window.browserBookmarks.addFolder('New Folder');
        // Drive a fresh render ourselves (sequence counter makes concurrent bookmarks-changed
        // refresh bail out, so only this call's results land in the DOM).
        await refreshBookmarkBar();
        startInlineRename(id, 'New Folder'); // sets _renamingFolderId, blocking further rebuilds
    });

    window.electronAPI.onToggleBookmarkBar(() => {
        bookmarkBarVisible = !bookmarkBarVisible;
        window.inkSettings.set('bookmarkBarVisible', bookmarkBarVisible);
        refreshBookmarkBar();
    });
    window.browserBookmarks.onChanged(() => { refreshBookmarkBar(); updateBookmarkBtn(currentTabUrl); });
    window.electronAPI.onBookmarkPromptClosed(() => updateBookmarkBtn(currentTabUrl));

    refreshBookmarkBar();

    // ── Focus Mode + Pomodoro ────────────────────────────────────────────────
    const focusBtn         = document.getElementById('focus-btn');
    const utilityBar       = document.getElementById('utility-bar');

    // Inline pill (in the toolbar)
    const pomPill          = document.getElementById('pomodoro-pill');
    const pillTime         = document.getElementById('pill-time');
    const pillRingFill     = document.getElementById('pill-ring-fill');
    const pillPhaseDot     = document.getElementById('pill-phase-dot');

    // Full controls overlay
    const pomOverlay       = document.getElementById('pomodoro-overlay');
    const pomPhase         = document.getElementById('pomodoro-phase');
    const pomTime          = document.getElementById('pomodoro-time');
    const pomStartBtn      = document.getElementById('pomodoro-start');
    const pomSkipBtn       = document.getElementById('pomodoro-skip');
    const pomResetBtn      = document.getElementById('pomodoro-reset');
    const pomSessions      = document.getElementById('pomodoro-sessions');
    const pomCloseBtn      = document.getElementById('pomodoro-close');

    // Pomodoro config (seconds) — loaded from settings
    const POM_FOCUS    = getPomSetting('pomWork', 25) * 60;
    const POM_SHORT    = getPomSetting('pomShortBreak', 5) * 60;
    const POM_LONG     = getPomSetting('pomLongBreak', 15) * 60;
    const POM_SESSIONS = getPomSetting('pomSessions', 4);

    const PILL_RING_CIRCUMFERENCE = 2 * Math.PI * 11; // pill ring r=11

    let pomState = {
        phase: 'focus',   // 'focus' | 'break'
        running: false,
        elapsed: 0,
        total: POM_FOCUS,
        sessionsDone: 0,
        timer: null,
        shown: false,     // whether pill is visible
    };

    function pomShowPill() {
        if (pomState.shown) return;
        pomState.shown = true;
        pomPill.classList.remove('hidden');
        utilityBar.classList.add('pomodoro-active');
    }

    function pomHidePill() {
        pomState.shown = false;
        pomPill.classList.add('hidden');
        utilityBar.classList.remove('pomodoro-active');
    }

    function pomUpdateUI() {
        const remaining = Math.max(0, pomState.total - pomState.elapsed);
        const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
        const secs = (remaining % 60).toString().padStart(2, '0');
        const timeStr = `${mins}:${secs}`;
        const progress = pomState.elapsed / pomState.total;
        const isFocus = pomState.phase === 'focus';
        const phaseLabel = isFocus ? 'Focus' : (pomState.sessionsDone % POM_SESSIONS === 0 ? 'Long Break' : 'Short Break');

        // Update inline pill (offset=0 → full ring, offset=circumference → empty — countdown drains)
        pillTime.textContent = timeStr;
        pillRingFill.style.strokeDashoffset = PILL_RING_CIRCUMFERENCE * progress;
        pillRingFill.className = 'pill-ring-fill' + (isFocus ? '' : ' break');
        pillPhaseDot.className = 'pill-phase-dot' + (isFocus ? '' : ' break');

        // Update overlay
        pomTime.textContent = timeStr;
        pomPhase.textContent = phaseLabel;
        pomPhase.className = 'pomodoro-phase' + (isFocus ? '' : ' break');
        pomStartBtn.textContent = pomState.running ? 'Pause' : 'Start';

        // Session dots
        pomSessions.innerHTML = '';
        for (let i = 0; i < POM_SESSIONS; i++) {
            const dot = document.createElement('div');
            dot.className = 'pom-session-dot' + (i < (pomState.sessionsDone % POM_SESSIONS) ? ' done' : '');
            pomSessions.appendChild(dot);
        }
    }

    async function pomSetFocusActive(active) {
        const current = await window.focusMode.getState();
        if (current !== active) await window.focusMode.toggle();
        focusBtn.classList.toggle('active', active);
    }

    async function pomAdvancePhase() {
        if (pomState.phase === 'focus') {
            pomState.sessionsDone++;
            const isLong = pomState.sessionsDone % POM_SESSIONS === 0;
            pomState.phase = 'break';
            pomState.total = isLong ? POM_LONG : POM_SHORT;
            await pomSetFocusActive(false);
        } else {
            pomState.phase = 'focus';
            pomState.total = POM_FOCUS;
            await pomSetFocusActive(true);
        }
        pomState.elapsed = 0;
        pomState.running = true;
        pomUpdateUI();
    }

    function pomTick() {
        pomState.elapsed++;
        if (pomState.elapsed >= pomState.total) {
            clearInterval(pomState.timer);
            pomState.timer = null;
            pomState.running = false;
            pomAdvancePhase().then(() => {
                if (pomState.running) {
                    pomState.timer = setInterval(pomTick, 1000);
                }
            });
        } else {
            pomUpdateUI();
        }
    }

    pomStartBtn.addEventListener('click', () => {
        if (pomState.running) {
            clearInterval(pomState.timer);
            pomState.timer = null;
            pomState.running = false;
        } else {
            pomState.running = true;
            pomState.timer = setInterval(pomTick, 1000);
        }
        pomUpdateUI();
    });

    pomSkipBtn.addEventListener('click', () => {
        clearInterval(pomState.timer);
        pomState.timer = null;
        pomState.running = false;
        pomAdvancePhase().then(() => {
            if (pomState.running) pomState.timer = setInterval(pomTick, 1000);
        });
    });

    pomResetBtn.addEventListener('click', async () => {
        clearInterval(pomState.timer);
        pomState.timer = null;
        pomState.running = false;
        pomState.elapsed = 0;
        pomState.phase = 'focus';
        pomState.total = POM_FOCUS;
        pomState.sessionsDone = 0;
        pomUpdateUI();
        pomCloseOverlay();
        pomHidePill();
        // Turn off focus mode too
        const active = await window.focusMode.getState();
        if (active) {
            await window.focusMode.toggle();
            focusBtn.classList.remove('active');
        }
    });

    function pomOpenOverlay() {
        pomUpdateUI();
        pomOverlay.classList.remove('hidden');
        window.focusMode.overlayOpen();
    }

    function pomCloseOverlay() {
        pomOverlay.classList.add('hidden');
        window.focusMode.overlayClose();
    }

    pomCloseBtn.addEventListener('click', pomCloseOverlay);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !pomOverlay.classList.contains('hidden')) {
            pomCloseOverlay();
        }
    });

    // Pill click → open full controls overlay
    pomPill.addEventListener('click', pomOpenOverlay);

    // Focus button: single click = toggle focus mode + show/hide pill
    focusBtn.addEventListener('click', async () => {
        const active = await window.focusMode.toggle();
        focusBtn.classList.toggle('active', active);
        if (active) {
            pomShowPill();
            // Auto-start the timer
            if (!pomState.running) {
                pomState.running = true;
                pomState.timer = setInterval(pomTick, 1000);
            }
            pomUpdateUI();
        } else {
            // Stop and reset the timer when focus is turned off
            clearInterval(pomState.timer);
            pomState.timer = null;
            pomState.running = false;
            pomState.elapsed = 0;
            pomState.phase = 'focus';
            pomState.total = POM_FOCUS;
            pomState.sessionsDone = 0;
            pomHidePill();
            pomUpdateUI();
        }
    });

    // Sync button state when focus mode changes from main process (e.g. pomodoro phase flip)
    window.focusMode.onChanged((active) => {
        focusBtn.classList.toggle('active', active);
    });

    // Restore initial state
    window.focusMode.getState().then(active => focusBtn.classList.toggle('active', active));

    pomUpdateUI();

    const brunoBtn = document.getElementById("bruno-btn");
    let brunoOpen = false;
    brunoBtn.addEventListener("click", () => {
        if (brunoOpen) {
            window.bruno.close();
            brunoOpen = false;
            brunoBtn.classList.remove('active');
        } else {
            window.bruno.open();
            brunoOpen = true;
            brunoBtn.classList.add('active');
        }
    });

    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.menu.open();
        menuOpen = true;
    });

    function loadUrlInActiveTab(url) {
        let formattedUrl = url;
        if (!/^https?:\/\//i.test(url)) {
            if (url.includes(".") && !url.includes(" ")) {
                formattedUrl = "https://" + url;
            } else {
                const engines = {
                    google: 'https://www.google.com/search?q=',
                    duckduckgo: 'https://duckduckgo.com/?q=',
                    bing: 'https://www.bing.com/search?q=',
                };
                formattedUrl = (engines[getSearchEngine()] || engines.google) + encodeURIComponent(url);
            }
        }
        window.tab.loadUrl(activeTabIndex, formattedUrl);
    }

    addBtn.addEventListener("click", () => { window.tab.add(); });

    window.tab.onTabCreated((_e, data) => {
        createTabButton(data.index, data.title);
        setTimeout(() => { updateTabWidths(data.totalTabs); updateScrollShadows(); }, 10);
    });

    window.tab.onTabRemoved((_e, data) => {
        tabUrls.delete(data.index);
        removeTabButton(data.index);
        hideSuggestions();
        setTimeout(() => { updateTabWidths(data.totalTabs); updateScrollShadows(); }, 10);
    });

    window.tab.onTabSwitched((_e, data) => {
        activeTabIndex = data.index;
        if (data.url) tabUrls.set(data.index, data.url);
        setActiveTab(data.index);
        updateSearchBarUrl(data.url || "");
        currentTabUrl = data.url || '';
        updateBookmarkBtn(currentTabUrl);
        const activeEl = tabs.get(data.index);
        if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        updateScrollShadows();
    });

    window.tab.onUrlUpdated((_e, data) => {
        if (data.url) tabUrls.set(data.index, data.url);
        if (data.index === activeTabIndex) {
            updateSearchBarUrl(data.url);
            currentTabUrl = data.url || '';
            currentTabTitle = data.title || '';
            updateBookmarkBtn(currentTabUrl);
        }
        updateTabTitle(data.index, data.title || data.url, data.favicon);
    });

    window.tab.onNavigationUpdated((_e, data) => {
        if (data.index === activeTabIndex) updateNavigationButtons(data.canGoBack, data.canGoForward);
    });

    window.tabsUI?.onPinTab((index) => {
        const btn = document.querySelector(`#tabs-container .tab-button[data-index="${index}"]`);
        if (!btn) return;
        const isPinned = btn.classList.toggle('pinned');
        btn.dataset.pinned = isPinned ? '1' : '';
        updateTabWidths(tabs.size);
        updateScrollShadows();
    });

    function createTabButton(index, title) {
        if (tabs.has(index)) return;

        const tabButton = document.createElement('div');
        tabButton.className = 'tab-button';
        tabButton.dataset.index = index;
        tabButton.draggable = true;
        tabButton.tabIndex = 0;
        tabButton.role = 'button';

        const tabTitle = document.createElement('span');
        tabTitle.className = 'tab-title';
        tabTitle.textContent = title || `Tab ${index + 1}`;

        const closeButton = document.createElement('button');
        closeButton.className = 'tab-close';
        closeButton.innerHTML = '×';
        closeButton.onclick = (e) => { e.stopPropagation(); window.tab.remove(parseInt(index)); };

        tabButton.appendChild(tabTitle);
        tabButton.appendChild(closeButton);

        tabButton.addEventListener('click', () => { window.tab.switch(parseInt(index)); });
        tabButton.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                window.tab.switch(parseInt(index));
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                const allTabs = Array.from(tabsContainer.querySelectorAll('.tab-button'));
                const currentIndex = allTabs.indexOf(tabButton);
                const nextTab = allTabs[(currentIndex + 1) % allTabs.length];
                if (nextTab) nextTab.focus();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                const allTabs = Array.from(tabsContainer.querySelectorAll('.tab-button'));
                const currentIndex = allTabs.indexOf(tabButton);
                const prevTab = allTabs[(currentIndex - 1 + allTabs.length) % allTabs.length];
                if (prevTab) prevTab.focus();
            }
        });

        // Drag support
        tabButton.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(index));
            e.dataTransfer.effectAllowed = 'move';
            tabButton.classList.add('dragging');
        });
        tabButton.addEventListener('dragend', async (e) => {
            tabButton.classList.remove('dragging');
            const targetWindow = await window.dragdrop.getWindowAtPoint(e.screenX, e.screenY);
            const thisWindowId = await window.dragdrop.getThisWindowId();
            if (!targetWindow) {
                const url = await window.tab.getTabUrl(index);
                await window.dragdrop.detachToNewWindow(index, e.screenX, e.screenY, url);
            } else if (targetWindow.id !== thisWindowId) {
                const url = await window.tab.getTabUrl(index);
                await window.dragdrop.moveTabToWindow(thisWindowId, index, targetWindow.id, url);
            } else {
                const ordered = Array.from(tabsContainer.querySelectorAll('.tab-button')).map(el => parseInt(el.dataset.index));
                if (ordered.length) window.tab.reorder(ordered);
            }
        });

        tabsContainer.appendChild(tabButton);
        tabs.set(index, tabButton);
        setActiveTab(index);

        // Accessibility
        tabButton.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.tab.switch(parseInt(index)); }
        });

        updateScrollShadows();
    }

    function removeTabButton(index) {
        const tabButton = tabs.get(index);
        if (tabButton) { tabButton.remove(); tabs.delete(index); }
    }

    function setActiveTab(index) {
        tabs.forEach(tab => tab.classList.remove('active'));
        const activeTab = tabs.get(index);
        if (activeTab) activeTab.classList.add('active');
        activeTabIndex = index;
    }

    function updateSearchBarUrl(url) { searchBar.value = url; }

    function updateTabTitle(index, title, faviconUrl) {
        const tabButton = tabs.get(index);
        if (!tabButton) return;
        const titleSpan = tabButton.querySelector('.tab-title');
        let faviconElement = tabButton.querySelector('.tab-favicon');
        if (titleSpan) { titleSpan.textContent = title || `Tab ${index + 1}`; tabButton.title = titleSpan.textContent; }
        if (faviconUrl && faviconUrl !== '') {
            if (!faviconElement) { faviconElement = document.createElement('img'); faviconElement.className = 'tab-favicon'; tabButton.insertBefore(faviconElement, titleSpan); }
            updateTabFavicon(faviconElement, faviconUrl);
        } else if (faviconElement) { faviconElement.remove(); }
    }

    function updateTabFavicon(faviconElement, faviconUrl) {
        if (faviconUrl && faviconUrl !== '') {
            faviconElement.src = faviconUrl;
            faviconElement.alt = '';
            faviconElement.onerror = () => { setDomainFavicon(faviconElement, faviconUrl); };
        } else { setDomainFavicon(faviconElement, ''); }
    }

    function setDomainFavicon(faviconElement, url) {
        try {
            if (url) {
                const domain = new URL(url).hostname;
                const initial = domain.charAt(0).toUpperCase();
                const fallbackDiv = document.createElement('div');
                fallbackDiv.className = 'tab-favicon default';
                fallbackDiv.textContent = initial;
                faviconElement.replaceWith(fallbackDiv);
            } else {
                const fallbackDiv = document.createElement('div');
                fallbackDiv.className = 'tab-favicon default';
                fallbackDiv.textContent = '◉';
                faviconElement.replaceWith(fallbackDiv);
            }
        } catch (e) {
            const fallbackDiv = document.createElement('div');
            fallbackDiv.className = 'tab-favicon default';
            fallbackDiv.textContent = '◉';
            faviconElement.replaceWith(fallbackDiv);
        }
    }

    function updateTabWidths(_totalTabs) {
        const actualTabCount = tabs.size; if (actualTabCount === 0) return;
        requestAnimationFrame(() => {
            const tabBarWidth = (tabsContainer && tabsContainer.offsetWidth) ? tabsContainer.offsetWidth : tabBar.offsetWidth;
            const pinnedWidth = 36; const minTabWidth = 80; const maxTabWidth = 240;
            const allTabs = Array.from(tabs.values());
            const pinnedTabs = allTabs.filter(t => t.classList.contains('pinned'));
            const unpinnedTabs = allTabs.filter(t => !t.classList.contains('pinned'));
            const unpinnedCount = unpinnedTabs.length;
            if (unpinnedCount === 0 && pinnedTabs.length > 0) {
                tabBar.classList.add('only-pinned');
                const widthPer = Math.floor(tabBarWidth / pinnedTabs.length);
                const finalWidth = Math.max(widthPer, pinnedWidth);
                pinnedTabs.forEach(tab => { tab.style.width = `${finalWidth}px`; tab.style.minWidth = `${finalWidth}px`; tab.style.maxWidth = `${finalWidth}px`; tab.style.flex = '0 0 auto'; });
                tabsContainer.style.overflowX = 'hidden'; return;
            }
            tabBar.classList.remove('only-pinned');
            pinnedTabs.forEach(tab => { tab.style.width = `${pinnedWidth}px`; tab.style.minWidth = `${pinnedWidth}px`; tab.style.maxWidth = `${pinnedWidth}px`; tab.style.flex = '0 0 auto'; });
            const remainingWidth = tabBarWidth - (pinnedTabs.length * pinnedWidth);
            const idealUnpinnedWidth = Math.floor(Math.max(0, remainingWidth) / Math.max(1, unpinnedCount));
            if (idealUnpinnedWidth >= minTabWidth && idealUnpinnedWidth <= maxTabWidth) {
                unpinnedTabs.forEach(tab => { tab.style.width = `${idealUnpinnedWidth}px`; tab.style.minWidth = `${minTabWidth}px`; tab.style.maxWidth = `${maxTabWidth}px`; tab.style.flex = '0 0 auto'; });
                tabsContainer.style.overflowX = 'hidden';
            } else if (idealUnpinnedWidth > maxTabWidth) {
                unpinnedTabs.forEach(tab => { tab.style.width = `${maxTabWidth}px`; tab.style.minWidth = `${minTabWidth}px`; tab.style.maxWidth = `${maxTabWidth}px`; tab.style.flex = '0 0 auto'; });
                tabsContainer.style.overflowX = 'hidden';
            } else {
                unpinnedTabs.forEach(tab => { tab.style.width = `${minTabWidth}px`; tab.style.minWidth = `${minTabWidth}px`; tab.style.maxWidth = `${maxTabWidth}px`; tab.style.flex = '0 0 auto'; });
                tabsContainer.style.overflowX = 'auto';
            }
        });
    }

    window.addEventListener('resize', () => { setTimeout(() => { updateTabWidths(tabs.size); updateScrollShadows(); }, 100); });

    // In-window reordering
    tabsContainer.addEventListener('dragover', (e) => {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const draggingTab = document.querySelector('.dragging'); if (!draggingTab) return;
        const afterElement = getDragAfterElement(tabsContainer, e.clientX);
        if (afterElement == null) { tabsContainer.appendChild(draggingTab); } else { tabsContainer.insertBefore(draggingTab, afterElement); }
    });

    function getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.tab-button:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // Gradient edge indicators
    function updateScrollShadows() {
        if (!tabsContainer) return;
        const maxScrollLeft = tabsContainer.scrollWidth - tabsContainer.clientWidth;
        const left = tabsContainer.scrollLeft;
        const right = maxScrollLeft - left;
        if (left > 2) tabBar.classList.add('scrollable-left'); else tabBar.classList.remove('scrollable-left');
        if (right > 2) tabBar.classList.add('scrollable-right'); else tabBar.classList.remove('scrollable-right');
    }
    tabsContainer.addEventListener('scroll', updateScrollShadows);

    // Tab bar scroll arrows
    const tabScrollLeft = document.getElementById('tab-scroll-left');
    const tabScrollRight = document.getElementById('tab-scroll-right');
    let tabScrollInterval = null;

    function scrollTabsBy(amount) {
        tabsContainer.scrollBy({ left: amount, behavior: 'smooth' });
    }

    function startTabScroll(amount) {
        scrollTabsBy(amount);
        tabScrollInterval = setInterval(() => scrollTabsBy(amount), 200);
    }

    function stopTabScroll() {
        clearInterval(tabScrollInterval);
        tabScrollInterval = null;
    }

    tabScrollLeft.addEventListener('mousedown', () => startTabScroll(-160));
    tabScrollRight.addEventListener('mousedown', () => startTabScroll(160));
    tabScrollLeft.addEventListener('click', () => scrollTabsBy(-160));
    tabScrollRight.addEventListener('click', () => scrollTabsBy(160));
    document.addEventListener('mouseup', stopTabScroll);

    tabsContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        tabsContainer.scrollBy({ left: e.deltaY !== 0 ? e.deltaY : e.deltaX, behavior: 'smooth' });
    }, { passive: false });

    function updateNavigationButtons(canGoBack, canGoForward) {
        backBtn.disabled = !canGoBack; forwardBtn.disabled = !canGoForward;
        backBtn.style.opacity = canGoBack ? '1' : '0.5'; forwardBtn.style.opacity = canGoForward ? '1' : '0.5';
        backBtn.style.cursor = canGoBack ? 'pointer' : 'not-allowed'; forwardBtn.style.cursor = canGoForward ? 'pointer' : 'not-allowed';
    }

    // Keep dropdown aligned on resize/scroll
    window.addEventListener('resize', positionSuggestions);
    window.addEventListener('scroll', positionSuggestions, true);

    // Hide suggestions on navigation updates or url programmatic updates
    const _origUpdateSearchBarUrl = updateSearchBarUrl;
    updateSearchBarUrl = (url) => { _origUpdateSearchBarUrl(url); hideSuggestions(); };

    // Handle selection coming from overlay click
    window.suggestions.onSelected((item) => {
        if (!item) return;
        if (item.type === 'history' && item.url) {
            searchBar.value = item.url;
            loadUrlInActiveTab(item.url);
        } else if ((item.type === 'google' || item.type === 'action') && item.query) {
            searchBar.value = item.query;
            loadUrlInActiveTab(item.query);
        }
        hideSuggestions();
        try { searchBar.focus(); } catch (e) {}
    });

    // Overlay pointer-down: when overlay receives mousedown we get notified
    window.suggestions.onPointerDown(() => {
        overlayPointerDown = true;
        // Clear shortly after — allow time for click/select to be processed
        setTimeout(() => { overlayPointerDown = false; }, 350);
    });

    setTimeout(() => { if (tabs.size > 0) { updateTabWidths(tabs.size); updateScrollShadows(); } }, 100);
});