// ============================================================================
// Bruno Export/Import Operations
// ============================================================================
const fs = require('fs');
const path = require('path');

function exportCollection(collectionPath) {
  try {
    if (!fs.existsSync(collectionPath)) {
      throw new Error('Collection path does not exist');
    }

    const items = fs.readdirSync(collectionPath);
    const collection = {
      name: path.basename(collectionPath),
      requests: [],
      environments: []
    };

    items.forEach(item => {
      const itemPath = path.join(collectionPath, item);
      if (item.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(itemPath, 'utf-8'));
        collection.requests.push(data);
      } else if (item.endsWith('.env')) {
        const data = fs.readFileSync(itemPath, 'utf-8');
        collection.environments.push({ name: item, content: data });
      }
    });

    return collection;
  } catch (error) {
    console.error('Error exporting collection:', error);
    throw error;
  }
}

function importCollection(collectionData, targetPath) {
  try {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // Import requests
    if (collectionData.requests) {
      collectionData.requests.forEach(request => {
        const filename = request.filename || `${Date.now()}_${request.name}`;
        const filepath = path.join(targetPath, `${filename}.json`);
        fs.writeFileSync(filepath, JSON.stringify(request, null, 2), 'utf-8');
      });
    }

    // Import environments
    if (collectionData.environments) {
      collectionData.environments.forEach(env => {
        const envPath = path.join(targetPath, env.name);
        fs.writeFileSync(envPath, env.content, 'utf-8');
      });
    }

    return true;
  } catch (error) {
    console.error('Error importing collection:', error);
    throw error;
  }
}

module.exports = {
  exportCollection,
  importCollection
};
