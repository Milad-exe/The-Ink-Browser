document.addEventListener('DOMContentLoaded', () => {
    
    const buttons = document.querySelectorAll('button');

    buttons.forEach(button => {
        button.addEventListener('click', async (event) => {

            const buttonText = button.textContent.trim();

            switch(buttonText) {
                case 'New Tab':
                    await window.electronAPI.addTab();
                    await window.electronAPI.closeMenu();
                    break;
                case 'History':
                    try {
                        await window.electronAPI.openHistoryTab();
                        await window.electronAPI.closeMenu();
                    } catch (error) {
                        console.error('Error opening history tab:', error);
                    }
                    break;
                case 'New Window':
                    await window.electronAPI.closeMenu();
                    break;
                case 'Bookmarks':
                    await window.electronAPI.closeMenu();
                    break;
                case 'Persistence':
                    break;
            }
        });
    });
});
