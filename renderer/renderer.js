document.addEventListener("DOMContentLoaded", () => {
    const addBtn = document.getElementById("new-tab-btn");
    const tabBar = document.getElementById("tab-bar");
    const tabsContainer = document.getElementById("tabs-container");
    const searchBar = document.getElementById("searchBar");
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

    searchBar.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
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

    setTimeout(() => { if (tabs.size > 0) { updateTabWidths(tabs.size); updateScrollShadows(); } }, 100);
});