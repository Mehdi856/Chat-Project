import { 
  getCurrentUser, 
  fetchContacts, 
  saveMessage, 
  fetchMessages, 
  logoutUser 
} from './firebase.js';

import { showMessage } from './auth.js';

// DOM Elements
const contactsList = document.getElementById('contacts-list');
const searchInput = document.getElementById('search-contact');
const noChatSelected = document.getElementById('no-chat-selected');
const activeChat = document.getElementById('active-chat');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const backButton = document.getElementById('back-button');
const userInfoSpan = document.getElementById('user-info');
const logoutBtn = document.getElementById('logout-btn');

// Current chat state
let currentChat = {
  uid: null,
  username: null
};

// Current user
let currentUser = null;

// Contacts data
let contacts = [];

/**
 * Initialize chat application
 */
async function initChat() {
  // Check if user is authenticated
  currentUser = getCurrentUser();
  
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }
  
  // Display user info
  userInfoSpan.textContent = currentUser.username || currentUser.email;
  
  // Load contacts
  await loadContacts();
  
  // Set up event listeners
  setupEventListeners();
}

/**
 * Load all contacts from Firestore
 */
async function loadContacts() {
  try {
    contacts = await fetchContacts();
    
    // Filter out current user
    contacts = contacts.filter(contact => contact.uid !== currentUser.uid);
    
    // Render contacts list
    renderContacts(contacts);
  } catch (error) {
    console.error("Error loading contacts:", error);
    showMessage("Failed to load contacts", "error");
  }
}

/**
 * Render contacts in the sidebar
 */
function renderContacts(contactsToRender) {
  contactsList.innerHTML = '';
  
  if (contactsToRender.length === 0) {
    contactsList.innerHTML = '<div class="no-contacts">No contacts found</div>';
    return;
  }
  
  contactsToRender.forEach(contact => {
    const contactElement = document.createElement('div');
    contactElement.className = 'contact';
    contactElement.dataset.uid = contact.uid;
    
    // Get initials for avatar
    const initials = getInitials(contact.username || contact.email);
    
    contactElement.innerHTML = `
      <div class="contact-avatar">${initials}</div>
      <div class="contact-info">
        <div class="contact-name">${contact.username || contact.email}</div>
        <div class="contact-preview">Click to start chatting</div>
      </div>
    `;
    
    // Add click event to start chat
    contactElement.addEventListener('click', () => {
      startChat(contact);
    });
    
    contactsList.appendChild(contactElement);
  });
}

/**
 * Get initials from name or email
 */
function getInitials(name) {
  if (!name) return '?';
  
  if (name.includes('@')) {
    // It's an email
    return name.split('@')[0].charAt(0).toUpperCase();
  }
  
  // It's a name
  const nameParts = name.split(' ');
  if (nameParts.length > 1) {
    return (nameParts[0].charAt(0) + nameParts[1].charAt(0)).toUpperCase();
  }
  
  return name.charAt(0).toUpperCase();
}

/**
 * Start a chat with a contact
 */
function startChat(contact) {
  // Update current chat
  currentChat.uid = contact.uid;
  currentChat.username = contact.username || contact.email;
  
  // Update UI
  noChatSelected.style.display = 'none';
  activeChat.style.display = 'flex';
  
  // Update chat header
  document.getElementById('chat-avatar').textContent = getInitials(currentChat.username);
  document.getElementById('chat-name').textContent = currentChat.username;
  
  // Clear previous messages
  messagesContainer.innerHTML = '';
  
  // Highlight selected contact
  const contacts = document.querySelectorAll('.contact');
  contacts.forEach(c => c.classList.remove('active'));
  document.querySelector(`.contact[data-uid="${contact.uid}"]`).classList.add('active');
  
  // Load messages
  loadMessages();
  
  // Focus on input
  messageInput.focus();
}

/**
 * Load messages between current user and selected contact
 */
async function loadMessages() {
  try {
    const messages = await fetchMessages(currentUser.uid, currentChat.uid);
    
    if (messages.length === 0) {
      // No messages yet
      messagesContainer.innerHTML = `
        <div class="no-messages">
          No messages yet. Say hello!
        </div>
      `;
      return;
    }
    
    // Group messages by date
    const groupedMessages = groupMessagesByDate(messages);
    
    // Render message groups
    renderMessageGroups(groupedMessages);
    
    // Scroll to bottom
    scrollToBottom();
  } catch (error) {
    console.error("Error loading messages:", error);
    showMessage("Failed to load messages", "error");
  }
}

/**
 * Group messages by date
 */
function groupMessagesByDate(messages) {
  const groups = {};
  
  messages.forEach(message => {
    const date = new Date(message.timestamp);
    const dateStr = date.toLocaleDateString();
    
    if (!groups[dateStr]) {
      groups[dateStr] = [];
    }
    
    groups[dateStr].push(message);
  });
  
  return groups;
}

/**
 * Render message groups
 */
function renderMessageGroups(groups) {
  messagesContainer.innerHTML = '';
  
  Object.keys(groups).forEach(date => {
    // Add date divider
    const divider = document.createElement('div');
    divider.className = 'date-divider';
    divider.textContent = formatDate(date);
    messagesContainer.appendChild(divider);
    
    // Add messages for this date
    const messages = groups[date];
    let lastSender = null;
    let messageGroup = null;
    
    messages.forEach(message => {
      const isSent = message.sender === currentUser.uid;
      const sender = isSent ? currentUser.uid : currentChat.uid;
      
      // Start a new message group if sender changes
      if (sender !== lastSender) {
        messageGroup = document.createElement('div');
        messageGroup.className = `message-group ${isSent ? 'sent' : 'received'}`;
        messagesContainer.appendChild(messageGroup);
        lastSender = sender;
      }
      
      // Create message element
      const messageElement = document.createElement('div');
      messageElement.className = `message ${isSent ? 'sent' : 'received'} fade-in`;
      
      const time = new Date(message.timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      messageElement.innerHTML = `
        <div class="message-content">${message.message}</div>
        <div class="message-time">${time}</div>
      `;
      
      messageGroup.appendChild(messageElement);
    });
  });
  
  // Scroll to bottom
  scrollToBottom();
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  const today = new Date().toLocaleDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString();
  
  if (dateStr === today) {
    return "Today";
  } else if (dateStr === yesterdayStr) {
    return "Yesterday";
  } else {
    return dateStr;
  }
}

/**
 * Send a message
 */
async function sendMessage() {
  const message = messageInput.value.trim();
  
  if (!message) return;
  
  try {
    const success = await saveMessage(currentUser.uid, currentChat.uid, message);
    
    if (success) {
      // Clear input
      messageInput.value = '';
      
      // Reload messages
      await loadMessages();
      
      // Focus input
      messageInput.focus();
    } else {
      showMessage("Failed to send message", "error");
    }
  } catch (error) {
    console.error("Error sending message:", error);
    showMessage("Failed to send message", "error");
  }
}

/**
 * Scroll messages container to bottom
 */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Filter contacts by search term
 */
function filterContacts() {
  const searchTerm = searchInput.value.toLowerCase();
  
  if (!searchTerm) {
    renderContacts(contacts);
    return;
  }
  
  const filtered = contacts.filter(contact => {
    const username = (contact.username || contact.email).toLowerCase();
    return username.includes(searchTerm);
  });
  
  renderContacts(filtered);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Send message on button click
  sendBtn.addEventListener('click', sendMessage);
  
  // Send message on Enter key
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
  
  // Back button (mobile view)
  backButton.addEventListener('click', () => {
    activeChat.style.display = 'none';
    noChatSelected.style.display = 'flex';
    currentChat = { uid: null, username: null };
    
    // Remove active class from contacts
    const contacts = document.querySelectorAll('.contact');
    contacts.forEach(c => c.classList.remove('active'));
  });
  
  // Search contacts
  searchInput.addEventListener('input', filterContacts);
  
  // Logout button
  logoutBtn.addEventListener('click', async () => {
    await logoutUser();
  });
}

// Initialize chat when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Check if we're on the chat page
  if (document.querySelector('.chat-container')) {
    initChat();
  }
});

// Export functions
export { initChat };
