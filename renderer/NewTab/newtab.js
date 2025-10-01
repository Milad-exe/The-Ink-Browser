document.addEventListener('DOMContentLoaded', () => {
    const searchBar = document.querySelector('.search-bar');
    
    searchBar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = searchBar.value.trim();
            if (query) {
                handleSearch(query);
            }
        }
    });
    
    function handleSearch(query) {
        let url;
        
        // Check if it's a URL
        if (query.startsWith('http://') || query.startsWith('https://')) {
            url = query;
        } else if (query.includes('.') && !query.includes(' ')) {
            // Likely a domain name
            url = 'https://' + query;
        } else {
            // Search query
            url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        }
        
        // Navigate to the URL by replacing the current page
        window.location.href = url;
    }
});