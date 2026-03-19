(function(){
  const listEl = document.getElementById('list');
  let current = { items: [], activeIndex: -1 };

  function render(payload){
    const { items = [], activeIndex = -1 } = payload || {};
    current.items = items; current.activeIndex = activeIndex;
    listEl.innerHTML = '';

    items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'item' + (idx === activeIndex ? ' active' : '');
      // favicon/icon
      const icon = document.createElement('img');
      icon.className = 'fav';
      icon.width = 16; icon.height = 16;
      icon.style.marginRight = '8px';
      icon.alt = '';
      try {
        icon.src = item.favicon || (item.url ? `https://www.google.com/s2/favicons?domain=${(new URL(item.url)).hostname}` : '');
      } catch (err) {
        icon.src = item.favicon || '';
      }
      const main = document.createElement('span'); main.textContent = item.title || item.query || item.url || '';
      const secondary = document.createElement('span'); secondary.className='secondary';
      if ((item.type === 'google' || item.type === 'action') && item.query) { secondary.textContent = 'Search Google'; }
      el.appendChild(icon);
      el.appendChild(main);
      if (secondary.textContent) { el.appendChild(document.createTextNode(' ')); el.appendChild(secondary);} 
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        try { if (window.overlaySuggestions && window.overlaySuggestions.pointerDown) window.overlaySuggestions.pointerDown(); } catch (err) {}
        window.overlaySuggestions.select(item);
      });
      listEl.appendChild(el);
    });
  }

  window.overlaySuggestions.onData((payload) => {
    render(payload);
  });
})();
