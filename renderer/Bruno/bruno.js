// ============================================================================
// STATE - FILE-BASED STORAGE
// ============================================================================
const bruno = {
  collectionPath: null,
  collectionName: null,
  requests: {}, // filename -> request data
  currentRequestFile: null,

  isOpen() {
    return !!this.collectionPath;
  }
};

console.log('✅ bruno.js loaded');

// ============================================================================
// MODAL
// ============================================================================
function showModal(id) {
  console.log('showModal:', id);
  document.getElementById(id).classList.remove('hidden');
  const input = document.getElementById('request-name-input');
  if (input) input.focus();
}

function closeModals() {
  console.log('closeModals');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// ============================================================================
// COLLECTION MANAGEMENT
// ============================================================================
async function openCollection() {
  console.log('openCollection called');
  const path = await window.bruno.selectDirectory();
  console.log('Selected path:', path);
  if (!path) return;

  bruno.collectionPath = path;
  bruno.collectionName = path.split(/[\/\\]/).pop();
  bruno.requests = {};
  bruno.currentRequestFile = null;

  console.log('Collection opened:', bruno.collectionName);
  updateCollectionUI();
}

function updateCollectionUI() {
  console.log('updateCollectionUI');
  document.getElementById('collection-title').textContent = bruno.collectionName || 'Collections';
  renderRequests();
}

// ============================================================================
// REQUEST MANAGEMENT
// ============================================================================
async function createRequest() {
  console.log('createRequest called');
  if (!bruno.isOpen()) {
    alert('Please open a collection first');
    return;
  }

  const name = document.getElementById('request-name-input').value.trim();
  console.log('Request name:', name);
  if (!name) {
    alert('Please enter request name');
    return;
  }

  try {
    const filename = `${Date.now()}_${name.replace(/\s+/g, '_')}`;
    const requestData = {
      filename,
      name,
      method: 'GET',
      url: '',
      body: '',
      auth: { type: 'none' },
      script: '',
      assert: '',
      docs: ''
    };

    // Save to disk
    const filepath = `${bruno.collectionPath}/${filename}.json`;
    console.log('Saving to:', filepath);
    await window.bruno.saveCollectionFile(filepath, JSON.stringify(requestData, null, 2));

    bruno.requests[filename] = requestData;
    bruno.currentRequestFile = filename;

    document.getElementById('request-name-input').value = '';
    closeModals();
    renderRequests();
    loadRequest(requestData);
    console.log('✅ Request created successfully');
  } catch (error) {
    console.error('❌ Error creating request:', error);
    alert('Error creating request: ' + error.message);
  }
}

async function saveRequest(filename, data) {
  if (!bruno.isOpen()) return;
  const filepath = `${bruno.collectionPath}/${filename}.json`;
  try {
    await window.bruno.saveCollectionFile(filepath, JSON.stringify(data, null, 2));
    console.log('✅ Request saved:', filename);
  } catch (error) {
    console.error('❌ Save error:', error);
  }
}

function openRequest(filename) {
  console.log('openRequest:', filename);
  const request = bruno.requests[filename];
  if (!request) return;
  bruno.currentRequestFile = filename;
  renderRequests();
  loadRequest(request);
}

function deleteRequest(filename) {
  console.log('deleteRequest:', filename);
  if (!confirm('Delete request?')) return;
  delete bruno.requests[filename];
  if (bruno.currentRequestFile === filename) {
    bruno.currentRequestFile = null;
    clearRequestUI();
  }
  renderRequests();
}

function loadRequest(req) {
  console.log('loadRequest:', req.name);
  document.getElementById('request-method').value = req.method || 'GET';
  document.getElementById('request-url').value = req.url || '';
  document.getElementById('body-textarea').value = req.body || '';
  document.getElementById('script-textarea').value = req.script || '';
  document.getElementById('assert-textarea').value = req.assert || '';
  document.getElementById('docs-textarea').value = req.docs || '';
  document.getElementById('auth-type').value = req.auth?.type || 'none';
  document.getElementById('file-info').textContent = `${req.filename}.json`;
}

function clearRequestUI() {
  document.getElementById('request-url').value = '';
  document.getElementById('body-textarea').value = '';
  document.getElementById('script-textarea').value = '';
  document.getElementById('assert-textarea').value = '';
  document.getElementById('docs-textarea').value = '';
}

function saveCurrentRequest() {
  if (!bruno.currentRequestFile || !bruno.isOpen()) return;
  const req = bruno.requests[bruno.currentRequestFile];
  if (!req) return;

  req.method = document.getElementById('request-method').value;
  req.url = document.getElementById('request-url').value;
  req.body = document.getElementById('body-textarea').value;
  req.script = document.getElementById('script-textarea').value;
  req.assert = document.getElementById('assert-textarea').value;
  req.docs = document.getElementById('docs-textarea').value;
  req.auth = { type: document.getElementById('auth-type').value };

  saveRequest(bruno.currentRequestFile, req);
}

// ============================================================================
// UI RENDERING
// ============================================================================
function renderRequests() {
  console.log('renderRequests');
  const list = document.getElementById('requests-list');
  if (!bruno.isOpen()) {
    list.innerHTML = '<div class="empty-state">No collection open</div>';
    return;
  }

  const requests = Object.values(bruno.requests);
  if (requests.length === 0) {
    list.innerHTML = '<div class="empty-state">No requests</div>';
    return;
  }

  list.innerHTML = '';
  requests.forEach(req => {
    const el = document.createElement('div');
    el.className = 'req-item' + (bruno.currentRequestFile === req.filename ? ' active' : '');
    el.style.display = 'flex';
    el.style.justifyContent = 'space-between';
    el.style.alignItems = 'center';

    const nameSpan = document.createElement('span');
    nameSpan.style.flex = '1';
    nameSpan.style.cursor = 'pointer';
    nameSpan.innerHTML = `<span style="color: var(--accent); font-weight: 500; font-size: 11px;">${req.method}</span> ${req.name}`;
    nameSpan.addEventListener('click', () => openRequest(req.filename));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon';
    delBtn.style.width = '18px';
    delBtn.style.height = '18px';
    delBtn.style.fontSize = '12px';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteRequest(req.filename);
    });

    el.appendChild(nameSpan);
    el.appendChild(delBtn);
    list.appendChild(el);
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('='.repeat(50));
  console.log('🚀 Bruno initializing...');
  console.log('='.repeat(50));

  // Get all buttons
  const newReqBtn = document.getElementById('new-request-btn');
  const openColBtn = document.getElementById('open-collection-btn');
  const closeBtn = document.getElementById('bruno-close-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalCreateBtn = document.getElementById('modal-create-btn');
  const sendBtn = document.getElementById('send-btn');
  const tabs = document.querySelectorAll('.req-tab');

  console.log('Button check:', {
    newReqBtn: !!newReqBtn,
    openColBtn: !!openColBtn,
    closeBtn: !!closeBtn,
    modalCancelBtn: !!modalCancelBtn,
    modalCreateBtn: !!modalCreateBtn,
    sendBtn: !!sendBtn,
    tabsCount: tabs.length
  });

  // Attach listeners
  newReqBtn?.addEventListener('click', () => {
    console.log('✓ new-request-btn clicked');
    if (!bruno.isOpen()) {
      alert('Please open a collection first');
      return;
    }
    showModal('modal-new-request');
  });

  openColBtn?.addEventListener('click', () => {
    console.log('✓ open-collection-btn clicked');
    openCollection();
  });

  closeBtn?.addEventListener('click', () => {
    console.log('✓ bruno-close-btn clicked');
    window.bruno.close();
  });

  modalCancelBtn?.addEventListener('click', () => {
    console.log('✓ modal-cancel-btn clicked');
    closeModals();
  });

  modalCreateBtn?.addEventListener('click', () => {
    console.log('✓ modal-create-btn clicked');
    createRequest();
  });

  sendBtn?.addEventListener('click', async () => {
    console.log('✓ send-btn clicked');
    saveCurrentRequest();

    const method = document.getElementById('request-method').value;
    let url = document.getElementById('request-url').value;
    const body = document.getElementById('body-textarea').value;

    console.log('Send request:', { method, url, bodyLength: body.length });

    if (!url) {
      alert('Please enter URL');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      const options = { method, headers: {} };

      if (body && method !== 'GET' && method !== 'HEAD') {
        options.body = body;
        options.headers['Content-Type'] = 'application/json';
      }

      document.getElementById('response-status').textContent = 'Loading...';
      document.getElementById('response-body').textContent = 'Sending request...';

      console.log('Fetching:', url);
      const response = await fetch(url, options);
      const responseBody = await response.text();

      console.log('✓ Response:', response.status);
      document.getElementById('response-status').textContent = `${response.status} ${response.statusText}`;
      document.getElementById('response-body').textContent = responseBody || '(empty response)';
    } catch (error) {
      console.error('❌ Fetch error:', error);
      document.getElementById('response-body').textContent = 'Error: ' + error.message;
      document.getElementById('response-status').textContent = 'Error';
    }
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = e.target.getAttribute('data-tab');
      console.log('✓ Tab clicked:', tabName);
      saveCurrentRequest();
      document.querySelectorAll('.req-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(`${tabName}-pane`).classList.add('active');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      console.log('✓ Escape pressed');
      window.bruno.close();
    }
  });

  console.log('✅ All event listeners attached!');
  console.log('='.repeat(50));
});

console.log('✅ bruno.js script executed');
