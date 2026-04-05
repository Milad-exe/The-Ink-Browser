(function(){
  const listEl = document.getElementById('list');
  let current = { items: [], activeIndex: -1 };

  function render(payload) {
    const { items = [], activeIndex = -1 } = payload || {};
    current.items = items;
    current.activeIndex = activeIndex;
    listEl.innerHTML = '';

    items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'item' + (idx === activeIndex ? ' active' : '');

      // Favicon
      const icon = document.createElement('img');
      icon.className = 'fav';
      icon.width = 14; icon.height = 14;
      icon.alt = '';
      try {
        icon.src = item.favicon || (item.url ? `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}` : '');
      } catch {
        icon.src = item.favicon || '';
      }
      el.appendChild(icon);

      // Main label — "Title — url" for navigable items, just query for search items
      const main = document.createElement('span');
      main.className = 'main-label';

      const isSearch = item.type === 'action' || item.type === 'google' || item.type === 'duckduckgo' || item.type === 'bing';

      if (!isSearch && item.url) {
        const title = item.title && item.title !== item.url ? item.title : null;
        if (title) {
          // "Page Title" in normal weight, "— url" dimmed
          const titleSpan = document.createElement('span');
          titleSpan.className = 'label-title';
          titleSpan.textContent = title;
          const sepSpan = document.createElement('span');
          sepSpan.className = 'label-sep';
          sepSpan.textContent = ' — ';
          const urlSpan = document.createElement('span');
          urlSpan.className = 'label-url';
          urlSpan.textContent = item.url;
          main.appendChild(titleSpan);
          main.appendChild(sepSpan);
          main.appendChild(urlSpan);
        } else {
          main.textContent = item.url;
        }
        // Full URL in tooltip on the whole row
        el.title = item.url;
      } else {
        main.textContent = item.query || item.title || item.url || '';
      }

      el.appendChild(main);

      // Right-side pill/badge
      const secondary = document.createElement('span');
      secondary.className = 'secondary';
      if (item.type === 'switch-tab')  secondary.textContent = 'Switch';
      else if (item.type === 'action') secondary.textContent = 'Search';
      else if (item.type === 'google') secondary.textContent = 'Google';
      else if (item.type === 'duckduckgo') secondary.textContent = 'DDG';
      else if (item.type === 'bing')   secondary.textContent = 'Bing';
      else if (item.type === 'history') secondary.textContent = 'History';
      else if (item.type === 'bookmark') secondary.textContent = 'Bookmark';

      if (secondary.textContent) el.appendChild(secondary);

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        try {
          if (window.overlaySuggestions && window.overlaySuggestions.pointerDown) {
            window.overlaySuggestions.pointerDown();
          }
        } catch {}
        window.overlaySuggestions.select(item);
      });

      listEl.appendChild(el);
    });
  }

  window.overlaySuggestions.onData((payload) => {
    render(payload);
  });
})();
