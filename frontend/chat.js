import { 
  getCurrentUser, 
  fetchContacts, 
  saveMessage, 
  listenForMessages, 
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
  
  // Listen for messages in real time
  listenForMessages(currentUser.uid, currentChat.uid, renderMessages);
  
  // Focus on input
  messageInput.focus();
}

/**
 * Render messages in the chat window
 */
function renderMessages(messages) {
  messagesContainer.innerHTML = ''; // Clear existing messages

  messages.forEach(msg => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');

    if (msg.sender === currentUser.uid) {
      messageElement.classList.add('sent');
    } else {
      messageElement.classList.add('received');
    }

    messageElement.innerHTML = `
      <div class="message-content">${msg.message}</div>
      <div class="message-timestamp">${formatTimestamp(msg.timestamp)}</div>
    `;

    messagesContainer.appendChild(messageElement);
  });

  // Scroll to bottom
  scrollToBottom();
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Scroll chat to bottom
 */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Send a new message
 */
async function sendMessage() {
  const message = messageInput.value.trim();
  if (message === '' || !currentChat.uid) return;

  try {
    await saveMessage(currentUser.uid, currentChat.uid, message);
    messageInput.value = '';
    messageInput.focus();
  } catch (error) {
    console.error("Error sending message:", error);
    showMessage("Failed to send message", "error");
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') sendMessage();
  });
  
  logoutBtn.addEventListener('click', async () => {
    await logoutUser();
  });

  backButton.addEventListener('click', () => {
    activeChat.style.display = 'none';
    noChatSelected.style.display = 'flex';
    currentChat = { uid: null, username: null };
  });

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    const filteredContacts = contacts.filter(contact => 
      contact.username.toLowerCase().includes(query) || 
      contact.email.toLowerCase().includes(query)
    );
    renderContacts(filteredContacts);
  });
}

// Initialize chat on page load
initChat();
