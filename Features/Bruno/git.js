// ============================================================================
// Bruno Git Operations
// ============================================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function gitInit(dirPath) {
  try {
    if (!fs.existsSync(path.join(dirPath, '.git'))) {
      execSync('git init', { cwd: dirPath });
    }
    return true;
  } catch (error) {
    console.error('Error initializing git:', error);
    throw error;
  }
}

function isGitRepo(dirPath) {
  try {
    return fs.existsSync(path.join(dirPath, '.git'));
  } catch (error) {
    console.error('Error checking git repo:', error);
    return false;
  }
}

function gitStatus(dirPath) {
  try {
    const status = execSync('git status --porcelain', { cwd: dirPath, encoding: 'utf-8' });
    return status || '';
  } catch (error) {
    console.error('Error getting git status:', error);
    return '';
  }
}

function createGitignore(dirPath) {
  try {
    const gitignorePath = path.join(dirPath, '.gitignore');
    const content = `node_modules/
.env
.DS_Store
*.log
`;
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, content, 'utf-8');
    }
    return true;
  } catch (error) {
    console.error('Error creating .gitignore:', error);
    throw error;
  }
}

module.exports = {
  gitInit,
  isGitRepo,
  gitStatus,
  createGitignore
};
