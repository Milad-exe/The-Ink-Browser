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
            console.error('Error getting userData path:', error);
            this.file = path.join(process.cwd(), 'browsing-history.json');
        }
    }

    async ensureFileExists() {
        if (!this.file) {
            console.error('File path not initialized');
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
                console.error('Error creating history file:', writeError);
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
            console.error("Error reading JSON file:", error);
            return [];
        }
    }

    async addToHistory(url, title) {
        await this.ensureFileExists();
        
        try {
            const historyData = await this.loadHistory();
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
            console.error('Error adding to history:', error);
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
            console.error('Error removing from history:', error);
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