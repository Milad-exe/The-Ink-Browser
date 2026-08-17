(() => {
    'use strict';
    document.getElementById('close-btn')?.addEventListener('click', () => window.glanceBar?.close());
    document.getElementById('open-tab')?.addEventListener('click', () => window.glanceBar?.promote());
})();
