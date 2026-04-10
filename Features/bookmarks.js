const { app } = require('electron');
const path    = require('path');
const fs      = require('fs').promises;
const { encrypt, decrypt, isEncrypted } = require('./encryption');

class Bookmarks {
    constructor() {
        this._file  = path.join(app.getPath('userData'), 'bookmarks.json');
        this._cache = null;
    }

    _genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

    _normalize(item) {
        if (!item.id)   item = { ...item, id: this._genId() };
        if (!item.type) item = { ...item, type: 'bookmark' };
        return item;
    }

    // ── Low-level read/write ─────────────────────────────────────────────────

    async _load() {
        if (this._cache) return this._cache;
        try {
            const raw = await fs.readFile(this._file, 'utf8');
            let plaintext;
            if (isEncrypted(raw)) plaintext = decrypt(raw);
            else                  plaintext = raw; // legacy plaintext — encrypted on next _save()
            this._cache = JSON.parse(plaintext);
            if (!Array.isArray(this._cache)) this._cache = [];
        } catch {
            this._cache = [];
        }
        // Migrate: ensure every top-level item has an id and type
        this._cache = this._cache.map(item => this._normalize(item));
        return this._cache;
    }

    async _save() {
        try {
            await fs.writeFile(this._file, encrypt(JSON.stringify(this._cache, null, 2)), 'utf8');
        } catch {}
    }

    // ── Public API ───────────────────────────────────────────────────────────

    async getAll() {
        return this._load();
    }

    async add(url, title) {
        const bookmarks = await this._load();
        const exists    = bookmarks.some(b => b.type === 'bookmark' && b.url === url);
        if (!exists) {
            bookmarks.push({ type: 'bookmark', id: this._genId(), url, title: title || url, addedAt: Date.now() });
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

    async removeById(id) {
        await this._load();
        const result = this._findNodeAndParentArray(id);
        if (result) {
            result.parentArray.splice(result.index, 1);
            await this._save();
            return true;
        }
        return false;
    }

    async has(url) {
        const bookmarks = await this._load();
        return bookmarks.some(b => b.type === 'bookmark' && b.url === url);
    }

    async updateTitle(url, title) {
        const bookmarks = await this._load();
        const entry     = bookmarks.find(b => b.url === url);
        if (entry && title) {
            entry.title = title;
            await this._save();
        }
    }

    async updateById(id, updates) {
        await this._load();
        const result = this._findNodeAndParentArray(id);
        if (result) {
            Object.assign(result.node, updates);
            await this._save();
            return true;
        }
        return false;
    }

    async addFolder(title) {
        const bookmarks = await this._load();
        const id = this._genId();
        bookmarks.push({ type: 'folder', id, title: title || 'New Folder', children: [] });
        await this._save();
        return id;
    }

    async addDivider() {
        const bookmarks = await this._load();
        const id = this._genId();
        bookmarks.push({ type: 'divider', id });
        await this._save();
        return id;
    }

    // Add a sub-folder directly inside an existing folder
    async addFolderInto(title, parentFolderId) {
        await this._load();
        const result = this._findNodeAndParentArray(parentFolderId);
        if (!result || result.node.type !== 'folder') return null;
        const id = this._genId();
        if (!Array.isArray(result.node.children)) result.node.children = [];
        result.node.children.push({ type: 'folder', id, title: title || 'New Folder', children: [] });
        await this._save();
        return id;
    }

    // Add a divider directly inside an existing folder
    async addDividerInto(parentFolderId) {
        await this._load();
        const result = this._findNodeAndParentArray(parentFolderId);
        if (!result || result.node.type !== 'folder') return null;
        const id = this._genId();
        if (!Array.isArray(result.node.children)) result.node.children = [];
        result.node.children.push({ type: 'divider', id });
        await this._save();
        return id;
    }

    _findNodeAndParentArray(id, array) {
        array = array || (this._cache || []);
        for (let i = 0; i < array.length; i++) {
            if (array[i].id === id) return { node: array[i], parentArray: array, index: i };
            if (array[i].type === 'folder' && Array.isArray(array[i].children)) {
                const result = this._findNodeAndParentArray(id, array[i].children);
                if (result) return result;
            }
        }
        return null;
    }

    async moveOutOfFolder(itemId, folderId, insertBeforeId) {
        await this._load();
        const src = this._findNodeAndParentArray(itemId);
        if (!src) return false;
        
        // Remove from its current location
        const [item] = src.parentArray.splice(src.index, 1);
        
        if (insertBeforeId) {
            const target = this._findNodeAndParentArray(insertBeforeId);
            if (target) {
                target.parentArray.splice(target.index, 0, item);
            } else {
                this._cache.push(item);
            }
        } else {
            this._cache.push(item);
        }
        await this._save();
        return true;
    }

    async moveIntoFolder(itemId, folderId, insertBeforeId = null) {
        await this._load();
        const src = this._findNodeAndParentArray(itemId);
        if (!src) return false;
        if (itemId === folderId) return false;

        const folderTarget = this._findNodeAndParentArray(folderId);
        if (!folderTarget || folderTarget.node.type !== 'folder') return false;

        if (src.node.type === 'folder') {
            if (this._findNodeAndParentArray(folderId, src.node.children || [])) {
                return false; // prevent cycles
            }
        }

        // Extract
        const [item] = src.parentArray.splice(src.index, 1);
        
        if (!Array.isArray(folderTarget.node.children)) folderTarget.node.children = [];
        
        if (insertBeforeId) {
            const beforeIdx = folderTarget.node.children.findIndex(c => c.id === insertBeforeId);
            if (beforeIdx !== -1) {
                folderTarget.node.children.splice(beforeIdx, 0, item);
            } else {
                folderTarget.node.children.push(item);
            }
        } else {
            folderTarget.node.children.push(item);
        }
        await this._save();
        return true;
    }

    async reorder(ids) {
        const bookmarks = await this._load();
        const map       = new Map(bookmarks.map(b => [b.id, b]));
        const reordered = ids.map(id => map.get(id)).filter(Boolean);
        const inOrder   = new Set(ids);
        bookmarks.forEach(b => { if (!inOrder.has(b.id)) reordered.push(b); });
        this._cache = reordered;
        await this._save();
    }

    async reorderInFolder(folderId, orderedIds) {
        await this._load();
        const result = this._findNodeAndParentArray(folderId);
        if (!result || result.node.type !== 'folder') return false;
        const folder   = result.node;
        const children = folder.children || [];
        const map      = new Map(children.map(c => [c.id, c]));
        const reordered = orderedIds.map(id => map.get(id)).filter(Boolean);
        const inOrder   = new Set(orderedIds);
        children.forEach(c => { if (!inOrder.has(c.id)) reordered.push(c); });
        folder.children = reordered;
        await this._save();
        return true;
    }
}

module.exports = Bookmarks;
