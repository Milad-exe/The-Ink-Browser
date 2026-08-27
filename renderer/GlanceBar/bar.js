(() => {
    'use strict';
    document.getElementById('close-btn')?.addEventListener('click', () => window.glanceBar?.close());
    const openBtn = document.getElementById('open-tab');
    // The tooltip's shortcut hint is platform-specific — mac glyphs read wrong
    // on Windows/Linux.
    if (openBtn) {
        const mac = window.glanceBar?.platform === 'darwin';
        openBtn.title = mac ? 'Expand into this tab (⌘↵)' : 'Expand into this tab (Ctrl+Enter)';
        openBtn.addEventListener('click', () => window.glanceBar?.promote());
    }
})();
