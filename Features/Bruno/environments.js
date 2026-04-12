// ============================================================================
// Bruno Environments Management
// Environments live in {collectionPath}/environments/{name}.json
// Each file: { name, variables: [{ name, value, enabled, secret }] }
// ============================================================================
const fs = require('fs');
const path = require('path');

class EnvironmentManager {
  envDir(collectionPath) {
    return path.join(collectionPath, 'environments');
  }

  createEnvironment(collectionPath, envName) {
    try {
      const dir = this.envDir(collectionPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const envPath = path.join(dir, `${envName}.json`);
      if (fs.existsSync(envPath)) throw new Error('Environment already exists');
      const data = { name: envName, variables: [] };
      fs.writeFileSync(envPath, JSON.stringify(data, null, 2), 'utf-8');
      return { name: envName, path: envPath };
    } catch (error) {
      console.error('Error creating environment:', error);
      throw error;
    }
  }

  listEnvironments(collectionPath) {
    try {
      const dir = this.envDir(collectionPath);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f.replace('.json', ''),
          path: path.join(dir, f)
        }));
    } catch (error) {
      console.error('Error listing environments:', error);
      return [];
    }
  }

  // Returns flat { key: value } object for {{var}} substitution
  loadEnvironment(envPath) {
    try {
      const data = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
      const vars = {};
      (data.variables || []).forEach(v => {
        if (v.enabled !== false) vars[v.name] = v.value;
      });
      return vars;
    } catch (error) {
      console.error('Error loading environment:', error);
      return {};
    }
  }

  // Returns full { name, variables: [...] } for editing in the UI
  loadEnvironmentFull(envPath) {
    try {
      return JSON.parse(fs.readFileSync(envPath, 'utf-8'));
    } catch (error) {
      return { name: path.basename(envPath, '.json'), variables: [] };
    }
  }

  // variables is an array: [{ name, value, enabled, secret }]
  saveEnvironment(envPath, variables) {
    try {
      let data = { name: path.basename(envPath, '.json'), variables: [] };
      if (fs.existsSync(envPath)) {
        try { data = JSON.parse(fs.readFileSync(envPath, 'utf-8')); } catch {}
      }
      data.variables = variables;
      fs.writeFileSync(envPath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('Error saving environment:', error);
      throw error;
    }
  }

  deleteEnvironment(envPath) {
    try {
      if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
      return true;
    } catch (error) {
      console.error('Error deleting environment:', error);
      throw error;
    }
  }
}

module.exports = EnvironmentManager;
