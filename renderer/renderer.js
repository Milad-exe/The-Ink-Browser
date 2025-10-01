document.addEventListener("DOMContentLoaded", () => {
    const addBtn = document.getElementById("new-tab-btn");
    const tabBar = document.getElementById("tab-bar");
    const searchBar = document.getElementById("searchBar");
    const backBtn = document.getElementById("back-btn");
    const forwardBtn = document.getElementById("forward-btn");
    const reloadBtn = document.getElementById("reload-btn");
    
    let tabs = new Map();
    let tabCounter = 0;
    let initialTabCreated = false;
    let activeTabIndex = 0;

    // Navigation button event listeners
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

    function loadUrlInActiveTab(url) {
        let formattedUrl = url;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            if (url.includes(".") && !url.includes(" ")) {
                formattedUrl = "https://" + url;
            } else {
                formattedUrl = "https://www.google.com/search?q=" + encodeURIComponent(url);
            }
        }
        
        console.log('Loading URL in active tab:', formattedUrl);
        window.tab.loadUrl(activeTabIndex, formattedUrl);
    }

    addBtn.addEventListener("click", async () => {
        window.tab.add();
    });

    window.tab.onTabCreated((event, data) => {
        console.log('Tab created:', data);
        createTabButton(data.index, data.title);
        setTimeout(() => updateTabWidths(data.totalTabs), 10);
    });

    window.tab.onTabRemoved((event, data) => {
        console.log('Tab removed:', data);
        removeTabButton(data.index);
        setTimeout(() => updateTabWidths(data.totalTabs), 10);
    });

    window.tab.onTabSwitched((event, data) => {
        console.log('Tab switched:', data);
        activeTabIndex = data.index;
        setActiveTab(data.index);
        updateSearchBarUrl(data.url || "");
    });

    window.tab.onUrlUpdated((event, data) => {
        console.log('Tab URL updated:', data);
        if (data.index === activeTabIndex) {
            updateSearchBarUrl(data.url);
        }
        updateTabTitle(data.index, data.title || data.url, data.favicon);
    });

    window.tab.onNavigationUpdated((event, data) => {
        console.log('Navigation updated:', data);
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
        
        tabBar.appendChild(tabButton);
        tabs.set(index, tabButton);
        
        console.log('Created tab button:', index, 'Total tabs in UI:', tabs.size);
        
        setActiveTab(index);
    }

    function removeTabButton(index) {
        const tabButton = tabs.get(index);
        if (tabButton) {
            tabButton.remove();
            tabs.delete(index);
            console.log('Removed tab button:', index, 'Remaining tabs:', tabs.size);
        }
    }

    function setActiveTab(index) {
        tabs.forEach(tab => tab.classList.remove('active'));
        
        const activeTab = tabs.get(index);
        if (activeTab) {
            activeTab.classList.add('active');
            console.log('Set active tab:', index);
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
            
            faviconElement.onload = () => {
                console.log('Favicon loaded:', faviconUrl);
            };
            
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
            
            console.log('Tab bar width:', tabBarWidth, 'Using tab count:', actualTabCount, 'Width per tab:', idealTabWidth);
            
            if (idealTabWidth >= minTabWidth) {
                tabs.forEach((tab, index) => {
                    tab.style.width = `${idealTabWidth}px`;
                    tab.style.minWidth = `${idealTabWidth}px`;
                    tab.style.maxWidth = `${idealTabWidth}px`;
                    tab.style.flexShrink = '0';
                    console.log('Set tab', index, 'width to', idealTabWidth);
                });
                tabBar.style.overflowX = 'hidden';
            } else {
                tabs.forEach((tab, index) => {
                    tab.style.width = `${minTabWidth}px`;
                    tab.style.minWidth = `${minTabWidth}px`;
                    tab.style.maxWidth = `${minTabWidth}px`;
                    tab.style.flexShrink = '0';
                    console.log('Set tab', index, 'width to minimum', minTabWidth);
                });
                tabBar.style.overflowX = 'auto';
            }
        });
    }

    window.addEventListener('resize', () => {
        setTimeout(() => updateTabWidths(tabs.size), 100);
    });

    function updateNavigationButtons(canGoBack, canGoForward) {
        backBtn.disabled = !canGoBack;
        forwardBtn.disabled = !canGoForward;
        
        // Add visual styling for disabled state
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