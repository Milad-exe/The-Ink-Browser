document.addEventListener('DOMContentLoaded', async () => {
    const containerDiv = document.getElementById('container');

    document.addEventListener('click', async () => {
        try {
            if (window.menu && window.menu.close) {
                await window.menu.close();
            }
        } catch (error) {
            console.log('Menu close API not available or menu already closed');
        }
    });

    try {
        console.log('Loading history...');
        const historyData = await window.browserHistory.get();
        console.log('History data received:', historyData);
        
        if (historyData && Array.isArray(historyData) && historyData.length > 0) {
            console.log('Found', historyData.length, 'history entries');
            historyData.forEach(entry => {
                createHistoryEntry(containerDiv, entry);
            });
        } else {
            console.log('No history entries found');
            const noHistoryMsg = document.createElement('p');
            noHistoryMsg.textContent = 'No browsing history found.';
            noHistoryMsg.style.textAlign = 'center';
            noHistoryMsg.style.color = '#666';
            containerDiv.appendChild(noHistoryMsg);
        }
    } catch (error) {
        console.error('Error loading history:', error);
        const errorMsg = document.createElement('p');
        errorMsg.textContent = 'Error loading history: ' + error.message;
        errorMsg.style.textAlign = 'center';
        errorMsg.style.color = '#ff0000';
        containerDiv.appendChild(errorMsg);
    }
});

function createHistoryEntry(container, entry) {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'history-entry';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'history-content';
    
    const titleElement = document.createElement('div');
    titleElement.textContent = entry.title || 'Untitled';
    titleElement.className = 'history-title';
    
    const urlElement = document.createElement('div');
    urlElement.textContent = entry.url;
    urlElement.className = 'history-url';
    
    const timestampElement = document.createElement('div');
    const date = new Date(entry.timestamp);
    timestampElement.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    timestampElement.className = 'history-timestamp';
    
    const removeButton = document.createElement('button');
    removeButton.textContent = '×';
    removeButton.className = 'history-remove-btn';
    removeButton.title = 'Remove from history';
    
    removeButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        try {
            const success = await window.browserHistory.remove(entry.url, entry.timestamp);
            if (success) {
                entryDiv.remove();
                console.log('History entry removed successfully');
            } else {
                console.error('Failed to remove history entry');
            }
        } catch (error) {
            console.error('Error removing history entry:', error);
        }
    });
    
    contentDiv.addEventListener('click', () => {
        if (entry.url) {
            window.location.href = entry.url;
        }
    });
    
    contentDiv.style.cursor = 'pointer';
    
    contentDiv.appendChild(titleElement);
    contentDiv.appendChild(urlElement);
    
    entryDiv.appendChild(contentDiv);
    entryDiv.appendChild(timestampElement);
    entryDiv.appendChild(removeButton);
    
    container.appendChild(entryDiv);
}