document.addEventListener('DOMContentLoaded', () => {
    async function close() {
        try { await window.electronAPI.closeMenu(); } catch {}
    }

    document.getElementById('btn-new-tab').addEventListener('click', async () => {
        await window.electronAPI.addTab();
        await close();
    });

    document.getElementById('btn-new-window').addEventListener('click', async () => {
        await window.electronAPI.newWindow();
        await close();
    });

    document.getElementById('btn-history').addEventListener('click', async () => {
        try { await window.electronAPI.openHistoryTab(); } catch {}
        await close();
    });

    document.getElementById('btn-bookmarks').addEventListener('click', async () => {
        try { await window.electronAPI.openBookmarksTab(); } catch {}
        await close();
    });

    document.getElementById('btn-settings').addEventListener('click', async () => {
        try { await window.electronAPI.openSettingsTab(); } catch {}
        await close();
    });
});
