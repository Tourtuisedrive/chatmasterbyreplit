class ChatManager {
    constructor() {
        this.messageInput = document.getElementById('message-input');
        this.sendButton = document.getElementById('send-btn');
        this.chatMessages = document.getElementById('chat-messages');
        this.modeBtns = document.querySelectorAll('.mode-btn');
        this.quickReplies = document.querySelectorAll('.quick-reply-btn');
        this.currentMode = 'general';
        this.isTyping = false;
        this.init();
    }

    init() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchMode(btn));
        });

        this.quickReplies.forEach(btn => {
            btn.addEventListener('click', (e) => this.handleQuickReply(e.target.textContent));
        });

        // Add welcome message
        this.addMessage('Welcome! I\'m your AI assistant. I can help you in two modes:\n• General: For everyday conversations\n• Expert: For specialized technical help\n\nChoose a mode to get started!', 'bot');
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isTyping) return;

        this.addMessage(message, 'user');
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        await this.simulateResponse(message);
    }

    async simulateResponse(message) {
        this.isTyping = true;
        this.showTypingIndicator();

        try {
            const response = await fetch('/api/send_message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    mode: this.currentMode
                })
            });

            // Minimum typing time of 1 second for natural feel
            await new Promise(resolve => setTimeout(resolve, 1000));

            const data = await response.json();
            this.removeTypingIndicator();
            this.addMessage(data.response, 'bot');
        } catch (error) {
            console.error('Error:', error);
            this.removeTypingIndicator();
            this.addMessage('Sorry, I encountered an error. Please try again.', 'bot');
        }

        this.isTyping = false;
    }

    addMessage(content, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.innerHTML = `
            <div class="message-content">
                ${this.formatMessage(content)}
            </div>
        `;
        this.chatMessages.appendChild(messageDiv);

        // Ensure smooth scrolling to the latest message
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    formatMessage(content) {
        // Convert URLs to clickable links
        return content.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        ).replace(/\n/g, '<br>');
    }

    showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'message bot typing-indicator';
        indicator.innerHTML = `
            <div class="message-content">
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        this.chatMessages.appendChild(indicator);
        indicator.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    removeTypingIndicator() {
        const indicator = this.chatMessages.querySelector('.typing-indicator');
        if (indicator) indicator.remove();
    }

    switchMode(btn) {
        if (this.isTyping) return;

        this.modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentMode = btn.dataset.mode;

        const modeMessage = this.currentMode === 'expert'
            ? 'Switched to Expert mode. I\'ll provide more technical and detailed responses.'
            : 'Switched to General mode. I\'ll keep things simple and conversational.';

        this.addMessage(modeMessage, 'bot');
    }

    handleQuickReply(text) {
        if (!this.isTyping) {
            this.messageInput.value = text;
            this.sendMessage();
        }
    }

    scrollToBottom() {
        const lastMessage = this.chatMessages.lastElementChild;
        if (lastMessage) {
            lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }
}