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
const contactUidInput = document.getElementById("contact-uid-input");
const addContactBtn = document.getElementById("add-contact-btn");
const deleteContactBtn = document.getElementById("delete-contact-btn");
const backButton = document.getElementById("back-button");

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

function renderContacts(contacts) {
    contactsContainer.innerHTML = "";
    
    contacts.forEach(contact => {
        const contactItem = document.createElement("div");
        contactItem.classList.add("contact-item");
        contactItem.dataset.uid = contact.uid;
        
        // Avatar styling
        const firstLetter = contact.username?.charAt(0).toUpperCase() || "?";
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = contact.username?.length % colors.length || 0;
        const avatarColor = colors[colorIndex];
        
        // Get last message preview
        const lastMessage = getLastMessagePreview(contact.uid);
        const lastMessageText = lastMessage?.text || "No messages yet";
        const lastMessageTime = lastMessage?.timestamp ? formatTime(new Date(lastMessage.timestamp)) : "";
        
        contactItem.innerHTML = `
            <div class="contact-avatar" style="background: ${avatarColor}">${firstLetter}</div>
            <div class="contact-info">
                <div class="contact-name-row">
                    <span class="contact-name">${contact.username || "Unknown"}</span>
                    <span class="message-time">${lastMessageTime}</span>
                </div>
                <div class="contact-preview">${lastMessageText}</div>
            </div>
            <span class="unread-count" style="display: ${unreadMessages[contact.uid] > 0 ? 'flex' : 'none'}">
                ${unreadMessages[contact.uid] || ''}
            </span>
        `;
        
        contactItem.addEventListener("click", () => openChat(contact));
        contactsContainer.appendChild(contactItem);
    });
}

function getLastMessagePreview(contactUID) {
    if (!messagesData[contactUID] || messagesData[contactUID].length === 0) return null;
    return messagesData[contactUID][0]; // Return most recent message
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function openChat(contact) {
    currentChatUID = contact.uid;
    messagesContainer.innerHTML = "";
    unreadMessages[contact.uid] = 0;
    updateContactUI();

    // Update UI
    noChatSelected.style.display = "none";
    activeChat.style.display = "flex";
    chatNameElement.textContent = contact.username || contact.uid;
    
    // Set chat avatar
    const firstLetter = contact.username?.charAt(0).toUpperCase() || "?";
    chatAvatarElement.textContent = firstLetter;
    const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
    const colorIndex = contact.username?.length % colors.length || 0;
    chatAvatarElement.style.background = colors[colorIndex];

    // Load and render messages
    const messages = await loadMessages(contact.uid);
    messagesData[contact.uid] = messages;
    renderMessages(messages);
}

async function loadMessages(contactUID, getLastOnly = false) {
    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");

        // Updated URL to include both user.uid and contactUID
        let url = `${BACKEND_URL}/messages/${user.uid}/${contactUID}`;
        if (getLastOnly) url += '?limit=1';

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${user.token}` },
        });

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const messages = await response.json();
        return Array.isArray(messages) ? messages : [];
    } catch (error) {
        console.error("❌ Failed to load messages:", error);
        return [];
    }
}

function renderMessages(messages) {
    messagesContainer.innerHTML = "";
    
    // Group messages by date
    const groupedMessages = groupMessagesByDate(messages);
    
    // Get dates and sort them chronologically (oldest first)
    const sortedDates = Object.keys(groupedMessages).sort((a, b) => {
        // Convert date strings to Date objects for comparison
        return new Date(a) - new Date(b);
    });
    
    // Render each group in chronological order
    sortedDates.forEach(date => {
        // Add date separator
        const dateDivider = document.createElement("div");
        dateDivider.classList.add("date-divider");
        dateDivider.textContent = date;
        messagesContainer.appendChild(dateDivider);
        
        // Render messages for this date in chronological order (without reverse)
        groupedMessages[date].forEach(message => {
            renderMessage(message);
        });
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function groupMessagesByDate(messages) {
    const groups = {};
    
    // Sort all messages by timestamp (oldest first)
    const sortedMessages = [...messages].sort((a, b) => {
        return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });
    
    sortedMessages.forEach(message => {
        const messageDate = new Date(message.timestamp || Date.now());
        const dateKey = formatDate(messageDate);
        
        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        
        groups[dateKey].push(message);
    });
    
    return groups;
}
    
 

function renderMessage(message) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", message.sender === getCurrentUser().uid ? "sent" : "received");
    
    const timeString = formatTime(new Date(message.timestamp || Date.now()));
    
    messageDiv.innerHTML = `
        <div class="message-content">${message.text}</div>
        <div class="message-time">${timeString}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
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
    messagesData[message.sender].push(message);
    
    if (message.sender === currentChatUID) {
        // If current chat is open, render the message
        renderMessage(message);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
        // Otherwise increment unread count
        unreadMessages[message.sender] = (unreadMessages[message.sender] || 0) + 1;
        updateContactUI();
    }
    //update ui
    updateContactUI();
    // Also update contact preview
    updateContactPreviews();
}
function updateContactPreviews() {
    document.querySelectorAll(".contact-item").forEach(item => {
        const uid = item.dataset.uid;
        const lastMessage = getLastMessagePreview(uid);
        
        if (lastMessage) {
            const previewEl = item.querySelector(".contact-preview");
            const timeEl = item.querySelector(".message-time");
            
            previewEl.textContent = lastMessage.text || "No messages yet";
            timeEl.textContent = lastMessage.timestamp ? 
                formatTime(new Date(lastMessage.timestamp)) : "";
        }
    });
}

function setupEventListeners() {
    // Send message on button click or Enter key
    sendBtn.addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });

    // Contact management
    addContactBtn.addEventListener("click", addContact);
    deleteContactBtn.addEventListener("click", deleteContact);

    // Back button
    backButton.addEventListener("click", () => {
        noChatSelected.style.display = "flex";
        activeChat.style.display = "none";
        currentChatUID = null;
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

        // Create message object
        const message = {
            text,
            sender: user.uid,
            receiver: currentChatUID,
            timestamp: new Date().toISOString()
        };

        // Send via WebSocket
        ws.send(JSON.stringify({ 
            type: "message", 
            ...message 
        }));

        // Add to local data and render
        if (!messagesData[currentChatUID]) {
            messagesData[currentChatUID] = [];
        }
        messagesData[currentChatUID].push(message);
        renderMessage(message);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Clear input
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
async function addContact() {
    const user = getCurrentUser();
    const contactUID = contactUidInput.value.trim();
    
    if (!user || !user.token || !contactUID) {
        alert("Invalid user or empty UID!");
        return;
    }

    try {
        // Use the current user's UID in the URL, not the contact's UID
        const response = await fetch(`${BACKEND_URL}/contacts/${user.uid}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${user.token}`
            },
            body: JSON.stringify({ contact_uid: contactUID })
        });

        if (!response.ok) {
            throw new Error(`Failed to add contact: ${response.statusText}`);
        }

        alert("✅ Contact added successfully!");
        contactUidInput.value = ""; // Clear input field
        await loadContacts(); // Refresh contacts list
    } catch (error) {
        console.error("❌ Error adding contact:", error);
        alert("Failed to add contact. Try again.");
    }
}

async function deleteContact() {
    const user = getCurrentUser();
    const contactUID = contactUidInput.value.trim();
    
    if (!user || !user.token || !contactUID) {
        alert("Invalid user or empty UID!");
        return;
    }

    try {
        // Use the current user's UID in the URL, not the contact's UID
        const response = await fetch(`${BACKEND_URL}/contacts/${user.uid}`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${user.token}`
            },
            body: JSON.stringify({ contact_uid: contactUID })
        });

        if (!response.ok) {
            throw new Error(`Failed to delete contact: ${response.statusText}`);
        }

        alert("🗑️ Contact deleted successfully!");
        contactUidInput.value = ""; // Clear input field
        await loadContacts(); // Refresh contacts list
    } catch (error) {
        console.error("❌ Error deleting contact:", error);
        alert("Failed to delete contact. Try again.");
    }
}