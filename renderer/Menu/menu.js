document.addEventListener('DOMContentLoaded', async () => {
    const buttons = document.querySelectorAll('button');

    // Find the persistence button and attach an indicator dot
    const persistBtn = Array.from(buttons).find(b => b.textContent.trim() === 'Persistence');
    let indicator = null;

    async function refreshIndicator() {
        try {
            const mode = await window.persist.getMode();
            if (persistBtn) {
                if (!indicator) {
                    indicator = document.createElement('span');
                    indicator.className = 'indicator';
                    persistBtn.appendChild(indicator);
                }
                indicator.classList.toggle('on', !!mode);
                indicator.classList.toggle('off', !mode);
                persistBtn.setAttribute('aria-pressed', !!mode);
                persistBtn.title = mode ? 'Persistence: On' : 'Persistence: Off';
            }
        } catch {}
    }

    await refreshIndicator();

    buttons.forEach(button => {
        button.addEventListener('click', async () => {
            const buttonText = button.textContent.trim();
            switch (buttonText) {
                case 'New Tab':
                    await window.electronAPI.addTab();
                    await window.electronAPI.closeMenu();
                    break;
                case 'History':
                    try {
                        await window.electronAPI.openHistoryTab();
                        await window.electronAPI.closeMenu();
                    } catch {}
                    break;
                case 'New Window':
                    await window.electronAPI.newWindow();
                    await window.electronAPI.closeMenu();
                    break;
                case 'Bookmarks':
                    await window.electronAPI.closeMenu();
                    break;
                case 'Persistence':
                    try {
                        const current = await window.persist.getMode();
                        await window.persist.setMode(!current);
                        await refreshIndicator();
                        // keep menu open so the change is visible immediately
                    } catch {}
                    break;
            }
        });
    });
});
