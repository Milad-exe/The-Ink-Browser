// ============================================================================
// Bruno Environments Management
// ============================================================================
const fs = require('fs');
const path = require('path');

class EnvironmentManager {
  createEnvironment(collectionPath, envName) {
    try {
      const envPath = path.join(collectionPath, `${envName}.env`);
      if (fs.existsSync(envPath)) {
        throw new Error('Environment already exists');
      }
      fs.writeFileSync(envPath, '', 'utf-8');
      return { name: envName, path: envPath };
    } catch (error) {
      console.error('Error creating environment:', error);
      throw error;
    }
  }

  listEnvironments(collectionPath) {
    try {
      if (!fs.existsSync(collectionPath)) {
        return [];
      }

      const files = fs.readdirSync(collectionPath)
        .filter(f => f.endsWith('.env'))
        .map(f => ({
          name: f.replace('.env', ''),
          path: path.join(collectionPath, f)
        }));

      return files;
    } catch (error) {
      console.error('Error listing environments:', error);
      return [];
    }
  }

  loadEnvironment(envPath) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const variables = {};

      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, value] = trimmed.split('=');
          if (key && value) {
            variables[key.trim()] = value.trim();
          }
        }
      });

      return variables;
    } catch (error) {
      console.error('Error loading environment:', error);
      return {};
    }
  }

  saveEnvironment(envPath, variables) {
    try {
      const content = Object.entries(variables)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      fs.writeFileSync(envPath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error('Error saving environment:', error);
      throw error;
    }
  }

  deleteEnvironment(envPath) {
    try {
      if (fs.existsSync(envPath)) {
        fs.unlinkSync(envPath);
      }
      return true;
    } catch (error) {
      console.error('Error deleting environment:', error);
      throw error;
    }
  }
}

module.exports = EnvironmentManager;
