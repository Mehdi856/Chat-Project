import { getCurrentUser, logoutUser } from "./auth.js";

const BACKEND_URL = "https://chat-project-2.onrender.com";
let ws = null; // WebSocket connection

// DOM Elements
const messagesContainer = document.getElementById("messages-container");
const contactsContainer = document.getElementById("contacts-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const logoutBtn = document.getElementById("logout-btn");
const typingIndicator = document.getElementById("typing-indicator"); // Add this in your HTML

// Current chat state
let currentChatUID = null;
let unreadMessages = {};

/**
 * Initialize chat application
 */
async function initChat() {
  const user = getCurrentUser();
  if (!user || !user.token) {
    window.location.href = "login.html";
    return;
  }

  // Load contacts
  await loadContacts();

  // Set up WebSocket connection
  setupWebSocket(user);

  // Set up event listeners
  setupEventListeners();
}

/**
 * Load contacts from the backend
 */
async function loadContacts() {
  try {
    const user = getCurrentUser();
    if (!user || !user.token) throw new Error("User not authenticated");

    const response = await fetch(`${BACKEND_URL}/contacts`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });

    if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

    const contacts = await response.json();

    // Filter out the logged-in user
    const filteredContacts = contacts.filter(contact => contact.uid !== user.uid);
    renderContacts(filteredContacts);
  } catch (error) {
    console.error("❌ Failed to load contacts:", error);
  }
}

/**
 * Render contacts list
 */
function renderContacts(contacts) {
  contactsContainer.innerHTML = "";
  contacts.forEach(contact => {
    const contactElement = document.createElement("div");
    contactElement.classList.add("contact");
    contactElement.dataset.uid = contact.uid;

    let unreadCount = unreadMessages[contact.uid] || 0;
    contactElement.innerHTML = `
      <span class="contact-name">${contact.username}</span>
      <span class="unread-count">${unreadCount > 0 ? unreadCount : ""}</span>
    `;

    contactElement.addEventListener("click", () => openChat(contact));
    contactsContainer.appendChild(contactElement);
  });
}

/**
 * Open a chat with a specific contact
 */
async function openChat(contact) {
  currentChatUID = contact.uid;
  messagesContainer.innerHTML = ""; // Clear previous messages
  unreadMessages[contact.uid] = 0; // Reset unread count
  updateContactUI(); // Refresh contact list

  // Load previous messages
  await loadMessages(contact.uid);
}

/**
 * Update UI to reflect unread messages
 */
function updateContactUI() {
  document.querySelectorAll(".contact").forEach(contactEl => {
    const uid = contactEl.dataset.uid;
    const unreadCount = unreadMessages[uid] || 0;
    contactEl.querySelector(".unread-count").innerText = unreadCount > 0 ? unreadCount : "";
  });
}

/**
 * Set up WebSocket connection
 */
function setupWebSocket(user) {
  ws = new WebSocket(`wss://chat-project-2.onrender.com/ws`);

  ws.onopen = () => {
    console.log("✅ WebSocket connected");
    
    // Send authentication with Firebase token in headers
    ws.send(JSON.stringify({ type: "auth", token: user.token }));
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === "message") {
        if (message.sender === currentChatUID) {
          renderMessage(message);
        } else {
          unreadMessages[message.sender] = (unreadMessages[message.sender] || 0) + 1;
          updateContactUI();
        }
      } else if (message.type === "typing") {
        showTypingIndicator(message.sender);
      }
    } catch (error) {
      console.error("❌ Error parsing WebSocket message:", error);
    }
  };

  ws.onclose = () => {
    console.warn("⚠️ WebSocket disconnected. Reconnecting in 3 seconds...");
    setTimeout(() => setupWebSocket(user), 3000); // Auto-reconnect
  };

  ws.onerror = (error) => {
    console.error("❌ WebSocket error:", error);
  };
}

/**
 * Load previous messages from backend
 */
async function loadMessages(contactUID) {
  try {
    const user = getCurrentUser();
    if (!user || !user.token) throw new Error("User not authenticated");

    const response = await fetch(`${BACKEND_URL}/messages/${contactUID}`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });

    if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

    const messages = await response.json();
    messages.forEach(renderMessage);
  } catch (error) {
    console.error("❌ Failed to load messages:", error);
  }
}

/**
 * Render a message in the chat window
 */
function renderMessage(message) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("message");
  messageElement.innerHTML = `
    <div class="message-content">${message.text}</div>
    <div class="message-metadata">
      <span class="message-sender">${message.sender}</span>
      <span class="message-timestamp">${formatTimestamp(message.timestamp)}</span>
    </div>
  `;
  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Format timestamp into a user-friendly format
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

/**
 * Send a new message
 */
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentChatUID) return;

  try {
    const user = getCurrentUser();
    if (!user) throw new Error("User not authenticated");

    // Send message via WebSocket
    ws.send(JSON.stringify({ type: "message", text, sender: user.uid, receiver: currentChatUID }));

    // Clear input field
    messageInput.value = "";
  } catch (error) {
    console.error("❌ Failed to send message:", error);
  }
}

/**
 * Show typing indicator
 */
function showTypingIndicator(sender) {
  if (sender === currentChatUID) {
    typingIndicator.innerText = "Typing...";
    setTimeout(() => (typingIndicator.innerText = ""), 3000);
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  sendBtn.addEventListener("click", sendMessage);
  messageInput.addEventListener("input", () => {
    ws.send(JSON.stringify({ type: "typing", sender: getCurrentUser().uid }));
  });

  logoutBtn.addEventListener("click", logoutUser);
}

// Initialize chat on page load
initChat();
