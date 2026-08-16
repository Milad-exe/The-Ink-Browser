(() => {
    'use strict';
    const hostEl = document.getElementById('host');
    window.glanceBar?.onInfo((info) => {
        if (!info?.url)
            return;
        try { hostEl.textContent = new URL(info.url).hostname.replace(/^www\./, ''); }
        catch { hostEl.textContent = info.url; }
    });
    document.getElementById('close-btn')?.addEventListener('click', () => window.glanceBar?.close());
    document.getElementById('open-tab')?.addEventListener('click', () => window.glanceBar?.promote());
})();
