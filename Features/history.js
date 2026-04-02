const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');

class History {
    constructor() {
        this.historyArray = [];
        this.file = null;
        this.initialized = false;
        this.initializeFilePath();
    }

    initializeFilePath() {
        try {
            const userDataPath = app.getPath('userData');
            this.file = path.join(userDataPath, 'browsing-history.json');
        } catch (error) {
            this.file = path.join(process.cwd(), 'browsing-history.json');
        }
    }

    async ensureFileExists() {
        if (!this.file) {
            return false;
        }

        if (this.initialized) {
            return true;
        }

        const exists = await this.historyFileExists();
        
        if(!exists){
            let text = '[]';
            try {
                await fs.writeFile(this.file, text, { encoding: 'utf8' });
            } catch (writeError) {
                return false;
            }
        }

        this.initialized = true;
        return true;
    }

    async loadHistory(){
        await this.ensureFileExists();
        
        try {
            const data = await fs.readFile(this.file, 'utf8');
            const jsonData = JSON.parse(data);
            return jsonData;
        } catch (error) {
            return [];
        }
    }

    async addToHistory(url, title) {
        await this.ensureFileExists();
        
        try {
            let historyData = await this.loadHistory();
            // Skip saving likely search-result pages (e.g. google.com/search?q=...)
            const isLikelySearchResult = (rawUrl) => {
                if (!rawUrl) return false;
                try {
                    const u = new URL(rawUrl);
                    const host = (u.hostname || '').toLowerCase();
                    const path = (u.pathname || '').toLowerCase();
                    const params = u.searchParams;
                    const isGoogle = host.includes('google.');
                    const isBing = host.includes('bing.com');
                    const isDuck = host.includes('duckduckgo.com');
                    if ((isGoogle && (path.startsWith('/search') || path.startsWith('/url') || params.has('q'))) ||
                        (isBing && (path.startsWith('/search') || params.has('q'))) ||
                        (isDuck && params.has('q'))) {
                        return true;
                    }
                    if (path.includes('/search') && params.has('q')) return true;
                    if (u.search && u.search.toLowerCase().includes('q=')) return true;
                } catch (err) {
                    return false;
                }
                return false;
            };

            if (isLikelySearchResult(url)) return;
            const newEntry = {
                url: url,
                title: title,
                timestamp: new Date().toISOString()
            };
            
            historyData.unshift(newEntry);
            
            if (historyData.length > 1000) {
                historyData = historyData.slice(0, 1000);
            }
            
            await fs.writeFile(this.file, JSON.stringify(historyData, null, 2), { encoding: 'utf8' });
        } catch (error) {
            
        }
    }

    async removeFromHistory(url, timestamp) {
        await this.ensureFileExists();
        
        try {
            const historyData = await this.loadHistory();
            
            const filteredHistory = historyData.filter(entry => 
                !(entry.url === url && entry.timestamp === timestamp)
            );
            
            await fs.writeFile(this.file, JSON.stringify(filteredHistory, null, 2), { encoding: 'utf8' });
            return true;
        } catch (error) {
            return false;
        }
    }

    async clearHistory() {
        try {
            await this.ensureFileExists();
            await fs.writeFile(this.file, '[]', { encoding: 'utf8' });
            return true;
        } catch {
            return false;
        }
    }

    async historyFileExists() {
        try {
            const stats = await fs.stat(this.file);
            return stats.isFile();
        } catch {
            return false;
        }
    }
}

module.exports = History;