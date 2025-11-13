const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Persistence {
  constructor() {
    const userDir = app.getPath('userData');
    this.dir = path.join(userDir, 'ink');
    this.statePath = path.join(this.dir, 'tabs-state.json');
    this.settingsPath = path.join(this.dir, 'settings.json');
    this._ensureDir();
    this.settings = this._loadSettings();
  }

  _ensureDir() {
    try { if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true }); } catch {}
  }

  _loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, 'utf-8');
        const obj = JSON.parse(raw);
        return { persistAllTabs: !!obj.persistAllTabs };
      }
    } catch {}
    return { persistAllTabs: false };
  }

  getPersistMode() {
    return !!this.settings.persistAllTabs;
  }

  setPersistMode(enabled) {
    this.settings.persistAllTabs = !!enabled;
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch {}
  }

  hasState() {
    try { return fs.existsSync(this.statePath); } catch { return false; }
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return null;
      const raw = fs.readFileSync(this.statePath, 'utf-8');
      const obj = JSON.parse(raw);
      // Validate minimal shape
      if (!obj || !Array.isArray(obj.tabs)) return null;
      return obj;
    } catch {
      return null;
    }
  }

  saveState(state) {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
    } catch {}
  }
}

module.exports = Persistence;
