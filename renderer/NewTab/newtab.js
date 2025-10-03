document.addEventListener('DOMContentLoaded', () => {
    const searchBar = document.querySelector('.search-bar');
    
    if (window.electronAPI && window.electronAPI.windowClick) {
        window.addEventListener("click", (e) => {
            window.electronAPI.windowClick({ x: e.clientX, y: e.clientY });
        });
    }
    
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
        
        if (query.startsWith('http://') || query.startsWith('https://')) {
            url = query;
        } else if (query.includes('.') && !query.includes(' ')) {
            url = 'https://' + query;
        } else {
            url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        }
        
        window.location.href = url;
    }
});