document.addEventListener('DOMContentLoaded', function() {
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-btn');
  const messagesContainer = document.querySelector('.messages-container');
  
  // Handle sending messages
  function sendMessage() {
    const message = messageInput.value.trim();
    if (message === '') return;
    
    // Get current time
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    const timeString = `${formattedHours}:${formattedMinutes} ${ampm}`;
    
    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = 'message sent';
    messageElement.innerHTML = `
      <div class="message-content">${message}</div>
      <div class="message-time">${timeString}</div>
    `;
    
    // Add message to container with animation
    messagesContainer.appendChild(messageElement);
    messageElement.classList.add('fade-in');
    
    // Clear input
    messageInput.value = '';
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Simulate response after delay (for demo only)
    setTimeout(() => {
      simulateResponse();
    }, 1000 + Math.random() * 2000);
  }
  
  // Simulate response (for demo purposes)
  function simulateResponse() {
    const responses = [
      "That's interesting!",
      "I see what you mean.",
      "I'll get back to you on that.",
      "Can you tell me more?",
      "Thanks for sharing!",
      "I appreciate your message.",
      "Let's discuss this further."
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    // Get current time
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    const timeString = `${formattedHours}:${formattedMinutes} ${ampm}`;
    
    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = 'message received';
    messageElement.innerHTML = `
      <div class="message-content">${randomResponse}</div>
      <div class="message-time">${timeString}</div>
    `;
    
    // Add message to container with animation
    messagesContainer.appendChild(messageElement);
    messageElement.classList.add('fade-in');
    
    // Play notification sound (optional)
    // const audio = new Audio('notification.mp3');
    // audio.play();
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  // Event listeners
  sendButton.addEventListener('click', sendMessage);
  
  messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
  
  // Handle contact selection
  const contacts = document.querySelectorAll('.contact');
  contacts.forEach(contact => {
    contact.addEventListener('click', function() {
      // Remove active class from all contacts
      contacts.forEach(c => c.classList.remove('active'));
      // Add active class to clicked contact
      this.classList.add('active');
      
      // In a real app, you would load the conversation with this contact
      // For now, we'll just update the header
      const contactName = this.querySelector('.contact-name').textContent;
      const contactAvatar = this.querySelector('.contact-avatar').textContent;
      
      document.querySelector('.chat-header .contact-name').textContent = contactName;
      document.querySelector('.chat-header .contact-avatar').textContent = contactAvatar;
    });
  });
});
