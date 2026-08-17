const log = require('./log');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { app } = require('electron');
const { encrypt, decrypt, isEncrypted } = require('./encryption');
/**
 * Browsing history — kept in memory, persisted with a write-behind.
 *
 * The old implementation hit the disk for EVERYTHING: every keystroke in the
 * address bar (suggestions search) and every page navigation re-read, decrypted
 * and re-parsed the whole file, then re-encrypted and rewrote it. Now the list
 * loads once, all reads are memory-speed, and mutations schedule one coalesced
 * encrypted write 500 ms later (flushed synchronously on quit so nothing is
 * lost). Privacy-motivated deletions (remove / clear) flush immediately.
 */
// Retention. The old 1000-entry cap was days of browsing, not months: the page
// you half-remember from last week was routinely already gone. Chrome keeps 90
// days; match that, with a generous entry ceiling so the file can't grow without
// bound on a heavy day. Both are settings (see DEFAULTS in persistence.js) —
// this module reads them through setRetention(), because History is constructed
// before Persistence in some paths and must never depend on it.
const DEFAULT_MAX_ENTRIES = 50000;
const DEFAULT_MAX_DAYS = 90;
let MAX_ENTRIES = DEFAULT_MAX_ENTRIES;
let MAX_DAYS = DEFAULT_MAX_DAYS;
const WRITE_DELAY_MS = 500;
/** Apply the user's retention settings (0 days = keep until the cap). */
function setRetention({ maxEntries, maxDays } = {}) {
    if (Number.isFinite(maxEntries) && maxEntries > 0)
        MAX_ENTRIES = Math.min(500000, Math.floor(maxEntries));
    if (Number.isFinite(maxDays) && maxDays >= 0)
        MAX_DAYS = Math.floor(maxDays);
}
class History {
    file; // JSON store path (userData)
    cache; // the single source of truth once loaded
    initialized;
    _writeTimer; // debounced flush
    _quitHooked;
    // fileSuffix scopes the store per profile ('' = profile 1's legacy file,
    // '-p2' etc. for other profiles — each profile has its OWN history).
    constructor(fileSuffix = '') {
        this.file = null;
        this.initialized = false;
        this.cache = null; // Array — the single source of truth once loaded
        this._writeTimer = null;
        this._quitHooked = false;
        this.initPath(fileSuffix);
    }
    initPath(fileSuffix = '') {
        const name = `browsing-history${fileSuffix}.json`;
        try {
            this.file = path.join(app.getPath('userData'), name);
        }
        catch {
            this.file = path.join(process.cwd(), name);
        }
    }
    async ensureFile() {
        if (this.initialized)
            return true;
        if (!this.file)
            return false;
        try {
            await fs.stat(this.file);
        }
        catch {
            // File doesn't exist — write an empty encrypted history
            await fs.writeFile(this.file, encrypt('[]'), 'utf8');
        }
        this.initialized = true;
        return true;
    }
    // ── Load once; every later read is served from memory ────────────────────
    async load() {
        if (this.cache)
            return this.cache;
        await this.ensureFile();
        try {
            const raw = await fs.readFile(this.file, 'utf8');
            // Plaintext legacy file — migrated to encrypted on next write.
            const plaintext = isEncrypted(raw) ? decrypt(raw) : raw;
            const data = JSON.parse(plaintext);
            // Entries written before the rename tag their container as `persona`.
            for (const e of (Array.isArray(data) ? data : (data?.entries || [])))
                if (e && e.persona !== undefined && e.profile === undefined) { e.profile = e.persona; delete e.persona; }
            this.cache = Array.isArray(data) ? data : [];
        }
        catch {
            this.cache = [];
        }
        return this.cache;
    }
    // ── Write-behind ──────────────────────────────────────────────────────────
    _scheduleWrite() {
        clearTimeout(this._writeTimer);
        this._writeTimer = setTimeout(() => { this._flush().catch(() => { }); }, WRITE_DELAY_MS);
        if (!this._quitHooked) {
            this._quitHooked = true;
            try {
                app.on('before-quit', () => this.flushSync());
            }
            catch (e) { log.debug('history', '_scheduleWrite', e); }
        }
    }
    async _flush() {
        clearTimeout(this._writeTimer);
        this._writeTimer = null;
        if (!this.cache)
            return;
        await fs.writeFile(this.file, encrypt(JSON.stringify(this.cache)), 'utf8');
    }
    // Quit path — a pending debounced write must not die with the process.
    flushSync() {
        if (!this._writeTimer || !this.cache)
            return;
        clearTimeout(this._writeTimer);
        this._writeTimer = null;
        try {
            fsSync.writeFileSync(this.file, encrypt(JSON.stringify(this.cache)), 'utf8');
        }
        catch (e) { log.error('history', 'history could not be flushed on quit', e); }
    }
    /**
     * Trim in place to the retention window. Entries are newest-first, so the
     * age cut is a truncation once the first too-old entry is found — no scan of
     * the whole list on every visit.
     */
    _prune(history) {
        if (MAX_DAYS > 0) {
            const cutoff = Date.now() - MAX_DAYS * 86400000;
            for (let i = history.length - 1; i >= 0; i--) {
                const t = Date.parse(history[i].timestamp);
                if (Number.isFinite(t) && t >= cutoff) {
                    if (i + 1 < history.length)
                        history.length = i + 1;
                    break;
                }
                if (i === 0)
                    history.length = 0;
            }
        }
        if (history.length > MAX_ENTRIES)
            history.length = MAX_ENTRIES;
        return history;
    }
    // ── Public API (signatures unchanged) ─────────────────────────────────────
    async loadHistory() {
        const h = await this.load();
        // An existing file may predate the retention window (or a tightened
        // setting) — bring it inside on first read rather than on next visit.
        const before = h.length;
        this._prune(h);
        if (h.length !== before)
            this._scheduleWrite();
        return h;
    }
    async addToHistory(url, title, profile = null, profileName = null) {
        if (isSearchResultUrl(url))
            return;
        const p = profile || null;
        const history = await this.load();
        // Dedup by URL *and profile* — the same page under two profiles (e.g. Gmail
        // as Work vs Personal) is treated as two distinct entries, not one.
        const i = history.findIndex(e => e.url === url && (e.profile || null) === p);
        if (i !== -1)
            history.splice(i, 1);
        history.unshift({ url, title, timestamp: new Date().toISOString(), ...(p ? { profile: p, profileName: profileName || null } : {}) });
        this._prune(history);
        this._scheduleWrite();
    }
    async removeFromHistory(url, timestamp) {
        try {
            const history = await this.load();
            this.cache = history.filter(e => !(e.url === url && e.timestamp === timestamp));
            await this._flush(); // deletion is a privacy action — persist now
            return true;
        }
        catch {
            return false;
        }
    }
    async clearHistory() {
        try {
            await this.ensureFile();
            this.cache = [];
            await this._flush();
            return true;
        }
        catch {
            return false;
        }
    }
    // Remove entries newer than `sinceMs` (keep older ones). sinceMs = 0 clears all.
    async clearSince(sinceMs) {
        try {
            if (!sinceMs)
                return this.clearHistory();
            const history = await this.load();
            this.cache = history.filter(e => {
                const t = Date.parse(e.timestamp || 0);
                return isNaN(t) ? true : t < sinceMs;
            });
            await this._flush();
            return true;
        }
        catch {
            return false;
        }
    }
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function isSearchResultUrl(rawUrl) {
    if (!rawUrl)
        return false;
    try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        const p = u.pathname.toLowerCase();
        const params = u.searchParams;
        if (host.includes('google.') && (p.startsWith('/search') || p.startsWith('/url') || params.has('q')))
            return true;
        if (host.includes('bing.com') && (p.startsWith('/search') || params.has('q')))
            return true;
        if (host.includes('duckduckgo.com') && params.has('q'))
            return true;
        if (p.includes('/search') && params.has('q'))
            return true;
    }
    catch (e) { log.debug('history', 'isSearchResultUrl', e); }
    return false;
}

History.setRetention = setRetention;
module.exports = History;