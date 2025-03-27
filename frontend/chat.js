import { getCurrentUser, logoutUser } from "./auth.js";

const BACKEND_URL = "https://chat-project-2.onrender.com";
let ws = null; // WebSocket connection

// DOM Elements
const messagesContainer = document.getElementById("messages-container");
const contactsContainer = document.getElementById("contacts-list");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const logoutBtn = document.getElementById("logout-btn");
const typingIndicator = document.getElementById("typing-indicator");
const userInfoElement = document.getElementById("user-info");
const userAvatarElement = document.getElementById("user-avatar");
const noChatSelected = document.getElementById("no-chat-selected");
const activeChat = document.getElementById("active-chat");
const chatNameElement = document.getElementById("chat-name");
const chatAvatarElement = document.getElementById("chat-avatar");

// State
let currentChatUID = null;
let unreadMessages = {};
let contactsData = [];
let messagesData = {};

// Initialize chat when page loads
document.addEventListener('DOMContentLoaded', initChat);

async function initChat() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    updateUserHeader(user);
    await loadContacts();
    setupWebSocket(user);
    setupEventListeners();
}

function updateUserHeader(user) {
    if (user && user.username) {
        userInfoElement.textContent = user.username;
        const firstLetter = user.username.charAt(0).toUpperCase();
        userAvatarElement.textContent = firstLetter;
        
        // Generate consistent color based on username
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = user.username.length % colors.length;
        userAvatarElement.style.background = colors[colorIndex];
    }
}

async function loadContacts() {
    try {
        const user = getCurrentUser();
        if (!user?.token || !user?.uid) throw new Error("User not authenticated");

        const response = await fetch(`${BACKEND_URL}/contacts/${user.uid}`, {
            headers: { Authorization: `Bearer ${user.token}` },
        });

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const data = await response.json();
        contactsData = data.contacts || [];
        const filteredContacts = contactsData.filter(contact => contact.uid !== user.uid);
        
        // Load last messages for each contact
        await Promise.all(filteredContacts.map(async contact => {
            const messages = await loadMessages(contact.uid, true); // true = load only last message
            messagesData[contact.uid] = messages || [];
        }));

        renderContacts(filteredContacts);
    } catch (error) {
        console.error("❌ Failed to load contacts:", error);
    }
}


function setupWebSocket(user) {
    ws = new WebSocket(`wss://chat-project-2.onrender.com/ws`);
    
    ws.onopen = () => {
        console.log("✅ WebSocket connected");
        ws.send(JSON.stringify({ token: user.token }));
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);

            if (message.type === "message") {
                handleNewMessage(message);
            } else if (message.type === "typing") {
                showTypingIndicator(message.sender);
            }
        } catch (error) {
            console.error("❌ Error parsing WebSocket message:", error);
        }
    };

    ws.onclose = () => {
        console.warn("⚠️ WebSocket disconnected. Reconnecting in 3 seconds...");
        setTimeout(() => setupWebSocket(user), 3000);
    };

    ws.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
    };
}

function handleNewMessage(message) {
    // Add to messages data
    if (!messagesData[message.sender]) {
        messagesData[message.sender] = [];
    }
    messagesData[message.sender].unshift(message);
    
    if (message.sender === currentChatUID) {
        // If current chat is open, render the message
        renderMessage(message);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
        // Otherwise increment unread count
        unreadMessages[message.sender] = (unreadMessages[message.sender] || 0) + 1;
        updateContactUI();
    }
}

function setupEventListeners() {
    // Send message on button click or Enter key
    sendBtn.addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });

    // Typing indicator
    let typingTimeout;
    messageInput.addEventListener("input", () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
                type: "typing", 
                sender: getCurrentUser().uid,
                receiver: currentChatUID
            }));
            
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                typingIndicator.style.display = "none";
            }, 2000);
        }
    });

    // Logout button
    logoutBtn.addEventListener("click", logoutUser);
}

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

function showTypingIndicator(senderUID) {
    if (senderUID === currentChatUID) {
        typingIndicator.style.display = "block";
        typingIndicator.textContent = "typing...";
        setTimeout(() => {
            typingIndicator.style.display = "none";
        }, 2000);
    }
}

function updateContactUI() {
    document.querySelectorAll(".contact-item").forEach(item => {
        const uid = item.dataset.uid;
        const unreadCount = unreadMessages[uid] || 0;
        const unreadBadge = item.querySelector(".unread-count");

        if (unreadCount > 0) {
            unreadBadge.textContent = unreadCount;
            unreadBadge.style.display = "flex";
        } else {
            unreadBadge.style.display = "none";
        }
    });
}

// Function to show typing indicator
function showTypingIndicator(senderUID) {
    if (senderUID === currentChatUID) {
        typingIndicator.style.display = "block";
        setTimeout(() => {
            typingIndicator.style.display = "none";
        }, 2000); // Hide after 2s
    }
}

function renderContacts(contacts) {
  contactsContainer.innerHTML = "";
  contacts.forEach(contact => {
      const contactItem = document.createElement("div");
      contactItem.classList.add("contact-item");
      contactItem.dataset.uid = contact.uid; // ✅ Correctly set UID
      contactItem.innerHTML = `
          <span>${contact.username || "Unknown"}</span> <!-- Avoid undefined -->
          <span class="unread-count" style="display: none;"></span>
      `;
      contactItem.addEventListener("click", () => openChat({ uid: contact.uid, username: contact.username })); // ✅ Pass correct object
      contactsContainer.appendChild(contactItem);
  });

}

// Function to render messages
function renderMessage(message) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", message.sender === getCurrentUser().uid ? "sent" : "received");
    messageDiv.textContent = message.text;
    messagesContainer.prepend(messageDiv);
    

}


// Initialize chat on page load
initChat();
