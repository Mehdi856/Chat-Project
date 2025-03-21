import { 
  getCurrentUser, 
  fetchContacts, 
  saveMessage, 
  listenForMessages, 
  logoutUser,
  updateMessageSeen,
  listenForTypingStatus,
  updateTypingStatus
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
const userAvatar = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');
const chatName = document.getElementById('chat-name');

// Current chat state
let currentChat = {
  uid: null,
  username: null
};

// Current user
let currentUser = null;

// Contacts data
let contacts = [];

// Track unread message counts
let unreadCounts = {};

// Store messages by user
let messagesByUser = {};

// Track the last seen message timestamp for each contact
let lastSeenTimestamps = {};

// Track the last message timestamp for each contact (for sorting)
let lastMessageTimestamps = {};

// Track the last message content for each contact
let lastMessageContent = {};

// Typing timeout
let typingTimeout = null;

// Message listeners
let messageListeners = {};

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
  
  // Update user avatar with initial and color
  const initial = getInitials(currentUser.username || currentUser.email);
  userAvatar.textContent = initial;
  userAvatar.style.backgroundColor = getUserColor(currentUser.uid || currentUser.email);
  
  // Display user info
  userInfoSpan.textContent = currentUser.username || currentUser.email;
  
  // Load last seen timestamps from localStorage
  loadLastSeenTimestamps();
  
  // Load contacts
  await loadContacts();
  
  // Set up event listeners
  setupEventListeners();
  
  // Start listening for messages from all contacts
  listenForAllMessages();
}

/**
 * Generate a unique color based on user ID or email
 */
function getUserColor(identifier) {
  const colors = [
    '#FF5722', '#E91E63', '#9C27B0', '#673AB7', 
    '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4', 
    '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
    '#FFC107', '#FF9800', '#795548', '#607D8B'
  ];
  
  // Simple hash function to generate consistent colors
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = ((hash << 5) - hash) + identifier.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

/**
 * Load last seen timestamps from localStorage
 */
function loadLastSeenTimestamps() {
  const savedTimestamps = localStorage.getItem(`lastSeenTimestamps_${currentUser.uid}`);
  if (savedTimestamps) {
    lastSeenTimestamps = JSON.parse(savedTimestamps);
  }
}

/**
 * Save last seen timestamps to localStorage
 */
function saveLastSeenTimestamps() {
  localStorage.setItem(`lastSeenTimestamps_${currentUser.uid}`, JSON.stringify(lastSeenTimestamps));
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
 * Listen for messages from all contacts
 */
function listenForAllMessages() {
  contacts.forEach(contact => {
    // Initialize unread counts if not exists
    if (!unreadCounts[contact.uid]) {
      unreadCounts[contact.uid] = 0;
    }
    
    // Set up message listener for each contact
    messageListeners[contact.uid] = listenForMessages(
      currentUser.uid, 
      contact.uid, 
      (messages) => {
        // Store messages for this contact
        messagesByUser[contact.uid] = messages;
        
        // Update last message timestamp and content for sorting
        updateLastMessageInfo(contact.uid, messages);
        
        // Handle new messages for this contact
        handleContactMessages(contact, messages);
      }
    );
  });
}

/**
 * Update the last message timestamp and content for a contact
 */
function updateLastMessageInfo(contactId, messages) {
  if (!messages || messages.length === 0) return;
  
  // Find the most recent message timestamp and content
  const sortedMessages = [...messages].sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  );
  
  const mostRecentMessage = sortedMessages[0];
  
  // Update the last message timestamp for this contact
  lastMessageTimestamps[contactId] = new Date(mostRecentMessage.timestamp).getTime();
  
  // Update the last message content for this contact
  lastMessageContent[contactId] = {
    text: mostRecentMessage.message,
    sender: mostRecentMessage.sender,
    timestamp: mostRecentMessage.timestamp
  };
}

/**
 * Handle messages for a specific contact
 */
function handleContactMessages(contact, messages) {
  // Get last seen timestamp for this contact
  const lastSeenTimestamp = lastSeenTimestamps[contact.uid] || 0;
  
  // Only count new messages received after the last seen timestamp
  const newUnreadCount = messages.filter(
    msg => msg.sender === contact.uid && 
           new Date(msg.timestamp).getTime() > lastSeenTimestamp && 
           !msg.seen
  ).length;
  
  // Get the most recent message timestamp
  const mostRecentTimestamp = lastMessageTimestamps[contact.uid] || 0;
  
  // Update unread count if changed
  if (unreadCounts[contact.uid] !== newUnreadCount) {
    unreadCounts[contact.uid] = newUnreadCount;
    
    // Update UI for this contact
    updateContactUI(contact);
    
    // If this is the active chat, mark messages as seen
    if (currentChat.uid === contact.uid) {
      updateMessageSeen(currentUser.uid, currentChat.uid);
      unreadCounts[contact.uid] = 0;
      updateContactUI(contact);
      
      // Update the last seen timestamp for this contact
      lastSeenTimestamps[contact.uid] = new Date().getTime();
      saveLastSeenTimestamps();
    }
    
    // Always sort contacts by most recent message regardless of unread status
    sortContactsByRecent();
  } else if (mostRecentTimestamp > 0) {
    // Even if unread count didn't change, still sort by most recent message
    // This ensures new messages in active chats still move the contact up
    sortContactsByRecent();
  }
  
  // If this is the active chat, render the messages
  if (currentChat.uid === contact.uid) {
    renderMessages(messages);
  }
}

/**
 * Sort contacts by most recent message and re-render
 */
function sortContactsByRecent() {
  // Create a copy of contacts for sorting
  const contactsToSort = [...contacts];
  
  // Sort contacts by the last message timestamp (most recent first)
  contactsToSort.sort((a, b) => {
    const timeA = lastMessageTimestamps[a.uid] || 0;
    const timeB = lastMessageTimestamps[b.uid] || 0;
    return timeB - timeA;
  });
  
  // Update contacts array with sorted contacts
  contacts = contactsToSort;
  
  // Re-render contacts (if not currently searching)
  if (!searchInput.value) {
    renderContacts(contacts);
  }
}

/**
 * Update UI for a specific contact
 */
function updateContactUI(contact) {
  const contactElement = document.querySelector(`.contact[data-uid="${contact.uid}"]`);
  if (!contactElement) return;
  
  // Update last message preview if available
  const previewElement = contactElement.querySelector('.contact-preview');
  if (previewElement && lastMessageContent[contact.uid]) {
    const lastMsg = lastMessageContent[contact.uid];
    let previewText = lastMsg.text;
    
    // Truncate message if too long
    if (previewText.length > 25) {
      previewText = previewText.substring(0, 25) + '...';
    }
    
    // Add prefix for sent messages
    if (lastMsg.sender === currentUser.uid) {
      previewText = 'You: ' + previewText;
    }
    
    previewElement.textContent = previewText;
  }
  
  // Update or add badge with unread count
  let badgeElement = contactElement.querySelector('.unread-badge');
  const unreadCount = unreadCounts[contact.uid] || 0;
  
  if (unreadCount > 0) {
    if (!badgeElement) {
      // Create badge if it doesn't exist
      badgeElement = document.createElement('div');
      badgeElement.className = 'unread-badge';
      contactElement.appendChild(badgeElement);
    }
    badgeElement.textContent = unreadCount;
    badgeElement.style.display = 'flex';
  } else if (badgeElement) {
    // Hide badge if no unread messages
    badgeElement.style.display = 'none';
  }
  
  // Update timestamp display if we have a last message
  const timestampElement = contactElement.querySelector('.message-date');
  if (timestampElement && lastMessageContent[contact.uid]) {
    const msgDate = new Date(lastMessageContent[contact.uid].timestamp);
    timestampElement.textContent = formatDateForContacts(msgDate);
  }
}

/**
 * Format date for contact list (Today, Yesterday, or DD/MM)
 */
function formatDateForContacts(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (isSameDay(date, today)) {
    return 'Today';
  } else if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  } else {
    // Format as DD/MM
    return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
  }
}

/**
 * Format date for chat day separators
 */
function formatDateForChat(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (isSameDay(date, today)) {
    return 'Today';
  } else if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  } else {
    // Format as Day, Month DD, YYYY
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    });
  }
}

/**
 * Check if two dates are the same day
 */
function isSameDay(date1, date2) {
  return date1.getDate() === date2.getDate() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getFullYear() === date2.getFullYear();
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
    
    // Get unique color for this contact
    const backgroundColor = getUserColor(contact.uid || contact.email);
    
    // Get last message preview text
    let previewText = 'Click to start chatting';
    let dateText = '';
    
    if (lastMessageContent[contact.uid]) {
      const lastMsg = lastMessageContent[contact.uid];
      previewText = lastMsg.text;
      
      // Truncate message if too long
      if (previewText.length > 25) {
        previewText = previewText.substring(0, 25) + '...';
      }
      
      // Add prefix for sent messages
      if (lastMsg.sender === currentUser.uid) {
        previewText = 'You: ' + previewText;
      }
      
      // Format date
      const msgDate = new Date(lastMsg.timestamp);
      dateText = formatDateForContacts(msgDate);
    }
    
    contactElement.innerHTML = `
      <div class="contact-avatar" style="background-color: ${backgroundColor}">${initials}</div>
      <div class="contact-info">
        <div class="contact-name-row">
          <div class="contact-name">${contact.username || contact.email}</div>
          <div class="message-date">${dateText}</div>
        </div>
        <div class="contact-preview">${previewText}</div>
      </div>
    `;
    
    // Add unread badge if needed
    const unreadCount = unreadCounts[contact.uid] || 0;
    if (unreadCount > 0) {
      const badge = document.createElement('div');
      badge.className = 'unread-badge';
      badge.textContent = unreadCount;
      contactElement.appendChild(badge);
    }
    
    // Add click event to start chat
    contactElement.addEventListener('click', () => {
      startChat(contact);
    });
    
    // Highlight if this is the active chat
    if (currentChat.uid === contact.uid) {
      contactElement.classList.add('active');
    }
    
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
  
  // Get unique color for chat avatar
  const backgroundColor = getUserColor(contact.uid || contact.email);
  
  // Update chat header
  const chatAvatar = document.getElementById('chat-avatar');
  chatAvatar.textContent = getInitials(currentChat.username);
  chatAvatar.style.backgroundColor = backgroundColor;
  document.getElementById('chat-name').textContent = currentChat.username;
  
  // Add typing indicator span
  if (!document.getElementById('typing-indicator')) {
    const typingIndicator = document.createElement('span');
    typingIndicator.id = 'typing-indicator';
    typingIndicator.className = 'typing-indicator';
    document.querySelector('.contact-info').appendChild(typingIndicator);
  }
  
  // Clear previous messages
  messagesContainer.innerHTML = '';
  
  // Highlight selected contact
  const contacts = document.querySelectorAll('.contact');
  contacts.forEach(c => c.classList.remove('active'));
  document.querySelector(`.contact[data-uid="${contact.uid}"]`).classList.add('active');
  
  // Mark messages as seen
  updateMessageSeen(currentUser.uid, currentChat.uid);
  
  // Update the last seen timestamp for this contact
  lastSeenTimestamps[contact.uid] = new Date().getTime();
  saveLastSeenTimestamps();
  
  // Reset unread count for this contact
  unreadCounts[contact.uid] = 0;
  updateContactUI(contact);
  
  // Render messages for this chat (if any)
  if (messagesByUser[contact.uid]) {
    renderMessages(messagesByUser[contact.uid]);
  }
  
  // Listen for typing status
  listenForTypingStatus(currentChat.uid, (isTyping) => {
    const typingIndicator = document.getElementById('typing-indicator');
    if (isTyping) {
      typingIndicator.textContent = 'typing...';
      typingIndicator.style.display = 'inline';
    } else {
      typingIndicator.style.display = 'none';
    }
  });
  
  // Focus on input
  messageInput.focus();
}

/**
 * Render messages in the chat window
 */
function renderMessages(messages) {
  if (!messages || messages.length === 0) {
    messagesContainer.innerHTML = '<div class="no-messages">No messages yet</div>';
    return;
  }
  
  messagesContainer.innerHTML = ''; // Clear existing messages
  
  // Sort messages by timestamp to ensure correct order
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  // Find the last message from the current user
  const lastSentMessageIndex = messages.reduceRight((found, msg, index) => {
    if (found === -1 && msg.sender === currentUser.uid) {
      return index;
    }
    return found;
  }, -1);

  // Track the current date to know when to insert date separators
  let currentDateStr = '';

  messages.forEach((msg, index) => {
    const messageDate = new Date(msg.timestamp);
    const messageDateStr = messageDate.toDateString();
    
    // If this message is from a different day than the previous one, add a date separator
    if (messageDateStr !== currentDateStr) {
      currentDateStr = messageDateStr;
      
      const dateSeparator = document.createElement('div');
      dateSeparator.className = 'date-separator';
      dateSeparator.innerHTML = `<span>${formatDateForChat(messageDate)}</span>`;
      messagesContainer.appendChild(dateSeparator);
    }
    
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');

    if (msg.sender === currentUser.uid) {
      messageElement.classList.add('sent');
      
      // Only show status for the last sent message
      const isLastSentMessage = (index === lastSentMessageIndex);
      
      messageElement.innerHTML = `
        <div class="message-content">${msg.message}</div>
        <div class="message-metadata">
          <span class="message-timestamp">${formatTimestamp(msg.timestamp)}</span>
          ${isLastSentMessage ? 
            `<span class="message-status">
              <i class="fas ${msg.seen ? 'fa-check-double' : 'fa-check'}"></i>
            </span>` : ''}
        </div>
      `;
    } else {
      messageElement.classList.add('received');
      
      messageElement.innerHTML = `
        <div class="message-content">${msg.message}</div>
        <div class="message-metadata">
          <span class="message-timestamp">${formatTimestamp(msg.timestamp)}</span>
        </div>
      `;
    }

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
    // Clear the input field immediately
    messageInput.value = '';
    messageInput.focus();
    
    // Then save the message to Firebase
    await saveMessage(currentUser.uid, currentChat.uid, message);
  } catch (error) {
    console.error("Error sending message:", error);
    showMessage("Failed to send message", "error");
  }
}

/**
 * Send typing status to Firebase
 */
function sendTypingStatus(isTyping) {
  if (currentChat.uid) {
    try {
      const typingData = {
        uid: currentUser.uid,
        isTyping: isTyping,
        timestamp: new Date().getTime()
      };
      
      // Call Firebase function to update typing status
      updateTypingStatus(currentUser.uid, currentChat.uid, typingData);
    } catch (error) {
      console.error("Error updating typing status:", error);
    }
  }
}

/**
 * Handle typing events
 */
function handleTyping() {
  // User is typing
  sendTypingStatus(true);
  
  // Clear existing timeout
  if (typingTimeout) clearTimeout(typingTimeout);
  
  // Set new timeout to stop typing indicator after 2 seconds of inactivity
  typingTimeout = setTimeout(() => {
    sendTypingStatus(false);
  }, 2000);
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') sendMessage();
  });
  
  // Add typing indicator
  messageInput.addEventListener('input', handleTyping);
  
  logoutBtn.addEventListener('click', async () => {
    // Save last seen timestamps before logout
    saveLastSeenTimestamps();
    
    // Clean up message listeners before logout
    Object.values(messageListeners).forEach(unsubscribe => {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
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
      (contact.username && contact.username.toLowerCase().includes(query)) || 
      (contact.email && contact.email.toLowerCase().includes(query))
    );
    renderContacts(filteredContacts);
  });
}

// Initialize chat on page load
initChat();
