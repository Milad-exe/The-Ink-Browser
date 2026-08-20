"use strict";
// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
(() => {
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            window.Ink.i18n.init(window.inkI18n?.getSync() || (window.northstarSettings?.getSync() || {}).i18n || {});
            window.Ink.i18n.apply(document);
        }
        catch (e) { window.inkLog?.debug('menu', 'i18n: ' + e); }
        const api = window.electronAPI;
        const mac = api.platform === 'darwin';
        const MOD = mac ? '⌘' : 'Ctrl ';
        const close = async () => { try {
            await api.closeMenu();
        }
        catch (e) { window.inkLog?.debug('menu', 'close: ' + e); } };
        const act = (fn) => async () => { try {
            await fn();
        }
        catch (e) { window.inkLog?.debug('menu', 'act: ' + e); } await close(); };
        // Fill keyboard-shortcut hints (platform-aware).
        document.querySelectorAll('.sc[data-sc]').forEach(el => {
            el.textContent = MOD + el.dataset.sc;
        });
        const histSc = document.getElementById('sc-history');
        if (histSc)
            histSc.textContent = mac ? '⌘Y' : 'Ctrl H';
        const privTabSc = document.getElementById('sc-private-tab');
        if (privTabSc)
            privTabSc.textContent = mac ? '⌘⌥T' : 'Ctrl Alt T';
        // Reflect the bookmark-bar state as a checkmark.
        try {
            const settings = await api.getSettings();
            if (settings && settings.bookmarkBarVisible) {
                document.getElementById('bookmark-bar-check').classList.add('visible');
            }
        }
        catch (e) { window.inkLog?.debug('menu', 'act: ' + e); }
        // ── Actions ────────────────────────────────────────────────────────────
        document.getElementById('btn-new-tab').addEventListener('click', act(() => api.addTab()));
        document.getElementById('btn-new-private-tab').addEventListener('click', act(() => api.addPrivateTab()));
        document.getElementById('btn-new-window').addEventListener('click', act(() => api.newWindow()));
        document.getElementById('btn-new-private').addEventListener('click', act(() => api.newPrivateWindow()));
        document.getElementById('btn-find').addEventListener('click', act(() => api.find()));
        document.getElementById('btn-print').addEventListener('click', act(() => api.print()));
        document.getElementById('btn-history').addEventListener('click', act(() => api.openHistoryTab()));
        document.getElementById('btn-bookmarks').addEventListener('click', act(() => api.openBookmarksTab()));
        document.getElementById('btn-passwords').addEventListener('click', act(() => api.openSettingsTab('passwords')));
        document.getElementById('btn-extensions').addEventListener('click', act(() => api.openSettingsTab('extensions')));
        document.getElementById('btn-bookmark-bar').addEventListener('click', act(() => api.toggleBookmarkBar()));
        document.getElementById('btn-settings').addEventListener('click', act(() => api.openSettingsTab()));
        // ── Zoom (menu stays open so you can adjust repeatedly) ──────────────────
        const zoomLevel = document.getElementById('zoom-level');
        const setZoom = async (dir) => {
            try {
                const pct = await api.zoom(dir);
                if (typeof pct === 'number')
                    zoomLevel.textContent = pct + '%';
            }
            catch (e) { window.inkLog?.debug('menu', 'setZoom: ' + e); }
        };
        document.getElementById('zoom-out').addEventListener('click', () => setZoom('out'));
        document.getElementById('zoom-in').addEventListener('click', () => setZoom('in'));
        document.getElementById('zoom-reset').addEventListener('click', () => setZoom('reset'));
        setZoom('get'); // reflect the active tab's current zoom
        // A menu you can only click is half a menu: arrows move, Enter runs,
        // Escape closes, and the first row is focused so the keyboard has
        // somewhere to start.
        document.querySelectorAll('.menu-row').forEach(r => r.setAttribute('role', 'menuitem'));
        window.Ink?.keys?.rows(document, { selector: '.menu-row, #zoom-reset', onEscape: close, focusFirst: true });
        // Left/Right work the zoom row from its single stop, the way a slider
        // row behaves in a native menu.
        document.getElementById('zoom-reset').addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')
                return;
            e.preventDefault();
            e.stopPropagation();
            setZoom(e.key === 'ArrowLeft' ? 'out' : 'in');
        });
    });
})();
