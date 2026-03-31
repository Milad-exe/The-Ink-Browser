document.addEventListener('DOMContentLoaded', async () => {

  // ============================================================================
  // State
  // ============================================================================
  // collections: [{ path, name, requests: [...], envs: [...], activeEnvPath, envVariables }]
  let collections = [];
  let currentCollectionPath = null; // which collection the active request belongs to
  let currentRequest = null;        // full request object in the editor
  let editingEnvCollectionPath = null; // collection path the env modal is scoped to
  let editingEnvPath = null;

  // ============================================================================
  // Utilities
  // ============================================================================
  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getActiveEnvVars() {
    const col = collections.find(c => c.path === currentCollectionPath);
    return col?.envVariables || {};
  }

  function substituteVars(str) {
    const vars = getActiveEnvVars();
    return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : `{{${k}}}`
    );
  }

  // ============================================================================
  // Persist / restore state
  // ============================================================================
  async function saveState() {
    const state = {
      collections: collections.map(c => ({
        path: c.path,
        name: c.name,
        activeEnvPath: c.activeEnvPath || null,
        openFolders: c.openFolders || [],
      })),
      currentCollectionPath,
      currentRequestFilename: currentRequest?.filename || null,
      currentRequestCollectionPath: currentRequest ? currentCollectionPath : null,
    };
    try { await window.bruno.saveState(state); } catch {}
  }

  async function restoreState() {
    try {
      const state = await window.bruno.loadState();
      if (!state || !Array.isArray(state.collections)) return;

      for (const saved of state.collections) {
        if (!saved.path) continue;
        try {
          const col = await loadCollection(saved.path, false);
          if (col) {
            col.openFolders = saved.openFolders || [];
            if (saved.activeEnvPath) {
              await selectEnvironmentForCollection(col, saved.activeEnvPath, false);
            }
          }
        } catch {}
      }

      renderTree();
      renderEnvSelector();

      if (state.currentRequestFilename && state.currentRequestCollectionPath) {
        const col = collections.find(c => c.path === state.currentRequestCollectionPath);
        if (col) {
          const req = col.requests.find(r => r.filename === state.currentRequestFilename);
          if (req) {
            currentCollectionPath = col.path;
            await selectRequest(req.filename, col.path);
            return;
          }
        }
      }
      showNoRequestState();
    } catch {}
  }

  // ============================================================================
  // KV editor helpers
  // ============================================================================
  function addKVRow(containerId, key = '', value = '') {
    const rows = document.querySelector(`#${containerId} .kv-rows`);
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="checkbox" class="kv-check" checked>
      <input type="text" class="kv-key" placeholder="Key" value="${escapeHtml(key)}">
      <input type="text" class="kv-value" placeholder="Value" value="${escapeHtml(value)}">
      <button class="kv-del">×</button>`;
    row.querySelector('.kv-del').addEventListener('click', () => row.remove());
    rows.appendChild(row);
  }

  function setKVData(containerId, data) {
    const rows = document.querySelector(`#${containerId} .kv-rows`);
    rows.innerHTML = '';
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([k, v]) => addKVRow(containerId, k, String(v)));
    }
    if (!rows.children.length) addKVRow(containerId);
  }

  function getKVData(containerId) {
    const result = {};
    document.querySelectorAll(`#${containerId} .kv-row`).forEach(row => {
      if (!row.querySelector('.kv-check').checked) return;
      const k = row.querySelector('.kv-key').value.trim();
      const v = row.querySelector('.kv-value').value;
      if (k) result[k] = v;
    });
    return result;
  }

  ['params-editor', 'headers-editor'].forEach(id => {
    document.querySelector(`#${id} .kv-add-btn`).addEventListener('click', () => addKVRow(id));
    addKVRow(id);
  });

  // ============================================================================
  // Auth
  // ============================================================================
  const AUTH_FIELD_IDS = ['bearer', 'basic', 'apikey', 'oauth2', 'digest'];
  function updateAuthFields(type) {
    AUTH_FIELD_IDS.forEach(t =>
      document.getElementById(`auth-${t}-fields`).classList.toggle('hidden', type !== t)
    );
  }
  document.getElementById('auth-type').addEventListener('change', e => updateAuthFields(e.target.value));

  // ============================================================================
  // Load a collection into memory
  // ============================================================================
  async function loadCollection(dirPath, renderAfter = true) {
    // Avoid duplicates
    if (collections.find(c => c.path === dirPath)) {
      if (renderAfter) renderTree();
      return collections.find(c => c.path === dirPath);
    }

    const info = await window.bruno.initCollection(dirPath);
    const col = {
      path: dirPath,
      name: info?.name || dirPath.split(/[/\\]/).pop(),
      requests: [],
      envs: [],
      activeEnvPath: null,
      envVariables: {},
      openFolders: [],
    };

    // Load requests
    try {
      const list = await window.bruno.listRequests(dirPath);
      col.requests = await Promise.all(list.map(async r => {
        try {
          const data = await window.bruno.loadRequest(r.path);
          return { filename: r.filename, folder: r.folder || null, path: r.path, name: data?.name || r.filename, method: data?.method || 'GET' };
        } catch {
          return { filename: r.filename, folder: r.folder || null, path: r.path, name: r.filename, method: 'GET' };
        }
      }));
    } catch {}

    // Load envs
    try { col.envs = await window.bruno.listEnvironments(dirPath); } catch {}

    collections.push(col);
    if (renderAfter) { renderTree(); renderEnvSelector(); }
    return col;
  }

  // ============================================================================
  // Sidebar tree
  // ============================================================================
  function buildTree(requests) {
    const root = { folders: {}, requests: [] };
    requests.forEach(req => {
      if (!req.folder) { root.requests.push(req); return; }
      const parts = req.folder.split('/');
      let node = root;
      parts.forEach(p => {
        if (!node.folders[p]) node.folders[p] = { folders: {}, requests: [] };
        node = node.folders[p];
      });
      node.requests.push(req);
    });
    return root;
  }

  function renderTree() {
    const container = document.getElementById('collections-tree');
    container.innerHTML = '';
    if (!collections.length) {
      container.innerHTML = '<div class="empty-state">Open or create a collection to get started</div>';
      return;
    }

    collections.forEach(col => {
      // Collection header row
      const header = document.createElement('div');
      header.className = 'collection-header';
      header.innerHTML = `
        <span class="col-arrow">▾</span>
        <span class="col-name">${escapeHtml(col.name)}</span>
        <button class="btn-icon col-add-req" title="New request" data-col="${escapeHtml(col.path)}">+</button>`;
      container.appendChild(header);

      const body = document.createElement('div');
      body.className = 'collection-body';

      const tree = buildTree(col.requests);
      renderTreeNode(tree, body, col, 0);
      container.appendChild(body);

      // Toggle expand / collapse
      let expanded = true;
      header.querySelector('.col-arrow').addEventListener('click', () => {
        expanded = !expanded;
        header.querySelector('.col-arrow').textContent = expanded ? '▾' : '▸';
        body.classList.toggle('hidden', !expanded);
      });

      // Add request button on collection header
      header.querySelector('.col-add-req').addEventListener('click', e => {
        e.stopPropagation();
        openNewRequestModal(col.path);
      });
    });
  }

  function renderTreeNode(node, container, col, depth) {
    const indent = depth * 14;
    Object.keys(node.folders).sort().forEach(name => {
      const folderKey = col.path + '|' + name;
      const isOpen = col.openFolders?.includes(folderKey);

      const folderRow = document.createElement('div');
      folderRow.className = 'folder-item';
      folderRow.style.paddingLeft = `${14 + indent}px`;
      folderRow.innerHTML = `<span class="folder-icon">${isOpen ? '▾' : '▸'}</span><span class="folder-name">${escapeHtml(name)}</span>`;

      const childWrap = document.createElement('div');
      childWrap.className = 'folder-children' + (isOpen ? '' : ' hidden');
      renderTreeNode(node.folders[name], childWrap, col, depth + 1);

      folderRow.addEventListener('click', () => {
        const nowOpen = childWrap.classList.contains('hidden');
        childWrap.classList.toggle('hidden', !nowOpen);
        folderRow.querySelector('.folder-icon').textContent = nowOpen ? '▾' : '▸';
        if (!col.openFolders) col.openFolders = [];
        if (nowOpen) col.openFolders.push(folderKey);
        else col.openFolders = col.openFolders.filter(k => k !== folderKey);
        saveState();
      });

      container.appendChild(folderRow);
      container.appendChild(childWrap);
    });

    node.requests.forEach(req => {
      const item = document.createElement('div');
      const isActive = currentRequest?.filename === req.filename && currentCollectionPath === col.path;
      item.className = 'req-item' + (isActive ? ' active' : '');
      item.style.paddingLeft = `${14 + indent}px`;
      const m = req.method || 'GET';
      item.innerHTML = `<span class="req-method method-${m.toLowerCase()}">${m}</span><span class="req-name">${escapeHtml(req.name || req.filename)}</span>`;
      item.addEventListener('click', () => {
        currentCollectionPath = col.path;
        selectRequest(req.filename, col.path);
      });
      container.appendChild(item);
    });
  }

  // ============================================================================
  // Editor show/hide
  // ============================================================================
  function showNoRequestState() {
    document.getElementById('no-request-state').style.display = 'flex';
    document.getElementById('request-editor').classList.add('hidden');
  }

  function showEditor() {
    document.getElementById('no-request-state').style.display = 'none';
    document.getElementById('request-editor').classList.remove('hidden');
  }

  // ============================================================================
  // Select + load a request into the editor
  // ============================================================================
  async function selectRequest(filename, colPath) {
    const col = collections.find(c => c.path === colPath);
    if (!col) return;
    const req = col.requests.find(r => r.filename === filename);
    if (!req) return;

    if (currentRequest?.filename !== filename || currentCollectionPath !== colPath) {
      await saveCurrentRequest();
    }

    try {
      const data = await window.bruno.loadRequest(req.path);
      if (!data) return;
      currentRequest = { ...data, filename: req.filename, path: req.path };
      currentCollectionPath = colPath;

      document.getElementById('request-method').value = data.method || 'GET';
      document.getElementById('request-url').value = data.url || '';
      document.getElementById('body-textarea').value = data.body || '';
      document.getElementById('script-textarea').value = data.script || '';
      document.getElementById('assert-textarea').value = data.assert || '';
      document.getElementById('docs-textarea').value = data.docs || '';
      setKVData('params-editor', data.params || {});
      setKVData('headers-editor', data.headers || {});

      const authType = data.auth?.type || 'none';
      document.getElementById('auth-type').value = authType;
      updateAuthFields(authType);
      // Bearer
      document.getElementById('auth-token').value = data.auth?.token || '';
      // Basic
      document.getElementById('auth-username').value = data.auth?.username || '';
      document.getElementById('auth-password').value = data.auth?.password || '';
      // API Key
      document.getElementById('auth-apikey-key').value   = data.auth?.key || '';
      document.getElementById('auth-apikey-value').value = data.auth?.value || '';
      document.getElementById('auth-apikey-in').value    = data.auth?.in || 'header';
      // OAuth2
      document.getElementById('auth-oauth2-grant').value        = data.auth?.grantType || 'client_credentials';
      document.getElementById('auth-oauth2-tokenurl').value     = data.auth?.tokenUrl || '';
      document.getElementById('auth-oauth2-clientid').value     = data.auth?.clientId || '';
      document.getElementById('auth-oauth2-clientsecret').value = data.auth?.clientSecret || '';
      document.getElementById('auth-oauth2-scope').value        = data.auth?.scope || '';
      // Digest
      document.getElementById('auth-digest-username').value = data.auth?.username || '';
      document.getElementById('auth-digest-password').value = data.auth?.password || '';

      document.getElementById('request-breadcrumb').textContent =
        `${col.name}${req.folder ? ' / ' + req.folder.split('/').join(' / ') : ''} / ${req.name || req.filename}`;

      showEditor();
      renderEnvSelector();
      renderTree(); // update active highlight
      await saveState();
    } catch (err) {
      console.error('Error loading request:', err);
    }
  }

  // ============================================================================
  // Collect + save
  // ============================================================================
  function collectRequestData() {
    const authType = document.getElementById('auth-type').value;
    const auth = { type: authType };
    if (authType === 'bearer') {
      auth.token = document.getElementById('auth-token').value;
    } else if (authType === 'basic') {
      auth.username = document.getElementById('auth-username').value;
      auth.password = document.getElementById('auth-password').value;
    } else if (authType === 'apikey') {
      auth.key   = document.getElementById('auth-apikey-key').value;
      auth.value = document.getElementById('auth-apikey-value').value;
      auth.in    = document.getElementById('auth-apikey-in').value;
    } else if (authType === 'oauth2') {
      auth.grantType    = document.getElementById('auth-oauth2-grant').value;
      auth.tokenUrl     = document.getElementById('auth-oauth2-tokenurl').value;
      auth.clientId     = document.getElementById('auth-oauth2-clientid').value;
      auth.clientSecret = document.getElementById('auth-oauth2-clientsecret').value;
      auth.scope        = document.getElementById('auth-oauth2-scope').value;
    } else if (authType === 'digest') {
      auth.username = document.getElementById('auth-digest-username').value;
      auth.password = document.getElementById('auth-digest-password').value;
    }
    return {
      ...currentRequest,
      method: document.getElementById('request-method').value,
      url: document.getElementById('request-url').value,
      params: getKVData('params-editor'),
      headers: getKVData('headers-editor'),
      body: document.getElementById('body-textarea').value,
      auth,
      script: document.getElementById('script-textarea').value,
      assert: document.getElementById('assert-textarea').value,
      docs: document.getElementById('docs-textarea').value,
    };
  }

  async function saveCurrentRequest() {
    if (!currentRequest || !currentCollectionPath) return;
    try {
      const data = collectRequestData();
      await window.bruno.saveRequest(currentCollectionPath, currentRequest.filename, data);
      currentRequest = data;
      // Update in-memory record so sidebar reflects updated method immediately
      const col = collections.find(c => c.path === currentCollectionPath);
      if (col) {
        const idx = col.requests.findIndex(r => r.filename === currentRequest.filename);
        if (idx !== -1) {
          col.requests[idx].method = data.method;
          col.requests[idx].name = data.name;
        }
      }
      renderTree(); // reflect updated method badge immediately
    } catch (err) {
      console.error('Error saving request:', err);
    }
  }

  // Live-update method badge when select changes (no need to save)
  document.getElementById('request-method').addEventListener('change', () => {
    if (!currentRequest || !currentCollectionPath) return;
    const col = collections.find(c => c.path === currentCollectionPath);
    if (!col) return;
    const idx = col.requests.findIndex(r => r.filename === currentRequest.filename);
    if (idx !== -1) col.requests[idx].method = document.getElementById('request-method').value;
    renderTree();
  });

  // ============================================================================
  // Toolbar buttons
  // ============================================================================
  document.getElementById('open-collection-btn').addEventListener('click', async () => {
    const dir = await window.bruno.openCollection();
    if (!dir) return;
    const col = await loadCollection(dir, true);
    if (!col) return;

    // Restore saved active env
    const savedEnvName = await window.bruno.getActiveEnvironment(dir);
    if (savedEnvName) {
      const env = col.envs.find(e => e.name === savedEnvName);
      if (env) await selectEnvironmentForCollection(col, env.path, false);
    }
    renderEnvSelector();
    saveState();
  });

  document.getElementById('new-collection-btn').addEventListener('click', async () => {
    const info = await window.bruno.createCollection();
    if (!info || !info.path) return;
    await loadCollection(info.path, true);
    renderEnvSelector();
    saveState();
  });

  document.getElementById('bruno-close-btn').addEventListener('click', async () => {
    await saveCurrentRequest();
    await saveState();
    window.bruno.close();
  });

  // ============================================================================
  // New Request modal
  // ============================================================================
  function openNewRequestModal(colPath) {
    document.getElementById('modal-new-request').classList.remove('hidden');
    document.getElementById('request-name-input').focus();
    document.getElementById('modal-new-request').dataset.colPath = colPath;
  }

  document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-new-request').classList.add('hidden');
    document.getElementById('request-name-input').value = '';
  });

  document.getElementById('modal-create').addEventListener('click', async () => {
    const name = document.getElementById('request-name-input').value.trim();
    if (!name) { alert('Enter a name'); return; }
    const colPath = document.getElementById('modal-new-request').dataset.colPath;
    if (!colPath) return;
    const col = collections.find(c => c.path === colPath);
    if (!col) return;

    try {
      const newReq = await window.bruno.createRequest(colPath, name);
      await window.bruno.saveRequest(colPath, newReq.filename, newReq);
      col.requests.push({
        filename: newReq.filename,
        folder: null,
        path: colPath + '/' + newReq.filename + '.json',
        name,
        method: 'GET'
      });
      document.getElementById('modal-new-request').classList.add('hidden');
      document.getElementById('request-name-input').value = '';
      currentCollectionPath = colPath;
      renderTree();
      await selectRequest(newReq.filename, colPath);
    } catch (err) {
      console.error('Error creating request:', err);
    }
  });

  // ============================================================================
  // Request editor tabs
  // ============================================================================
  document.querySelectorAll('.req-tab').forEach(tab => {
    tab.addEventListener('click', e => {
      document.querySelectorAll('.req-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(`${e.target.dataset.tab}-pane`).classList.add('active');
    });
  });

  document.querySelectorAll('.res-tab').forEach(tab => {
    tab.addEventListener('click', e => {
      document.querySelectorAll('.res-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.res-pane').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(`res-${e.target.dataset.tab}-pane`).classList.add('active');
    });
  });

  // ============================================================================
  // Send Request
  // ============================================================================
  document.getElementById('send-btn').addEventListener('click', async () => {
    let url = document.getElementById('request-url').value.trim();
    const method = document.getElementById('request-method').value;
    const body = document.getElementById('body-textarea').value;
    const params = getKVData('params-editor');
    const headers = getKVData('headers-editor');

    if (!url) { alert('Enter a URL'); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    url = substituteVars(url);

    if (Object.keys(params).length) {
      try {
        const u = new URL(url);
        Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, substituteVars(v)));
        url = u.toString();
      } catch {}
    }

    const fetchHeaders = {};
    Object.entries(headers).forEach(([k, v]) => { fetchHeaders[k] = substituteVars(v); });

    const authType = document.getElementById('auth-type').value;
    if (authType === 'bearer') {
      const token = substituteVars(document.getElementById('auth-token').value);
      if (token) fetchHeaders['Authorization'] = `Bearer ${token}`;
    } else if (authType === 'basic') {
      const u = document.getElementById('auth-username').value;
      const p = document.getElementById('auth-password').value;
      if (u) fetchHeaders['Authorization'] = 'Basic ' + btoa(`${u}:${p}`);
    } else if (authType === 'apikey') {
      const k = substituteVars(document.getElementById('auth-apikey-key').value);
      const v = substituteVars(document.getElementById('auth-apikey-value').value);
      if (k) {
        if (document.getElementById('auth-apikey-in').value === 'query') {
          try {
            const u = new URL(url);
            u.searchParams.set(k, v);
            url = u.toString();
          } catch {}
        } else {
          fetchHeaders[k] = v;
        }
      }
    } else if (authType === 'digest') {
      // Digest auth requires a challenge/response cycle; mark the header so
      // the user is aware — full Digest is not feasible in a plain fetch context.
      const u = document.getElementById('auth-digest-username').value;
      const p = document.getElementById('auth-digest-password').value;
      if (u) fetchHeaders['X-Digest-Username'] = u;
      if (p) fetchHeaders['X-Digest-Password'] = p;
    }
    // OAuth2: token must be fetched first (not handled inline — user pastes access token into Bearer instead)

    const options = { method, headers: fetchHeaders };
    if (body && method !== 'GET' && method !== 'HEAD') {
      options.body = substituteVars(body);
      if (!fetchHeaders['Content-Type']) fetchHeaders['Content-Type'] = 'application/json';
    }

    const statusEl = document.getElementById('response-status');
    const bodyEl = document.getElementById('res-body-pane');
    const headersEl = document.getElementById('res-headers-pane');
    statusEl.textContent = 'Sending…';
    statusEl.className = 'response-status';
    bodyEl.textContent = '';
    headersEl.innerHTML = '';

    const t0 = Date.now();
    try {
      const res = await fetch(url, options);
      const elapsed = Date.now() - t0;
      const text = await res.text();
      statusEl.textContent = `${res.status} ${res.statusText}  •  ${elapsed}ms`;
      statusEl.className = 'response-status ' + (res.ok ? 'status-ok' : 'status-err');
      let display = text;
      try { display = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      bodyEl.textContent = display || '(empty response)';
      res.headers.forEach((val, key) => {
        const row = document.createElement('div');
        row.className = 'res-header-row';
        row.innerHTML = `<span class="res-hk">${escapeHtml(key)}</span><span class="res-hv">${escapeHtml(val)}</span>`;
        headersEl.appendChild(row);
      });
    } catch (err) {
      statusEl.textContent = 'Error';
      statusEl.className = 'response-status status-err';
      bodyEl.textContent = 'Error: ' + err.message;
    }
  });

  document.getElementById('save-btn').addEventListener('click', saveCurrentRequest);

  // ============================================================================
  // ENVIRONMENTS
  // ============================================================================

  // The env selector shows envs for the active collection (the one that owns currentRequest)
  function renderEnvSelector() {
    const sel = document.getElementById('env-select');
    sel.innerHTML = '<option value="">No Environment</option>';

    const col = collections.find(c => c.path === currentCollectionPath);
    if (!col) return;

    col.envs.forEach(env => {
      const opt = document.createElement('option');
      opt.value = env.path;
      opt.textContent = env.name;
      if (env.path === col.activeEnvPath) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!col.activeEnvPath) sel.value = '';
  }

  async function selectEnvironmentForCollection(col, envPath, persist = true) {
    col.activeEnvPath = envPath || null;
    if (envPath) {
      try { col.envVariables = await window.bruno.loadEnvironment(envPath); }
      catch { col.envVariables = {}; }
    } else {
      col.envVariables = {};
    }
    if (persist) {
      const envName = col.envs.find(e => e.path === envPath)?.name || null;
      await window.bruno.setActiveEnvironment(col.path, envName);
    }
  }

  document.getElementById('env-select').addEventListener('change', async e => {
    const col = collections.find(c => c.path === currentCollectionPath);
    if (!col) return;
    await selectEnvironmentForCollection(col, e.target.value || null);
    await saveState();
  });

  // ============================================================================
  // Environment modal
  // ============================================================================
  document.getElementById('env-manage-btn').addEventListener('click', openEnvModal);
  document.getElementById('env-modal-close').addEventListener('click', closeEnvModal);
  document.getElementById('env-modal-cancel').addEventListener('click', closeEnvModal);

  async function openEnvModal() {
    const col = collections.find(c => c.path === currentCollectionPath);
    if (!col) { alert('Select a request first to manage its collection environments'); return; }
    editingEnvCollectionPath = col.path;
    editingEnvPath = null;

    // Refresh env list
    try { col.envs = await window.bruno.listEnvironments(col.path); } catch {}

    renderEnvModalList(col);
    document.getElementById('env-no-selection').style.display = 'flex';
    const ea = document.getElementById('env-editor-area');
    ea.classList.add('hidden'); ea.style.display = 'none';
    document.getElementById('env-save-btn').style.display = 'none';
    document.getElementById('env-delete-btn').style.display = 'none';
    document.getElementById('modal-env').classList.remove('hidden');
  }

  function closeEnvModal() {
    document.getElementById('modal-env').classList.add('hidden');
    editingEnvPath = null;
    editingEnvCollectionPath = null;
  }

  function renderEnvModalList(col) {
    const list = document.getElementById('env-sidebar-list');
    list.innerHTML = '';
    if (!col.envs.length) {
      list.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--on-surface-variant);">No environments yet</div>';
      return;
    }
    col.envs.forEach(env => {
      const item = document.createElement('div');
      item.className = 'env-list-item' + (env.path === editingEnvPath ? ' active' : '');
      item.textContent = env.name;
      item.addEventListener('click', () => loadEnvForEditing(env.path));
      list.appendChild(item);
    });
  }

  async function loadEnvForEditing(envPath) {
    editingEnvPath = envPath;
    const col = collections.find(c => c.path === editingEnvCollectionPath);
    if (col) renderEnvModalList(col);
    try {
      const data = await window.bruno.loadEnvironmentFull(envPath);
      renderEnvVars(data?.variables || []);
    } catch { renderEnvVars([]); }

    document.getElementById('env-no-selection').style.display = 'none';
    const ea = document.getElementById('env-editor-area');
    ea.classList.remove('hidden'); ea.style.display = 'flex';
    document.getElementById('env-save-btn').style.display = '';
    document.getElementById('env-delete-btn').style.display = '';
  }

  function renderEnvVars(variables) {
    const rows = document.querySelector('#env-vars-editor .kv-rows');
    rows.innerHTML = '';
    variables.forEach(v => addEnvVarRow(v.name, v.value, v.enabled !== false, v.secret === true));
    if (!variables.length) addEnvVarRow();
  }

  function addEnvVarRow(name = '', value = '', enabled = true, secret = false) {
    const rows = document.querySelector('#env-vars-editor .kv-rows');
    const row = document.createElement('div');
    row.className = 'kv-row env-var-row';
    row.innerHTML = `
      <input type="checkbox" class="kv-check" ${enabled ? 'checked' : ''}>
      <input type="text" class="kv-key" placeholder="Variable name" value="${escapeHtml(name)}">
      <input type="${secret ? 'password' : 'text'}" class="kv-value env-val" placeholder="Value" value="${escapeHtml(value)}">
      <button class="env-secret-toggle ${secret ? 'active' : ''}" title="Toggle secret">🔒</button>
      <button class="kv-del">×</button>`;
    const secretBtn = row.querySelector('.env-secret-toggle');
    const valInput = row.querySelector('.env-val');
    secretBtn.addEventListener('click', () => {
      const isSec = valInput.type === 'password';
      valInput.type = isSec ? 'text' : 'password';
      secretBtn.classList.toggle('active', !isSec);
    });
    row.querySelector('.kv-del').addEventListener('click', () => row.remove());
    rows.appendChild(row);
  }

  document.getElementById('env-add-var-btn').addEventListener('click', () => addEnvVarRow());

  document.getElementById('env-add-btn').addEventListener('click', async () => {
    const name = prompt('Environment name:');
    if (!name?.trim()) return;
    const col = collections.find(c => c.path === editingEnvCollectionPath);
    if (!col) return;
    try {
      const created = await window.bruno.createEnvironment(col.path, name.trim());
      col.envs = await window.bruno.listEnvironments(col.path);
      renderEnvModalList(col);
      await loadEnvForEditing(created.path);
      renderEnvSelector();
    } catch (err) { alert('Error: ' + err.message); }
  });

  document.getElementById('env-save-btn').addEventListener('click', async () => {
    if (!editingEnvPath) return;
    const variables = [];
    document.querySelectorAll('#env-vars-editor .env-var-row').forEach(row => {
      const name = row.querySelector('.kv-key').value.trim();
      if (!name) return;
      variables.push({
        name,
        value: row.querySelector('.env-val').value,
        enabled: row.querySelector('.kv-check').checked,
        secret: row.querySelector('.env-val').type === 'password'
      });
    });
    try {
      await window.bruno.saveEnvironment(editingEnvPath, variables);
      const col = collections.find(c => c.path === editingEnvCollectionPath);
      if (col && col.activeEnvPath === editingEnvPath) {
        col.envVariables = await window.bruno.loadEnvironment(editingEnvPath);
      }
    } catch (err) { alert('Error: ' + err.message); }
  });

  document.getElementById('env-delete-btn').addEventListener('click', async () => {
    if (!editingEnvPath) return;
    const col = collections.find(c => c.path === editingEnvCollectionPath);
    const env = col?.envs.find(e => e.path === editingEnvPath);
    if (!confirm(`Delete environment "${env?.name}"?`)) return;
    try {
      await window.bruno.deleteEnvironment(editingEnvPath);
      if (col) {
        if (col.activeEnvPath === editingEnvPath) {
          col.activeEnvPath = null; col.envVariables = {};
          await window.bruno.setActiveEnvironment(col.path, null);
        }
        col.envs = await window.bruno.listEnvironments(col.path);
      }
      editingEnvPath = null;
      if (col) renderEnvModalList(col);
      document.getElementById('env-no-selection').style.display = 'flex';
      const ea = document.getElementById('env-editor-area');
      ea.classList.add('hidden'); ea.style.display = 'none';
      document.getElementById('env-save-btn').style.display = 'none';
      document.getElementById('env-delete-btn').style.display = 'none';
      renderEnvSelector();
    } catch (err) { alert('Error: ' + err.message); }
  });

  // ============================================================================
  // Resize divider
  // ============================================================================
  const handle = document.getElementById('resize-handle');
  let resizing = false;

  handle.addEventListener('mousedown', async e => {
    resizing = true;
    handle.classList.add('dragging');
    await window.bruno.resizeStart(e.screenX);
    e.preventDefault();
  });

  document.addEventListener('mousemove', async e => {
    if (!resizing) return;
    await window.bruno.resizeMove(e.screenX);
  });

  document.addEventListener('mouseup', async () => {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove('dragging');
    await window.bruno.resizeEnd();
  });

  // ============================================================================
  // Keyboard shortcuts
  // ============================================================================
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('modal-new-request').classList.contains('hidden')) {
        document.getElementById('modal-new-request').classList.add('hidden');
        document.getElementById('request-name-input').value = '';
        return;
      }
      if (!document.getElementById('modal-env').classList.contains('hidden')) {
        closeEnvModal(); return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('send-btn').click();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentRequest();
    }
  });

  // ============================================================================
  // Boot — restore previous state
  // ============================================================================
  showNoRequestState();
  await restoreState();

  console.log('✅ Bruno ready');
});
