/**
 * Ink Browser — At-rest encryption
 *
 * Uses AES-256-GCM — the symmetric cipher mandated by OpenPGP (RFC 4880bis §9.3)
 * for modern PGP symmetric encryption.  The master key is generated once with a
 * CSPRNG and stored in userData/ink/.key (mode 0600 on Unix).
 *
 * Every encrypted blob is a JSON object:
 *   { v: 1, iv: <base64-12B>, tag: <base64-16B>, data: <base64-ciphertext> }
 *
 * The GCM authentication tag provides tamper-detection equivalent to an HMAC.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ALGO       = 'aes-256-gcm';
const KEY_BYTES  = 32;   // 256-bit key
const IV_BYTES   = 12;   // 96-bit IV — optimal for GCM
const TAG_BYTES  = 16;   // 128-bit auth tag

let _key     = null;
let _keyPath = null;

// ── Key path ────────────────────────────────────────────────────────────────

function _resolveKeyPath() {
    if (_keyPath) return _keyPath;
    try {
        const { app } = require('electron');
        _keyPath = path.join(app.getPath('userData'), 'ink', '.key');
    } catch {
        _keyPath = path.join(process.cwd(), '.ink-key');
    }
    return _keyPath;
}

// ── Key loading / generation ─────────────────────────────────────────────────

function _getKey() {
    if (_key) return _key;

    const keyPath = _resolveKeyPath();
    const dir     = path.dirname(keyPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(keyPath)) {
        const stored = fs.readFileSync(keyPath);
        if (stored.length === KEY_BYTES) {
            _key = stored;
            return _key;
        }
        // Key file corrupt — regenerate (existing data will be unreadable; safer than no encryption)
    }

    _key = crypto.randomBytes(KEY_BYTES);
    fs.writeFileSync(keyPath, _key, { mode: 0o600 });
    return _key;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 string.
 * Returns a JSON string safe to store in a file.
 */
function encrypt(plaintext) {
    const key       = _getKey();
    const iv        = crypto.randomBytes(IV_BYTES);
    const cipher    = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag       = cipher.getAuthTag();

    return JSON.stringify({
        v:    1,
        iv:   iv.toString('base64'),
        tag:  tag.toString('base64'),
        data: encrypted.toString('base64')
    });
}

/**
 * Decrypt a value produced by encrypt().
 * Throws if the data has been tampered with (GCM auth tag mismatch).
 */
function decrypt(ciphertext) {
    const key     = _getKey();
    const { iv, tag, data } = JSON.parse(ciphertext);
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'), { authTagLength: TAG_BYTES });
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final()
    ]).toString('utf8');
}

/**
 * Returns true if the string looks like an encrypted blob written by encrypt().
 * Used for seamless migration from plaintext files.
 */
function isEncrypted(str) {
    try {
        const obj = JSON.parse(str);
        return !!(obj && obj.v === 1 && obj.iv && obj.tag && obj.data);
    } catch {
        return false;
    }
}

module.exports = { encrypt, decrypt, isEncrypted };
