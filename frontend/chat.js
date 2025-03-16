document.addEventListener('DOMContentLoaded', function() {
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-btn');
  const messagesContainer = document.querySelector('.messages-container');
  const noChatSelected = document.getElementById('no-chat-selected');
  const chatContent = document.getElementById('chat-content');
  const backButton = document.getElementById('back-button');
  const contactsList = document.querySelector('.contacts-list');
  
  // Initialize chat history in localStorage if it doesn't exist
  if (!localStorage.getItem('chatHistory')) {
    const initialHistory = {
      '1': [
        { content: "thabet akhdem ui t3 chat", isReceived: true, time: "10:30 AM" },
        { content: "wshndir fih", isReceived: false, time: "10:32 AM" },
        { content: "lazem nwjed koulech bach tebdaw development alaise", isReceived: true, time: "10:33 AM" },
        { content: "a3tini describtion kefech ak ttkhayel l ui ha ykon", isReceived: false, time: "10:35 AM" },
        { content: "dorka fhemt chwi beli 7abit haja simple rir bach ntesti", isReceived: true, time: "10:36 AM" }
      ],
      '2': [
        { content: "Hi! This is a new conversation with aymen chiboub", isReceived: true, time: "Yesterday" }
      ],
      '3': [
        { content: "Hi! This is a new conversation with abdou", isReceived: true, time: "Mar 12" }
      ]
    };
    localStorage.setItem('chatHistory', JSON.stringify(initialHistory));
  }
  
  function saveChatHistory(contactId, messages) {
    const chatHistory = JSON.parse(localStorage.getItem('chatHistory')) || {};
    chatHistory[contactId] = messages;
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
  }
  
  function getChatHistory(contactId) {
    const chatHistory = JSON.parse(localStorage.getItem('chatHistory')) || {};
    return chatHistory[contactId] || [];
  }
  
  function showNoChatSelectedState() {
    noChatSelected.style.display = 'flex';
    chatContent.style.display = 'none';
  }
  
  function showChatContent() {
    noChatSelected.style.display = 'none';
    chatContent.style.display = 'flex';
    chatContent.style.flexDirection = 'column';
    chatContent.style.height = '100%';
  }
  
  showChatContent();
  
  backButton.addEventListener('click', function() {
    showNoChatSelectedState();
    const contacts = document.querySelectorAll('.contact');
    contacts.forEach(c => c.classList.remove('active'));
  });
  
  function createMessageGroup(message, isReceived, time = null) {
    // If time is not provided, generate current time
    if (!time) {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const formattedHours = hours % 12 || 12;
      const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
      time = `${formattedHours}:${formattedMinutes} ${ampm}`;
    }
    
    const messageGroupElement = document.createElement('div');
    messageGroupElement.className = `message-group ${isReceived ? 'received' : 'sent'}`;
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isReceived ? 'received' : 'sent'}`;
    
    const messageContentElement = document.createElement('div');
    messageContentElement.className = 'message-content';
    messageContentElement.textContent = message;
    
    const timeElement = document.createElement('div');
    timeElement.className = 'message-time';
    timeElement.textContent = time;
    
    messageElement.appendChild(messageContentElement);
    messageElement.appendChild(timeElement);
    messageGroupElement.appendChild(messageElement);
    
    messageGroupElement.classList.add('fade-in');
    
    return {
      element: messageGroupElement,
      time: time,
      text: message
    };
  }
  
  function updateContactPreview(contactId, message, time) {
    const contact = document.querySelector(`.contact[data-contact-id="${contactId}"]`);
    if (contact) {
      const previewElement = contact.querySelector('.contact-preview');
      const timeElement = contact.querySelector('.contact-time');
      
      if (previewElement) {
        previewElement.textContent = message;
      }
      
      if (timeElement) {
        timeElement.textContent = time;
      }
      
      // Move contact to the top of the list
      moveContactToTop(contact);
    }
  }
  
  function moveContactToTop(contactElement) {
    // Remove the contact from its current position
    const parent = contactElement.parentNode;
    parent.removeChild(contactElement);
    
    // Insert it at the beginning of the contacts list
    const firstContact = parent.firstChild;
    parent.insertBefore(contactElement, firstContact);
  }
  
  function sendMessage() {
    const message = messageInput.value.trim();
    if (message === '') return;
    
    const activeContact = document.querySelector('.contact.active');
    const contactId = activeContact ? activeContact.getAttribute('data-contact-id') : '1';
    
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    const timeString = `${formattedHours}:${formattedMinutes} ${ampm}`;
    
    // Create and display the message
    const messageGroup = createMessageGroup(message, false, timeString);
    messagesContainer.appendChild(messageGroup.element);
    
    // Save to chat history
    const chatHistory = getChatHistory(contactId);
    chatHistory.push({
      content: message,
      isReceived: false,
      time: timeString
    });
    saveChatHistory(contactId, chatHistory);
    
    messageInput.value = '';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    updateContactPreview(contactId, message, timeString);
    
    setTimeout(() => {
      simulateResponse(contactId);
    }, 1000 + Math.random() * 2000);
  }
  
  function simulateResponse(contactId) {
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
    
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    const timeString = `${formattedHours}:${formattedMinutes} ${ampm}`;
    
    // Create and display the response
    const messageGroup = createMessageGroup(randomResponse, true, timeString);
    messagesContainer.appendChild(messageGroup.element);
    
    // Save to chat history
    const chatHistory = getChatHistory(contactId);
    chatHistory.push({
      content: randomResponse,
      isReceived: true,
      time: timeString
    });
    saveChatHistory(contactId, chatHistory);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Update contact preview with the response message
    updateContactPreview(contactId, randomResponse, timeString);
  }
  
  sendButton.addEventListener('click', sendMessage);
  
  messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
  
  // Load and display chat for the specified contact
  function loadContactChat(contactId, contactName) {
    messagesContainer.innerHTML = '';
    
    const dateDivider = document.createElement('div');
    dateDivider.className = 'date-divider';
    dateDivider.textContent = 'Today';
    messagesContainer.appendChild(dateDivider);
    
    const messages = getChatHistory(contactId);
    
    if (messages.length === 0) {
      const welcomeMessage = {
        content: `Hi! This is a new conversation with ${contactName}`,
        isReceived: true,
        time: "Just now"
      };
      messages.push(welcomeMessage);
      saveChatHistory(contactId, messages);
    }
    
    messages.forEach(msg => {
      const messageGroupElement = document.createElement('div');
      messageGroupElement.className = `message-group ${msg.isReceived ? 'received' : 'sent'}`;
      
      const messageElement = document.createElement('div');
      messageElement.className = `message ${msg.isReceived ? 'received' : 'sent'}`;
      
      const messageContentElement = document.createElement('div');
      messageContentElement.className = 'message-content';
      messageContentElement.textContent = msg.content;
      
      const timeElement = document.createElement('div');
      timeElement.className = 'message-time';
      timeElement.textContent = msg.time;
      
      messageElement.appendChild(messageContentElement);
      messageElement.appendChild(timeElement);
      messageGroupElement.appendChild(messageElement);
      
      messagesContainer.appendChild(messageGroupElement);
    });
    
    // Update contact preview with the last message, but don't move to top
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const contact = document.querySelector(`.contact[data-contact-id="${contactId}"]`);
      if (contact) {
        const previewElement = contact.querySelector('.contact-preview');
        const timeElement = contact.querySelector('.contact-time');
        
        if (previewElement) {
          previewElement.textContent = lastMessage.content;
        }
        
        if (timeElement) {
          timeElement.textContent = lastMessage.time;
        }
      }
    }
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  const contacts = document.querySelectorAll('.contact');
  contacts.forEach(contact => {
    contact.addEventListener('click', function() {
      contacts.forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      
      showChatContent();
      
      const contactId = this.getAttribute('data-contact-id');
      const contactName = this.querySelector('.contact-name').textContent;
      const contactAvatar = this.querySelector('.contact-avatar').textContent;
      
      document.querySelector('.chat-header .contact-name').textContent = contactName;
      document.querySelector('.chat-header .contact-avatar').textContent = contactAvatar;
      
      loadContactChat(contactId, contactName);
    });
  });
  
  // Load the first contact's chat initially
  const firstContact = document.querySelector('.contact');
  if (firstContact) {
    firstContact.classList.add('active');
    const contactId = firstContact.getAttribute('data-contact-id');
    const contactName = firstContact.querySelector('.contact-name').textContent;
    const contactAvatar = firstContact.querySelector('.contact-avatar').textContent;
    
    document.querySelector('.chat-header .contact-name').textContent = contactName;
    document.querySelector('.chat-header .contact-avatar').textContent = contactAvatar;
    
    loadContactChat(contactId, contactName);
  }
  
  window.toggleChatView = function() {
    if (noChatSelected.style.display === 'none') {
      showNoChatSelectedState();
      contacts.forEach(c => c.classList.remove('active'));
    } else {
      showChatContent();
      contacts[0].classList.add('active');
    }
  };
});
