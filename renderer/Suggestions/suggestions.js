"use strict";
// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
(() => {
    (function () {
        const listEl = document.getElementById('list');
        // Inline SVGs (neutral gray so they read on light + dark themes)
        const G = '%23888';
        const SVG_SEARCH = `data:image/svg+xml;utf8,<svg viewBox="0 0 256 256" fill="${G}" xmlns="http://www.w3.org/2000/svg"><path d="M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z"></path></svg>`;
        const SVG_GLOBE = `data:image/svg+xml;utf8,<svg viewBox="0 0 256 256" fill="${G}" xmlns="http://www.w3.org/2000/svg"><path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,187a113.4,113.4,0,0,1-20.39-35h40.82a116.94,116.94,0,0,1-10,20.77A108.61,108.61,0,0,1,128,207Zm-26.49-59a135.42,135.42,0,0,1,0-40h53a135.42,135.42,0,0,1,0,40ZM44,128a83.49,83.49,0,0,1,2.43-20H77.25a160.63,160.63,0,0,0,0,40H46.43A83.49,83.49,0,0,1,44,128Zm84-79a113.4,113.4,0,0,1,20.39,35H107.59a116.94,116.94,0,0,1,10-20.77A108.61,108.61,0,0,1,128,49Zm50.73,59h30.82a83.52,83.52,0,0,1,0,40H178.75a160.63,160.63,0,0,0,0-40Zm20.77-24H173.71a140.82,140.82,0,0,0-15.5-34.36A84.51,84.51,0,0,1,199.52,84ZM97.79,49.64A140.82,140.82,0,0,0,82.29,84H56.48A84.51,84.51,0,0,1,97.79,49.64ZM56.48,172H82.29a140.82,140.82,0,0,0,15.5,34.36A84.51,84.51,0,0,1,56.48,172Zm101.73,34.36A140.82,140.82,0,0,0,173.71,172h25.81A84.51,84.51,0,0,1,158.21,206.36Z"></path></svg>`;
        const SVG_BKMK = `data:image/svg+xml;utf8,<svg viewBox="0 0 256 256" fill="${G}" xmlns="http://www.w3.org/2000/svg"><path d="M243,96a20.33,20.33,0,0,0-17.74-14l-56.59-4.57L146.83,24.62a20.36,20.36,0,0,0-37.66,0L87.35,77.44,30.76,82A20.45,20.45,0,0,0,19.1,117.88l43.18,37.24-13.2,55.7A20.37,20.37,0,0,0,79.57,233L128,203.19,176.43,233a20.39,20.39,0,0,0,30.49-22.15l-13.2-55.7,43.18-37.24A20.43,20.43,0,0,0,243,96ZM172.53,141.7a12,12,0,0,0-3.84,11.86L181.58,208l-47.29-29.08a12,12,0,0,0-12.58,0L74.42,208l12.89-54.4a12,12,0,0,0-3.84-11.86L41.2,105.24l55.4-4.47a12,12,0,0,0,10.13-7.38L128,41.89l21.27,51.5a12,12,0,0,0,10.13,7.38l55.4,4.47Z"></path></svg>`;
        const SVG_HIST = `data:image/svg+xml;utf8,<svg viewBox="0 0 256 256" fill="${G}" xmlns="http://www.w3.org/2000/svg"><path d="M140,80v41.21l34.17,20.5a12,12,0,1,1-12.34,20.58l-40-24A12,12,0,0,1,116,128V80a12,12,0,0,1,24,0ZM128,28A99.38,99.38,0,0,0,57.24,57.34c-4.69,4.74-9,9.37-13.24,14V64a12,12,0,0,0-24,0v40a12,12,0,0,0,12,12H72a12,12,0,0,0,0-24H57.77C63,86,68.37,80.22,74.26,74.26a76,76,0,1,1,1.58,109,12,12,0,0,0-16.48,17.46A100,100,0,1,0,128,28Z"></path></svg>`;
        const SVG_TAB = `data:image/svg+xml;utf8,<svg viewBox="0 0 256 256" fill="${G}" xmlns="http://www.w3.org/2000/svg"><path d="M220,32H76A20,20,0,0,0,56,52V72H36A20,20,0,0,0,16,92V204a20,20,0,0,0,20,20H180a20,20,0,0,0,20-20V184h20a20,20,0,0,0,20-20V52A20,20,0,0,0,220,32ZM176,96v16H40V96Zm0,104H40V136H176Zm40-40H200V92a20,20,0,0,0-20-20H80V56H216Z"></path></svg>`;
        const ENGINE_NAME = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing' };
        const isSearchType = (t) => t === 'action' || t === 'google' || t === 'duckduckgo' || t === 'bing';
        // Show a readable URL, as Chrome/Firefox do: no scheme, no trailing slash.
        const cleanUrl = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        /**
         * standard emphasis: the part of the text matching what the user typed is
         * de-emphasized (thin), and the rest — the completion — is bold. Makes it
         * obvious at a glance what each suggestion adds to your query.
         */
        function highlight(text, query, cls) {
            const frag = document.createDocumentFragment();
            text = text || '';
            const q = (query || '').toLowerCase();
            const i = q ? text.toLowerCase().indexOf(q) : -1;
            const push = (t, strong) => {
                if (!t)
                    return;
                const s = document.createElement('span');
                s.className = (strong ? 'strong' : 'thin') + (cls ? ' ' + cls : '');
                s.textContent = t;
                frag.appendChild(s);
            };
            if (i === -1) {
                push(text, true);
                return frag;
            }
            push(text.slice(0, i), true);
            push(text.slice(i, i + q.length), false);
            push(text.slice(i + q.length), true);
            return frag;
        }
        // Favicons come from the local cache (sites you've visited) only — never a
        // network fetch from the suggestions overlay. hostOf() derives the lookup
        // key for a suggestion.
        function hostOf(item) {
            try {
                if (item.url)
                    return new URL(item.url).host;
            }
            catch (e) { window.northstarLog?.debug('suggestions', 'hostOf: ' + e); }
            if (item.type === 'navigate' && item.query) {
                const h = String(item.query).replace(/^https?:\/\//, '').split(/[/?#]/)[0];
                if (/\.[a-z]{2,}$/i.test(h))
                    return h;
            }
            return '';
        }
        function render(payload) {
            const { items = [], activeIndex = -1, query = '', engine = 'google' } = payload || {};
            listEl.innerHTML = '';
            items.forEach((item, idx) => {
                const el = document.createElement('div');
                el.className = 'item' + (idx === activeIndex ? ' active' : '');
                const search = isSearchType(item.type);
                // ── Icon ──────────────────────────────────────────────────────────────
                const icon = document.createElement('img');
                icon.className = 'fav';
                icon.alt = '';
                let fallback = SVG_GLOBE;
                if (search)
                    fallback = SVG_SEARCH;
                else if (item.type === 'history')
                    fallback = SVG_HIST;
                else if (item.type === 'bookmark')
                    fallback = SVG_BKMK;
                else if (item.type === 'switch-tab')
                    fallback = SVG_TAB;
                // Placeholder first, then fill from the local favicon cache (visited
                // sites) — no network fetch here, so typing can't ping every domain.
                icon.src = search ? SVG_SEARCH : fallback;
                if (!search) {
                    if (item.favicon && /^data:/.test(item.favicon)) {
                        icon.src = item.favicon;
                    }
                    else {
                        const host = hostOf(item);
                        if (host && window.overlaySuggestions.cachedFavicon) {
                            window.overlaySuggestions.cachedFavicon(host)
                                .then(d => {
                                    if (d) { icon.src = d; return; }
                                    // Not visited before — pull the domain's favicon from the
                                    // engine's service (Chrome/Firefox-style), if allowed.
                                    if (window.overlaySuggestions.remoteFavicon)
                                        window.overlaySuggestions.remoteFavicon(host)
                                            .then(rd => { if (rd) icon.src = rd; })
                                            .catch(() => { });
                                })
                                .catch(() => { });
                        }
                    }
                }
                el.appendChild(icon);
                // ── Label: primary (highlighted) + dim secondary ──────────────────────
                const main = document.createElement('span');
                main.className = 'main-label';
                const primary = document.createElement('span');
                primary.className = 'primary';
                const addSecondary = (text, opts) => {
                    const sep = document.createElement('span');
                    sep.className = 'sep';
                    sep.textContent = ' — ';
                    main.appendChild(sep);
                    const sec = document.createElement('span');
                    sec.className = 'secondary';
                    if (opts && opts.url)
                        sec.appendChild(highlight(text, query, 'url'));
                    else
                        sec.textContent = text;
                    main.appendChild(sec);
                };
                if (search) {
                    primary.appendChild(highlight(item.query || '', query));
                    main.appendChild(primary);
                    if (item.type === 'action')
                        addSecondary('Search with ' + (ENGINE_NAME[engine] || 'Google'));
                }
                else if (item.type === 'navigate') {
                    primary.appendChild(highlight(item.query || '', query));
                    main.appendChild(primary);
                    addSecondary('Visit');
                }
                else {
                    // history / bookmark / switch-tab — "Title — url"
                    const title = item.title && item.title !== item.url ? item.title : item.url;
                    primary.appendChild(highlight(title || '', query));
                    main.appendChild(primary);
                    if (item.type === 'switch-tab')
                        addSecondary('Switch to Tab');
                    else if (item.url)
                        addSecondary(cleanUrl(item.url), { url: true });
                    el.title = item.url || '';
                }
                el.appendChild(main);
                // Hover moves the ONE selection to this row (accent), so mouse and
                // keyboard never show two highlights, and Enter after hovering goes
                // where the pointer is — matching Chrome/Firefox.
                el.addEventListener('mouseenter', () => {
                    for (const c of listEl.children)
                        c.classList.toggle('active', c === el);
                    try { window.overlaySuggestions.hover && window.overlaySuggestions.hover(idx); }
                    catch (e) { window.northstarLog?.debug('suggestions', 'hover: ' + e); }
                });
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    try {
                        window.overlaySuggestions.pointerDown && window.overlaySuggestions.pointerDown();
                    }
                    catch (e) { window.northstarLog?.debug('suggestions', 'addSecondary: ' + e); }
                    window.overlaySuggestions.select(item);
                });
                listEl.appendChild(el);
            });
        }
        window.overlaySuggestions.onData(render);
    })();
})();
