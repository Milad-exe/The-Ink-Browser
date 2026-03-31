// ============================================================================
// Bruno Collections Management
// A collection is a directory. bruno.json at the root holds metadata
// including the currently active environment name.
// ============================================================================
const fs = require('fs');
const path = require('path');

const BRUNO_JSON = 'bruno.json';

function _brunoJsonPath(dirPath) {
  return path.join(dirPath, BRUNO_JSON);
}

function _readBrunoJson(dirPath) {
  const p = _brunoJsonPath(dirPath);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function _writeBrunoJson(dirPath, data) {
  fs.writeFileSync(_brunoJsonPath(dirPath), JSON.stringify(data, null, 2), 'utf-8');
}

// Returns info about a collection directory, creating bruno.json if absent.
function initCollection(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return null;
    let data = _readBrunoJson(dirPath);
    if (!data) {
      data = { name: path.basename(dirPath), version: '1', activeEnvironment: null };
      _writeBrunoJson(dirPath, data);
    }
    return { ...data, path: dirPath };
  } catch (error) {
    console.error('Error initialising collection:', error);
    throw error;
  }
}

// Read the active environment name stored in bruno.json (null if none)
function getActiveEnvironment(dirPath) {
  try {
    const data = _readBrunoJson(dirPath);
    return data ? data.activeEnvironment || null : null;
  } catch (error) {
    console.error('Error reading active environment:', error);
    return null;
  }
}

// Persist the active environment name into bruno.json
function setActiveEnvironment(dirPath, envName) {
  try {
    let data = _readBrunoJson(dirPath) || { name: path.basename(dirPath), version: '1' };
    data.activeEnvironment = envName || null;
    _writeBrunoJson(dirPath, data);
    return true;
  } catch (error) {
    console.error('Error saving active environment:', error);
    throw error;
  }
}

// Lists subdirectories of dirPath that contain a bruno.json (i.e. are Bruno collections)
function listCollections(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(dirPath, e.name, BRUNO_JSON)))
      .map(e => ({
        name: e.name,
        path: path.join(dirPath, e.name)
      }));
  } catch (error) {
    console.error('Error listing collections:', error);
    throw error;
  }
}

function getCollectionInfo(collectionPath) {
  try {
    if (!fs.existsSync(collectionPath)) return null;
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
  initCollection,
  getActiveEnvironment,
  setActiveEnvironment,
  listCollections,
  getCollectionInfo
};
