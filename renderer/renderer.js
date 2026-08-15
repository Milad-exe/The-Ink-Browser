"use strict";
// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
(() => {
    /**
     * Browser chrome renderer — tab bar, address bar, bookmark bar, focus mode,
     * Pomodoro timer, and window controls.
     *
     * Everything runs inside a single DOMContentLoaded callback that owns all
     * shared state. Init functions below are defined with `function` declarations
     * (hoisted) and called in order at the top of the callback.
     *
     * Module-level helpers (pure utilities, no DOM/state access) live above the
     * DOMContentLoaded listener.
     */
    // ── Module-level utilities ────────────────────────────────────────────────────
    /** Sanitize an HTML string using DOMPurify when available. */
    const sanitizeHtml = (typeof DOMPurify !== 'undefined')
        ? (html) => DOMPurify.sanitize(html, { FORCE_BODY: false })
        : (html) => html;
    /** Returns a debounced wrapper around `fn` with a `.cancel()` method. */
    function debounce(fn, delay = 150) {
        let t;
        const db = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
        db.cancel = () => clearTimeout(t);
        return db;
    }
    /** Paint a cached favicon (from sites you've actually visited) onto an <img>,
     *  or remove the <img> if we have none — NO network fetch. This is why typing
     *  in the omnibox / rendering the bookmark bar never pings a site's favicon. */
    function paintCachedFavicon(imgEl, url) {
        let host = '';
        try {
            host = new URL(url).host;
        }
        catch { }
        if (!host || !window.tab?.cachedFavicon) {
            imgEl.remove();
            return;
        }
        window.tab.cachedFavicon(host).then((d) => {
            if (d)
                imgEl.src = d;
            else
                imgEl.remove();
        }).catch(() => imgEl.remove());
    }
    /** Folder SVG markup (Material Design folder shape). */
    const FOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="11" viewBox="0 0 24 20" fill="currentColor"><path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/></svg>';
    /** Create a `<span>` containing the folder SVG. */
    function makeFolderIcon(cls) {
        const span = document.createElement('span');
        span.className = cls || 'bookmark-folder-icon';
        span.innerHTML = FOLDER_SVG;
        return span;
    }
    // ── Entry point ───────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // ── Fully synchronous startup ─────────────────────────────────────────────
        // The main process sends tab-created / tab-switched / url-updated /
        // navigation-updated from its did-finish-load handler, which fires after
        // this callback. IF this callback were async, those IPC handlers could run
        // during an await — before the const DOM refs (searchBar, backBtn, …) and
        // the suggestion state below are initialized — throwing "Cannot access X
        // before initialization" and leaving the address bar/nav buttons dead.
        // Loading settings synchronously keeps the entire setup in one tick, so no
        // IPC is processed until every declaration and init function has run.
        let tabs = new Map(); // tabIndex → <div.tab-button>
        let splitPair = null; // [idxA, idxB] when split view is active
        let folderState = { folders: [], assign: new Map() }; // tab folders
        let tabUrls = new Map(); // tabIndex → url string
        let tabPrivate = new Map(); // tabIndex → boolean (private flag)
        let tabLoading = new Set(); // tabIndexes currently loading
        let personaNames = {}; // persona id → current display name (for labelling)
        // Only the active workspace's tabs are shown in the strip.
        function filterTabsByWorkspace() {
            for (const [idx, btn] of tabs) {
                const ws = btn.dataset.ws || '1';
                btn.classList.toggle('ws-hidden', ws !== activeWorkspace);
            }
            updateChromeTabs(document.querySelectorAll('#tabs-container .tab-button:not(.ws-hidden)').length);
            syncPinCols();
        }
        let activeTabIndex = 0;
        let currentTabUrl = '';
        // True once the user (click) or Cmd+L/Cmd+K intentionally focuses the
        // omnibox — lets the startup focus guard tell an intended focus from the
        // native focus-restore that pulls the bar on launch / new window.
        let omniFocusIntent = false;
        let currentTabTitle = '';
        // ── Settings (synchronous) ────────────────────────────────────────────────
        let settings = {};
        try {
            settings = window.northstarSettings.getSync() || {};
        }
        catch { }
        const getSearchEngine = () => settings.searchEngine || 'google';
        const getPomSetting = (key, def) => (typeof settings[key] === 'number' ? settings[key] : def);
        // ── Private window detection (synchronous) ────────────────────────────────
        let isPrivateWindow = false;
        try {
            isPrivateWindow = window.northstarPrivate?.isPrivateWindowSync?.() ?? false;
        }
        catch { }
        if (isPrivateWindow) {
            document.documentElement.setAttribute('data-private-window', 'true');
        }
        window.northstarPrivate?.onSetPrivateWindow?.((v) => {
            if (v)
                document.documentElement.setAttribute('data-private-window', 'true');
            else
                document.documentElement.removeAttribute('data-private-window');
        });
        // ── Shared state ──────────────────────────────────────────────────────────
        let menuOpen = false;
        // ── Bookmark bar state (must be declared before initBookmarkBar() is called) ──
        let bookmarkBarVisible = !!settings.bookmarkBarVisible;
        let hasBookmarks = false;
        let renamingFolderId = null;
        let refreshSeq = 0;
        let openDropdownId = null; // id of the anchor button whose dropdown is open
        let dropdownCleanup = null;
        // ── DOM references ─────────────────────────────────────────────────────────
        const tabBar = document.getElementById('tab-bar');
        const tabsContainer = document.getElementById('tabs-container');
        const searchBar = document.getElementById('searchBar');
        const backBtn = document.getElementById('back-btn');
        const forwardBtn = document.getElementById('forward-btn');
        const reloadBtn = document.getElementById('reload-btn');
        const omnibox = document.querySelector('.omnibox');
        const omniIcon = document.getElementById('omni-icon');
        const urlDisplay = document.getElementById('url-display');
        const menuBtn = document.getElementById('menu-btn');
        const addBtn = document.getElementById('new-tab-btn');
        const tabDragSpacer = document.getElementById('tab-drag-spacer');
        const bookmarkBtn = document.getElementById('bookmark-btn');
        const bookmarkBar = document.getElementById('bookmark-bar');
        const bookmarkBarItems = document.getElementById('bookmark-bar-items');
        // ── Init sequence ─────────────────────────────────────────────────────────
        initTabBarSide(); // set side/top layout BEFORE anything measures the strip
        initTabBar(); // registers all tab IPC listeners
        initWindowControls();
        initNavButtons();
        initAddressBar();
        initBookmarkBar();
        initFocusModeAndPomodoro();
        initMenu();
        initDownloads();
        initExtensions();
        initUtilityBarConfig();
        initReaderAndPip();
        initChromeClock();
        initPersonas();
        initProfiles();
        initEssentials();
        // ─────────────────────────────────────────────────────────────────────────
        // Chrome status clock (tab strip) — updates on the minute, no seconds timer
        // ─────────────────────────────────────────────────────────────────────────
        function initChromeClock() {
            const el = document.getElementById('chrome-clock');
            if (!el)
                return;
            const paint = () => {
                const n = new Date();
                const h = n.getHours(), m = n.getMinutes();
                el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            };
            paint();
            // Align to the top of the next minute, then tick each minute.
            setTimeout(() => { paint(); setInterval(paint, 60000); }, (60 - new Date().getSeconds()) * 1000);
        }
        // Mono "TABS·N" micro-label in the chrome status. Prefers the count the
        // main process sends; falls back to counting the rendered tab buttons.
        function updateChromeTabs(n) {
            const el = document.getElementById('chrome-tabs');
            if (!el)
                return;
            const count = (typeof n === 'number' && n > 0) ? n : document.querySelectorAll('.tab-button').length;
            el.textContent = 'TABS·' + count;
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Window controls
        // ─────────────────────────────────────────────────────────────────────────
        function initWindowControls() {
            const container = document.getElementById('window-controls');
            if (!container || !window.windowControls)
                return;
            if (window.windowControls.platform === 'darwin') {
                container.style.width = '72px'; // space for native traffic lights
                container.classList.add('wc-mac');
                return;
            }
            // Windows / Linux: render our own controls on the right side
            container.innerHTML = `
            <button class="wc-btn wc-minimize" id="wc-minimize" title="Minimize">
              <svg viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
            </button>
            <button class="wc-btn wc-maximize" id="wc-maximize" title="Maximize">
              <svg viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>
            </button>
            <button class="wc-btn wc-close" id="wc-close" title="Close">
              <svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
            </button>`;
            container.classList.add('wc-win');
            document.getElementById('wc-close')?.addEventListener('click', () => window.windowControls.close());
            document.getElementById('wc-minimize')?.addEventListener('click', () => window.windowControls.minimize());
            document.getElementById('wc-maximize')?.addEventListener('click', () => window.windowControls.maximize());
            window.windowControls.onMaximizeChanged((isMax) => {
                const btn = document.getElementById('wc-maximize');
                if (!btn)
                    return;
                btn.title = isMax ? 'Restore' : 'Maximize';
                btn.innerHTML = isMax
                    ? `<svg viewBox="0 0 10 10" fill="none"><rect x="2" y="0" width="8" height="8" stroke="currentColor"/><rect x="0" y="2" width="8" height="8" stroke="currentColor" fill="var(--surface-container-lowest)"/></svg>`
                    : `<svg viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>`;
            });
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Navigation buttons (back / forward / reload)
        // ─────────────────────────────────────────────────────────────────────────
        function initNavButtons() {
            setupNavButton(backBtn, () => window.tab.goBack(activeTabIndex));
            setupNavButton(forwardBtn, () => window.tab.goForward(activeTabIndex));
            reloadBtn.addEventListener('click', () => {
                if (tabLoading.has(activeTabIndex))
                    window.tab.stop(activeTabIndex);
                else
                    window.tab.reload(activeTabIndex);
            });
            addBtn.addEventListener('click', () => window.tab.add());
            window.addEventListener('click', (e) => {
                if (menuOpen)
                    window.electronAPI.windowClick({ x: e.clientX, y: e.clientY });
            });
            window.menu.onClosed(() => { menuOpen = false; });
        }
        /**
         * Back/forward buttons — click navigates one step; holding the button
         * (or right-clicking it) shows the tab's history list, Firefox-style.
         */
        function setupNavButton(btn, action) {
            let pressTimer = null;
            let menuShown = false;
            const showHistoryMenu = () => {
                const r = btn.getBoundingClientRect();
                window.tab.showNavHistoryMenu(activeTabIndex, Math.round(r.left), Math.round(r.bottom + 2));
            };
            btn.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || btn.disabled)
                    return;
                menuShown = false;
                clearTimeout(pressTimer);
                pressTimer = setTimeout(() => { menuShown = true; showHistoryMenu(); }, 400);
            });
            btn.addEventListener('mouseup', () => clearTimeout(pressTimer));
            btn.addEventListener('mouseleave', () => clearTimeout(pressTimer));
            btn.addEventListener('click', () => {
                if (menuShown) {
                    menuShown = false;
                    return;
                } // long-press already handled
                action();
            });
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (!btn.disabled)
                    showHistoryMenu();
            });
        }
        function updateNavigationButtons(canGoBack, canGoForward) {
            backBtn.disabled = !canGoBack;
            forwardBtn.disabled = !canGoForward;
            backBtn.style.opacity = canGoBack ? '1' : '0.5';
            forwardBtn.style.opacity = canGoForward ? '1' : '0.5';
            backBtn.style.cursor = canGoBack ? 'pointer' : 'not-allowed';
            forwardBtn.style.cursor = canGoForward ? 'pointer' : 'not-allowed';
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Address bar + URL suggestions overlay
        // ─────────────────────────────────────────────────────────────────────────
        function initAddressBar() {
            // Pre-warm the suggestions overlay so its first load doesn't steal
            // focus (and a keystroke) once the user starts typing — but NOT during
            // startup: spawning that renderer competed with the chrome's own first
            // paint. Warm on first address-bar focus, or once startup has settled.
            let suggestionsWarmed = false;
            const warmSuggestions = () => {
                if (suggestionsWarmed)
                    return;
                suggestionsWarmed = true;
                window.suggestions.warm?.().catch?.(() => { });
            };
            searchBar.addEventListener('focus', warmSuggestions, { once: true });
            setTimeout(warmSuggestions, 2500);
            searchBar.addEventListener('input', (e) => {
                userTyping = true;
                barEdited = true;
                // Only autocomplete on insertions — autofilling right after the user
                // deletes text would "bring back" the URL they just erased.
                lastInputWasInsert = !!(e.inputType && e.inputType.startsWith('insert'));
                updateSuggestions();
            });
            searchBar.addEventListener('focus', () => {
                updateUrlDisplay();
                updateOmniboxIcon();
                if (userTyping) {
                    if (searchBar.value.trim())
                        updateSuggestions();
                }
                else if (barEdited) {
                    // Refocusing with an uncommitted edit — keep the typed text
                    // (Firefox preserves it until you actually navigate).
                    searchBar.select();
                }
                else {
                    if (currentTabUrl && searchBar.value !== currentTabUrl)
                        searchBar.value = currentTabUrl;
                    searchBar.select();
                }
            });
            searchBar.addEventListener('blur', () => {
                // Uncommitted typed text stays in the bar (Firefox); otherwise rest
                // on the full URL with the host emphasised (url-display overlay).
                if (!barEdited && currentTabUrl)
                    searchBar.value = restingValueFor(currentTabUrl);
                updateUrlDisplay();
                updateOmniboxIcon();
                setTimeout(() => {
                    if (overlayPointerDown)
                        return;
                    if (document.activeElement === searchBar)
                        return;
                    hideSuggestions();
                }, 400);
            });
            searchBar.addEventListener('keydown', onSearchKeyDown);
            // Lock / security icon → Firefox-style site-info panel (connection,
            // permissions, clear data). Only meaningful on real http(s) pages.
            omniIcon?.addEventListener('mousedown', (e) => {
                const kind = omnibox?.dataset.omni;
                if (kind !== 'secure' && kind !== 'insecure')
                    return;
                e.preventDefault();
                e.stopPropagation();
                const r = omniIcon.getBoundingClientRect();
                try {
                    window.siteInfo.open({ x: Math.round(r.left), y: Math.round(r.bottom) });
                }
                catch { }
            });
            // Overlay view was (re)created — restore focus to the address bar, but
            // only if the user was actually typing (the overlay is also pre-warmed
            // at startup, which must not grab focus or fake a typing session).
            window.suggestions.onCreated(() => { if (userTyping) {
                try {
                    searchBar.focus();
                }
                catch { }
            } });
            window.suggestions.onSelected(onSuggestionSelected);
            window.suggestions.onPointerDown(() => {
                overlayPointerDown = true;
                setTimeout(() => { overlayPointerDown = false; }, 350);
            });
            if (window.contentInteraction) {
                window.contentInteraction.onClicked(() => { hideSuggestions(); searchBar.blur(); });
            }
            // New blank tab (main process) → focus + select the address bar so the
            // user can immediately type a URL. This fires more than once per new
            // tab (the page load can steal focus back) — don't clobber text the
            // user already started typing.
            window.electronAPI.onFocusAddressBar?.(() => {
                omniFocusIntent = true; // Cmd+L / Cmd+K is an intentional focus
                if (userTyping && document.activeElement === searchBar)
                    return;
                try {
                    searchBar.focus();
                    searchBar.select();
                }
                catch { }
            });
            window.addEventListener('resize', positionSuggestions);
            window.addEventListener('scroll', positionSuggestions, true);
        }
        // ── Suggestion state ──────────────────────────────────────────────────────
        let currentSuggestions = [];
        let activeSuggestionIndex = -1;
        let overlayPointerDown = false;
        let userTyping = false;
        let lastInputWasInsert = false;
        let currentQuery = ''; // the user's typed text, for match highlighting
        let barEdited = false; // uncommitted typed text in the bar (survives blur)
        function getSuggestionsBounds() {
            const r = searchBar.getBoundingClientRect();
            return { left: r.left, top: r.bottom + 4, width: r.width };
        }
        function positionSuggestions() {
            if (!currentSuggestions.length)
                return;
            window.suggestions.update(getSuggestionsBounds(), currentSuggestions, activeSuggestionIndex, currentQuery, getSearchEngine());
        }
        function hideSuggestions() {
            userTyping = false;
            updateSuggestions.cancel();
            window.suggestions.close();
            currentSuggestions = [];
            activeSuggestionIndex = -1;
        }
        function renderSuggestions(list) {
            if (!userTyping)
                return;
            currentSuggestions = list;
            activeSuggestionIndex = list.length ? 0 : -1;
            if (!list.length) {
                hideSuggestions();
                return;
            }
            window.suggestions.open(getSuggestionsBounds(), currentSuggestions, activeSuggestionIndex, currentQuery, getSearchEngine()).catch(() => { });
        }
        function setActiveSuggestion(newIndex) {
            if (!currentSuggestions.length)
                return;
            if (newIndex < 0)
                newIndex = currentSuggestions.length - 1;
            if (newIndex >= currentSuggestions.length)
                newIndex = 0;
            activeSuggestionIndex = newIndex;
            const item = currentSuggestions[newIndex];
            if (item)
                searchBar.value = item.url || item.query || '';
            window.suggestions.update(getSuggestionsBounds(), currentSuggestions, activeSuggestionIndex, currentQuery, getSearchEngine());
        }
        /**
         * Commit an address-bar navigation: load the URL, close the popup, and
         * move focus off the bar so it falls back to its resting display —
         * exactly what Firefox does on Enter / suggestion click.
         */
        function commitNavigation(value) {
            barEdited = false;
            userTyping = false;
            const formatted = loadUrlInActiveTab(value);
            if (formatted)
                currentTabUrl = formatted; // optimistic; url-updated confirms
            hideSuggestions();
            searchBar.blur();
            updateOmniboxIcon();
        }
        function handleSuggestionSelect(index) {
            const item = currentSuggestions[index];
            if (!item)
                return;
            if (item.type === 'switch-tab') {
                hideSuggestions();
                searchBar.blur();
                window.tab.switch(item.tabIndex);
            }
            else if ((item.type === 'history' || item.type === 'bookmark') && item.url) {
                if (item.persona) { hideSuggestions(); searchBar.blur(); window.tab.openInPersona(item.persona, item.url); return; }
                searchBar.value = item.url;
                commitNavigation(item.url);
            }
            else if (item.query) {
                searchBar.value = item.query;
                commitNavigation(item.query);
            }
        }
        function onSuggestionSelected(item) {
            if (!item)
                return;
            // The click landed in the overlay view — reclaim OS focus for the
            // chrome view first so the blur below lands on a focused bar.
            try {
                searchBar.focus();
            }
            catch { }
            if (item.type === 'switch-tab') {
                hideSuggestions();
                searchBar.blur();
                window.tab.switch(item.tabIndex);
                return;
            }
            if ((item.type === 'history' || item.type === 'bookmark') && item.url) {
                if (item.persona) { hideSuggestions(); searchBar.blur(); window.tab.openInPersona(item.persona, item.url); return; }
                searchBar.value = item.url;
                commitNavigation(item.url);
            }
            else if (item.query) {
                searchBar.value = item.query;
                commitNavigation(item.query);
            }
            else {
                hideSuggestions();
            }
        }
        function onSearchKeyDown(e) {
            // Firefox: Ctrl/Cmd+Enter wraps a bare term in www. … .com; anything
            // that already looks like a URL just navigates normally.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const v = searchBar.value.trim();
                if (!v)
                    return;
                searchBar.value = /[\s./:]/.test(v) ? v : `www.${v}.com`;
                commitNavigation(searchBar.value);
                return;
            }
            if (currentSuggestions.length) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveSuggestion(activeSuggestionIndex + 1);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveSuggestion(activeSuggestionIndex - 1);
                    return;
                }
                if (e.key === 'Tab') {
                    e.preventDefault();
                    setActiveSuggestion(activeSuggestionIndex + (e.shiftKey ? -1 : 1));
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    hideSuggestions();
                    return;
                }
                if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
                    e.preventDefault();
                    const item = currentSuggestions[activeSuggestionIndex];
                    // The action/navigate row's query is the raw typed prefix — use
                    // the live bar value so inline domain autofill is what loads.
                    if (item?.type === 'action' || item?.type === 'navigate') {
                        const url = searchBar.value.trim();
                        if (url)
                            commitNavigation(url);
                        return;
                    }
                    handleSuggestionSelect(activeSuggestionIndex);
                    return;
                }
            }
            else if (e.key === 'Escape') {
                // Popup already closed: a second Escape reverts the bar to the
                // page URL, keeping focus (Firefox behaviour).
                e.preventDefault();
                barEdited = false;
                userTyping = false;
                searchBar.value = currentTabUrl || '';
                searchBar.select();
                updateOmniboxIcon();
                return;
            }
            if (e.key === 'Enter') {
                const url = searchBar.value.trim();
                if (url)
                    commitNavigation(url);
            }
        }
        // ── Suggestion data sources ───────────────────────────────────────────────
        function getOpenTabSuggestions(q) {
            const ql = q.toLowerCase();
            const results = [];
            tabs.forEach((btn, index) => {
                if (index === activeTabIndex)
                    return;
                const url = tabUrls.get(index) || '';
                const title = btn.querySelector('.tab-title')?.textContent || '';
                if (!url || url === 'newtab' || url.startsWith('file://'))
                    return;
                if (!url.toLowerCase().includes(ql) && !title.toLowerCase().includes(ql))
                    return;
                results.push({ type: 'switch-tab', tabIndex: index, title: title || url, url });
            });
            return results;
        }
        async function getBookmarkSuggestions(q, limit = 3) {
            try {
                const entries = await window.browserBookmarks.getAll();
                if (!Array.isArray(entries) || !q)
                    return [];
                const ql = q.toLowerCase();
                const results = [];
                for (const e of entries) {
                    if (!e.url)
                        continue;
                    if (!e.url.toLowerCase().includes(ql) && !(e.title || '').toLowerCase().includes(ql))
                        continue;
                    const base = e.title || e.url;
                    const pName = e.persona ? (personaNames[e.persona] || 'persona') : null;
                    results.push({ type: 'bookmark', url: e.url, title: pName ? `${base}  ·  ${pName}` : base, persona: e.persona || null });
                    if (results.length >= limit)
                        break;
                }
                return results;
            }
            catch {
                return [];
            }
        }
        async function getHistorySuggestions(q, limit = 5) {
            try {
                const entries = await (window.browserHistory.search
                    ? window.browserHistory.search(q, limit * 3)
                    : window.browserHistory.get());
                if (!Array.isArray(entries) || !q)
                    return [];
                const results = [];
                const seen = new Set();
                for (const e of entries) {
                    if (!e.url)
                        continue;
                    // Key by URL *and persona* so the same page under two personas
                    // stays as two distinct suggestions.
                    const key = normalizeUrl(e.url) + '|' + (e.persona || '');
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    const base = e.title || e.url;
                    const pName = e.persona ? (personaNames[e.persona] || e.personaName || 'persona') : null;
                    results.push({
                        type: 'history', url: e.url,
                        title: pName ? `${base}  ·  ${pName}` : base,
                        persona: e.persona || null,
                    });
                    if (results.length >= limit)
                        break;
                }
                return results;
            }
            catch {
                return [];
            }
        }
        async function getSearchSuggestions(q, limit = 6) {
            if (!q)
                return [];
            // Firefox disables remote search suggestions in private browsing —
            // never leak keystrokes for a private window or private tab.
            if (isPrivateWindow || tabPrivate.get(activeTabIndex))
                return [];
            const engine = getSearchEngine();
            const suggestMap = {
                google: `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
                duckduckgo: `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
                bing: `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
            };
            try {
                const res = await fetch(suggestMap[engine] || suggestMap.google, { cache: 'no-store' });
                const data = await res.json();
                const arr = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
                return arr.slice(0, limit).map(s => ({ type: engine, query: s }));
            }
            catch {
                return [];
            }
        }
        /**
         * Relevance rank for a history/bookmark/tab entry against the query.
         * Lower is better; -1 means "not relevant enough, hide it".
         *
         * This is what stops noise like `gymshark.com` / `spotify.com` showing for
         * "y" just because the letter appears somewhere inside them — a bare
         * substring only counts once the query is at least 3 chars long.
         */
        function linkScore(item, ql) {
            let host = '', path = '';
            const title = (item.title || '').toLowerCase();
            try {
                const u = new URL(item.url);
                host = u.hostname.replace(/^www\./, '').toLowerCase();
                path = (u.pathname + u.search).toLowerCase();
            }
            catch {
                host = (item.url || '').toLowerCase();
            }
            if (host.startsWith(ql))
                return 0; // youtube.com for "you"
            if (host.split('.').some(l => l.startsWith(ql)))
                return 1; // sub-label: m.youtube.com
            if (title.split(/[\s\-–—_/|:.()]+/).some(w => w.startsWith(ql)))
                return 2; // title word start
            if (ql.length >= 3 && (host.includes(ql) || title.includes(ql) || path.includes(ql)))
                return 3;
            return -1;
        }
        /**
         * Firefox surfaces clean, high-frecency pages — not OAuth/sign-in redirects
         * or giant tracking URLs. We lack visit counts, so approximate: a weak match
         * (title/substring only, score ≥ 2) that lands on a login redirect or a long
         * param-heavy URL is almost never what the user wants. Strong host matches
         * (score < 2, e.g. youtube.com/watch?v=…) are always kept.
         */
        function isLowValueMatch(url, score) {
            if (score < 2)
                return false;
            const u = url || '';
            if (u.length > 90)
                return true;
            if (/[?&](continue|dsh|ifkv|flowName|flowEntry|checkConnection|gclid|gclsrc|gad_)/i.test(u))
                return true;
            if (/\/(signin|oauth2?|auth|login|challenge)\b/i.test(u))
                return true;
            return false;
        }
        /** Lower = cleaner: short URLs with a real title sort ahead of long/untitled ones. */
        function cleanliness(item) {
            const hasTitle = item.title && item.title !== item.url;
            return (item.url || '').length + (hasTitle ? 0 : 40);
        }
        /**
         * Firefox-style inline autocomplete: if the top domain match extends what
         * the user typed, return the completed host (e.g. "you" → "youtube.com").
         * Returns null when it isn't safe to autofill (caret not at end, user is
         * deleting, query has spaces, etc.). Caller applies it to the input.
         */
        function computeAutofill(q, url) {
            if (!lastInputWasInsert || !userTyping)
                return null;
            if (document.activeElement !== searchBar)
                return null;
            if (searchBar.value !== q)
                return null; // user typed more since
            if (q.includes(' ') || /^https?:\/\//i.test(q))
                return null;
            if (searchBar.selectionStart !== q.length ||
                searchBar.selectionEnd !== q.length)
                return null; // caret must be at the end
            const ql = q.toLowerCase();
            let host;
            try {
                host = new URL(url).hostname.toLowerCase();
            }
            catch {
                return null;
            }
            const bare = host.replace(/^www\./, '');
            const match = bare.startsWith(ql) ? bare : (host.startsWith(ql) ? host : null);
            return (match && match.length > q.length) ? match : null;
        }
        /** Does the typed text look like a URL/domain rather than a search? */
        function looksLikeUrl(q) {
            if (/^https?:\/\//i.test(q))
                return true;
            if (/\s/.test(q))
                return false;
            // bare domain / host[:port][/path] — needs a dot with a TLD-ish tail
            return /^[^\s/]+\.[a-z]{2,}([:/].*)?$/i.test(q) || /^localhost([:/].*)?$/i.test(q);
        }
        const updateSuggestions = debounce(async () => {
            const q = searchBar.value.trim();
            if (!q) {
                hideSuggestions();
                return;
            }
            const ql = q.toLowerCase();
            currentQuery = q; // typed text drives the bold-completion highlighting
            // Immediate feedback while async sources load
            renderSuggestions([looksLikeUrl(q) ? { type: 'navigate', query: q } : { type: 'action', query: q }]);
            try {
                // Over-fetch links so relevance scoring (below) has enough
                // candidates to find good matches before we truncate the list.
                const openTabs = getOpenTabSuggestions(q);
                const [bookmarks, hist, search] = await Promise.all([
                    getBookmarkSuggestions(q, 12),
                    getHistorySuggestions(q, 20),
                    getSearchSuggestions(q, 6),
                ]);
                // Score each link/tab; drop irrelevant and low-value (auth/redirect)
                // matches. Bookmarks slightly outrank history at the same tier.
                const scored = [];
                const consider = (item, bias) => {
                    const s = linkScore(item, ql);
                    if (s < 0 || isLowValueMatch(item.url, s))
                        return;
                    scored.push({ item, score: s + bias, clean: cleanliness(item) });
                };
                for (const b of bookmarks)
                    consider(b, -0.1);
                for (const h of hist)
                    consider(h, 0);
                for (const t of openTabs)
                    consider(t, -0.2);
                // Sort by relevance tier, then by cleanliness (short, titled URLs first).
                scored.sort((a, b) => (a.score - b.score) || (a.clean - b.clean));
                // Dedup by normalized host+path (ignoring www), keeping the best entry.
                const rankedLinks = [];
                const seenLinks = new Set();
                for (const { item } of scored) {
                    const key = normalizeUrl(item.url);
                    if (seenLinks.has(key))
                        continue;
                    seenLinks.add(key);
                    rankedLinks.push(item);
                }
                // Inline-autofill from the top domain-prefix match, and make the
                // first row match what's now in the address bar so Enter is obvious.
                const topDomain = rankedLinks.find(x => linkScore(x, ql) === 0);
                const completed = topDomain ? computeAutofill(q, topDomain.url) : null;
                if (completed) {
                    searchBar.value = q + completed.slice(q.length);
                    searchBar.setSelectionRange(q.length, searchBar.value.length);
                }
                const base = completed
                    ? { type: 'navigate', query: completed }
                    : (looksLikeUrl(q) ? { type: 'navigate', query: q } : { type: 'action', query: q });
                // The heuristic already represents the autofilled domain — don't
                // repeat it as a history row right underneath (Firefox collapses this).
                const heuristicKey = completed ? normalizeUrl('https://' + completed) : null;
                const merged = [base];
                const seenQuery = new Set([String(base.query).toLowerCase()]);
                // Search suggestions right under the heuristic row (max 3); skip
                // base-query dupes. Firefox's default order shows suggestions
                // ahead of history/bookmarks.
                let searchCount = 0;
                for (const s of search) {
                    const k = (s.query || '').toLowerCase();
                    if (k && !seenQuery.has(k)) {
                        merged.push(s);
                        seenQuery.add(k);
                        if (++searchCount >= 3)
                            break;
                    }
                }
                // History / bookmarks / open tabs — tight cap like Firefox (max 4).
                // Caps keep the whole list (base + ≤3 search + ≤4 links = ≤8) visible
                // without scrolling — see MAX_HEIGHT in ipc/suggestions.js.
                let linkCount = 0;
                for (const link of rankedLinks) {
                    if (heuristicKey && normalizeUrl(link.url) === heuristicKey)
                        continue;
                    merged.push(link);
                    if (++linkCount >= 4)
                        break;
                }
                renderSuggestions(merged);
            }
            catch { /* keep base rendered */ }
        }, 120);
        // Normalize for dedup: host (without www) + path, lowercased, no trailing slash.
        function normalizeUrl(u) {
            try {
                const n = new URL(u);
                return (n.hostname.replace(/^www\./, '') + n.pathname).toLowerCase().replace(/\/$/, '');
            }
            catch {
                return (u || '').toLowerCase();
            }
        }
        // ── URL loading ───────────────────────────────────────────────────────────
        // Turn omnibox / dropped input into a loadable URL: pass through real
        // URLs, http-ify bare domains, and send anything else to the search engine.
        function formatToUrl(input) {
            const text = String(input || '').trim();
            if (!text) return '';
            if (/^https?:\/\//i.test(text)) return text;
            if (/^northstar:\/\//i.test(text)) return text; // internal-page scheme
            if (/^(file|about|data|blob):/i.test(text)) return text; // dropped file:// etc.
            if (text.includes('.') && !/\s/.test(text)) return 'https://' + text;
            const engines = {
                google: 'https://www.google.com/search?q=',
                duckduckgo: 'https://duckduckgo.com/?q=',
                bing: 'https://www.bing.com/search?q=',
            };
            return (engines[getSearchEngine()] || engines.google) + encodeURIComponent(text);
        }
        function loadUrlInActiveTab(url) {
            const formatted = formatToUrl(url);
            window.tab.loadUrl(activeTabIndex, formatted);
            return formatted;
        }
        function getDomainDisplay(url) {
            if (!url || url === 'newtab' || url.startsWith('file://'))
                return url || '';
            return window.urlUtils?.getDomain(url) || url;
        }
        // Internal-page tokens ('settings', 'settings/appearance', 'history',
        // 'bookmarks') display as northstar:// urls in the omnibox. Accepts a bare
        // token or an already-formed northstar:// url; null for anything else.
        function northstarDisplay(token) {
            if (!token)
                return null;
            if (/^northstar:\/\//i.test(token))
                return token;
            const base = String(token).split('/')[0];
            if (['settings', 'history', 'bookmarks'].includes(base))
                return 'northstar://' + token;
            return null;
        }
        // ── Firefox-style resting URL display ─────────────────────────────────────
        // While the bar is unfocused the full URL stays visible, painted into the
        // #url-display overlay: host in full text colour, scheme and path dimmed.
        // The input underneath keeps the complete URL (transparent text) so focus
        // and select-all behave normally.
        // Parse `url` into [dimmed prefix, host, dimmed rest]; null if it isn't a
        // plain displayable http(s) URL.
        function urlDisplayParts(url) {
            let u;
            try {
                u = new URL(url);
            }
            catch {
                return null;
            }
            if (u.protocol !== 'https:' && u.protocol !== 'http:')
                return null;
            // Split on the raw string, not the parsed origin — IDN hosts, uppercase
            // schemes and credential forms would otherwise fall back to domain-only
            // and make the rest of the URL vanish from the bar.
            const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^/?#@]*@)?)([^/?#]+)([\s\S]*)$/);
            if (!m)
                return null;
            return [m[1], m[2], m[3]];
        }
        // Resting input value: the full URL for http(s) pages, the legacy domain
        // fallback for internal pages (newtab, file://).
        function restingValueFor(url) {
            const ns = northstarDisplay(url);
            if (ns)
                return ns;
            return urlDisplayParts(url) ? url : getDomainDisplay(url);
        }
        function updateUrlDisplay() {
            const parts = currentTabUrl ? urlDisplayParts(currentTabUrl) : null;
            const resting = document.activeElement !== searchBar && !barEdited &&
                !!parts && searchBar.value === currentTabUrl;
            if (resting) {
                const [pre, host, rest] = parts;
                urlDisplay.textContent = '';
                const hostEl = document.createElement('span');
                hostEl.className = 'host';
                hostEl.textContent = host;
                urlDisplay.append(pre, hostEl, rest);
            }
            omnibox?.classList.toggle('showing-url', resting);
        }
        function updateSearchBarUrl(url) {
            // Never clobber the address bar while the user is typing in it — page
            // events (redirects, title/favicon updates) kept re-inserting the old
            // URL over freshly typed text.
            if (document.activeElement === searchBar && userTyping)
                return;
            // Uncommitted typed text survives same-page updates (title / favicon
            // refreshes); only a real navigation replaces it, like Firefox.
            if (barEdited && url === currentTabUrl)
                return;
            barEdited = false;
            currentTabUrl = url || ''; // callers re-assign right after; needed here so the display check is coherent
            if (document.activeElement !== searchBar) {
                searchBar.value = restingValueFor(url);
            }
            else {
                searchBar.value = url;
            }
            updateUrlDisplay();
            updateOmniboxIcon();
            hideSuggestions();
        }
        // Context-aware address-bar icon: a lock on HTTPS, a "not secure" glyph on
        // HTTP, and the search glyph while typing or on internal / new-tab pages.
        function updateOmniboxIcon() {
            if (!omnibox)
                return;
            if (document.activeElement === searchBar) {
                omnibox.dataset.omni = 'search';
                return;
            }
            const url = currentTabUrl || '';
            if (/^https:\/\//i.test(url))
                omnibox.dataset.omni = 'secure';
            else if (/^http:\/\//i.test(url))
                omnibox.dataset.omni = 'insecure';
            else
                omnibox.dataset.omni = 'search';
        }
        // Loading state → tab spinner + reload/stop button toggle.
        function setTabLoading(index, loading) {
            if (loading)
                tabLoading.add(index);
            else
                tabLoading.delete(index);
            tabs.get(index)?.classList.toggle('loading', !!loading);
            if (index === activeTabIndex)
                updateReloadButton();
        }
        function updateReloadButton() {
            const loading = tabLoading.has(activeTabIndex);
            reloadBtn.classList.toggle('loading', loading);
            reloadBtn.title = loading ? 'Stop' : 'Reload';
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Bookmark bar
        // ─────────────────────────────────────────────────────────────────────────
        // ── Dropdown (overflow + folder sub-panels) ──────────────────────────────
        function closeDropdown() {
            document.getElementById('bm-dropdown')?.remove();
            document.getElementById('bm-subdropdown')?.remove();
            if (dropdownCleanup) {
                dropdownCleanup();
                dropdownCleanup = null;
            }
            openDropdownId = null;
        }
        function openDropdown(anchorBtn, anchorId, buildFn) {
            if (openDropdownId === anchorId) {
                closeDropdown();
                return;
            }
            closeDropdown();
            openDropdownId = anchorId;
            const panel = document.createElement('div');
            panel.id = 'bm-dropdown';
            panel.className = 'bookmark-overflow-dropdown';
            buildFn(panel);
            document.body.appendChild(panel);
            const rect = anchorBtn.getBoundingClientRect();
            const panelW = 200;
            panel.style.left = Math.min(rect.left, window.innerWidth - panelW - 4) + 'px';
            panel.style.top = rect.bottom + 'px';
            const handler = (e) => {
                if (!panel.contains(e.target) && e.target !== anchorBtn) {
                    closeDropdown();
                    document.removeEventListener('mousedown', handler, true);
                }
            };
            document.addEventListener('mousedown', handler, true);
            dropdownCleanup = () => document.removeEventListener('mousedown', handler, true);
        }
        // ── Dropdown item builder ─────────────────────────────────────────────────
        function makeDropdownItem(entry, parentFolderId) {
            if (entry.type === 'divider') {
                const sep = document.createElement('div');
                sep.className = 'bookmark-overflow-sep';
                return sep;
            }
            const item = document.createElement('button');
            item.className = 'bookmark-overflow-item';
            item.dataset.id = entry.id;
            item.dataset.parentFolderId = parentFolderId || '';
            if (parentFolderId) {
                item.draggable = true;
                item.addEventListener('dragstart', (e) => {
                    dragSrcId = entry.id;
                    dragSrcFolderId = parentFolderId;
                    bmDragActive = true;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', entry.id);
                    closeDropdown();
                });
                item.addEventListener('dragend', () => {
                    dragSrcId = null;
                    dragSrcFolderId = null;
                    bmDragActive = false;
                    clearDragClasses();
                    clearSpring(true);
                });
            }
            if (entry.type === 'folder') {
                item.classList.add('bookmark-overflow-folder-item');
                item.appendChild(makeFolderIcon('bookmark-overflow-folder-icon'));
                const lbl = document.createElement('span');
                lbl.textContent = entry.title || 'Folder';
                item.appendChild(lbl);
                const arrow = document.createElement('span');
                arrow.className = 'bookmark-overflow-submenu-arrow';
                arrow.textContent = '▶';
                item.appendChild(arrow);
                // Hover to open (Firefox-style)
                item.addEventListener('mouseenter', () => {
                    clearTimeout(overflowCloseTimer);
                    clearTimeout(overflowHoverTimer);
                    overflowHoverTimer = setTimeout(() => openFolderSubPanel(item, entry), 220);
                });
                item.addEventListener('mouseleave', (e) => {
                    clearTimeout(overflowHoverTimer);
                    const sub = document.getElementById('bm-subdropdown');
                    if (sub && (e.relatedTarget === sub || sub.contains(e.relatedTarget)))
                        return;
                    overflowCloseTimer = setTimeout(() => {
                        document.getElementById('bm-subdropdown')?.remove();
                        document.querySelectorAll('#bm-dropdown .has-submenu-open')
                            .forEach(el => el.classList.remove('has-submenu-open'));
                    }, 220);
                });
                // Click also opens (fallback)
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    clearTimeout(overflowHoverTimer);
                    const existing = document.getElementById('bm-subdropdown');
                    if (existing && existing.dataset.forId === entry.id) {
                        existing.remove();
                        item.classList.remove('has-submenu-open');
                    }
                    else {
                        openFolderSubPanel(item, entry);
                    }
                });
            }
            else {
                const img = document.createElement('img');
                img.className = 'bookmark-bar-favicon';
                item.appendChild(img);
                paintCachedFavicon(img, entry.url);
                const lbl = document.createElement('span');
                try {
                    lbl.textContent = entry.title || new URL(entry.url).hostname;
                }
                catch {
                    lbl.textContent = entry.url;
                }
                item.appendChild(lbl);
                item.addEventListener('click', () => { closeDropdown(); window.tab.loadUrl(activeTabIndex, entry.url); });
                item.addEventListener('auxclick', (e) => {
                    if (e.button !== 1)
                        return;
                    e.preventDefault();
                    closeDropdown();
                    window.browserBookmarks.openInNewTab(entry.url, false);
                });
            }
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.browserBookmarks.showBarContextMenu({ type: entry.type, id: entry.id, url: entry.url, title: entry.title });
            });
            return item;
        }
        // ── Folder bar click → floating folder WebContentsView ───────────────────
        async function openFolderPanel(btn, entry) {
            const rect = btn.getBoundingClientRect();
            closeDropdown();
            try {
                await window.electronAPI.openFolderDropdown({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, entry);
            }
            catch { }
        }
        /**
         * Fill a panel div with the items of a folder entry.
         * Each folder item shows a ▶ arrow; hovering over it for 300ms opens a
         * side-panel (same pattern as the overflow subfolder).
         * Drag from any item sets dragSrcId/FolderId and closes the panel.
         */
        function buildFolderPanelItems(panel, folderEntry) {
            const folderId = folderEntry.id;
            const children = folderEntry.children || [];
            if (!children.length) {
                const empty = document.createElement('div');
                empty.className = 'bookmark-overflow-empty';
                empty.textContent = '(empty)';
                panel.appendChild(empty);
                return;
            }
            // Local spring state for subfolders within this panel
            let panelSpringTimer = null;
            let panelSpringRow = null;
            function clearPanelSpring() {
                if (panelSpringTimer) {
                    clearTimeout(panelSpringTimer);
                    panelSpringTimer = null;
                }
                panelSpringRow = null;
            }
            children.forEach(child => {
                if (child.type === 'divider') {
                    const sep = document.createElement('div');
                    sep.className = 'bookmark-overflow-sep';
                    panel.appendChild(sep);
                    return;
                }
                const row = document.createElement('button');
                row.className = 'bookmark-overflow-item';
                row.dataset.id = child.id;
                row.dataset.parentFolderId = folderId;
                if (child.type === 'folder') {
                    row.classList.add('bookmark-overflow-folder-item');
                    row.appendChild(makeFolderIcon('bookmark-overflow-folder-icon'));
                    const lbl = document.createElement('span');
                    lbl.textContent = child.title || 'Folder';
                    row.appendChild(lbl);
                    const arr = document.createElement('span');
                    arr.className = 'bookmark-overflow-submenu-arrow';
                    arr.textContent = '▶';
                    row.appendChild(arr);
                    // Click drills in: rebuild the panel contents for the subfolder
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Clear current contents down to the header+sep then refill
                        const panelEl = document.getElementById('bm-dropdown');
                        if (!panelEl)
                            return;
                        // Remove everything after the separator
                        while (panelEl.children.length > 2)
                            panelEl.removeChild(panelEl.lastChild);
                        // Update header text
                        const hdr = panelEl.querySelector('.bookmark-folder-panel-header');
                        if (hdr)
                            hdr.textContent = child.title || 'Folder';
                        buildFolderPanelItems(panelEl, child);
                    });
                }
                else {
                    const img = document.createElement('img');
                    img.className = 'bookmark-bar-favicon';
                    row.appendChild(img);
                    paintCachedFavicon(img, child.url);
                    const lbl = document.createElement('span');
                    try {
                        lbl.textContent = child.title || new URL(child.url).hostname;
                    }
                    catch {
                        lbl.textContent = child.url;
                    }
                    row.appendChild(lbl);
                    row.addEventListener('click', () => {
                        closeDropdown();
                        window.tab.loadUrl(activeTabIndex, child.url);
                    });
                    row.addEventListener('auxclick', (e) => {
                        if (e.button !== 1)
                            return;
                        e.preventDefault();
                        closeDropdown();
                        window.browserBookmarks.openInNewTab(child.url, false);
                    });
                }
                // Drag — same pattern as makeDropdownItem
                row.draggable = true;
                row.addEventListener('dragstart', (e) => {
                    dragSrcId = child.id;
                    dragSrcFolderId = folderId;
                    bmDragActive = true;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', child.id);
                    closeDropdown();
                });
                row.addEventListener('dragend', () => {
                    dragSrcId = null;
                    dragSrcFolderId = null;
                    bmDragActive = false;
                    clearDragClasses();
                    clearSpring(true);
                });
                // Drag-over target: spring into subfolder, or show drop-before line
                row.addEventListener('dragenter', (e) => {
                    if (!bmDragActive || dragSrcId === child.id)
                        return;
                    e.preventDefault();
                    if (panelSpringRow === row)
                        return;
                    clearDragClasses();
                    clearPanelSpring();
                    if (child.type === 'folder') {
                        row.classList.add('drag-into');
                        panelSpringRow = row;
                        panelSpringTimer = setTimeout(() => {
                            if (panelSpringRow !== row)
                                return;
                            panelSpringRow = null;
                            panelSpringTimer = null;
                            const panelEl = document.getElementById('bm-dropdown');
                            if (!panelEl)
                                return;
                            while (panelEl.children.length > 2)
                                panelEl.removeChild(panelEl.lastChild);
                            const hdr = panelEl.querySelector('.bookmark-folder-panel-header');
                            if (hdr)
                                hdr.textContent = child.title || 'Folder';
                            buildFolderPanelItems(panelEl, child);
                        }, 500);
                    }
                    else {
                        row.classList.add('drop-before');
                    }
                });
                row.addEventListener('dragover', (e) => {
                    if (!bmDragActive || dragSrcId === child.id)
                        return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                });
                row.addEventListener('dragleave', (e) => {
                    if (row.contains(e.relatedTarget))
                        return;
                    const moved = e.relatedTarget?.closest?.('.bookmark-overflow-item');
                    if (moved && moved !== row) {
                        if (panelSpringRow === row)
                            clearPanelSpring();
                        row.classList.remove('drop-before', 'drag-into');
                    }
                });
                row.addEventListener('drop', async (e) => {
                    if (!dragSrcId || dragSrcId === child.id)
                        return;
                    e.preventDefault();
                    e.stopPropagation();
                    row.classList.remove('drop-before', 'drag-into');
                    clearSpring(true);
                    clearPanelSpring();
                    if (child.type === 'folder') {
                        await window.browserBookmarks.moveIntoFolder(dragSrcId, child.id, null);
                    }
                    else {
                        await window.browserBookmarks.moveIntoFolder(dragSrcId, folderId, child.id);
                    }
                });
                row.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.browserBookmarks.showBarContextMenu({
                        type: child.type, id: child.id, url: child.url, title: child.title,
                    });
                });
                panel.appendChild(row);
            });
            // Drop on empty space within the panel → append to folder end
            panel.addEventListener('dragover', (e) => {
                if (!bmDragActive || e.target.closest('.bookmark-overflow-item, .bookmark-overflow-sep'))
                    return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            panel.addEventListener('drop', async (e) => {
                if (!dragSrcId || e.target.closest('.bookmark-overflow-item, .bookmark-overflow-sep'))
                    return;
                e.preventDefault();
                clearSpring(true);
                await window.browserBookmarks.moveIntoFolder(dragSrcId, folderId, null);
            });
        }
        function openFolderSubPanel(anchorItem, entry) {
            document.querySelectorAll('#bm-dropdown .has-submenu-open')
                .forEach(el => el.classList.remove('has-submenu-open'));
            document.getElementById('bm-subdropdown')?.remove();
            const sub = document.createElement('div');
            sub.id = 'bm-subdropdown';
            sub.className = 'bookmark-overflow-dropdown';
            sub.dataset.forId = entry.id;
            if (!entry.children?.length) {
                const empty = document.createElement('div');
                empty.className = 'bookmark-overflow-empty';
                empty.textContent = '(empty)';
                sub.appendChild(empty);
            }
            else {
                entry.children.forEach(child => sub.appendChild(makeDropdownItem(child, entry.id)));
            }
            document.body.appendChild(sub);
            const r = anchorItem.getBoundingClientRect();
            // Flip left if sub would overflow the right edge
            const subW = 200;
            const spaceRight = window.innerWidth - r.right;
            sub.style.left = (spaceRight >= subW ? r.right : r.left - subW) + 'px';
            sub.style.top = r.top + 'px';
            anchorItem.classList.add('has-submenu-open');
            // Keep sub open while cursor is inside it
            sub.addEventListener('mouseenter', () => clearTimeout(overflowCloseTimer));
            sub.addEventListener('mouseleave', (e) => {
                if (e.relatedTarget === anchorItem || anchorItem.contains(e.relatedTarget))
                    return;
                overflowCloseTimer = setTimeout(() => {
                    sub.remove();
                    anchorItem.classList.remove('has-submenu-open');
                }, 220);
            });
        }
        // ── Drag and drop ─────────────────────────────────────────────────────────
        let dragSrcId = null;
        let dragSrcFolderId = null;
        let bmDragActive = false;
        let externDragId = null;
        let externLastTarget = null;
        // Spring-load state — folder opens after a hover delay during drag
        let springTimer = null;
        let springFolderId = null;
        let springOpen = false;
        // Overflow dropdown subfolder hover-open state
        let overflowHoverTimer = null;
        let overflowCloseTimer = null;
        function clearDragClasses() {
            document.querySelectorAll('.drag-into, .drop-before')
                .forEach(el => el.classList.remove('drag-into', 'drop-before'));
        }
        function clearSpring(closePanel = false) {
            if (springTimer) {
                clearTimeout(springTimer);
                springTimer = null;
            }
            springFolderId = null;
            if (closePanel && springOpen) {
                closeDropdown();
                window.electronAPI.closeFolderDropdown();
                springOpen = false;
            }
        }
        // Prevent bookmark drags from bubbling to the tab bar's own dragover handler
        document.addEventListener('dragover', (e) => {
            if (!bmDragActive)
                return;
            const inBar = !!e.target.closest('#bookmark-bar');
            const inDropdown = !!e.target.closest('#bm-dropdown');
            if (!inBar && !inDropdown)
                e.stopPropagation();
        }, true);
        function makeDraggable(el, item, getAllFn) {
            el.draggable = true;
            el.addEventListener('dragstart', (e) => {
                dragSrcId = item.id;
                dragSrcFolderId = null;
                bmDragActive = true;
                el.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
            });
            el.addEventListener('dragend', () => {
                dragSrcId = null;
                dragSrcFolderId = null;
                bmDragActive = false;
                el.classList.remove('dragging');
                clearDragClasses();
                clearSpring(true);
            });
            el.addEventListener('dragover', (e) => {
                if (!bmDragActive)
                    return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                clearDragClasses();
                if (item.type === 'folder') {
                    if (springOpen && springFolderId === item.id) {
                        el.classList.add('drag-into');
                    }
                    else {
                        el.classList.add('drop-before');
                        if (springFolderId !== item.id) {
                            clearSpring(false);
                            springFolderId = item.id;
                            springTimer = setTimeout(async () => {
                                springOpen = true;
                                el.classList.remove('drop-before');
                                el.classList.add('drag-into');
                                const rect = el.getBoundingClientRect();
                                closeDropdown();
                                try {
                                    await window.electronAPI.openFolderDropdown({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, item);
                                }
                                catch { }
                            }, 500);
                        }
                    }
                }
                else {
                    el.classList.add('drop-before');
                }
            });
            el.addEventListener('dragleave', (e) => {
                clearDragClasses();
                if (item.type === 'folder' && springFolderId === item.id) {
                    const dropdown = document.getElementById('bm-dropdown');
                    if (dropdown?.contains(e.relatedTarget))
                        return;
                    clearSpring(false);
                }
            });
            el.addEventListener('drop', async (e) => {
                e.preventDefault();
                clearDragClasses();
                const wasSpringOpen = springOpen;
                clearSpring(true);
                if (!dragSrcId || dragSrcId === item.id)
                    return;
                if (dragSrcFolderId) {
                    await window.browserBookmarks.moveOutOfFolder(dragSrcId, dragSrcFolderId, item.id);
                }
                else if (item.type === 'folder' && wasSpringOpen) {
                    await window.browserBookmarks.moveIntoFolder(dragSrcId, item.id);
                }
                else {
                    const all = getAllFn();
                    const ids = all.map(b => b.id);
                    const from = ids.indexOf(dragSrcId);
                    const to = ids.indexOf(item.id);
                    if (from === -1 || to === -1)
                        return;
                    ids.splice(from, 1);
                    ids.splice(to, 0, dragSrcId);
                    await window.browserBookmarks.reorder(ids);
                }
            });
        }
        /** Build a spring-loaded folder panel where every row is a drop target. */
        function buildSpringPanel(panel, folderEntry) {
            const children = folderEntry.children || [];
            function makeDropRow(child) {
                const row = makeDropdownItem(child, folderEntry.id);
                row.addEventListener('dragenter', (e) => {
                    if (!bmDragActive || dragSrcId === child.id)
                        return;
                    e.preventDefault();
                    clearDragClasses();
                    // Show drop target. Folders get drag-into (drop inside), bookmarks get drop-before.
                    // No sub-spring: rebuilding the panel DOM during a live drag causes macOS to
                    // fire spurious dragleave/dragend. Drop onto a folder moves into it directly.
                    row.classList.add(child.type === 'folder' ? 'drag-into' : 'drop-before');
                });
                row.addEventListener('dragover', (e) => {
                    if (!bmDragActive || dragSrcId === child.id)
                        return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                });
                row.addEventListener('dragleave', (e) => {
                    if (row.contains(e.relatedTarget))
                        return;
                    row.classList.remove('drop-before', 'drag-into');
                });
                row.addEventListener('drop', async (e) => {
                    if (!dragSrcId || dragSrcId === child.id)
                        return;
                    e.preventDefault();
                    e.stopPropagation();
                    row.classList.remove('drop-before', 'drag-into');
                    clearSpring(true);
                    if (child.type === 'folder') {
                        await window.browserBookmarks.moveIntoFolder(dragSrcId, child.id, null);
                    }
                    else {
                        await window.browserBookmarks.moveIntoFolder(dragSrcId, folderEntry.id, child.id);
                    }
                });
                return row;
            }
            if (!children.length) {
                const empty = document.createElement('div');
                empty.className = 'bookmark-overflow-empty';
                empty.textContent = '(empty)';
                panel.appendChild(empty);
            }
            else {
                children.forEach(child => panel.appendChild(makeDropRow(child)));
            }
            panel.addEventListener('dragover', (e) => {
                if (!bmDragActive || e.target.closest('.bookmark-overflow-item, .bookmark-overflow-sep'))
                    return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            panel.addEventListener('drop', async (e) => {
                if (!dragSrcId || e.target.closest('.bookmark-overflow-item, .bookmark-overflow-sep'))
                    return;
                e.preventDefault();
                clearSpring(true);
                await window.browserBookmarks.moveIntoFolder(dragSrcId, folderEntry.id, null);
            });
        }
        // ── Extern drag (from folder dropdown to bookmark bar) ────────────────────
        window.electronAPI.onExternBookmarkDragStart((id, folderId) => {
            dragSrcId = id;
            dragSrcFolderId = folderId;
            bmDragActive = true;
            externDragId = id;
            externLastTarget = null;
        });
        window.electronAPI.onExternBookmarkDragPosition((x, y) => {
            if (!externDragId)
                return;
            clearDragClasses();
            const el = document.elementFromPoint(x, y);
            const barItem = el?.closest('.bookmark-bar-item, .bookmark-bar-divider');
            const overflowItem = el?.closest('.bookmark-overflow-item');
            if (barItem) {
                externLastTarget = barItem;
                barItem.classList.add(barItem.classList.contains('bookmark-bar-folder') ? 'drag-into' : 'drop-before');
            }
            else if (overflowItem && overflowItem.dataset.id && overflowItem.dataset.id !== externDragId) {
                externLastTarget = overflowItem;
                overflowItem.classList.add(overflowItem.classList.contains('bookmark-overflow-folder-item') ? 'drag-into' : 'drop-before');
            }
            else {
                externLastTarget = null;
            }
        });
        window.electronAPI.onExternBookmarkDragEnd(async () => {
            if (!externDragId)
                return;
            const srcId = dragSrcId, srcFolder = dragSrcFolderId, target = externLastTarget;
            dragSrcId = null;
            dragSrcFolderId = null;
            bmDragActive = false;
            externDragId = null;
            externLastTarget = null;
            clearDragClasses();
            clearSpring(true);
            if (!target || !srcId)
                return;
            const targetId = target.dataset.id;
            if (!targetId || targetId === srcId)
                return;
            // Target is inside a spring-opened overflow panel (subfolder)
            if (target.classList.contains('bookmark-overflow-item')) {
                const parentFolderId = target.dataset.parentFolderId;
                if (target.classList.contains('bookmark-overflow-folder-item')) {
                    // Drop onto a folder → append to its end
                    await window.browserBookmarks.moveIntoFolder(srcId, targetId, null);
                }
                else if (parentFolderId) {
                    // Drop before a bookmark inside the spring folder
                    await window.browserBookmarks.moveIntoFolder(srcId, parentFolderId, targetId);
                }
                return;
            }
            // Target is a bar item
            if (target.classList.contains('bookmark-bar-folder')) {
                await window.browserBookmarks.moveIntoFolder(srcId, targetId);
            }
            else if (srcFolder) {
                await window.browserBookmarks.moveOutOfFolder(srcId, srcFolder, targetId);
            }
            else {
                const all = await window.browserBookmarks.getAll();
                const ids = all.map(b => b.id);
                const from = ids.indexOf(srcId), to = ids.indexOf(targetId);
                if (from !== -1 && to !== -1) {
                    ids.splice(from, 1);
                    ids.splice(to, 0, srcId);
                    await window.browserBookmarks.reorder(ids);
                }
            }
        });
        // ── Bar item builder ──────────────────────────────────────────────────────
        function makeBarElement(entry, bookmarks) {
            if (entry.type === 'divider') {
                const el = document.createElement('div');
                el.className = 'bookmark-bar-divider';
                el.dataset.id = entry.id;
                makeDraggable(el, entry, () => bookmarks);
                el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.browserBookmarks.showBarContextMenu({ type: 'divider', id: entry.id });
                });
                return el;
            }
            const btn = document.createElement('button');
            btn.dataset.id = entry.id;
            if (entry.type === 'folder') {
                btn.className = 'bookmark-bar-item bookmark-bar-folder';
                btn.title = entry.title || 'Folder';
                btn.appendChild(makeFolderIcon('bookmark-folder-icon'));
                const lbl = document.createElement('span');
                lbl.className = 'bookmark-bar-label';
                lbl.textContent = entry.title || 'Folder';
                btn.appendChild(lbl);
                btn.addEventListener('click', () => openFolderPanel(btn, entry));
            }
            else {
                btn.className = 'bookmark-bar-item';
                btn.title = entry.title || entry.url;
                const img = document.createElement('img');
                img.className = 'bookmark-bar-favicon';
                btn.appendChild(img);
                paintCachedFavicon(img, entry.url);
                const lbl = document.createElement('span');
                lbl.className = 'bookmark-bar-label';
                try {
                    lbl.textContent = entry.title || new URL(entry.url).hostname;
                }
                catch {
                    lbl.textContent = entry.url;
                }
                btn.appendChild(lbl);
                if (entry.persona)
                    lbl.textContent += '  ·  ' + (personaNames[entry.persona] || 'persona');
                btn.addEventListener('click', () => {
                    if (entry.persona)
                        window.tab.openInPersona(entry.persona, entry.url);
                    else
                        window.tab.loadUrl(activeTabIndex, entry.url);
                });
                btn.addEventListener('auxclick', (e) => {
                    if (e.button !== 1)
                        return;
                    e.preventDefault();
                    window.browserBookmarks.openInNewTab(entry.url, false);
                });
            }
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.browserBookmarks.showBarContextMenu({ type: entry.type, id: entry.id, url: entry.url, title: entry.title });
            });
            makeDraggable(btn, entry, () => bookmarks);
            return btn;
        }
        // ── Bar render ────────────────────────────────────────────────────────────
        function reportChromeHeight() {
            const showBar = bookmarkBarVisible && hasBookmarks;
            bookmarkBar.classList.toggle('hidden', !showBar);
            window.electronAPI.reportChromeHeight(showBar ? 30 : 0); /* must match .bookmark-bar height */
        }
        reportChromeHeight();
        async function refreshBookmarkBar() {
            if (renamingFolderId)
                return;
            closeDropdown();
            bookmarkBarItems.innerHTML = '';
            if (!bookmarkBarVisible) {
                hasBookmarks = false;
                reportChromeHeight();
                return;
            }
            const seq = ++refreshSeq;
            let bookmarks = [];
            try {
                bookmarks = await window.browserBookmarks.getAll();
            }
            catch { }
            if (seq !== refreshSeq)
                return; // stale — a newer refresh started
            hasBookmarks = bookmarks.length > 0;
            reportChromeHeight();
            if (!hasBookmarks)
                return;
            const rendered = [];
            bookmarks.forEach(entry => {
                const el = makeBarElement(entry, bookmarks);
                bookmarkBarItems.appendChild(el);
                rendered.push({ el, entry });
            });
            // Overflow detection: hide items that don't fit and add a "» N" button
            requestAnimationFrame(() => {
                const barRight = bookmarkBarItems.getBoundingClientRect().right;
                const OVERFLOW_W = 40;
                const anyOverflow = rendered.some(r => r.el.getBoundingClientRect().right > barRight);
                if (!anyOverflow)
                    return;
                let overflowStart = -1;
                for (let i = 0; i < rendered.length; i++) {
                    if (rendered[i].el.getBoundingClientRect().right > barRight - OVERFLOW_W) {
                        overflowStart = i;
                        break;
                    }
                }
                if (overflowStart !== -1) {
                    for (let i = overflowStart; i < rendered.length; i++)
                        rendered[i].el.style.display = 'none';
                    const hidden = rendered.slice(overflowStart).map(r => r.entry);
                    const count = hidden.filter(e => e.type !== 'divider').length;
                    const more = document.createElement('button');
                    more.className = 'bookmark-bar-item bookmark-bar-more';
                    more.textContent = `» ${count}`;
                    more.title = `${count} more`;
                    more.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openDropdown(more, '__overflow__', (panel) => {
                            // Pass '__root__' as parentFolderId so drag handlers are attached
                            hidden.forEach(entry => panel.appendChild(makeDropdownItem(entry, '__root__')));
                        });
                    });
                    bookmarkBarItems.appendChild(more);
                }
            });
        }
        // ── Bar context menu events ───────────────────────────────────────────────
        bookmarkBar.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.bookmark-bar-item, .bookmark-bar-divider'))
                return;
            e.preventDefault();
            window.browserBookmarks.showBarContextMenu({ type: 'bar-bg', bookmarkBarVisible });
        });
        bookmarkBar.addEventListener('dragover', (e) => {
            if (!bmDragActive || !dragSrcFolderId)
                return;
            if (e.target.closest('.bookmark-bar-item, .bookmark-bar-divider'))
                return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        bookmarkBar.addEventListener('drop', async (e) => {
            if (!dragSrcId || !dragSrcFolderId)
                return;
            if (e.target.closest('.bookmark-bar-item, .bookmark-bar-divider'))
                return;
            e.preventDefault();
            await window.browserBookmarks.moveOutOfFolder(dragSrcId, dragSrcFolderId, null);
        });
        new ResizeObserver(() => { if (bookmarkBarVisible && hasBookmarks)
            refreshBookmarkBar(); })
            .observe(bookmarkBarItems);
        // ── Bookmark ★ button ─────────────────────────────────────────────────────
        async function updateBookmarkBtn(url) {
            if (!url || url === 'newtab' || url.startsWith('file://')) {
                bookmarkBtn.classList.remove('bookmarked');
                return;
            }
            try {
                const has = await window.browserBookmarks.has(url);
                bookmarkBtn.classList.toggle('bookmarked', has);
            }
            catch { }
        }
        bookmarkBtn.addEventListener('click', async () => {
            if (!currentTabUrl || currentTabUrl === 'newtab' || currentTabUrl.startsWith('file://'))
                return;
            const rect = bookmarkBtn.getBoundingClientRect();
            let hasObj = false, bkmkTitle = currentTabTitle || currentTabUrl, bkmkId = null;
            try {
                const all = await window.browserBookmarks.getAll();
                const existing = all.find(b => b.type === 'bookmark' && b.url === currentTabUrl);
                if (existing) {
                    hasObj = true;
                    bkmkTitle = existing.title || existing.url;
                    bkmkId = existing.id;
                }
            }
            catch { }
            await window.electronAPI.openBookmarkPrompt({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, currentTabUrl, bkmkTitle, hasObj, bkmkId);
        });
        // ── Bookmark bar event wiring ─────────────────────────────────────────────
        function initBookmarkBar() {
            window.electronAPI.onBookmarkAddPrompt(() => {
                if (!currentTabUrl || currentTabUrl === 'newtab' || currentTabUrl.startsWith('file://'))
                    return;
                const rect = bookmarkBtn.getBoundingClientRect();
                window.electronAPI.openBookmarkPrompt({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, currentTabUrl, currentTabTitle, false, null);
            });
            window.electronAPI.onBookmarkEditPrompt(({ id, url, title }) => {
                const rect = bookmarkBtn.getBoundingClientRect();
                window.electronAPI.openBookmarkPrompt({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, url, title, true, id);
            });
            window.electronAPI.onBookmarkFolderRename(({ id, title }) => {
                const rect = bookmarkBtn.getBoundingClientRect();
                window.electronAPI.openBookmarkPrompt({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, null, title, true, id, 'folder-rename');
            });
            window.electronAPI.onBookmarkNewFolderPrompt(async () => {
                window.electronAPI.closeFolderDropdown();
                const id = await window.browserBookmarks.addFolder('New Folder');
                await refreshBookmarkBar();
                startInlineBarRename(id, 'New Folder');
            });
            window.electronAPI.onToggleBookmarkBar(() => {
                bookmarkBarVisible = !bookmarkBarVisible;
                window.northstarSettings.set('bookmarkBarVisible', bookmarkBarVisible);
                refreshBookmarkBar();
            });
            window.browserBookmarks.onChanged(() => { refreshBookmarkBar(); updateBookmarkBtn(currentTabUrl); });
            window.electronAPI.onBookmarkPromptClosed(() => updateBookmarkBtn(currentTabUrl));
            refreshBookmarkBar();
        }
        /** Inline rename for a folder label directly in the bookmark bar. */
        function startInlineBarRename(folderId, defaultName) {
            const btn = bookmarkBarItems.querySelector(`[data-id="${folderId}"]`);
            if (!btn)
                return;
            const lbl = btn.querySelector('.bookmark-bar-label');
            if (!lbl)
                return;
            renamingFolderId = folderId;
            lbl.style.display = 'none';
            const input = document.createElement('input');
            input.className = 'bookmark-bar-rename-input';
            input.value = defaultName || '';
            input.size = Math.max((defaultName || '').length, 8);
            btn.appendChild(input);
            btn.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });
            requestAnimationFrame(() => { input.focus(); input.select(); });
            let done = false;
            async function commit() {
                if (done)
                    return;
                done = true;
                const name = input.value.trim() || 'New Folder';
                renamingFolderId = null;
                await window.browserBookmarks.updateById(folderId, { title: name });
            }
            function cancel() {
                if (done)
                    return;
                done = true;
                renamingFolderId = null;
                input.removeEventListener('blur', commit);
                refreshBookmarkBar();
            }
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                }
            });
            input.addEventListener('blur', commit, { once: true });
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Tab bar
        // ─────────────────────────────────────────────────────────────────────────
        function initTabBar() {
            // Another window's torn-off tab is hovering over our strip → light up.
            window.dragdrop.onMergeHover?.((v) => tabBar.classList.toggle('merge-target', !!v));
            window.pinActiveTab = () => window.tab.pin(activeTabIndex);
            // ── IPC events from main process ──────────────────────────────────────
            window.tab.onTabCreated((_e, data) => {
                tabPrivate.set(data.index, !!data.private);
                createTabButton(data.index, data.title, data.afterIndex ?? null, data.active !== false, !!data.private, !!data.container, data.workspace || '1');
                // Count only the active workspace's tabs (others live hidden).
                updateChromeTabs(document.querySelectorAll('#tabs-container .tab-button:not(.ws-hidden)').length);
                setTimeout(() => { updateTabWidths(data.totalTabs); updateScrollShadows(); }, 10);
            });
            // Speaker on audible tabs; mic/camera in danger colour while recording.
            window.tab.onMediaIndicator?.((_e, d) => updateTabIndicator(d.index, d));
            window.tab.onTabRemoved((_e, data) => {
                tabUrls.delete(data.index);
                tabPrivate.delete(data.index);
                tabLoading.delete(data.index);
                removeTabButton(data.index);
                hideSuggestions();
                updateChromeTabs(data.totalTabs);
                setTimeout(() => { updateTabWidths(data.totalTabs); updateScrollShadows(); }, 10);
            });
            window.tab.onTabSwitched((_e, data) => {
                activeTabIndex = data.index;
                if (data.url)
                    tabUrls.set(data.index, data.url);
                setActiveTab(data.index);
                updateReloadButton();
                updateSearchBarUrl(data.url || '');
                currentTabUrl = data.url || '';
                updateBookmarkBtn(currentTabUrl);
                tabs.get(data.index)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                updateScrollShadows();
                // Show per-tab private indicator on address bar (only in non-private windows)
                if (!isPrivateWindow) {
                    if (tabPrivate.get(data.index)) {
                        document.documentElement.setAttribute('data-private-tab', 'true');
                    }
                    else {
                        document.documentElement.removeAttribute('data-private-tab');
                    }
                }
            });
            window.tab.onUrlUpdated((_e, data) => {
                if (data.url)
                    tabUrls.set(data.index, data.url);
                if (data.private !== undefined)
                    tabPrivate.set(data.index, !!data.private);
                if (data.index === activeTabIndex) {
                    updateSearchBarUrl(data.url);
                    currentTabUrl = data.url || '';
                    currentTabTitle = data.title || '';
                    updateBookmarkBtn(currentTabUrl);
                    // Sync private-tab attribute
                    if (!isPrivateWindow) {
                        if (tabPrivate.get(data.index)) {
                            document.documentElement.setAttribute('data-private-tab', 'true');
                        }
                        else {
                            document.documentElement.removeAttribute('data-private-tab');
                        }
                    }
                }
                updateTabTitle(data.index, data.title || data.url, data.favicon);
            });
            window.tab.onNavigationUpdated((_e, data) => {
                if (data.index === activeTabIndex)
                    updateNavigationButtons(data.canGoBack, data.canGoForward);
            });
            window.tab.onTabLoading((_e, data) => {
                setTabLoading(data.index, data.loading);
            });
            window.tabsUI?.onPinTab((index) => {
                const btn = document.querySelector(`#tabs-container .tab-button[data-index="${index}"]`);
                if (!btn)
                    return;
                const isPinned = btn.classList.toggle('pinned');
                btn.dataset.pinned = isPinned ? '1' : '';
                // Firefox keeps pinned tabs in a block at the start of the strip:
                // pinning moves the tab to the end of that block, unpinning drops
                // it right after the block.
                const firstUnpinned = [...tabsContainer.querySelectorAll('.tab-button')]
                    .find(b => b !== btn && !b.classList.contains('pinned'));
                tabsContainer.insertBefore(btn, firstUnpinned || null);
                const ordered = [...tabsContainer.querySelectorAll('.tab-button')].map(el => parseInt(el.dataset.index));
                if (ordered.length)
                    window.tab.reorder(ordered);
                updateTabWidths(tabs.size);
                updateScrollShadows();
                syncPinCols();
            });
            // Split view: mark the two tabs that are on screen together so the strip
            // shows the pairing (the focused one keeps the normal active highlight).
            try {
                window.tabsUI?.onSplitChanged((pair) => {
                    splitPair = (Array.isArray(pair) && pair.length === 2) ? pair.map(Number) : null;
                    applySplitMarks();
                });
            }
            catch { }
            // Folders: main sends the active workspace's folders + tab assignments.
            try {
                const applyFolders = (data) => {
                    folderState.folders = Array.isArray(data?.folders) ? data.folders : [];
                    folderState.assign = new Map((data?.assignments || []).map(([i, f]) => [Number(i), f]));
                    layoutFolders();
                };
                window.folders?.onChanged(applyFolders);
                // A folder moved to another space takes its tabs with it, so re-tag
                // them here or they'd stay visible in the space they just left.
                window.folders?.onTabsMoved(({ indices, workspace }) => {
                    for (const i of indices || []) {
                        const btn = tabs.get(Number(i));
                        if (btn) btn.dataset.ws = String(workspace);
                    }
                    filterTabsByWorkspace();
                });
                // Pull the current folders (restored ones exist before this listener).
                window.folders?.list().then(applyFolders).catch(() => { });
            }
            catch { }
            // Called by the main process (executeJavaScript) when a tab dragged
            // from ANOTHER window drops on our strip: x (px from our left edge) →
            // where to insert it. Returns the data-index of the tab to insert
            // after, -1 for "at the front", or null to append at the end.
            window.__tabDropIndex = (x) => {
                const btns = [...tabsContainer.querySelectorAll('.tab-button')];
                if (!btns.length)
                    return null;
                let after = null; // null → before the first tab
                for (const b of btns) {
                    const r = b.getBoundingClientRect();
                    if (x >= r.left + r.width / 2)
                        after = b;
                    else
                        break;
                }
                // Incoming tabs are unpinned — clamp them past the pinned block.
                const lastPinned = btns.filter(b => b.classList.contains('pinned')).pop();
                if (lastPinned && (!after || after.classList.contains('pinned')))
                    after = lastPinned;
                if (!after)
                    return -1;
                return parseInt(after.dataset.index);
            };
            // ── Drop links / images / files / text onto the tab bar → new tab(s) ──
            // Firefox-style: a dropped URL or image opens in a new tab, OS files
            // open as file://, and anything else (selected text/phrases) runs as a
            // search in a new tab.
            async function openDrop(dt) {
                // 1) OS files (Explorer / Finder) → open each as a file:// URL.
                const files = dt.files;
                if (files && files.length) {
                    let opened = 0;
                    for (const f of files) {
                        const p = window.urlUtils?.getPathForFile?.(f) || '';
                        if (!p)
                            continue;
                        const norm = p.replace(/\\/g, '/').replace(/^\/+/, '');
                        await window.tab.addLazy('file:///' + encodeURI(norm));
                        opened++;
                    }
                    if (opened)
                        return;
                }
                // 2) A dragged URL — link, image, address-bar text, or file:// URI.
                const uriList = dt.getData('text/uri-list');
                if (uriList) {
                    const first = uriList.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#'));
                    if (first) {
                        await window.tab.addLazy(formatToUrl(first));
                        return;
                    }
                }
                // 3) Plain text — a URL opens, any other text searches.
                const text = (dt.getData('text/plain') || '').trim();
                if (text && isNaN(text))
                    await window.tab.addLazy(formatToUrl(text));
            }
            tabBar.addEventListener('dragover', (e) => {
                // Accept external content drops. (Tab reordering is pointer-tracked,
                // not HTML5 drag-and-drop, so it never reaches here.)
                const types = e.dataTransfer.types;
                if (types.includes('Files') || types.includes('text/uri-list') ||
                    types.includes('text/plain') || types.includes('text/html')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                }
            });
            tabBar.addEventListener('drop', async (e) => {
                const dt = e.dataTransfer;
                const plain = (dt.getData('text/plain') || '').trim();
                // Only handle genuine external content; a numeric-only payload is a
                // stray id (e.g. a bookmark drag) — let it fall through untouched.
                const hasContent = (dt.files && dt.files.length) ||
                    dt.types.includes('text/uri-list') || (plain && isNaN(plain));
                if (!hasContent)
                    return;
                e.preventDefault();
                e.stopPropagation();
                await openDrop(dt);
            });
            // ── Scroll controls ───────────────────────────────────────────────────
            const tabScrollLeft = document.getElementById('tab-scroll-left');
            const tabScrollRight = document.getElementById('tab-scroll-right');
            let scrollInterval = null;
            const scrollBy = (amt) => tabsContainer.scrollBy({ left: amt, behavior: 'smooth' });
            const startScroll = (amt) => { scrollBy(amt); scrollInterval = setInterval(() => scrollBy(amt), 200); };
            const stopScroll = () => { clearInterval(scrollInterval); scrollInterval = null; };
            tabScrollLeft.addEventListener('mousedown', () => startScroll(-160));
            tabScrollRight.addEventListener('mousedown', () => startScroll(160));
            tabScrollLeft.addEventListener('click', () => scrollBy(-160));
            tabScrollRight.addEventListener('click', () => scrollBy(160));
            document.addEventListener('mouseup', stopScroll);
            tabsContainer.addEventListener('wheel', (e) => {
                e.preventDefault();
                tabsContainer.scrollBy({ left: e.deltaY !== 0 ? e.deltaY : e.deltaX, behavior: 'smooth' });
            }, { passive: false });
            tabsContainer.addEventListener('scroll', updateScrollShadows);
            // Right-click the empty part of the tab list → a custom menu.
            const newFolderInline = async () => {
                let id = null;
                try { id = await window.folders.create('New Folder'); } catch { }
                if (id) setTimeout(() => { const h = tabsContainer.querySelector(`.folder-header[data-folder="${CSS.escape(id)}"]`); if (h) startFolderRename(h, id); }, 140);
            };
            tabsContainer.addEventListener('contextmenu', (e) => {
                if (e.target.closest('.tab-button') || e.target.closest('.folder-header')) return;
                e.preventDefault(); e.stopPropagation();
                // Grouped as in the reference design doc. Only actions with a real
                // implementation are listed — no placeholder rows.
                openCtxMenu(e.clientX, e.clientY, [
                    ['Compact Mode', [
                        ['Toggle compact mode', () => window.tabsUI.toggleCompact()],
                    ]],
                    ['New Tab', () => window.tab.add()],
                    ['New Folder', newFolderInline],
                    ['sep'],
                    ['Reload Selected Tab', () => window.tab.reload(activeTabIndex)],
                    ['Bookmark Selected Tab…', () => {
                        const btn = tabs.get(activeTabIndex);
                        const title = btn?.querySelector('.tab-title')?.textContent || '';
                        if (currentTabUrl) window.browserBookmarks.add(currentTabUrl, title);
                    }],
                    ['Reopen Closed Tab', () => window.tabsUI.reopenClosed()],
                ]);
            });
            window.addEventListener('resize', () => setTimeout(() => { updateTabWidths(tabs.size); updateScrollShadows(); }, 100));
            setTimeout(() => { if (tabs.size > 0) {
                updateTabWidths(tabs.size);
                updateScrollShadows();
            } }, 100);
        }
        // First time an isolated tab ever appears, explain the dot once, then
        // remember (persisted) so it never shows again.
        let isoHintShownThisSession = false;
        function maybeShowIsolationHint() {
            if (isoHintShownThisSession)
                return;
            let seen = true;
            try { seen = !!(window.northstarSettings.getSync() || {}).isolationHintSeen; }
            catch { }
            if (seen)
                return;
            isoHintShownThisSession = true;
            try { window.northstarSettings.set('isolationHintSeen', true); }
            catch { }
            const el = document.getElementById('iso-hint');
            if (!el)
                return;
            el.classList.remove('hidden');
            let timer = null;
            const dismiss = () => { el.classList.add('hidden'); clearTimeout(timer); };
            el.querySelector('.iso-hint-close')?.addEventListener('click', dismiss, { once: true });
            timer = setTimeout(dismiss, 7000);
        }
        // ── Personas ──────────────────────────────────────────────────────────────
        // Personas are auto-numbered; a persona tab can be optionally renamed via
        // right-click → "Name This Persona…". Names are resolved live (personaNames
        // map) so a rename reflects in history/suggestions without rewriting entries.
        async function refreshPersonaNames() {
            try { personaNames = (await window.personas.map()) || {}; }
            catch { personaNames = {}; }
        }
        function initPersonas() {
            refreshPersonaNames();
            try { window.personas.onChanged(() => refreshPersonaNames()); }
            catch { }
            const modal = document.getElementById('persona-rename-modal');
            const input = document.getElementById('pr-input');
            if (!modal || !input)
                return;
            let renameId = null;
            const close = () => { modal.classList.add('hidden'); renameId = null; };
            const save = async () => {
                const name = input.value.trim();
                if (renameId && name) { await window.personas.rename(renameId, name); await refreshPersonaNames(); }
                close();
            };
            try {
                window.personas.onRename((id) => {
                    renameId = String(id);
                    input.value = personaNames[renameId] || '';
                    modal.classList.remove('hidden');
                    input.focus(); input.select();
                });
            }
            catch { }
            document.getElementById('pr-save')?.addEventListener('click', save);
            document.getElementById('pr-cancel')?.addEventListener('click', close);
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); });
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        }
        // ── Tab bar placement (left sidebar ⇄ classic top strip) ──────────────────
        function sideTabs() { return document.documentElement.dataset.tabbar !== 'top'; }
        function initTabBarSide() {
            let mode = 'side', width = 232;
            try {
                const s = window.northstarSettings.getSync();
                mode = (s.tabBarSide ?? 'side');
                width = snapSidebar(Number(s.sidebarWidth) || 232);
            }
            catch { }
            document.documentElement.dataset.tabbar = mode === 'top' ? 'top' : 'side';
            applySidebarWidth(width);
            initSidebarResizer();
            try { window.tabsUI.onSidebarWidth((w) => applySidebarWidth(w)); }
            catch { }
            try {
                window.tabsUI.onTabBarSide((v) => {
                    document.documentElement.dataset.tabbar = v === 'top' ? 'top' : 'side';
                    updateTabWidths(tabs.size);
                    updateScrollShadows();
                });
            }
            catch { }
            // Compact mode: collapse the sidebar (page full-bleed).
            try {
                window.tabsUI.onCompact((on) => {
                    document.documentElement.dataset.compact = on ? 'on' : '';
                    updateTabWidths(tabs.size);
                });
            }
            catch { }
        }
        // Drag the right edge of the sidebar to resize it (side mode). Live-resizes
        // the page view; persists (globally) on release.
        // Snap a raw width to either the icon rail (56) or the expanded band
        // (180–460); the 56–180 gap never sticks. Mirrors clampW in ipc/tabs.js.
        function snapSidebar(px) {
            px = Math.round(px);
            return px < 132 ? 56 : Math.max(180, Math.min(460, px));
        }
        function applySidebarWidth(w) {
            document.documentElement.style.setProperty('--sidebar-w', w + 'px');
            document.documentElement.dataset.rail = w <= 56 ? 'on' : '';
        }
        function initSidebarResizer() {
            const handle = document.getElementById('sidebar-resizer');
            if (!handle)
                return;
            let dragging = false, raf = null, pending = 232, pid = null;
            const clamp = snapSidebar;
            handle.addEventListener('pointerdown', (e) => {
                if (sideTabs() === false)
                    return;
                dragging = true;
                pid = e.pointerId;
                handle.setPointerCapture(e.pointerId);
                document.documentElement.classList.add('sidebar-resizing');
                try { window.tabsUI.startSidebarResize(); } catch { }
                e.preventDefault();
            });
            handle.addEventListener('pointermove', (e) => {
                if (!dragging)
                    return;
                pending = clamp(e.clientX);
                applySidebarWidth(pending);
                if (!raf)
                    raf = requestAnimationFrame(() => { raf = null; window.tabsUI.resizeSidebar(pending); });
            });
            // Drop the drag. `commit` false when the main process already ended it
            // (release landed on the page view; its mouseUp finished + persisted).
            const stop = (commit) => {
                if (!dragging)
                    return;
                dragging = false;
                try { if (pid != null) handle.releasePointerCapture(pid); } catch { }
                document.documentElement.classList.remove('sidebar-resizing');
                if (commit)
                    window.tabsUI.commitSidebarWidth(pending);
            };
            handle.addEventListener('pointerup', () => stop(true));
            handle.addEventListener('pointercancel', () => stop(true));
            // Main fires this when the release happened over the page view.
            try { window.tabsUI.onSidebarResizeEnded((w) => { pending = clamp(w); stop(false); }); } catch { }
        }
        // ── Essentials (pinned favourites; sidebar top, per profile) ──────────────
        function initEssentials() {
            const grid = document.getElementById('essentials');
            if (!grid)
                return;
            const render = async () => {
                let items = [];
                try { items = (await window.essentials.list()) || []; }
                catch { }
                grid.innerHTML = '';
                for (const it of items) {
                    const tile = document.createElement('button');
                    tile.className = 'essential-tile';
                    tile.tabIndex = -1;
                    tile.title = it.title || it.url;
                    let letter = '•';
                    try { letter = new URL(it.url).hostname.replace(/^www\./, '').charAt(0).toUpperCase(); }
                    catch { }
                    const fb = document.createElement('span');
                    fb.className = 'ess-fallback';
                    fb.textContent = letter;
                    const img = document.createElement('img');
                    img.style.display = 'none';
                    img.addEventListener('load', () => { img.style.display = ''; fb.style.display = 'none'; });
                    paintCachedFavicon(img, it.url);
                    tile.appendChild(img);
                    tile.appendChild(fb);
                    const rm = document.createElement('button');
                    rm.className = 'ess-remove';
                    rm.tabIndex = -1;
                    rm.textContent = '×';
                    rm.title = 'Remove from Essentials';
                    rm.addEventListener('click', (e) => { e.stopPropagation(); window.essentials.remove(it.url, it.persona || null); });
                    tile.appendChild(rm);
                    // Click: focus an already-open tab of this site, else open one
                    // (persona-bound essentials reopen in their persona).
                    tile.addEventListener('click', () => {
                        if (it.persona) {
                            window.tab.openInPersona(it.persona, it.url);
                            return;
                        }
                        let origin = null;
                        try { origin = new URL(it.url).origin; }
                        catch { }
                        if (origin) {
                            for (const [idx, u] of tabUrls) {
                                try {
                                    if (new URL(u).origin === origin) {
                                        window.tab.switch(idx);
                                        return;
                                    }
                                }
                                catch { }
                            }
                        }
                        window.browserBookmarks.openInNewTab(it.url, true);
                    });
                    // Essentials get their own menu — "Remove from Essentials"
                    // rather than the tab strip's unpin.
                    tile.addEventListener('contextmenu', (ev) => {
                        ev.preventDefault(); ev.stopPropagation();
                        openCtxMenu(ev.clientX, ev.clientY, [
                            ['Open in New Tab', () => window.browserBookmarks.openInNewTab(it.url, true)],
                            ['sep'],
                            ['Bookmark…', () => window.browserBookmarks.add(it.url, it.title || '')],
                            ['sep'],
                            ['Remove from Essentials', () => window.essentials.remove(it.url, it.persona || null), 'danger'],
                        ]);
                    });
                    grid.appendChild(tile);
                }
            };
            render();
            try { window.essentials.onChanged(render); }
            catch { }
        }
        // ── Profiles ──────────────────────────────────────────────────────────────
        // The toolbar badge shows this window's profile (coloured initial); click
        // opens the native switcher menu (built in ipc/tabs.js). Rename via modal.
        let activeWorkspace = '1';
        let _spacesCache = [];
        function initProfiles() {
            const btn = document.getElementById('profile-btn');
            const badge = document.getElementById('profile-badge');
            const wsRow = document.getElementById('sb-workspaces');
            let openProfileModal = () => {}; // assigned when the modal wires up below
            const refresh = async () => {
                let cur = null, all = [];
                try { cur = await window.profiles.current(); }
                catch { }
                try { all = (await window.profiles.list()) || []; }
                catch { }
                _spacesCache = all; // menus need the space list without awaiting
                if (cur) {
                    // Restored tabs are tagged and filtered before this resolves, so
                    // they get measured against the default workspace and all end up
                    // hidden. Re-filter once the real one is known.
                    const wsChanged = activeWorkspace !== cur.id;
                    activeWorkspace = cur.id;
                    if (wsChanged) filterTabsByWorkspace();
                    if (badge) {
                        badge.classList.toggle('has-emoji', !!cur.emoji);
                        badge.classList.toggle('is-dot', !cur.emoji);
                        badge.textContent = cur.emoji || (cur.name || 'P').charAt(0);
                        badge.style.setProperty('--pf-color', cur.color || '');
                    }
                    if (btn)
                        btn.title = `Workspace: ${cur.name}`;
                    const sh = document.getElementById('space-header');
                    if (sh) sh.textContent = cur.name || 'Space';
                }
                // Avatar row: one per workspace, active one labelled.
                if (wsRow) {
                    wsRow.innerHTML = '';
                    for (const p of all) {
                        const b = document.createElement('button');
                        b.className = 'sb-ws' + (p.id === activeWorkspace ? ' active' : '');
                        b.tabIndex = -1;
                        b.title = p.name; // native hover label (survives foot overflow-scroll)
                        // Only the active space shows its emoji tile; the rest
                        // stay dots so the current space reads at a glance.
                        const isActive = p.id === activeWorkspace;
                        const av = document.createElement('span');
                        av.className = 'profile-badge' + (p.emoji && isActive ? ' has-emoji' : ' is-dot');
                        av.style.setProperty('--pf-color', p.color || '');
                        if (p.emoji && isActive)
                            av.textContent = p.emoji;
                        b.appendChild(av);
                        b.addEventListener('click', () => { if (p.id !== activeWorkspace) window.profiles.switch(p.id); });
                        b.addEventListener('dblclick', (e) => { e.preventDefault(); openProfileModal(p.id); });
                        b.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            const rows = [];
                            if (p.id !== activeWorkspace) rows.push(['Switch to this Space', () => window.profiles.switch(p.id)], ['sep']);
                            rows.push(
                                ['Change Name…', () => openProfileModal(p.id)],
                                ['Change Icon…', () => openProfileModal(p.id)],
                                ['sep'],
                                ['Create Space', async () => { const np = await window.profiles.create(); if (np?.id) openProfileModal(np.id); }],
                            );
                            openCtxMenu(e.clientX, e.clientY, rows);
                        });
                        wsRow.appendChild(b);
                    }
                }
            };
            refresh();
            try { window.profiles.onChanged(refresh); }
            catch { }
            try { window.profiles.onForceSwitch((id) => window.profiles.switch(id)); }
            catch { }
            try {
                window.profiles.onSwitched((id) => {
                    activeWorkspace = String(id);
                    filterTabsByWorkspace();
                    refresh();
                    // Essentials + bookmark bar reload via their own change events,
                    // which main re-emits on switch (they're per-workspace now).
                });
            }
            catch { }
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const r = btn.getBoundingClientRect();
                    window.profiles.menu(r.left, r.bottom + 4);
                });
            }
            document.getElementById('sb-add-ws')?.addEventListener('click', async () => {
                const p = await window.profiles.create();
                if (p?.id) openProfileModal(p.id); // prompt to name the new profile
            });
            document.getElementById('sb-settings')?.addEventListener('click', () => {
                window.tab.loadUrl(activeTabIndex, 'northstar://settings');
            });
            // Downloads live in the foot too — revealed once the session
            // has any downloads, opening the shared downloads panel.
            const dl = document.getElementById('sb-downloads');
            if (dl && window.downloads) {
                const revealIfAny = async () => {
                    try { if (((await window.downloads.getAll()) || []).length) dl.classList.remove('hidden'); }
                    catch { }
                };
                dl.addEventListener('click', () => {
                    const r = dl.getBoundingClientRect();
                    window.downloads.togglePanel({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
                });
                try { window.downloads.onChanged(() => dl.classList.remove('hidden')); }
                catch { }
                revealIfAny();
            }
            // Edit-profile modal (name + emoji)
            const modal = document.getElementById('profile-rename-modal');
            const input = document.getElementById('prf-input');
            const emojiBtn = document.getElementById('prf-emoji');
            const picker = document.getElementById('prf-emoji-picker');
            if (!modal || !input)
                return;
            // Render the chosen emoji (or a dot when opted out) onto the field.
            const setEmojiField = (val) => {
                emojiBtn.dataset.emoji = val || '';
                emojiBtn.textContent = val || '';
                emojiBtn.classList.toggle('is-dot', !val);
            };
            // Build the picker grid once: a "dot" (no emoji) option, then a palette.
            if (picker && !picker.dataset.built) {
                picker.dataset.built = '1';
                const PALETTE = ['🏠', '💼', '🎨', '🚀', '🎮', '🎧', '📚', '💡', '🔧', '🧪', '🛒', '💰', '✈️', '🌍', '🌙', '🔥', '🌈', '🍀', '🌸', '🌊', '⭐', '⚡', '🐱', '🐶', '🦊', '🐢', '🐝', '🦉', '🙂', '😎', '🤓', '👤', '❤️', '💙', '💚', '💜', '🧡', '🎬', '🎵', '⚽', '🏀', '🍕', '☕', '🛰️', '🔬', '📷', '🗂️', '🎯'];
                const none = document.createElement('button');
                none.type = 'button'; none.className = 'emoji-opt emoji-none';
                none.title = 'No emoji (dot)'; none.tabIndex = -1;
                none.addEventListener('click', () => { setEmojiField(''); picker.classList.add('hidden'); });
                picker.appendChild(none);
                for (const e of PALETTE) {
                    const b = document.createElement('button');
                    b.type = 'button'; b.className = 'emoji-opt'; b.textContent = e; b.tabIndex = -1;
                    b.addEventListener('click', () => { setEmojiField(e); picker.classList.add('hidden'); });
                    picker.appendChild(b);
                }
            }
            emojiBtn?.addEventListener('click', (e) => { e.stopPropagation(); picker?.classList.toggle('hidden'); });
            const close = () => {
                modal.classList.add('hidden');
                picker?.classList.add('hidden');
                modal.dataset.editId = '';
                // Bring the page (native view) back up from behind the chrome.
                try { window.focusMode.overlayClose(); }
                catch { }
            };
            const save = async () => {
                const id = modal.dataset.editId;
                if (id)
                    await window.profiles.update(id, {
                        name: input.value.trim(),
                        emoji: emojiBtn?.dataset.emoji || '', // empty → coloured dot
                    });
                close();
            };
            // Reused by double-click on an avatar and the context-menu "Rename".
            openProfileModal = async (id) => {
                modal.dataset.editId = String(id);
                let p = null;
                try { p = ((await window.profiles.list()) || []).find(x => x.id === String(id)); }
                catch { }
                input.value = p?.name || '';
                setEmojiField(p?.emoji || '');
                picker?.classList.add('hidden');
                modal.classList.remove('hidden');
                // The page is a native view that paints OVER the chrome DOM, so
                // collapse it while the modal is up or the modal hides behind it.
                try { window.focusMode.overlayOpen(); }
                catch { }
                input.focus(); input.select();
            };
            try { window.profiles.onRename((id) => openProfileModal(id)); }
            catch { }
            document.getElementById('prf-save')?.addEventListener('click', save);
            document.getElementById('prf-cancel')?.addEventListener('click', close);
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); });
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
            // Any click in the card that isn't the emoji field or the picker dismisses it.
            modal.querySelector('.ri-card')?.addEventListener('click', (e) => {
                if (e.target !== emojiBtn && !e.target.closest('#prf-emoji-picker'))
                    picker?.classList.add('hidden');
            });
        }
        // ── Tab DOM helpers ───────────────────────────────────────────────────────
        // Isolation is invisible except a small dot on tabs running in their own
        // isolated (per-tenant) session — see .tab-button[data-container] in CSS.
        function createTabButton(index, title, afterIndex = null, shouldActivate = true, isPrivate = false, isolated = false, workspace = '1') {
            if (tabs.has(index))
                return;
            const btn = document.createElement('div');
            btn.className = 'tab-button';
            btn.dataset.index = index;
            btn.dataset.ws = String(workspace);
            if (String(workspace) !== activeWorkspace)
                btn.classList.add('ws-hidden');
            btn.draggable = false; // pointer-tracked drag below, not HTML5 DnD
            // Not keyboard-focusable: the tab strip should never be a Tab-key stop.
            btn.tabIndex = -1;
            if (isPrivate)
                btn.dataset.private = 'true';
            if (isolated) {
                btn.dataset.container = 'true';
                btn.title = 'Separate persona — its own login & history';
                maybeShowIsolationHint();
            }
            const titleSpan = document.createElement('span');
            titleSpan.className = 'tab-title';
            titleSpan.textContent = title || `Tab ${index + 1}`;
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.tabIndex = -1;
            closeBtn.innerHTML = '×';
            closeBtn.onclick = (e) => { e.stopPropagation(); window.tab.remove(parseInt(index)); };
            if (isPrivate) {
                const shield = document.createElement('span');
                shield.className = 'tab-private-icon';
                shield.title = 'Private tab';
                shield.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M8 1L2 3.5V8c0 3.3 2.5 5.7 6 7 3.5-1.3 6-3.7 6-7V3.5L8 1zm0 6.5h4c-.3 2.2-1.8 4-4 5.1V7.5H4V5l4-1.7V7.5z"/></svg>';
                btn.appendChild(shield);
            }
            btn.appendChild(titleSpan);
            btn.appendChild(closeBtn);
            btn.addEventListener('mousedown', (e) => {
                if (e.button !== 1)
                    return;
                e.preventDefault();
            });
            btn.addEventListener('auxclick', (e) => {
                if (e.button !== 1)
                    return;
                e.preventDefault();
                e.stopPropagation();
                window.tab.remove(parseInt(index));
            });
            // Right-click a sidebar tab → a custom menu (pin, folder, close, …).
            btn.addEventListener('contextmenu', (e) => {
                if (e.target.closest('.tab-close')) return;
                e.preventDefault(); e.stopPropagation();
                const idx = parseInt(index);
                const isPinned = btn.classList.contains('pinned');
                const curFolder = folderState.assign.get(idx) || null;
                // Grouped as in the reference design doc; folder targets collapse
                // into one submenu instead of a row per folder.
                const rows = [['New Tab', () => window.tab.add()]];
                if (!isPinned) {
                    const moves = folderState.folders
                        .filter(f => f.id !== curFolder)
                        .map(f => [f.name || 'Folder', () => window.folders.assign(idx, f.id)]);
                    if (curFolder) moves.push(['sep'], ['Remove from Folder', () => window.folders.assign(idx, null)]);
                    if (moves.length) rows.push(['Move to Folder', moves]);
                }
                rows.push(
                    ['sep'],
                    ['Reload Tab', () => window.tab.reload(idx)],
                    ['Mute Tab', () => window.tab.toggleMute(idx)],
                    ['sep'],
                    [isPinned ? 'Unpin Tab' : 'Pin Tab', () => window.tab.pin(idx)],
                    ['Duplicate Tab', async () => {
                        const url = await window.tab.getTabUrl(idx);
                        const ni = await window.tab.add();
                        if (url && typeof ni === 'number') window.tab.loadUrl(ni, url);
                    }],
                    ['sep'],
                    ['Bookmark Tab…', async () => {
                        const url = await window.tab.getTabUrl(idx);
                        const title = btn.querySelector('.tab-title')?.textContent || '';
                        if (url) window.browserBookmarks.add(url, title);
                    }],
                    ['sep'],
                    ['Close Tab', () => window.tab.remove(idx), 'danger'],
                );
                openCtxMenu(e.clientX, e.clientY, rows);
            });
            // Firefox-style tab drag: pointer-tracked, and NOTHING moves until the
            // button is released.
            //  - inside the strip → live reorder preview
            //  - outside the strip → the tab ghosts; on RELEASE it either moves
            //    into the window under the cursor (dropped on its tab strip, at
            //    the drop position) or detaches into a new window there
            //  - Escape aborts the whole gesture and restores the original order
            const TEAR_MARGIN = 34;
            btn.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 || e.target.closest('.tab-close'))
                    return;
                // Firefox selects a tab on mousedown, not on click-release — so a
                // drag always moves the tab you're looking at.
                // Pinned sidebar tiles peek in a Glance on a plain click instead of
                // switching — the switch is skipped here and the glance fires on
                // release (below), so a drag still reorders them.
                const pinnedGlance = sideTabs() && btn.classList.contains('pinned');
                if (parseInt(index) !== activeTabIndex && !pinnedGlance)
                    window.tab.switch(parseInt(index));
                const startX = e.clientX, startY = e.clientY;
                let mode = 'idle'; // idle → drag
                let outside = false; // pointer currently beyond the strip
                let savedOrder = null; // DOM order at drag start, for cancel
                let dropFolder = undefined; // folder id under the cursor (null = ungrouped, undefined = untracked)
                const restoreOrder = () => {
                    if (!savedOrder)
                        return;
                    // Skip buttons whose tab was closed mid-drag — re-appending a
                    // detached node would resurrect a dead tab in the strip.
                    for (const el of savedOrder)
                        if (el.isConnected)
                            tabsContainer.appendChild(el);
                };
                const onMove = (ev) => {
                    if (mode === 'idle' && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
                        mode = 'drag';
                        savedOrder = [...tabsContainer.querySelectorAll('.tab-button')];
                        btn.classList.add('dragging');
                        document.documentElement.classList.add('tab-dragging'); // kills text selection
                        window.dragdrop.dragTrack?.(true); // main raises windows under the cursor
                    }
                    if (mode !== 'drag')
                        return;
                    // Leaving the strip vertically OR the window horizontally both
                    // count as "outside" (Firefox tears off / merges either way).
                    const barR = tabBar.getBoundingClientRect();
                    const out = ev.clientY < barR.top - TEAR_MARGIN || ev.clientY > barR.bottom + TEAR_MARGIN
                        || ev.clientX < -TEAR_MARGIN || ev.clientX > window.innerWidth + TEAR_MARGIN;
                    if (out !== outside) {
                        outside = out;
                        btn.classList.toggle('drag-outside', out);
                    }
                    if (out) {
                        stopEdgeScroll();
                        return;
                    }
                    edgeAutoScroll(ev.clientX, ev.clientY);
                    placeDraggedTab(btn, sideTabs() ? ev.clientY : ev.clientX);
                    // Which folder (if any) is the tab hovering over? (drop target)
                    if (sideTabs() && !btn.classList.contains('pinned')) {
                        const el = document.elementFromPoint(ev.clientX, ev.clientY);
                        const fh = el?.closest?.('.folder-header');
                        const mem = el?.closest?.('.tab-button.in-folder');
                        dropFolder = fh ? fh.dataset.folder
                            : (mem && mem !== btn) ? (folderState.assign.get(+mem.dataset.index) || null)
                            : null;
                        tabsContainer.querySelectorAll('.folder-header.drop-target').forEach(h => h.classList.remove('drop-target'));
                        if (dropFolder) tabsContainer.querySelector(`.folder-header[data-folder="${CSS.escape(dropFolder)}"]`)?.classList.add('drop-target');
                    }
                };
                const cleanup = () => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    document.removeEventListener('pointercancel', onCancel);
                    document.removeEventListener('keydown', onKey, true);
                    document.documentElement.classList.remove('tab-dragging');
                    btn.classList.remove('dragging', 'drag-outside');
                    stopEdgeScroll();
                    window.dragdrop.dragTrack?.(false);
                };
                const finish = async (drop) => {
                    const wasMode = mode, wasOutside = outside;
                    cleanup();
                    if (wasMode !== 'drag') {
                        if (pinnedGlance) {
                            const u = tabUrls.get(parseInt(index)) || await window.tab.getTabUrl(index);
                            if (u) { try { window.glance.open(u); } catch { } }
                        }
                        return;
                    }
                    if (!drop) {
                        restoreOrder();
                        return;
                    } // aborted
                    if (!wasOutside) { // reorder commit
                        const ordered = [...tabsContainer.querySelectorAll('.tab-button')].map(el => parseInt(el.dataset.index));
                        if (ordered.length)
                            window.tab.reorder(ordered);
                        // Apply folder membership from where it was dropped.
                        tabsContainer.querySelectorAll('.folder-header.drop-target').forEach(h => h.classList.remove('drop-target'));
                        if (dropFolder !== undefined) {
                            const cur = folderState.assign.get(parseInt(index)) || null;
                            const next = dropFolder || null;
                            if (cur !== next) { try { window.folders.assign(parseInt(index), next); } catch { } }
                        }
                        return;
                    }
                    // Released outside the strip → main decides: move into the
                    // window under the cursor, or detach into a new one.
                    const url = await window.tab.getTabUrl(index);
                    const res = await window.dragdrop.drop(index, url);
                    if (res === 'none' || res === 'window-moved')
                        restoreOrder();
                };
                const onUp = () => finish(true);
                const onCancel = () => finish(false);
                const onKey = (ev) => { if (ev.key === 'Escape') {
                    ev.stopPropagation();
                    finish(false);
                } };
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onCancel);
                document.addEventListener('keydown', onKey, true);
            });
            // afterIndex: tab index to insert after, -1 for the front, null → end
            const afterBtn = (afterIndex !== null && afterIndex !== -1) ? tabs.get(afterIndex) : null;
            if (afterIndex === -1) {
                tabsContainer.insertBefore(btn, tabsContainer.firstChild);
            }
            else if (afterBtn) {
                tabsContainer.insertBefore(btn, afterBtn.nextSibling);
            }
            else {
                tabsContainer.appendChild(btn);
            }
            tabs.set(index, btn);
            applySplitMarks();
            if (folderState.folders.length) layoutFolders();
            if (shouldActivate) {
                setActiveTab(index);
            }
            updateScrollShadows();
        }
        function removeTabButton(index) {
            const btn = tabs.get(index);
            if (btn) {
                btn.remove();
                tabs.delete(index);
            }
        }
        // Toggle .in-split on the two tabs currently sharing the screen (split view).
        function applySplitMarks() {
            for (const [idx, btn] of tabs)
                btn.classList.toggle('in-split', !!(splitPair && splitPair.includes(idx)));
        }
        function setActiveTab(index) {
            tabs.forEach(tab => tab.classList.remove('active'));
            const active = tabs.get(index);
            if (active)
                active.classList.add('active');
            activeTabIndex = index;
            applySplitMarks();
        }
        // ── Folders (tab groups): render a header per folder and slot its member
        //    tabs indented beneath it; collapsed folders hide their members. ────────
        function makeFolderHeader(f) {
            const h = document.createElement('div');
            h.className = 'folder-header';
            h.dataset.folder = f.id;
            h.tabIndex = -1;
            h.innerHTML = '<span class="folder-chevron">▸</span><span class="folder-icon">📁</span><span class="folder-name"></span><button class="folder-del" tabindex="-1" title="Delete folder">×</button>';
            h.addEventListener('click', (e) => {
                if (h.classList.contains('renaming') || e.target.closest('.folder-del')) return;
                window.folders.toggle(f.id);
            });
            h.addEventListener('dblclick', (e) => { e.preventDefault(); startFolderRename(h, f.id); });
            h.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showFolderMenu(e.clientX, e.clientY, f.id); });
            h.querySelector('.folder-del').addEventListener('click', (e) => { e.stopPropagation(); window.folders.remove(f.id); });
            return h;
        }
        // Reusable dark context menu. rows: [label, fn, className?] | ['sep'].
        let _closeCtxMenu = null;
        // rows: ['Label', fn, className?] | ['Label', [subRows], className?] | ['sep'].
        // A row whose second slot is an array becomes a submenu, opened on hover.
        function openCtxMenu(x, y, rows) {
            if (_closeCtxMenu) _closeCtxMenu();
            const chain = []; // every menu element currently on screen, root first
            const place = (menu, mx, my) => {
                document.body.appendChild(menu);
                const mw = menu.offsetWidth || 190, mh = menu.offsetHeight || 130;
                menu.style.left = Math.max(6, Math.min(mx, window.innerWidth - mw - 6)) + 'px';
                menu.style.top = Math.max(6, Math.min(my, window.innerHeight - mh - 6)) + 'px';
            };
            const closeFrom = (depth) => { while (chain.length > depth) chain.pop().remove(); };
            const build = (rowSet, depth) => {
                const menu = document.createElement('div');
                menu.className = 'ctx-menu';
                for (const r of rowSet) {
                    if (r[0] === 'sep') { const s = document.createElement('div'); s.className = 'ctx-menu-sep'; menu.appendChild(s); continue; }
                    const sub = Array.isArray(r[1]) ? r[1] : null;
                    const b = document.createElement('button');
                    b.className = 'ctx-menu-item' + (r[2] ? ' ' + r[2] : '') + (sub ? ' has-sub' : '');
                    b.tabIndex = -1;
                    b.appendChild(document.createTextNode(r[0]));
                    if (sub) { const ar = document.createElement('span'); ar.className = 'ctx-sub-arrow'; ar.textContent = '›'; b.appendChild(ar); }
                    b.addEventListener('mouseenter', () => {
                        closeFrom(depth + 1);
                        if (!sub || !sub.length) return;
                        const rc = b.getBoundingClientRect();
                        const child = build(sub, depth + 1);
                        chain.push(child);
                        place(child, rc.right - 2, rc.top - 5);
                    });
                    b.addEventListener('click', (e) => {
                        if (sub) { e.stopPropagation(); return; }
                        const fn = r[1]; closeAll(); fn && fn();
                    });
                    menu.appendChild(b);
                }
                return menu;
            };
            const onDoc = (e) => { if (!chain.some(m => m.contains(e.target))) closeAll(); };
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAll(); } };
            function closeAll() {
                closeFrom(0);
                document.removeEventListener('click', onDoc, true);
                document.removeEventListener('keydown', onKey, true);
                _closeCtxMenu = null;
            }
            const root = build(rows, 0);
            chain.push(root);
            place(root, x, y);
            _closeCtxMenu = closeAll;
            setTimeout(() => { document.addEventListener('click', onDoc, true); document.addEventListener('keydown', onKey, true); }, 0);
        }
        function openEmojiPicker(x, y, onPick) {
            if (_closeCtxMenu) _closeCtxMenu();
            const PALETTE = ['📁', '📂', '💼', '🎨', '🚀', '🎮', '🎧', '📚', '💡', '🔧', '🧪', '🛒', '💰', '✈️', '🌍', '🌙', '🔥', '🌈', '🍀', '🌸', '🌊', '⭐', '⚡', '🐱', '🐶', '🦊', '❤️', '💙', '💚', '💜', '🧡', '🎬', '🎵', '⚽', '🍕', '☕'];
            const menu = document.createElement('div');
            menu.className = 'ctx-menu emoji-pop';
            const grid = document.createElement('div'); grid.className = 'emoji-pop-grid';
            for (const e of PALETTE) {
                const b = document.createElement('button'); b.className = 'emoji-opt'; b.textContent = e; b.tabIndex = -1;
                b.addEventListener('click', () => { if (_closeCtxMenu) _closeCtxMenu(); onPick(e); });
                grid.appendChild(b);
            }
            menu.appendChild(grid);
            document.body.appendChild(menu);
            const mw = menu.offsetWidth || 240, mh = menu.offsetHeight || 160;
            menu.style.left = Math.max(6, Math.min(x, window.innerWidth - mw - 6)) + 'px';
            menu.style.top = Math.max(6, Math.min(y, window.innerHeight - mh - 6)) + 'px';
            const onDoc = (e) => { if (!menu.contains(e.target)) _closeCtxMenu?.(); };
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); _closeCtxMenu?.(); } };
            _closeCtxMenu = () => { menu.remove(); document.removeEventListener('click', onDoc, true); document.removeEventListener('keydown', onKey, true); _closeCtxMenu = null; };
            setTimeout(() => { document.addEventListener('click', onDoc, true); document.addEventListener('keydown', onKey, true); }, 0);
        }
        function showFolderMenu(x, y, id) {
            // Spaces other than the current one; the folder and its tabs move together.
            const spaceRows = (_spacesCache || [])
                .filter(p => String(p.id) !== String(activeWorkspace))
                .map(p => [`${p.emoji ? p.emoji + '  ' : ''}${p.name}`, () => window.folders.move(id, p.id)]);
            openCtxMenu(x, y, [
                ['Rename Folder…', () => { const h = tabsContainer.querySelector(`.folder-header[data-folder="${CSS.escape(id)}"]`); if (h) startFolderRename(h, id); }],
                ['Change Icon…', () => { const h = tabsContainer.querySelector(`.folder-header[data-folder="${CSS.escape(id)}"]`); const r = h ? h.getBoundingClientRect() : { right: x, top: y }; openEmojiPicker(r.right + 4, r.top, (e) => window.folders.icon(id, e)); }],
                ['sep'],
                ...(spaceRows.length ? [['Change Space', spaceRows], ['sep']] : []),
                ['Unpack Folder', () => window.folders.remove(id)],
                ['Delete Folder', () => {
                    const members = [...folderState.assign.entries()].filter(([, fid]) => fid === id).map(([i]) => i);
                    for (const i of members) { try { window.tab.remove(i); } catch { } }
                    window.folders.remove(id);
                }, 'danger'],
            ]);
        }
        function startFolderRename(h, id) {
            const name = h.querySelector('.folder-name');
            if (!name || h.classList.contains('renaming')) return;
            h.classList.add('renaming');
            const cur = name.textContent;
            const input = document.createElement('input');
            input.className = 'folder-rename-input'; input.value = cur; input.maxLength = 40;
            name.replaceWith(input); input.focus(); input.select();
            const done = (save) => {
                if (!h.classList.contains('renaming')) return;
                h.classList.remove('renaming');
                const span = document.createElement('span'); span.className = 'folder-name';
                const val = input.value.trim();
                span.textContent = (save && val) ? val : cur;
                input.replaceWith(span);
                if (save && val && val !== cur) window.folders.rename(id, val);
            };
            input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
            input.addEventListener('blur', () => done(true));
        }
        // Pin tiles share the tab grid with full-width rows, so auto-fit can never
        // collapse a track. Drive the track count off the visible pin count instead.
        function syncPinCols() {
            const n = tabsContainer.querySelectorAll('.tab-button.pinned:not(.ws-hidden)').length;
            tabsContainer.style.setProperty('--pin-cols', String(Math.min(Math.max(n, 1), 4)));
        }
        function layoutFolders() {
            if (!tabsContainer) return;
            const folders = folderState.folders;
            const validIds = new Set(folders.map(f => f.id));
            tabsContainer.querySelectorAll('.folder-header').forEach(h => { if (!validIds.has(h.dataset.folder)) h.remove(); });
            tabsContainer.querySelectorAll('.tab-button.in-folder').forEach(b => b.classList.remove('in-folder', 'folder-collapsed'));
            const pinned = [...tabsContainer.querySelectorAll('.tab-button.pinned')];
            const normal = [...tabsContainer.querySelectorAll('.tab-button:not(.pinned)')];
            syncPinCols();
            const grouped = new Set();
            const frag = document.createDocumentFragment();
            for (const f of folders) {
                let header = tabsContainer.querySelector(`.folder-header[data-folder="${CSS.escape(f.id)}"]`) || makeFolderHeader(f);
                header.classList.toggle('collapsed', !!f.collapsed);
                header.querySelector('.folder-icon').textContent = f.icon || (f.collapsed ? '📁' : '📂');
                if (!header.classList.contains('renaming')) header.querySelector('.folder-name').textContent = f.name || 'Folder';
                frag.appendChild(header);
                for (const btn of normal) {
                    if (folderState.assign.get(+btn.dataset.index) !== f.id) continue;
                    btn.classList.add('in-folder');
                    if (f.collapsed) btn.classList.add('folder-collapsed');
                    frag.appendChild(btn);
                    grouped.add(btn);
                }
            }
            for (const btn of normal) if (!grouped.has(btn)) frag.appendChild(btn);
            const lastPinned = pinned[pinned.length - 1] || null;
            if (lastPinned) lastPinned.after(frag);
            else tabsContainer.insertBefore(frag, tabsContainer.firstChild);
        }
        // ── Tab media indicator: audible/muted speaker, recording mic/camera ─────
        const INDICATOR_SVG = {
            audio: '<svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor"><path d="M3.5 7.5v5H7l4 3.5v-12L7 7.5H3.5z"/><path d="M13.5 7a4 4 0 010 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
            muted: '<svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor"><path d="M3.5 7.5v5H7l4 3.5v-12L7 7.5H3.5z"/><path d="M13 8l4 4M17 8l-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
            mic: '<svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5"/></svg>',
            camera: '<svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5.5" width="11" height="9" rx="1.5"/><path d="M13 9l5-2.5v7L13 11"/></svg>',
        };
        const INDICATOR_TITLE = {
            audio: 'Playing audio — click to mute',
            muted: 'Muted — click to unmute',
            mic: 'Using your microphone',
            camera: 'Using your camera',
        };
        function updateTabIndicator(index, d) {
            const btn = tabs.get(index);
            if (!btn)
                return;
            let el = btn.querySelector('.tab-indicator');
            // Recording outranks audio: you must always see that a tab has your mic.
            // A muted tab keeps its (crossed) speaker while media plays, so there's
            // always something to click to unmute.
            const kind = d.capture === 'camera' ? 'camera'
                : d.capture === 'mic' ? 'mic'
                    : d.muted && d.playing ? 'muted'
                        : d.audible ? 'audio'
                            : null;
            if (!kind) {
                el?.remove();
                return;
            }
            if (!el) {
                el = document.createElement('span');
                el.className = 'tab-indicator';
                // The speaker is a button: click toggles the tab's audio without
                // switching to it.
                el.addEventListener('click', (e) => {
                    if (el.dataset.kind !== 'audio' && el.dataset.kind !== 'muted')
                        return;
                    e.stopPropagation();
                    window.tab.toggleMute(index);
                });
                el.addEventListener('mousedown', (e) => e.stopPropagation());
                btn.insertBefore(el, btn.querySelector('.tab-title'));
            }
            if (el.dataset.kind !== kind) {
                el.dataset.kind = kind;
                el.innerHTML = INDICATOR_SVG[kind];
                el.classList.toggle('rec', kind === 'mic' || kind === 'camera');
                el.classList.toggle('clickable', kind === 'audio' || kind === 'muted');
                el.title = INDICATOR_TITLE[kind];
            }
        }
        function updateTabTitle(index, title, faviconUrl) {
            const btn = tabs.get(index);
            if (!btn)
                return;
            const span = btn.querySelector('.tab-title');
            if (span) {
                span.textContent = title || `Tab ${index + 1}`;
                btn.title = span.textContent;
            }
            let faviconEl = btn.querySelector('.tab-favicon');
            if (faviconUrl) {
                if (!faviconEl || faviconEl.tagName !== 'IMG') {
                    const img = document.createElement('img');
                    img.className = 'tab-favicon';
                    if (faviconEl)
                        faviconEl.replaceWith(img);
                    else
                        btn.insertBefore(img, span);
                    faviconEl = img;
                }
                // Only (re)load when the source actually changes — avoids re-fetch
                // flicker on the many url-updated events a single page fires.
                if (faviconEl.dataset.srcKey !== faviconUrl) {
                    faviconEl.dataset.srcKey = faviconUrl;
                    delete faviconEl.dataset.faviconRetried;
                    faviconEl.alt = '';
                    // A remote favicon <img> can HANG (e.g. Google's rate-limited s2
                    // service) — it neither loads nor fires onerror, so the icon would
                    // stay hidden forever. Time out and route to the reliable main-
                    // process fetch, which also tries the site's own /favicon.ico.
                    const guard = setTimeout(() => {
                        if (faviconEl.tagName === 'IMG' && !faviconEl.dataset.faviconRetried && !faviconEl.complete) {
                            onFaviconError(index, faviconEl, faviconUrl);
                        }
                    }, 3000);
                    faviconEl.onload = () => { clearTimeout(guard); markFaviconResolved(index); };
                    faviconEl.onerror = () => { clearTimeout(guard); onFaviconError(index, faviconEl, faviconUrl); };
                    faviconEl.src = faviconUrl;
                }
            }
            else if (faviconEl) {
                faviconEl.remove();
                btn.classList.remove('has-favicon');
            }
        }
        // Reveal the favicon the instant it resolves. `has-favicon` lets the tab show
        // its icon even while the page is still fetching slow tail-end resources —
        // otherwise the CSS spinner keeps the icon hidden until did-stop-loading,
        // which on some sites waits 20 s+ after the page is already usable (that was
        // the "favicon sometimes doesn't show up" + "feels slow" bug).
        function markFaviconResolved(index) {
            tabs.get(index)?.classList.add('has-favicon');
        }
        // A remote favicon <img> failed to load. Before giving up to the letter
        // placeholder, ask the main process to fetch it over the app's network stack
        // and hand back a data: URL — this rescues tab icons on setups where the
        // chrome's file:// origin can't load the remote image directly (Windows).
        async function onFaviconError(index, el, url) {
            if (!el || !url || el.dataset.faviconRetried)
                return setFaviconFallback(index, el);
            el.dataset.faviconRetried = '1';
            let dataUrl = '';
            try {
                dataUrl = await window.tab.fetchFavicon?.(url);
            }
            catch { }
            if (dataUrl && el.isConnected) {
                el.onload = () => markFaviconResolved(index);
                el.onerror = () => setFaviconFallback(index, el); // data URL shouldn't fail, but be safe
                el.src = dataUrl;
            }
            else {
                setFaviconFallback(index, el);
            }
        }
        // Letter placeholder — derived from the PAGE host, not the favicon URL, so
        // a site whose /favicon.ico fails still shows its own initial.
        function setFaviconFallback(index, el) {
            const div = document.createElement('div');
            div.className = 'tab-favicon default';
            let ch = '◉';
            try {
                const pageUrl = tabUrls.get(index) || '';
                if (pageUrl && !['newtab', 'settings', 'bookmarks', 'history'].includes(pageUrl)) {
                    const host = new URL(/^https?:\/\//.test(pageUrl) ? pageUrl : 'https://' + pageUrl)
                        .hostname.replace(/^www\./, '');
                    if (host)
                        ch = host.charAt(0).toUpperCase();
                }
            }
            catch { }
            div.textContent = ch;
            if (el && el.isConnected)
                el.replaceWith(div);
            else {
                const b = tabs.get(index);
                b?.querySelector('.tab-favicon')?.replaceWith(div);
            }
            tabs.get(index)?.classList.add('has-favicon'); // a letter is still a resolved icon
        }
        function updateTabWidths(_total) {
            const count = tabs.size;
            if (!count)
                return;
            // Sidebar mode: tabs are full-width rows — clear any inline widths the
            // top-strip layout applied and let CSS drive.
            if (sideTabs()) {
                for (const t of tabs.values()) {
                    t.style.width = t.style.minWidth = t.style.maxWidth = '';
                    t.style.flex = '';
                }
                tabsContainer.style.overflowX = '';
                return;
            }
            requestAnimationFrame(() => {
                // The container is content-sized now, so its own width isn't the
                // space available for tabs. container + spacer is the full slack
                // (invariant to tab widths); reserve a strip of it for dragging the
                // window so the tabs never consume every last pixel.
                const DRAG_RESERVE = 46;
                const avail = tabsContainer.offsetWidth + (tabDragSpacer?.offsetWidth || 0);
                const barW = Math.max(200, (avail || tabBar.offsetWidth) - DRAG_RESERVE);
                const PINNED_W = 34;
                const MIN_W = 120; // comfortable resting minimum
                const COMFY_W = 200; // preferred width when there's room to spare
                const allTabs = [...tabs.values()];
                const pinned = allTabs.filter(t => t.classList.contains('pinned'));
                const unpinned = allTabs.filter(t => !t.classList.contains('pinned'));
                pinned.forEach(t => Object.assign(t.style, { width: `${PINNED_W}px`, minWidth: `${PINNED_W}px`, maxWidth: `${PINNED_W}px`, flex: '0 0 auto' }));
                if (!unpinned.length) {
                    tabBar.classList.add('only-pinned');
                    tabsContainer.style.overflowX = 'hidden';
                    return;
                }
                tabBar.classList.remove('only-pinned');
                const remaining = barW - pinned.length * PINNED_W;
                const ideal = Math.floor(Math.max(0, remaining) / unpinned.length);
                // Tabs sit at a comfortable fixed width (COMFY_W), left-packed. With
                // many tabs they shrink evenly to share the bar, down to MIN_W, after
                // which the strip scrolls. This keeps a couple of tabs substantial
                // instead of tiny chips, without stretching them across the whole bar.
                const finalW = Math.max(MIN_W, Math.min(COMFY_W, ideal));
                tabsContainer.style.overflowX = ideal < MIN_W ? 'auto' : 'hidden';
                unpinned.forEach(t => Object.assign(t.style, { width: `${finalW}px`, minWidth: `${finalW}px`, maxWidth: `${finalW}px`, flex: '0 0 auto' }));
            });
        }
        function updateScrollShadows() {
            if (!tabsContainer)
                return;
            if (sideTabs()) {
                tabBar.classList.remove('scrollable-left', 'scrollable-right');
                return;
            }
            const max = tabsContainer.scrollWidth - tabsContainer.clientWidth;
            const left = tabsContainer.scrollLeft;
            tabBar.classList.toggle('scrollable-left', left > 2);
            tabBar.classList.toggle('scrollable-right', max - left > 2);
        }
        function getDragAfterElement(container, coord, pinned = false) {
            // Only consider tabs in the dragged tab's own group — pinned tabs
            // reorder within the pinned block, unpinned within the rest.
            // `coord` is x in the top strip, y in the sidebar (vertical list).
            const sel = pinned ? '.tab-button.pinned:not(.dragging)'
                : '.tab-button:not(.pinned):not(.dragging)';
            const vertical = sideTabs();
            return [...container.querySelectorAll(sel)].reduce((closest, child) => {
                const r = child.getBoundingClientRect();
                const offset = vertical ? coord - r.top - r.height / 2 : coord - r.left - r.width / 2;
                return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }
        /** Reorder preview: place the dragged tab under the cursor, keeping the
         *  pinned block intact at the start of the strip (Firefox behaviour). */
        function placeDraggedTab(btn, x) {
            const pinned = btn.classList.contains('pinned');
            const after = getDragAfterElement(tabsContainer, x, pinned);
            if (pinned) {
                const firstUnpinned = [...tabsContainer.querySelectorAll('.tab-button')]
                    .find(b => b !== btn && !b.classList.contains('pinned'));
                tabsContainer.insertBefore(btn, after ?? firstUnpinned ?? null);
            }
            else if (after == null) {
                tabsContainer.appendChild(btn);
            }
            else {
                tabsContainer.insertBefore(btn, after);
            }
        }
        // Auto-scroll the strip while a tab is dragged near its edges — without
        // this a tab can't be moved from one end of an overflowing strip to the
        // other in a single gesture.
        let edgeScrollDir = 0;
        let edgeScrollTimer = null;
        function edgeAutoScroll(x, y = null) {
            const r = tabsContainer.getBoundingClientRect();
            const vertical = sideTabs();
            const c = vertical ? (y ?? x) : x;
            const dir = vertical
                ? (c < r.top + 24 ? -1 : (c > r.bottom - 24 ? 1 : 0))
                : (c < r.left + 24 ? -1 : (c > r.right - 24 ? 1 : 0));
            if (dir === edgeScrollDir)
                return;
            edgeScrollDir = dir;
            clearInterval(edgeScrollTimer);
            edgeScrollTimer = null;
            if (dir)
                edgeScrollTimer = setInterval(() => {
                    if (sideTabs())
                        tabsContainer.scrollTop += dir * 12;
                    else
                        tabsContainer.scrollLeft += dir * 12;
                }, 16);
        }
        function stopEdgeScroll() {
            edgeScrollDir = 0;
            clearInterval(edgeScrollTimer);
            edgeScrollTimer = null;
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Focus mode + Pomodoro timer
        // ─────────────────────────────────────────────────────────────────────────
        function initFocusModeAndPomodoro() {
            const focusBtn = document.getElementById('focus-btn');
            const utilityBar = document.getElementById('utility-bar');
            const pomPill = document.getElementById('pomodoro-pill');
            const pillTime = document.getElementById('pill-time');
            const pillRingFill = document.getElementById('pill-ring-fill');
            const pillPhaseDot = document.getElementById('pill-phase-dot');
            const pomOverlay = document.getElementById('pomodoro-overlay');
            const pomPhase = document.getElementById('pomodoro-phase');
            const pomTime = document.getElementById('pomodoro-time');
            const pomStartBtn = document.getElementById('pomodoro-start');
            const pomSkipBtn = document.getElementById('pomodoro-skip');
            const pomResetBtn = document.getElementById('pomodoro-reset');
            const pomSessions = document.getElementById('pomodoro-sessions');
            const pomCloseBtn = document.getElementById('pomodoro-close');
            // Config from settings (seconds)
            const POM_FOCUS = getPomSetting('pomWork', 25) * 60;
            const POM_SHORT = getPomSetting('pomShortBreak', 5) * 60;
            const POM_LONG = getPomSetting('pomLongBreak', 15) * 60;
            const POM_SESSIONS = getPomSetting('pomSessions', 4);
            const RING_CIRC = 2 * Math.PI * 11; // pill ring r=11
            let pom = {
                phase: 'focus', running: false, elapsed: 0,
                total: POM_FOCUS, sessionsDone: 0, timer: null, shown: false,
            };
            function pomShowPill() {
                if (pom.shown)
                    return;
                pom.shown = true;
                pomPill.classList.remove('hidden');
                utilityBar.classList.add('pomodoro-active');
            }
            function pomHidePill() {
                pom.shown = false;
                pomPill.classList.add('hidden');
                utilityBar.classList.remove('pomodoro-active');
            }
            function pomUpdateUI() {
                const remaining = Math.max(0, pom.total - pom.elapsed);
                const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
                const secs = String(remaining % 60).padStart(2, '0');
                const timeStr = `${mins}:${secs}`;
                const isFocus = pom.phase === 'focus';
                const phaseLabel = isFocus
                    ? 'Focus'
                    : (pom.sessionsDone % POM_SESSIONS === 0 ? 'Long Break' : 'Short Break');
                pillTime.textContent = timeStr;
                pillRingFill.style.strokeDashoffset = String(RING_CIRC * (pom.elapsed / pom.total));
                // SVG elements: className is read-only (throws in strict mode) — use setAttribute.
                pillRingFill.setAttribute('class', 'pill-ring-fill' + (isFocus ? '' : ' break'));
                pillPhaseDot.setAttribute('class', 'pill-phase-dot' + (isFocus ? '' : ' break'));
                pomTime.textContent = timeStr;
                pomPhase.textContent = phaseLabel;
                pomPhase.className = 'pomodoro-phase' + (isFocus ? '' : ' break');
                pomStartBtn.textContent = pom.running ? 'Pause' : 'Start';
                pomSessions.innerHTML = '';
                for (let i = 0; i < POM_SESSIONS; i++) {
                    const dot = document.createElement('div');
                    dot.className = 'pom-session-dot' + (i < (pom.sessionsDone % POM_SESSIONS) ? ' done' : '');
                    pomSessions.appendChild(dot);
                }
            }
            async function pomSetFocusActive(active) {
                const current = await window.focusMode.getState();
                if (current !== active)
                    await window.focusMode.toggle();
                focusBtn.classList.toggle('active', active);
            }
            async function pomAdvancePhase() {
                if (pom.phase === 'focus') {
                    pom.sessionsDone++;
                    pom.phase = 'break';
                    pom.total = (pom.sessionsDone % POM_SESSIONS === 0) ? POM_LONG : POM_SHORT;
                    await pomSetFocusActive(false);
                }
                else {
                    pom.phase = 'focus';
                    pom.total = POM_FOCUS;
                    await pomSetFocusActive(true);
                }
                pom.elapsed = 0;
                pom.running = true;
                pomUpdateUI();
            }
            function pomTick() {
                pom.elapsed++;
                if (pom.elapsed >= pom.total) {
                    clearInterval(pom.timer);
                    pom.timer = null;
                    pom.running = false;
                    pomAdvancePhase().then(() => {
                        if (pom.running)
                            pom.timer = setInterval(pomTick, 1000);
                    });
                }
                else {
                    pomUpdateUI();
                }
            }
            function pomOpenOverlay() { pomUpdateUI(); pomOverlay.classList.remove('hidden'); window.focusMode.overlayOpen(); }
            function pomCloseOverlay() { pomOverlay.classList.add('hidden'); window.focusMode.overlayClose(); }
            pomStartBtn.addEventListener('click', () => {
                if (pom.running) {
                    clearInterval(pom.timer);
                    pom.timer = null;
                    pom.running = false;
                }
                else {
                    pom.running = true;
                    pom.timer = setInterval(pomTick, 1000);
                }
                pomUpdateUI();
            });
            pomSkipBtn.addEventListener('click', () => {
                clearInterval(pom.timer);
                pom.timer = null;
                pom.running = false;
                pomAdvancePhase().then(() => { if (pom.running)
                    pom.timer = setInterval(pomTick, 1000); });
            });
            pomResetBtn.addEventListener('click', async () => {
                clearInterval(pom.timer);
                Object.assign(pom, { timer: null, running: false, elapsed: 0, phase: 'focus', total: POM_FOCUS, sessionsDone: 0 });
                pomUpdateUI();
                pomCloseOverlay();
                pomHidePill();
                if (await window.focusMode.getState()) {
                    await window.focusMode.toggle();
                    focusBtn.classList.remove('active');
                }
            });
            pomCloseBtn.addEventListener('click', pomCloseOverlay);
            pomPill.addEventListener('click', pomOpenOverlay);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !pomOverlay.classList.contains('hidden'))
                    pomCloseOverlay();
            });
            focusBtn.addEventListener('click', async () => {
                const active = await window.focusMode.toggle();
                focusBtn.classList.toggle('active', active);
                if (active) {
                    pomShowPill();
                    if (!pom.running) {
                        pom.running = true;
                        pom.timer = setInterval(pomTick, 1000);
                    }
                    pomUpdateUI();
                }
                else {
                    clearInterval(pom.timer);
                    Object.assign(pom, { timer: null, running: false, elapsed: 0, phase: 'focus', total: POM_FOCUS, sessionsDone: 0 });
                    pomHidePill();
                    pomUpdateUI();
                }
            });
            window.focusMode.onChanged((active) => focusBtn.classList.toggle('active', active));
            window.focusMode.getState().then(active => focusBtn.classList.toggle('active', active));
            pomUpdateUI();
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Utility-bar customization — Settings → Appearance → Toolbar decides which
        // buttons exist. 'user-hidden' (display:none !important) layers on top of
        // the dynamic '.hidden' logic (reader/pip/downloads still self-hide when
        // not applicable), so both must clear for a button to show.
        // ─────────────────────────────────────────────────────────────────────────
        function applyUtilityBarConfig(cfg) {
            // Inside the function: the init sequence at the top of the file runs
            // before top-level consts down here would be initialized (TDZ).
            const UTILITY_BAR_ITEMS = {
                extensions: 'extensions-btn',
                downloads: 'downloads-btn',
                bookmark: 'bookmark-btn',
                reader: 'reader-btn',
                pip: 'pip-btn',
                focus: 'focus-btn',
                pomodoro: 'pomodoro-pill',
            };
            const conf = cfg || {};
            for (const [key, id] of Object.entries(UTILITY_BAR_ITEMS)) {
                const el = document.getElementById(id);
                if (el)
                    el.classList.toggle('user-hidden', conf[key] === false);
            }
        }
        function initUtilityBarConfig() {
            applyUtilityBarConfig(settings.utilityBar);
            if (window.northstarSettings?.onUtilityBarChanged) {
                window.northstarSettings.onUtilityBarChanged((cfg) => {
                    settings.utilityBar = cfg;
                    applyUtilityBarConfig(cfg);
                });
            }
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Extensions button + panel (puzzle icon → installed list + Web Store link)
        // ─────────────────────────────────────────────────────────────────────────
        function initExtensions() {
            const btn = document.getElementById('extensions-btn');
            if (!btn || !window.extensionsUI)
                return;
            let panelOpen = false;
            // ── Firefox-style pinning ────────────────────────────────────────────
            // Unpinned actions stay rendered (so a panel activation can still click
            // them and anchor their popup to the toolbar) but are lifted out of the
            // strip: absolutely positioned at the list origin and invisible.
            const actionList = () => document.querySelector('browser-action-list');
            function applyPinned(map) {
                const list = actionList();
                const root = list && list.shadowRoot;
                if (!root)
                    return;
                let style = root.getElementById('ink-pin-style');
                if (!style) {
                    style = document.createElement('style');
                    style.id = 'ink-pin-style';
                    root.appendChild(style);
                }
                const unpinned = Object.keys(map || {}).filter(id => map[id] === false);
                // :host{position:relative} makes the collapsed nodes anchor at the
                // list's own origin (right side of the toolbar) — so a popup opened
                // from the panel appears under the toolbar, not at the viewport corner.
                style.textContent = ':host{position:relative}\n' + unpinned.map(id => `#${CSS.escape(id)}{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;}`).join('\n');
            }
            let pinnedMap = (settings.extPinned || {});
            // The custom element upgrades asynchronously — retry until its shadow
            // root exists, then keep the style asserted across re-renders.
            const pinInit = setInterval(() => {
                const list = actionList();
                if (!list || !list.shadowRoot)
                    return;
                clearInterval(pinInit);
                applyPinned(pinnedMap);
                new MutationObserver(() => {
                    if (!list.shadowRoot.getElementById('ink-pin-style'))
                        applyPinned(pinnedMap);
                }).observe(list.shadowRoot, { childList: true });
            }, 250);
            window.extensionsUI.onPinnedChanged((map) => {
                pinnedMap = map || {};
                applyPinned(pinnedMap);
            });
            // Panel row click → click the real action button so the extension's
            // popup opens (or its onClicked fires), anchored to the toolbar.
            window.extensionsUI.onActivate((id) => {
                const list = actionList();
                const node = list && list.shadowRoot && list.shadowRoot.getElementById(id);
                if (node)
                    node.click();
            });
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const r = btn.getBoundingClientRect();
                panelOpen = await window.extensionsUI.togglePanel({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
                btn.classList.toggle('active', panelOpen);
            });
            window.extensionsUI.onPanelClosed(() => {
                panelOpen = false;
                btn.classList.remove('active');
            });
            // Close the panel AND any open action popup on clicks outside
            // (chrome or page content) — mirrors Firefox dismissal behavior.
            // Clicks inside the action strip (or our synthetic activation clicks)
            // are the ones OPENING a popup — those must not dismiss it.
            window.addEventListener('click', (e) => {
                if (panelOpen && !btn.contains(e.target))
                    window.extensionsUI.closePanel();
                const insideActionStrip = typeof e.composedPath === 'function' &&
                    e.composedPath().some((n) => n && n.tagName === 'BROWSER-ACTION-LIST');
                if (!insideActionStrip)
                    window.extensionsUI.closeActionPopup();
            });
            if (window.contentInteraction) {
                window.contentInteraction.onClicked(() => {
                    if (panelOpen)
                        window.extensionsUI.closePanel();
                    window.extensionsUI.closeActionPopup();
                });
            }
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Downloads button + panel
        // ─────────────────────────────────────────────────────────────────────────
        function initDownloads() {
            const btn = document.getElementById('downloads-btn');
            if (!btn || !window.downloads)
                return;
            let panelOpen = false;
            let activeCount = 0;
            function syncButton(items) {
                activeCount = items.filter(i => i.state === 'progressing').length;
                btn.classList.toggle('hidden', items.length === 0);
                btn.classList.toggle('downloading', activeCount > 0);
                btn.title = activeCount > 0 ? `Downloads — ${activeCount} in progress` : 'Downloads';
            }
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const r = btn.getBoundingClientRect();
                panelOpen = await window.downloads.togglePanel({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
                btn.classList.toggle('active', panelOpen);
                if (panelOpen)
                    btn.classList.remove('has-new');
            });
            window.downloads.onPanelClosed(() => {
                panelOpen = false;
                btn.classList.remove('active');
            });
            window.downloads.onChanged(async (item) => {
                const items = await window.downloads.getAll();
                syncButton(items);
                // Pulse ends → mark completion so the user notices the finished file
                if (item && item.state === 'completed' && !panelOpen)
                    btn.classList.add('has-new');
            });
            // Close the panel on clicks outside the button (chrome or page content)
            window.addEventListener('click', (e) => {
                if (panelOpen && !btn.contains(e.target))
                    window.downloads.closePanel();
            });
            if (window.contentInteraction) {
                window.contentInteraction.onClicked(() => { if (panelOpen)
                    window.downloads.closePanel(); });
            }
            // Restore button state for downloads started earlier in the session
            window.downloads.getAll().then(syncButton).catch(() => { });
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Reader mode + Picture-in-Picture buttons
        // ─────────────────────────────────────────────────────────────────────────
        function initReaderAndPip() {
            const readerBtn = document.getElementById('reader-btn');
            const pipBtn = document.getElementById('pip-btn');
            if (readerBtn && window.reader) {
                readerBtn.addEventListener('click', () => window.reader.toggle(activeTabIndex));
                // Main pushes { index, active, available } as pages load / tabs switch.
                window.reader.onState((d) => {
                    if (!d || d.index !== activeTabIndex)
                        return;
                    readerBtn.classList.toggle('hidden', !(d.available || d.active));
                    readerBtn.classList.toggle('active', !!d.active);
                    readerBtn.title = d.active ? 'Exit Reader View' : 'Reader View';
                });
                window.reader.onFailed((d) => {
                    if (!d || d.index !== activeTabIndex)
                        return;
                    // quiet feedback that extraction failed — no motion
                    readerBtn.title = 'No article found on this page';
                    setTimeout(() => { readerBtn.title = 'Reader View'; }, 1600);
                });
            }
            if (pipBtn && window.pip) {
                pipBtn.addEventListener('click', () => window.pip.toggle(activeTabIndex));
                window.pip.onMediaState((d) => {
                    if (!d || d.index !== activeTabIndex)
                        return;
                    pipBtn.classList.toggle('hidden', !d.playing);
                });
            }
            // Reset both when switching tabs; the main process re-sends the correct
            // state for the newly active tab immediately after.
            window.tab.onTabSwitched(() => {
                readerBtn?.classList.add('hidden');
                readerBtn?.classList.remove('active');
                pipBtn?.classList.add('hidden');
            });
        }
        // ─────────────────────────────────────────────────────────────────────────
        // Hamburger menu button
        // ─────────────────────────────────────────────────────────────────────────
        function initMenu() {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.menu.open();
                menuOpen = true;
            });
        }
    });
})();
