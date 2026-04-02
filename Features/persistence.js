const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  persistAllTabs: false,
  searchEngine: 'google',       // 'google' | 'duckduckgo' | 'bing'
  bookmarkBarVisible: false,
  pomWork: 25,                  // minutes
  pomShortBreak: 5,             // minutes
  pomLongBreak: 15,             // minutes
  pomSessions: 4,               // sessions before long break
};

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
        return { ...DEFAULTS, ...obj };
      }
    } catch {}
    return { ...DEFAULTS };
  }

  _save() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch {}
  }

  getAll() {
    return { ...this.settings };
  }

  get(key) {
    return this.settings[key] ?? DEFAULTS[key];
  }

  set(key, value) {
    if (!(key in DEFAULTS)) return;
    this.settings[key] = value;
    this._save();
  }

  // Legacy API kept for backward compat
  getPersistMode() {
    return !!this.settings.persistAllTabs;
  }

  setPersistMode(enabled) {
    this.settings.persistAllTabs = !!enabled;
    this._save();
  }

  hasState() {
    try { return fs.existsSync(this.statePath); } catch { return false; }
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return null;
      const raw = fs.readFileSync(this.statePath, 'utf-8');
      const obj = JSON.parse(raw);
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
