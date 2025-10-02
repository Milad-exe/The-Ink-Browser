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
            console.log('History file path:', this.file);
            console.log('userData path:', userDataPath);
        } catch (error) {
            console.error('Error getting userData path:', error);
            // Fallback to current directory if app.getPath fails
            this.file = path.join(process.cwd(), 'browsing-history.json');
            console.log('Using fallback path:', this.file);
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

        console.log('Checking if history file exists:', this.file);
        const exists = await this.historyFileExists();
        console.log('History file exists:', exists);
        
        if(!exists){
            console.log('Creating new history file...');
            let text = '{ "History" : []}';
            try {
                await fs.writeFile(this.file, text, { encoding: 'utf8' });
                console.log('History file created successfully');
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
            console.log('Reading history file...');
            const data = await fs.readFile(this.file, 'utf8');
            const jsonData = JSON.parse(data);
            console.log('History loaded:', jsonData);
            return jsonData;
        } catch (error) {
            console.error("Error reading JSON file:", error);
            return { History: [] };
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
            
            historyData.History.unshift(newEntry); // Add to beginning
            
            // Keep only last 1000 entries
            if (historyData.History.length > 1000) {
                historyData.History = historyData.History.slice(0, 1000);
            }
            
            await fs.writeFile(this.file, JSON.stringify(historyData, null, 2), { encoding: 'utf8' });
            console.log('Added to history:', newEntry);
        } catch (error) {
            console.error('Error adding to history:', error);
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