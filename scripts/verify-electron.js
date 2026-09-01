/**
 * postinstall guard — make sure Electron actually unpacked a runnable binary.
 *
 * Electron's own install step (node_modules/electron/install.js) downloads a
 * zip and extracts it with `extract-zip`. That extraction has been observed to
 * fail *silently* — it resolves successfully but leaves only a stray file
 * (`resources.pak`) behind, no `electron.exe` — so the install exits 0 and the
 * breakage only surfaces much later as a confusing ENOENT from `npm start`:
 *
 *     Error: spawn .../node_modules/electron/dist/.../Electron ENOENT
 *
 * We've hit this on Windows; the same silent-half-extract can happen on any
 * host. This runs after Electron's install (npm runs dependency install scripts
 * before the root postinstall) and, if the binary is missing, repairs the
 * install in place by re-extracting the cached/downloaded zip with `adm-zip`
 * (a more robust extractor than the one that failed). Net effect: `npm install`
 * followed by `npm start` just works on macOS, Windows, and Linux.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron');
const DIST = path.join(ELECTRON_DIR, 'dist');

// castlabs Widevine build — must match node_modules/electron/install.js so the
// repair pulls the exact same artifact the normal install would.
const MIRROR = 'https://github.com/castlabs/electron-releases/releases/download/';

// Mirrors node_modules/electron/install.js:getPlatformPath().
function platformBinaryRelPath() {
  switch (process.platform) {
    case 'mas':
    case 'darwin': return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'win32':  return 'electron.exe';
    default:       return 'electron'; // linux / *bsd
  }
}

function log(msg) { console.log(`[verify-electron] ${msg}`); }

// A good install has both the platform binary and the `version` marker file.
function isHealthy() {
  const binary = path.join(DIST, platformBinaryRelPath());
  const versionFile = path.join(DIST, 'version');
  return fs.existsSync(binary) && fs.existsSync(versionFile);
}

async function repair() {
  const AdmZip = require('adm-zip');
  const { downloadArtifact } = require('@electron/get');
  const version = require(path.join(ELECTRON_DIR, 'package.json')).version;

  // Integrity checksums ship with the electron package; pass them through when
  // present so a repaired download is verified just like the original.
  let checksums;
  try { checksums = require(path.join(ELECTRON_DIR, 'checksums.json')); }
  catch { checksums = undefined; }

  log(`repairing electron ${version} for ${process.platform}-${process.arch}…`);

  // Resolves the cached zip if present, otherwise downloads it. Same args the
  // stock installer uses, so this reuses the existing cache rather than
  // re-downloading ~130 MB when the bytes are already local.
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    mirrorOptions: { mirror: MIRROR },
    checksums,
  });

  // Re-extract from scratch with adm-zip (the extractor that doesn't silently
  // half-unpack), then restore path.txt so `require('electron')` resolves.
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  new AdmZip(zipPath).extractAllTo(DIST, true);
  fs.writeFileSync(path.join(ELECTRON_DIR, 'path.txt'), platformBinaryRelPath());

  if (!isHealthy()) {
    throw new Error('binary still missing after re-extracting ' + zipPath);
  }
  log('repaired — electron binary is present.');
}

async function main() {
  // Respect the same opt-out the stock installer honors.
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) return;

  // Nothing to guard if the electron package isn't installed at all.
  if (!fs.existsSync(ELECTRON_DIR)) return;

  if (isHealthy()) return;

  log('electron binary is missing or incompletely extracted — repairing.');
  try {
    await repair();
  } catch (err) {
    console.error(
      '\n[verify-electron] Could not repair the Electron install automatically.\n' +
      `[verify-electron] Reason: ${err && err.message ? err.message : err}\n` +
      '[verify-electron] Manual fix:\n' +
      '    rm -rf node_modules/electron/dist   (PowerShell: Remove-Item -Recurse -Force node_modules\\electron\\dist)\n' +
      '    node node_modules/electron/install.js\n'
    );
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
