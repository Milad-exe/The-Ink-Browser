const { app } = require('electron');
const path    = require('path');
const fs      = require('fs').promises;
const { encrypt, decrypt, isEncrypted } = require('./encryption');

class Bookmarks {
    constructor() {
        this._file  = path.join(app.getPath('userData'), 'bookmarks.json');
        this._cache = null;
    }

    // ── Low-level read/write (handles encrypt/decrypt + plaintext migration) ──

    async _load() {
        if (this._cache) return this._cache;
        try {
            const raw = await fs.readFile(this._file, 'utf8');
            let plaintext;
            if (isEncrypted(raw)) {
                plaintext = decrypt(raw);
            } else {
                // Legacy plaintext — will be encrypted on next _save()
                plaintext = raw;
            }
            this._cache = JSON.parse(plaintext);
            if (!Array.isArray(this._cache)) this._cache = [];
        } catch {
            this._cache = [];
        }
        return this._cache;
    }

    async _save() {
        try {
            await fs.writeFile(this._file, encrypt(JSON.stringify(this._cache, null, 2)), 'utf8');
        } catch {}
    }

    // ── Public API ──────────────────────────────────────────────────────────

    async getAll() {
        return this._load();
    }

    async add(url, title) {
        const bookmarks = await this._load();
        const exists    = bookmarks.some(b => b.url === url);
        if (!exists) {
            bookmarks.push({ url, title: title || url, addedAt: Date.now() });
            await this._save();
        }
        return !exists;
    }

    async remove(url) {
        const bookmarks = await this._load();
        const idx       = bookmarks.findIndex(b => b.url === url);
        if (idx !== -1) {
            bookmarks.splice(idx, 1);
            await this._save();
            return true;
        }
        return false;
    }

    async has(url) {
        const bookmarks = await this._load();
        return bookmarks.some(b => b.url === url);
    }

    async updateTitle(url, title) {
        const bookmarks = await this._load();
        const entry     = bookmarks.find(b => b.url === url);
        if (entry && title) {
            entry.title = title;
            await this._save();
        }
    }
}

module.exports = Bookmarks;
