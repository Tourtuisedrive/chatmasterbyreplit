document.addEventListener('DOMContentLoaded', () => {
    const themeManager = new ThemeManager();
    const chatManager = new ChatManager();

    // Menu handling
    const menuBtn = document.getElementById('menu-btn');
    const menuOverlay = document.getElementById('menu-overlay');
    const clearChatBtn = document.getElementById('clear-chat');

    menuBtn.addEventListener('click', () => {
        menuOverlay.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!menuOverlay.contains(e.target) && !menuBtn.contains(e.target)) {
            menuOverlay.classList.remove('active');
        }
    });

    clearChatBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = '';
        menuOverlay.classList.remove('active');
    });
});
