document.addEventListener("DOMContentLoaded", () => {
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

    let tabs = new Map();
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
    let suggestionsOpen = false;
    let overlayPointerDown = false;

    // Debounce helper
    const debounce = (fn, delay = 150) => {
        let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    };

    // Position suggestions below the address bar
    function positionSuggestions() {
        if (!currentSuggestions.length) return;
        const b = getSuggestionsBounds();
        window.suggestions.update(b, currentSuggestions, activeSuggestionIndex);
    }

    function hideSuggestions() {
        window.suggestions.close();
        suggestionsOpen = false;
        currentSuggestions = [];
        activeSuggestionIndex = -1;
    }

    function renderSuggestions(list) {
        currentSuggestions = list;
        activeSuggestionIndex = list.length ? 0 : -1;
        if (!list.length) { hideSuggestions(); return; }
        const b = getSuggestionsBounds();
        // mark open immediately so blur handlers don't close the overlay
        suggestionsOpen = true;
        // try to keep the input focused before opening so blur races are less likely
        try { window.focus(); searchBar.focus(); } catch (e) {}
        // open overlay and then ensure focus returns to the input after a short delay
        window.suggestions.open(b, currentSuggestions, activeSuggestionIndex).then(() => {
            try { setTimeout(() => { try { window.focus(); searchBar.focus(); } catch {} }, 45); } catch {}
        }).catch(() => { /* keep suggestionsOpen true until closed explicitly */ });
    }

    function setActiveSuggestion(newIndex) {
        if (!currentSuggestions.length) return;
        if (newIndex < 0) newIndex = currentSuggestions.length - 1;
        if (newIndex >= currentSuggestions.length) newIndex = 0;
        activeSuggestionIndex = newIndex;
        // Push updated active index to overlay
        const b = getSuggestionsBounds();
        window.suggestions.update(b, currentSuggestions, activeSuggestionIndex);
    }

    function handleSuggestionSelect(index) {
        const item = currentSuggestions[index];
        if (!item) return;
        if (item.type === 'history' && item.url) {
            searchBar.value = item.url;
            loadUrlInActiveTab(item.url);
            hideSuggestions();
        } else if ((item.type === 'google' || item.type === 'action') && item.query) {
            searchBar.value = item.query;
            loadUrlInActiveTab(item.query);
            hideSuggestions();
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
            const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`;
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();
            const arr = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
            return arr.slice(0, limit).map(s => ({ type: 'google', query: s }));
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
        try { searchBar.focus(); } catch {}
        try {
            const [hist, goog] = await Promise.all([
                getHistorySuggestions(q, 5),
                getGoogleSuggestions(q, 6)
            ]);
            // Merge: action, then history, then google
            const merged = [...base, ...hist];
            const seenQueries = new Set(merged.filter(x => x.query).map(x => x.query));
            for (const g of goog) { if (!seenQueries.has(g.query)) merged.push(g); }
            renderSuggestions(merged);
        } catch (_) {
            // keep base rendered
        }
    }, 120);

    searchBar.addEventListener('input', () => {
        updateSuggestions();
    });

    searchBar.addEventListener('focus', () => {
        if (searchBar.value.trim()) updateSuggestions();
    });

    searchBar.addEventListener('blur', () => {
        // Delay hiding slightly to allow click on suggestion via mousedown.
        // If suggestions overlay is open, don't auto-hide here — overlay selection will close it.
        setTimeout(() => {
            if (suggestionsOpen || overlayPointerDown) return;
            hideSuggestions();
        }, 400);
    });

    // If overlay view was just created, restore focus quickly to prevent initial caret loss
    window.suggestions.onCreated(() => {
        try { window.focus(); searchBar.focus(); } catch (e) {}
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
                formattedUrl = "https://www.google.com/search?q=" + encodeURIComponent(url);
            }
        }
        window.tab.loadUrl(activeTabIndex, formattedUrl);
    }

    addBtn.addEventListener("click", () => { window.tab.add(); });

    window.tab.onTabCreated((event, data) => {
        createTabButton(data.index, data.title);
        setTimeout(() => { updateTabWidths(data.totalTabs); updateScrollShadows(); }, 10);
    });

    window.tab.onTabRemoved((event, data) => {
        removeTabButton(data.index);
        setTimeout(() => { updateTabWidths(data.totalTabs); updateScrollShadows(); }, 10);
    });

    window.tab.onTabSwitched((event, data) => {
        activeTabIndex = data.index;
        setActiveTab(data.index);
        updateSearchBarUrl(data.url || "");
        const activeEl = tabs.get(data.index);
        if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        updateScrollShadows();
    });

    window.tab.onUrlUpdated((event, data) => {
        if (data.index === activeTabIndex) updateSearchBarUrl(data.url);
        updateTabTitle(data.index, data.title || data.url, data.favicon);
    });

    window.tab.onNavigationUpdated((event, data) => {
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

    function updateTabWidths(totalTabs) {
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
    });

    // Overlay pointer-down: when overlay receives mousedown we get notified
    window.suggestions.onPointerDown(() => {
        overlayPointerDown = true;
        // Clear shortly after — allow time for click/select to be processed
        setTimeout(() => { overlayPointerDown = false; }, 350);
    });

    setTimeout(() => { if (tabs.size > 0) { updateTabWidths(tabs.size); updateScrollShadows(); } }, 100);
});