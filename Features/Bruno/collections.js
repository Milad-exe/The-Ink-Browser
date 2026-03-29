// ============================================================================
// Bruno Collections Management
// ============================================================================
const fs = require('fs');
const path = require('path');

function listCollections(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
    return files.map(f => ({ name: f.replace('.json', ''), path: path.join(dirPath, f) }));
  } catch (error) {
    console.error('Error listing collections:', error);
    throw error;
  }
}

function getCollectionInfo(collectionPath) {
  try {
    if (!fs.existsSync(collectionPath)) {
      return null;
    }
    const stat = fs.statSync(collectionPath);
    return {
      name: path.basename(collectionPath),
      path: collectionPath,
      isDirectory: stat.isDirectory(),
      created: stat.birthtime,
      modified: stat.mtime
    };
  } catch (error) {
    console.error('Error getting collection info:', error);
    throw error;
  }
}

module.exports = {
  listCollections,
  getCollectionInfo
};
