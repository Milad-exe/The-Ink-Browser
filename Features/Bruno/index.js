// ============================================================================
// Bruno Feature - Main Index
// ============================================================================
const { ipcMain, dialog } = require('electron');
const BrunoUI = require('./ui');
const RequestManager = require('./requests');
const EnvironmentManager = require('./environments');
const FileOps = require('./files');
const Collections = require('./collections');
const Git = require('./git');
const ExportImport = require('./export-import');

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
    // UI Management
    ipcMain.handle('bruno-open', this.handleBrunoOpen.bind(this));
    ipcMain.handle('bruno-close', this.handleBrunoClose.bind(this));

    // Directory Selection
    ipcMain.handle('bruno-select-directory', this.handleSelectDirectory.bind(this));

    // File Operations
    ipcMain.handle('bruno-save-collection-file', this.handleSaveFile.bind(this));
    ipcMain.handle('bruno-load-collection-file', this.handleLoadFile.bind(this));
    ipcMain.handle('bruno-delete-collection-file', this.handleDeleteFile.bind(this));

    // Request Operations
    ipcMain.handle('bruno-create-request', this.handleCreateRequest.bind(this));
    ipcMain.handle('bruno-list-requests', this.handleListRequests.bind(this));

    // Environment Operations
    ipcMain.handle('bruno-create-environment', this.handleCreateEnvironment.bind(this));
    ipcMain.handle('bruno-list-environments', this.handleListEnvironments.bind(this));
    ipcMain.handle('bruno-load-environment', this.handleLoadEnvironment.bind(this));
    ipcMain.handle('bruno-save-environment', this.handleSaveEnvironment.bind(this));
    ipcMain.handle('bruno-delete-environment', this.handleDeleteEnvironment.bind(this));

    // Collection Operations
    ipcMain.handle('bruno-list-collections', this.handleListCollections.bind(this));

    // Git Operations
    ipcMain.handle('bruno-git-init', this.handleGitInit.bind(this));
    ipcMain.handle('bruno-is-git-repo', this.handleIsGitRepo.bind(this));
    ipcMain.handle('bruno-git-status', this.handleGitStatus.bind(this));
    ipcMain.handle('bruno-create-gitignore', this.handleCreateGitignore.bind(this));

    // Export/Import Operations
    ipcMain.handle('bruno-export-collection', this.handleExportCollection.bind(this));
    ipcMain.handle('bruno-import-collection', this.handleImportCollection.bind(this));
  }

  // UI Handlers
  async handleBrunoOpen(event) {
    return this.ui.open(event);
  }

  async handleBrunoClose(event) {
    return this.ui.close(event);
  }

  // Directory Selection
  async handleSelectDirectory() {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    } catch (error) {
      console.error('Error selecting directory:', error);
      return null;
    }
  }

  // File Operations
  async handleSaveFile(event, filePath, data) {
    return await this.files.saveCollectionFile(filePath, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }

  async handleLoadFile(event, filePath) {
    return await this.files.loadCollectionFile(filePath);
  }

  async handleDeleteFile(event, filePath) {
    return await this.files.deleteCollectionFile(filePath);
  }

  // Request Operations
  async handleCreateRequest(event, collectionPath, requestName) {
    return this.requests.createRequest(collectionPath, requestName);
  }

  async handleListRequests(event, collectionPath) {
    return this.requests.listRequests(collectionPath);
  }

  // Environment Operations
  async handleCreateEnvironment(event, collectionPath, envName) {
    return this.environments.createEnvironment(collectionPath, envName);
  }

  async handleListEnvironments(event, collectionPath) {
    return this.environments.listEnvironments(collectionPath);
  }

  async handleLoadEnvironment(event, envPath) {
    return this.environments.loadEnvironment(envPath);
  }

  async handleSaveEnvironment(event, envPath, variables) {
    return this.environments.saveEnvironment(envPath, variables);
  }

  async handleDeleteEnvironment(event, envPath) {
    return this.environments.deleteEnvironment(envPath);
  }

  // Collection Operations
  async handleListCollections(event) {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });
      if (result.canceled) return [];
      const dir = result.filePaths[0];
      return this.collections.listCollections(dir);
    } catch (error) {
      console.error('Error listing collections:', error);
      return [];
    }
  }

  // Git Operations
  async handleGitInit(event, dirPath) {
    return this.git.gitInit(dirPath);
  }

  async handleIsGitRepo(event, dirPath) {
    return this.git.isGitRepo(dirPath);
  }

  async handleGitStatus(event, dirPath) {
    return this.git.gitStatus(dirPath);
  }

  async handleCreateGitignore(event, dirPath) {
    return this.git.createGitignore(dirPath);
  }

  // Export/Import Operations
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
      return await this.files.loadCollectionFile(result.filePaths[0]);
    } catch (error) {
      console.error('Error importing collection:', error);
      return null;
    }
  }
}

module.exports = Bruno;

