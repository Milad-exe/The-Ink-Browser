// ============================================================================
// Bruno Requests Management
// ============================================================================
const fs = require('fs');
const path = require('path');

class RequestManager {
  createRequest(collectionPath, requestName) {
    try {
      const filename = `${Date.now()}_${requestName.replace(/\s+/g, '_')}`;
      const requestData = {
        filename,
        name: requestName,
        method: 'GET',
        url: '',
        params: {},
        headers: {},
        body: '',
        auth: { type: 'none' },
        script: '',
        assert: '',
        docs: ''
      };
      return requestData;
    } catch (error) {
      console.error('Error creating request:', error);
      throw error;
    }
  }

  saveRequest(collectionPath, filename, requestData) {
    try {
      // filename may include a subfolder path e.g. "folder/subfolder/my-request"
      const filepath = path.join(collectionPath, `${filename}.json`);
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filepath, JSON.stringify(requestData, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('Error saving request:', error);
      throw error;
    }
  }

  loadRequest(filepath) {
    try {
      const data = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading request:', error);
      throw error;
    }
  }

  // Recursively lists all .json request files under collectionPath.
  // Skips: environments/, bruno.json, folder metadata files.
  // Returns: [{ filename, folder, path }]
  //   folder = relative path from collectionPath (or null for root-level requests)
  listRequests(collectionPath) {
    try {
      const results = [];
      const scan = (dir, folderPath) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        entries.forEach(entry => {
          if (entry.name === 'environments') return;
          if (entry.name === 'bruno.json') return;
          if (entry.isDirectory()) {
            scan(
              path.join(dir, entry.name),
              folderPath ? `${folderPath}/${entry.name}` : entry.name
            );
          } else if (entry.name.endsWith('.json')) {
            results.push({
              filename: entry.name.replace('.json', ''),
              folder: folderPath || null,
              path: path.join(dir, entry.name)
            });
          }
        });
      };
      scan(collectionPath, null);
      return results;
    } catch (error) {
      console.error('Error listing requests:', error);
      return [];
    }
  }

  deleteRequest(collectionPath, filename) {
    try {
      const filepath = path.join(collectionPath, `${filename}.json`);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      return true;
    } catch (error) {
      console.error('Error deleting request:', error);
      throw error;
    }
  }
}

module.exports = RequestManager;
