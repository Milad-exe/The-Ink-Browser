"use strict";
// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
(() => {
    document.addEventListener('DOMContentLoaded', async () => {
        const container = document.getElementById('container');
        async function load() {
            container.innerHTML = '';
            let bookmarks = [];
            try {
                bookmarks = await window.browserBookmarks.getAll();
            }
            catch { }
            if (!bookmarks.length) {
                const msg = document.createElement('p');
                msg.className = 'empty-msg';
                msg.textContent = 'No bookmarks yet. Click ★ in the address bar to bookmark a page.';
                container.appendChild(msg);
                return;
            }
            bookmarks.forEach(entry => {
                const row = document.createElement('div');
                row.className = 'bookmark-entry';
                const icon = document.createElement('img');
                icon.className = 'bookmark-favicon';
                icon.style.display = 'none';
                // From the local favicon cache (visited sites) — no network fetch.
                try {
                    const host = new URL(entry.url).host;
                    window.northstarSettings?.cachedFavicon?.(host).then((d) => {
                        if (d) { icon.src = d; icon.style.display = ''; }
                    }).catch(() => { });
                }
                catch { }
                const content = document.createElement('div');
                content.className = 'bookmark-content';
                const title = document.createElement('div');
                title.className = 'bookmark-title';
                title.textContent = entry.title || entry.url;
                const url = document.createElement('div');
                url.className = 'bookmark-url';
                url.textContent = entry.url;
                content.appendChild(title);
                content.appendChild(url);
                const removeBtn = document.createElement('button');
                removeBtn.className = 'bookmark-remove';
                removeBtn.title = 'Remove bookmark';
                removeBtn.textContent = '×';
                removeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await window.browserBookmarks.remove(entry.url);
                    row.remove();
                    if (!container.querySelector('.bookmark-entry'))
                        load();
                });
                row.appendChild(icon);
                row.appendChild(content);
                row.appendChild(removeBtn);
                row.addEventListener('click', () => {
                    window.electronAPI.navigateActiveTab(entry.url);
                });
                row.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    window.browserBookmarks.showContextMenu(entry.url);
                });
                container.appendChild(row);
            });
        }
        window.browserBookmarks.onChanged(() => {
            load();
        });
        await load();
    });
})();
