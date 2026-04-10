document.addEventListener('DOMContentLoaded', async () => {
    async function close() {
        try { await window.electronAPI.closeMenu(); } catch {}
    }

    // Show current bookmark bar state
    try {
        const settings = await window.electronAPI.getSettings();
        if (settings && settings.bookmarkBarVisible) {
            document.getElementById('bookmark-bar-check').classList.add('visible');
        }
    } catch {}

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

    document.getElementById('btn-bookmark-bar').addEventListener('click', async () => {
        window.electronAPI.toggleBookmarkBar();
        await close();
    });

    document.getElementById('btn-settings').addEventListener('click', async () => {
        try { await window.electronAPI.openSettingsTab(); } catch {}
        await close();
    });
});
