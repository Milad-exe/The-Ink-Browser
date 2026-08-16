(() => {
    'use strict';
    const titleEl = document.getElementById('title');
    const closeBtn = document.getElementById('close-btn');
    window.sidePanel?.onInfo((info) => {
        if (info?.name)
            titleEl.textContent = info.name;
    });
    closeBtn?.addEventListener('click', () => window.sidePanel?.close());
})();
