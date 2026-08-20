"use strict";
// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
//
// Management panel: each row pins/unpins the extension to the toolbar,
// toggles it, opens options, or removes it. Extensions are RUN by clicking
// their pinned toolbar icon — the row itself never activates, so aiming for a
// control can't accidentally open a popup. The footer links to the Web Store.
(() => {
    const T = (key, fallback) => {
        try { const v = window.Ink?.i18n?.t(key); return (v && v !== key) ? v : fallback; }
        catch (e) { return fallback; }
    };
    try {
        window.Ink.i18n.init(window.inkI18n?.getSync() || (window.northstarSettings?.getSync() || {}).i18n || {});
        window.Ink.i18n.apply(document);
    }
    catch (e) { window.inkLog?.debug('extpanel', 'i18n: ' + e); }
    const listEl = document.getElementById('list');
    const PIN_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M9.5 1.5l5 5-1.5 1.5-.75-.25L9.5 10.5l.25 2.75L8.5 14.5 5 11 2 14l-1-1 3-3-3.5-3.5 1.25-1.25 2.75.25 2.75-2.75-.25-.75L9.5 1.5z"/></svg>`;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            window.extPanel.close();
        }
    });
    function render(items) {
        listEl.textContent = '';
        if (!items || items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'surface-empty';
            const t = document.createElement('div');
            t.className = 'empty-title';
            t.textContent = T('ext.empty', 'No extensions yet');
            const h = document.createElement('div');
            h.className = 'empty-hint';
            h.textContent = T('ext.emptyHint', 'Installed extensions are managed here.');
            empty.append(t, h);
            listEl.appendChild(empty);
            return;
        }
        for (const ext of items) {
            const row = document.createElement('div');
            row.className = 'surface-row ext-row';
            row.title = ext.description || ext.name;
            const icon = document.createElement('div');
            icon.className = 'ext-icon';
            if (ext.icon) {
                const img = document.createElement('img');
                img.src = ext.icon;
                img.className = 'ext-icon-img';
                if (!ext.enabled)
                    img.style.filter = 'grayscale(1) opacity(0.5)';
                icon.appendChild(img);
            }
            else {
                icon.classList.add('ext-icon-blank');
            }
            row.appendChild(icon);
            const meta = document.createElement('div');
            meta.className = 'ext-meta';
            const name = document.createElement('div');
            name.className = 'ext-name' + (ext.enabled ? '' : ' is-off');
            name.textContent = ext.name;
            const ver = document.createElement('div');
            ver.className = 'ext-sub';
            ver.textContent = 'v' + (ext.version || '?')
                + (ext.enabled ? '' : ' · off')
                + (ext.pinned ? '' : ' · unpinned');
            meta.appendChild(name);
            meta.appendChild(ver);
            row.appendChild(meta);
            const control = (el, handler) => {
                el.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
                return el;
            };
            // Pin / unpin — a real 26px button so it's an easy, unambiguous target.
            const pin = document.createElement('button');
            pin.className = 'surface-icon-btn ext-pin' + (ext.pinned ? ' is-pinned' : '');
            pin.title = ext.pinned ? T('ext.unpin', 'Pinned to the toolbar — click to unpin') : T('ext.pin', 'Pin to the toolbar');
            pin.innerHTML = PIN_SVG;
            control(pin, () => window.extPanel.setPinned(ext.id, !ext.pinned));
            row.appendChild(pin);
            if (ext.optionsUrl && ext.enabled) {
                const opts = document.createElement('button');
                opts.className = 'surface-icon-btn';
                opts.title = T('ext.options', 'Extension options');
                opts.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.6" stroke="currentColor" stroke-width="1.4"/><path d="M10 3v1.6M10 15.4V17M3 10h1.6M15.4 10H17M5 5l1.1 1.1M13.9 13.9L15 15M5 15l1.1-1.1M13.9 6.1L15 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
                control(opts, () => window.extPanel.openOptions(ext.id));
                row.appendChild(opts);
            }
            // A real button with a switch role: a <div> toggle is invisible to
            // the keyboard and announces as nothing.
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.setAttribute('role', 'switch');
            toggle.setAttribute('aria-checked', String(!!ext.enabled));
            toggle.className = 'ext-toggle' + (ext.enabled ? ' on' : '');
            toggle.title = ext.enabled ? T('ext.disable', 'Disable') : T('ext.enable', 'Enable');
            control(toggle, async () => { await window.extPanel.setEnabled(ext.id, !ext.enabled); refresh(); });
            row.appendChild(toggle);
            const rm = document.createElement('button');
            rm.className = 'surface-icon-btn ext-remove';
            rm.title = T('ext.remove', 'Remove extension');
            rm.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            control(rm, async () => { await window.extPanel.remove(ext.id); refresh(); });
            row.appendChild(rm);
            listEl.appendChild(row);
        }
    }
    // DevTools-panel extensions have no DevTools frontend to live in, so their
    // panels are listed here and open in the side panel instead.
    function renderDevtools(panels) {
        if (!panels || !panels.length)
            return;
        const head = document.createElement('div');
        head.className = 'surface-label';
        head.textContent = T('ext.devtoolsPanels', 'DevTools panels');
        listEl.appendChild(head);
        for (const p of panels) {
            const row = document.createElement('button');
            row.className = 'surface-row dt-row';
            row.title = `Open “${p.title}” from ${p.extensionName || p.extensionId}`;
            const meta = document.createElement('div');
            meta.className = 'ext-meta';
            const name = document.createElement('div');
            name.className = 'ext-name';
            name.textContent = p.title;
            const sub = document.createElement('div');
            sub.className = 'ext-sub';
            sub.textContent = p.extensionName || p.extensionId;
            meta.appendChild(name);
            meta.appendChild(sub);
            row.appendChild(meta);
            const arrow = document.createElement('span');
            arrow.className = 'ext-arrow';
            arrow.textContent = '→';
            row.appendChild(arrow);
            row.addEventListener('click', () => {
                window.extPanel.openDevtoolsPanel(p.id);
                window.extPanel.close();
            });
            listEl.appendChild(row);
        }
    }
    // The panel's height is decided by main BEFORE this content exists, from a
    // fixed per-row estimate — which clipped the last row as soon as rows of
    // different heights (the DevTools section) appeared. Measure what actually
    // rendered and let main resize to fit.
    function syncHeight() {
        try {
            const panel = document.getElementById('panel');
            const list = document.getElementById('list');
            if (!panel || !list || !window.extPanel.setHeight)
                return;
            // #panel is h-screen + overflow-hidden, so its own scrollHeight can
            // never exceed the current view height — measuring it just reports
            // back the size we already have. #list is the scrolling element, so
            // the height we want is the chrome around it plus its full content.
            const chromeH = panel.clientHeight - list.clientHeight;
            window.extPanel.setHeight(Math.ceil(chromeH + list.scrollHeight));
        }
        catch (e) { window.inkLog?.debug('panel', 'syncHeight: ' + e); }
    }
    // render() clears the list, so the devtools section is always appended after
    // it — never on its own.
    async function appendDevtools() {
        try {
            renderDevtools(await window.extPanel.devtoolsPanels());
        }
        catch (e) { window.inkLog?.debug('panel', 'appendDevtools: ' + e); }
        syncHeight();
    }
    async function refresh() {
        try {
            render(await window.extPanel.list());
        }
        catch (e) { window.inkLog?.debug('panel', 'refresh: ' + e); }
        await appendDevtools();
    }
    window.extPanel.onData((items) => { render(items); appendDevtools(); });
    document.getElementById('close-btn').addEventListener('click', () => window.extPanel.close());
    document.getElementById('store-link').addEventListener('click', (e) => {
        e.preventDefault();
        window.extPanel.openStore();
        window.extPanel.close();
    });
    // Rows here are not activatable — the controls inside them are — so Tab
    // walks the controls and only Escape is wired at the panel level.
    window.Ink?.keys?.rows(document, { selector: '.dt-row, #store-link', typeahead: false });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape')
        window.extPanel.close(); });
    refresh();
})();
