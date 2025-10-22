document.addEventListener("DOMContentLoaded", () => {
    const addBtn = document.getElementById("new-tab-btn");
    const tabBar = document.getElementById("tab-bar");
    const searchBar = document.getElementById("searchBar");
    const backBtn = document.getElementById("back-btn");
    const forwardBtn = document.getElementById("forward-btn");
    const reloadBtn = document.getElementById("reload-btn");
    const menuBtn = document.getElementById("menu-btn")
    
    let tabs = new Map();
    let tabCounter = 0;
    let initialTabCreated = false;
    let activeTabIndex = 0;
    let menuOpen = false;

    window.addEventListener("click", (e) => {
        if (menuOpen) {
            window.electronAPI.windowClick({ x: e.clientX, y: e.clientY });
        }
    });

    window.menu.onClosed((event, data) => {
        menuOpen = false;
    });

    window.electronAPI.onShowFindInPage(() => {
        
    });

    

    backBtn.addEventListener("click", () => {
        window.tab.goBack(activeTabIndex);
    });

    forwardBtn.addEventListener("click", () => {
        window.tab.goForward(activeTabIndex);
    });

    reloadBtn.addEventListener("click", () => {
        window.tab.reload(activeTabIndex);
    });

    searchBar.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const url = searchBar.value.trim();
            if (url) {
                loadUrlInActiveTab(url);
            }
        }
    });

    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.menu.open();
        menuOpen = true;
    })

    function loadUrlInActiveTab(url) {
        let formattedUrl = url;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            if (url.includes(".") && !url.includes(" ")) {
                formattedUrl = "https://" + url;
            } else {
                formattedUrl = "https://www.google.com/search?q=" + encodeURIComponent(url);
            }
        }
        
        window.tab.loadUrl(activeTabIndex, formattedUrl);
    }

    addBtn.addEventListener("click", async () => {
        window.tab.add();
    });

    window.tab.onTabCreated((event, data) => {
        createTabButton(data.index, data.title);
        setTimeout(() => updateTabWidths(data.totalTabs), 10);
    });

    window.tab.onTabRemoved((event, data) => {
        removeTabButton(data.index);
        setTimeout(() => updateTabWidths(data.totalTabs), 10);
    });

    window.tab.onTabSwitched((event, data) => {
        activeTabIndex = data.index;
        setActiveTab(data.index);
        updateSearchBarUrl(data.url || "");
    });

    window.tab.onUrlUpdated((event, data) => {
        if (data.index === activeTabIndex) {
            updateSearchBarUrl(data.url);
        }
        updateTabTitle(data.index, data.title || data.url, data.favicon);
    });

    window.tab.onNavigationUpdated((event, data) => {
        if (data.index === activeTabIndex) {
            updateNavigationButtons(data.canGoBack, data.canGoForward);
        }
    });

    function createTabButton(index, title) {
        if (tabs.has(index)) {
            return;
        }
        
        const tabButton = document.createElement('div');
        tabButton.className = 'tab-button';
        tabButton.dataset.index = index;
        tabButton.draggable = true;
        
        const tabTitle = document.createElement('span');
        tabTitle.className = 'tab-title';
        tabTitle.textContent = title || `Tab ${index + 1}`;
        
        const closeButton = document.createElement('button');
        closeButton.className = 'tab-close';
        closeButton.innerHTML = '×';
        closeButton.onclick = (e) => {
            e.stopPropagation();
            window.tab.remove(parseInt(index));
        };
        
        tabButton.appendChild(tabTitle);
        tabButton.appendChild(closeButton);
        
        tabButton.addEventListener('click', () => {
            window.tab.switch(parseInt(index));
        });

        // Simple drag implementation
        tabButton.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(index));
            e.dataTransfer.effectAllowed = 'move';
            tabButton.classList.add('dragging');
        });

        tabButton.addEventListener('dragend', async (e) => {
            tabButton.classList.remove('dragging');
            
            // Check if dropped outside current window
            const targetWindow = await window.dragdrop.getWindowAtPoint(e.screenX, e.screenY);
            const thisWindowId = await window.dragdrop.getThisWindowId();
            
            if (!targetWindow) {
                // Dropped outside any window - detach to new window
                const url = await window.tab.getTabUrl(index);
                await window.dragdrop.detachToNewWindow(index, e.screenX, e.screenY, url);
            } else if (targetWindow.id !== thisWindowId) {
                // Dropped on another window - move tab there
                const url = await window.tab.getTabUrl(index);
                await window.dragdrop.moveTabToWindow(thisWindowId, index, targetWindow.id, url);
            }
            // else: dropped in same window - already handled by dragover
        });
        
        tabBar.appendChild(tabButton);
        tabs.set(index, tabButton);
        
        setActiveTab(index);
    }

    function removeTabButton(index) {
        const tabButton = tabs.get(index);
        if (tabButton) {
            tabButton.remove();
            tabs.delete(index);
        }
    }

    function setActiveTab(index) {
        tabs.forEach(tab => tab.classList.remove('active'));
        
        const activeTab = tabs.get(index);
        if (activeTab) {
            activeTab.classList.add('active');
        }
        activeTabIndex = index;
    }

    function updateSearchBarUrl(url) {
        searchBar.value = url;
    }

    function updateTabTitle(index, title, faviconUrl) {
        const tabButton = tabs.get(index);
        if (tabButton) {
            const titleSpan = tabButton.querySelector('.tab-title');
            let faviconElement = tabButton.querySelector('.tab-favicon');
            
            if (titleSpan) {
                titleSpan.textContent = title || `Tab ${index + 1}`;
            }
            
            if (faviconUrl && faviconUrl !== '') {
                if (!faviconElement) {
                    faviconElement = document.createElement('img');
                    faviconElement.className = 'tab-favicon';
                    tabButton.insertBefore(faviconElement, titleSpan);
                }
                updateTabFavicon(faviconElement, faviconUrl);
            } else if (faviconElement) {
                faviconElement.remove();
            }
        }
    }

    function updateTabFavicon(faviconElement, faviconUrl) {
        if (faviconUrl && faviconUrl !== '') {
            faviconElement.src = faviconUrl;
            faviconElement.alt = '';
            faviconElement.onerror = () => {
                setDomainFavicon(faviconElement, faviconUrl);
            };
        } else {
            setDomainFavicon(faviconElement, '');
        }
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
        const actualTabCount = tabs.size;
        
        if (actualTabCount === 0) {
            return;
        }
        
        requestAnimationFrame(() => {
            const tabBarWidth = tabBar.offsetWidth;
            const idealTabWidth = Math.floor(tabBarWidth / actualTabCount);
            const minTabWidth = 28; // Minimum width before scrolling is started
            
            if (idealTabWidth >= minTabWidth) {
                tabs.forEach((tab, index) => {
                    tab.style.width = `${idealTabWidth}px`;
                    tab.style.minWidth = `${idealTabWidth}px`;
                    tab.style.maxWidth = `${idealTabWidth}px`;
                    tab.style.flexShrink = '0';
                });
                tabBar.style.overflowX = 'hidden';
            } else {
                tabs.forEach((tab, index) => {
                    tab.style.width = `${minTabWidth}px`;
                    tab.style.minWidth = `${minTabWidth}px`;
                    tab.style.maxWidth = `${minTabWidth}px`;
                    tab.style.flexShrink = '0';
                });
                tabBar.style.overflowX = 'auto';
            }
        });
    }

    window.addEventListener('resize', () => {
        setTimeout(() => updateTabWidths(tabs.size), 100);
    });

    // In-window reordering
    tabBar.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const draggingTab = document.querySelector('.dragging');
        if (!draggingTab) return;
        
        const afterElement = getDragAfterElement(tabBar, e.clientX);
        if (afterElement == null) {
            tabBar.appendChild(draggingTab);
        } else {
            tabBar.insertBefore(draggingTab, afterElement);
        }
    });

    function getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.tab-button:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function updateNavigationButtons(canGoBack, canGoForward) {
        backBtn.disabled = !canGoBack;
        forwardBtn.disabled = !canGoForward;
        
        backBtn.style.opacity = canGoBack ? '1' : '0.5';
        forwardBtn.style.opacity = canGoForward ? '1' : '0.5';
        backBtn.style.cursor = canGoBack ? 'pointer' : 'not-allowed';
        forwardBtn.style.cursor = canGoForward ? 'pointer' : 'not-allowed';
    }

    setTimeout(() => {
        if (tabs.size > 0) {
            updateTabWidths(tabs.size);
        }
    }, 100);
});