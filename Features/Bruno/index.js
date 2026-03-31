// ============================================================================
// Bruno Feature - Main Index
// ============================================================================
const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const BrunoUI = require('./ui');
const RequestManager = require('./requests');
const EnvironmentManager = require('./environments');
const FileOps = require('./files');
const Collections = require('./collections');
const Git = require('./git');
const ExportImport = require('./export-import');

const STATE_FILE = path.join(app.getPath('userData'), 'bruno-state.json');

class Bruno {
  constructor() {
    this.ui = new BrunoUI();
    this.requests = new RequestManager();
    this.environments = new EnvironmentManager();
    this.files = FileOps;
    this.collections = Collections;
    this.git = Git;
    this.exportImport = ExportImport;
    this.setupIpcHandlers();
  }

  setupIpcHandlers() {
    // UI
    ipcMain.handle('bruno-open', this.handleBrunoOpen.bind(this));
    ipcMain.handle('bruno-close', this.handleBrunoClose.bind(this));

    // Resize divider
    ipcMain.handle('bruno-resize-start', (e, x) => this.ui.startResize(e, x));
    ipcMain.handle('bruno-resize-move',  (e, x) => this.ui.doResize(e, x));
    ipcMain.handle('bruno-resize-end',   (e)    => this.ui.endResize(e));

    // Directory
    ipcMain.handle('bruno-select-directory', this.handleSelectDirectory.bind(this));

    // File ops
    ipcMain.handle('bruno-save-collection-file', this.handleSaveFile.bind(this));
    ipcMain.handle('bruno-load-collection-file', this.handleLoadFile.bind(this));
    ipcMain.handle('bruno-delete-collection-file', this.handleDeleteFile.bind(this));

    // Requests
    ipcMain.handle('bruno-create-request', this.handleCreateRequest.bind(this));
    ipcMain.handle('bruno-list-requests',  this.handleListRequests.bind(this));
    ipcMain.handle('bruno-save-request',   this.handleSaveRequest.bind(this));
    ipcMain.handle('bruno-load-request',   this.handleLoadRequest.bind(this));
    ipcMain.handle('bruno-delete-request', this.handleDeleteRequest.bind(this));

    // Environments
    ipcMain.handle('bruno-create-environment',    this.handleCreateEnvironment.bind(this));
    ipcMain.handle('bruno-list-environments',     this.handleListEnvironments.bind(this));
    ipcMain.handle('bruno-load-environment',      this.handleLoadEnvironment.bind(this));
    ipcMain.handle('bruno-load-environment-full', this.handleLoadEnvironmentFull.bind(this));
    ipcMain.handle('bruno-save-environment',      this.handleSaveEnvironment.bind(this));
    ipcMain.handle('bruno-delete-environment',    this.handleDeleteEnvironment.bind(this));

    // Collections
    ipcMain.handle('bruno-list-collections',       this.handleListCollections.bind(this));
    ipcMain.handle('bruno-create-collection',      this.handleCreateCollection.bind(this));
    ipcMain.handle('bruno-init-collection',        this.handleInitCollection.bind(this));
    ipcMain.handle('bruno-get-active-environment', this.handleGetActiveEnvironment.bind(this));
    ipcMain.handle('bruno-set-active-environment', this.handleSetActiveEnvironment.bind(this));

    // State persistence
    ipcMain.handle('bruno-save-state', this.handleSaveState.bind(this));
    ipcMain.handle('bruno-load-state', this.handleLoadState.bind(this));

    // Git
    ipcMain.handle('bruno-git-init',        this.handleGitInit.bind(this));
    ipcMain.handle('bruno-is-git-repo',     this.handleIsGitRepo.bind(this));
    ipcMain.handle('bruno-git-status',      this.handleGitStatus.bind(this));
    ipcMain.handle('bruno-create-gitignore',this.handleCreateGitignore.bind(this));

    // Export/Import
    ipcMain.handle('bruno-export-collection', this.handleExportCollection.bind(this));
    ipcMain.handle('bruno-import-collection', this.handleImportCollection.bind(this));
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  async handleBrunoOpen(event)  { return this.ui.open(event); }
  async handleBrunoClose(event) { return this.ui.close(event); }

  // ── Directory ───────────────────────────────────────────────────────────────
  async handleSelectDirectory() {
    try {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    } catch (e) { console.error(e); return null; }
  }

  // ── File ops ─────────────────────────────────────────────────────────────────
  async handleSaveFile(event, filePath, data) {
    return this.files.saveCollectionFile(filePath, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
  async handleLoadFile(event, filePath) { return this.files.loadCollectionFile(filePath); }
  async handleDeleteFile(event, filePath) { return this.files.deleteCollectionFile(filePath); }

  // ── Requests ─────────────────────────────────────────────────────────────────
  async handleCreateRequest(event, collectionPath, name) {
    return this.requests.createRequest(collectionPath, name);
  }
  async handleListRequests(event, collectionPath) {
    return this.requests.listRequests(collectionPath);
  }
  async handleSaveRequest(event, collectionPath, filename, data) {
    return this.requests.saveRequest(collectionPath, filename, data);
  }
  async handleLoadRequest(event, filepath) {
    return this.requests.loadRequest(filepath);
  }
  async handleDeleteRequest(event, collectionPath, filename) {
    return this.requests.deleteRequest(collectionPath, filename);
  }

  // ── Environments ─────────────────────────────────────────────────────────────
  async handleCreateEnvironment(event, collectionPath, name) {
    return this.environments.createEnvironment(collectionPath, name);
  }
  async handleListEnvironments(event, collectionPath) {
    return this.environments.listEnvironments(collectionPath);
  }
  async handleLoadEnvironment(event, envPath) {
    return this.environments.loadEnvironment(envPath);
  }
  async handleLoadEnvironmentFull(event, envPath) {
    return this.environments.loadEnvironmentFull(envPath);
  }
  async handleSaveEnvironment(event, envPath, variables) {
    return this.environments.saveEnvironment(envPath, variables);
  }
  async handleDeleteEnvironment(event, envPath) {
    return this.environments.deleteEnvironment(envPath);
  }

  // ── Collections ──────────────────────────────────────────────────────────────
  // Open a folder-picker so user picks an EXISTING collection directory
  async handleListCollections(event) {
    try {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled) return null;
      return result.filePaths[0];
    } catch (e) { console.error(e); return null; }
  }

  // Create a NEW collection directory + bruno.json
  async handleCreateCollection(event) {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Select Folder'
      });
      if (result.canceled) return null;
      const dir = result.filePaths[0];
      return this.collections.initCollection(dir);
    } catch (e) { console.error(e); return null; }
  }

  async handleInitCollection(event, dirPath) {
    return this.collections.initCollection(dirPath);
  }
  async handleGetActiveEnvironment(event, dirPath) {
    return this.collections.getActiveEnvironment(dirPath);
  }
  async handleSetActiveEnvironment(event, dirPath, envName) {
    return this.collections.setActiveEnvironment(dirPath, envName);
  }

  // ── State persistence ────────────────────────────────────────────────────────
  async handleSaveState(event, state) {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
      return true;
    } catch (e) { console.error('bruno save-state error:', e); return false; }
  }

  async handleLoadState() {
    try {
      if (!fs.existsSync(STATE_FILE)) return null;
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch (e) { return null; }
  }

  // ── Git ──────────────────────────────────────────────────────────────────────
  async handleGitInit(event, dirPath)        { return this.git.gitInit(dirPath); }
  async handleIsGitRepo(event, dirPath)      { return this.git.isGitRepo(dirPath); }
  async handleGitStatus(event, dirPath)      { return this.git.gitStatus(dirPath); }
  async handleCreateGitignore(event, dirPath){ return this.git.createGitignore(dirPath); }

  // ── Export / Import ───────────────────────────────────────────────────────────
  async handleExportCollection(event, collectionPath) {
    return this.exportImport.exportCollection(collectionPath);
  }
  async handleImportCollection(event) {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled) return null;
      return this.files.loadCollectionFile(result.filePaths[0]);
    } catch (e) { console.error(e); return null; }
  }
}

module.exports = Bruno;
