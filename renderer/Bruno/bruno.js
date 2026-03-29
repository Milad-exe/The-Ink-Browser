document.addEventListener('DOMContentLoaded', () => {
  // ============================================================================
  // DOM Elements
  // ============================================================================
  const openCollectionBtn = document.getElementById('open-collection-btn');
  const newRequestBtn = document.getElementById('new-request-btn');
  const brunoCloseBtn = document.getElementById('bruno-close-btn');
  const modal = document.getElementById('modal-new-request');
  const modalCancel = document.getElementById('modal-cancel');
  const modalCreate = document.getElementById('modal-create');
  const requestNameInput = document.getElementById('request-name-input');
  const sendBtn = document.getElementById('send-btn');
  const reqTabs = document.querySelectorAll('.req-tab');

  // ============================================================================
  // State
  // ============================================================================
  let collectionPath = null;
  let currentRequestFile = null;

  // ============================================================================
  // Event Listeners
  // ============================================================================

  openCollectionBtn.addEventListener('click', async () => {
    const path = await window.bruno.selectDirectory();
    if (path) {
      collectionPath = path;
      document.getElementById('collection-title').textContent = path.split(/[\/\\]/).pop();
      // TODO: Load requests from collection via IPC
    }
  });

  newRequestBtn.addEventListener('click', () => {
    if (!collectionPath) {
      alert('Please open a collection first');
      return;
    }
    modal.classList.remove('hidden');
    requestNameInput.focus();
  });

  modalCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
    requestNameInput.value = '';
  });

  modalCreate.addEventListener('click', async () => {
    const name = requestNameInput.value.trim();
    if (!name) {
      alert('Enter request name');
      return;
    }
    // TODO: Create request via IPC
    modal.classList.add('hidden');
    requestNameInput.value = '';
  });

  brunoCloseBtn.addEventListener('click', () => {
    window.bruno.close();
  });

  reqTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      // Save current request
      // TODO: Save via IPC

      // Switch tab
      reqTabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      const tabName = e.target.getAttribute('data-tab');
      document.getElementById(`${tabName}-pane`).classList.add('active');
    });
  });

  sendBtn.addEventListener('click', async () => {
    const method = document.getElementById('request-method').value;
    let url = document.getElementById('request-url').value;
    const body = document.getElementById('body-textarea').value;

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

      const response = await fetch(url, options);
      const responseBody = await response.text();

      document.getElementById('response-status').textContent = `${response.status} ${response.statusText}`;
      document.getElementById('response-body').textContent = responseBody || '(empty response)';
    } catch (error) {
      document.getElementById('response-body').textContent = 'Error: ' + error.message;
      document.getElementById('response-status').textContent = 'Error';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.bruno.close();
    }
  });

  console.log('✅ Bruno event listeners attached');
});
