const { contextBridge, ipcRenderer } = require('electron');

// Expose Bruno API to renderer
contextBridge.exposeInMainWorld('bruno', {
  open: () => ipcRenderer.invoke('bruno-open'),
  close: () => ipcRenderer.invoke('bruno-close'),
  selectDirectory: () => ipcRenderer.invoke('bruno-select-directory'),
  saveCollectionFile: (path, data) => ipcRenderer.invoke('bruno-save-collection-file', path, data),
  loadCollectionFile: (path) => ipcRenderer.invoke('bruno-load-collection-file', path)
});

// Initialize Bruno UI with event handlers
const initBruno = () => {
  console.log('✅ Bruno preload initializing...');

  const btn = (id) => document.getElementById(id);
  const state = {
    collectionPath: null,
    collectionName: null,
    requests: {},
    currentRequestFile: null,
    isOpen() { return !!this.collectionPath; }
  };

  // Show/hide modal
  const showModal = (id) => btn(id)?.classList.remove('hidden');
  const hideModal = (id) => btn(id)?.classList.add('hidden');

  // Render requests list
  const renderRequests = () => {
    const list = btn('requests-list');
    if (!state.isOpen()) {
      list.innerHTML = '<div class="empty-state">No collection open</div>';
      return;
    }
    const requests = Object.values(state.requests);
    if (requests.length === 0) {
      list.innerHTML = '<div class="empty-state">No requests</div>';
      return;
    }
    list.innerHTML = '';
    requests.forEach(req => {
      const div = document.createElement('div');
      div.className = 'req-item';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.innerHTML = `<span style="flex:1">${req.method} ${req.name}</span><button class="btn-icon" style="font-size:12px;">✕</button>`;
      list.appendChild(div);
    });
  };

  // OPEN COLLECTION
  btn('open-collection-btn')?.addEventListener('click', async () => {
    console.log('✓ CLICK: open-collection-btn');
    const path = await window.bruno.selectDirectory();
    if (path) {
      state.collectionPath = path;
      state.collectionName = path.split(/[\/\\]/).pop();
      state.requests = {};
      btn('collection-title').textContent = state.collectionName;
      renderRequests();
      console.log('✅ Collection opened:', state.collectionName);
    }
  });

  // NEW REQUEST
  btn('new-request-btn')?.addEventListener('click', () => {
    console.log('✓ CLICK: new-request-btn');
    if (!state.isOpen()) {
      alert('Open a collection first');
      return;
    }
    showModal('modal-new-request');
    btn('request-name-input')?.focus();
  });

  // CREATE REQUEST
  btn('modal-create')?.addEventListener('click', async () => {
    console.log('✓ CLICK: modal-create');
    const name = btn('request-name-input')?.value.trim();
    if (!name) return alert('Enter a name');

    const filename = `${Date.now()}_${name.replace(/\s+/g, '_')}`;
    const req = { filename, name, method: 'GET', url: '', body: '' };

    try {
      const filepath = `${state.collectionPath}/${filename}.json`;
      await window.bruno.saveCollectionFile(filepath, JSON.stringify(req, null, 2));
      state.requests[filename] = req;
      btn('request-name-input').value = '';
      hideModal('modal-new-request');
      renderRequests();
      console.log('✅ Request created:', name);
    } catch (e) {
      console.error('❌ Error:', e);
      alert('Error: ' + e.message);
    }
  });

  // CANCEL
  btn('modal-cancel')?.addEventListener('click', () => {
    console.log('✓ CLICK: modal-cancel');
    hideModal('modal-new-request');
  });

  // CLOSE BRUNO
  btn('bruno-close-btn')?.addEventListener('click', () => {
    console.log('✓ CLICK: bruno-close-btn');
    window.bruno.close();
  });

  // SEND REQUEST
  btn('send-btn')?.addEventListener('click', async () => {
    console.log('✓ CLICK: send-btn');
    let url = btn('request-url')?.value;
    const method = btn('request-method')?.value;
    const body = btn('body-textarea')?.value;

    if (!url) return alert('Enter URL');
    if (!url.startsWith('http')) url = 'https://' + url;

    try {
      btn('response-status').textContent = 'Loading...';
      const opts = { method };
      if (body) opts.body = body;
      const res = await fetch(url, opts);
      const text = await res.text();
      btn('response-status').textContent = `${res.status}`;
      btn('response-body').textContent = text || '(empty)';
      console.log('✅ Request sent, response:', res.status);
    } catch (e) {
      btn('response-body').textContent = 'Error: ' + e.message;
      console.error('❌ Fetch error:', e);
    }
  });

  // TABS
  document.querySelectorAll('.req-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = e.target.getAttribute('data-tab');
      console.log('✓ CLICK: tab', tabName);
      document.querySelectorAll('.req-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      btn(`${tabName}-pane`)?.classList.add('active');
    });
  });

  // ESCAPE TO CLOSE
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      console.log('✓ Escape pressed');
      window.bruno.close();
    }
  });

  console.log('✅ Bruno initialized, all listeners attached');
};

// Wait for DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBruno);
} else {
  initBruno();
}
