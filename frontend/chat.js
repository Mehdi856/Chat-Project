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
const backButtonContact = document.getElementById("back-button-contact");
const backButtonGroup = document.getElementById("back-button-group");
const backButtonChat = document.getElementById("back-button-chat");
const displayUidElement = document.getElementById("display-uid");
const contactUidElement = document.getElementById("contact-uid");
const menuButton = document.querySelector('.menu-button');
const dropdown = document.querySelector('.menu-dropdown');
const notificationBell = document.getElementById("notification-bell");
const notificationCount = document.getElementById("notification-count");
const notificationPanel = document.getElementById("notification-panel");
const notificationList = document.getElementById("notification-list");
const closeNotificationBtn = document.getElementById("close-notification-btn");

// State
let currentChatUID = null;
let unreadMessages = {};
let contactsData = [];
let messagesData = {};
let pendingContactRequests = [];

// Initialize chat when page loads
document.addEventListener('DOMContentLoaded', initChat);

async function initChat() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    updateUserHeader(user);
    displayUserUid(user);
    await loadContacts();
    await fetchPendingContactRequests();
    setupWebSocket(user);
    setupEventListeners();
}

function updateUserHeader(user) {
    if (user && user.name) {  // Changed from user.username to user.name
        userInfoElement.textContent = user.name;  // Display the user's name
        const firstLetter = user.name.charAt(0).toUpperCase();  // Get first letter of name
        userAvatarElement.textContent = firstLetter;
        
        // Generate a color based on the name
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = user.name.length % colors.length;
        userAvatarElement.style.background = colors[colorIndex];
    } else {
        // Fallback if name isn't available
        userInfoElement.textContent = "User";
        userAvatarElement.textContent = "U";
        userAvatarElement.style.background = '#6e8efb';
    }
}

function displayUserUid(user) {
    if (user && user.uid) {
        displayUidElement.textContent = `Your UID: ${user.uid}`;
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
        
        await Promise.all(filteredContacts.map(async contact => {
            const messages = await loadMessages(contact.uid, true);
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
        
        const firstLetter = contact.username?.charAt(0).toUpperCase() || "?";
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = contact.username?.length % colors.length || 0;
        const avatarColor = colors[colorIndex];
        
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
    return messagesData[contactUID][0];
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

    noChatSelected.style.display = "none";
    activeChat.style.display = "flex";
    document.getElementById("New-contact").style.display = "none";
    document.getElementById("New-group").style.display = "none";
    
    chatNameElement.textContent = contact.username || contact.uid;
    contactUidElement.textContent = `Contact UID: ${contact.uid}`;
    
    const firstLetter = contact.username?.charAt(0).toUpperCase() || "?";
    chatAvatarElement.textContent = firstLetter;
    const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
    const colorIndex = contact.username?.length % colors.length || 0;
    chatAvatarElement.style.background = colors[colorIndex];

    const messages = await loadMessages(contact.uid);
    messagesData[contact.uid] = messages;
    renderMessages(messages);
}

async function loadMessages(contactUID, getLastOnly = false) {
    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");

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
    
    const groupedMessages = groupMessagesByDate(messages);
    const sortedDates = Object.keys(groupedMessages).sort((a, b) => new Date(a) - new Date(b));
    
    sortedDates.forEach(date => {
        const dateDivider = document.createElement("div");
        dateDivider.classList.add("date-divider");
        dateDivider.textContent = date;
        messagesContainer.appendChild(dateDivider);
        
        groupedMessages[date].forEach(message => {
            renderMessage(message);
        });
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function groupMessagesByDate(messages) {
    const groups = {};
    const sortedMessages = [...messages].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    
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

async function fetchPendingContactRequests() {
    try {
        const user = getCurrentUser();
        if (!user?.token || !user?.uid) return;

        const response = await fetch(`${BACKEND_URL}/contact_requests/${user.uid}`, {
            headers: { Authorization: `Bearer ${user.token}` },
        });

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const data = await response.json();
        pendingContactRequests = data.requests || [];
        updateNotificationCount();
        renderNotifications();
    } catch (error) {
        console.error("❌ Failed to load contact requests:", error);
    }
}

function updateNotificationCount() {
    const count = pendingContactRequests.length;
    notificationCount.textContent = count;
    notificationCount.style.display = count > 0 ? "flex" : "none";
}

function renderNotifications() {
    notificationList.innerHTML = "";
    
    if (pendingContactRequests.length === 0) {
        const emptyMessage = document.createElement("div");
        emptyMessage.classList.add("notification-empty");
        emptyMessage.textContent = "No new notifications";
        notificationList.appendChild(emptyMessage);
        return;
    }
    
    pendingContactRequests.forEach(request => {
        const notificationItem = document.createElement("div");
        notificationItem.classList.add("notification-item");
        
        const timestamp = request.timestamp ? new Date(request.timestamp) : new Date();
        const timeString = formatTime(timestamp);
        
        notificationItem.innerHTML = `
            <div class="notification-header">
                <span class="notification-title">Contact Request</span>
                <span class="notification-time">${timeString}</span>
            </div>
            <div class="notification-content">
                <p><strong>${request.sender_name}</strong> added you as a contact</p>
            </div>
            <div class="notification-actions">
                <button class="btn accept-btn" data-request-id="${request.request_id}">Accept</button>
                <button class="btn decline-btn" data-request-id="${request.request_id}">Decline</button>
            </div>
        `;
        
        notificationItem.querySelector(".accept-btn").addEventListener("click", () => 
            respondToContactRequest(request.request_id, "accept"));
        notificationItem.querySelector(".decline-btn").addEventListener("click", () => 
            respondToContactRequest(request.request_id, "decline"));
        
        notificationList.appendChild(notificationItem);
    });
}

async function respondToContactRequest(requestId, response) {
    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");

        const responseData = await fetch(`${BACKEND_URL}/contact_requests/${requestId}/respond`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${user.token}`
            },
            body: JSON.stringify({ response })
        });

        if (!responseData.ok) throw new Error(`Server error: ${responseData.statusText}`);

        pendingContactRequests = pendingContactRequests.filter(req => req.request_id !== requestId);
        updateNotificationCount();
        renderNotifications();
        
        if (response === "accept") {
            await loadContacts();
        }
        
        alert(`Contact request ${response === "accept" ? "accepted" : "declined"} successfully!`);
    } catch (error) {
        console.error(`❌ Failed to ${response} contact request:`, error);
        alert("Failed to process the request. Please try again.");
    }
}

function toggleNotificationPanel() {
    notificationPanel.style.display = notificationPanel.style.display === "block" ? "none" : "block";
    if (notificationPanel.style.display === "block") {
        renderNotifications();
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
            const data = JSON.parse(event.data);

            if (data.type === "message") {
                handleNewMessage(data);
            } else if (data.type === "typing") {
                showTypingIndicator(data.sender);
            } else if (data.type === "notification") {
                fetchPendingContactRequests();
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
    if (!messagesData[message.sender]) {
        messagesData[message.sender] = [];
    }
    messagesData[message.sender].push(message);
    
    if (message.sender === currentChatUID) {
        renderMessage(message);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
        unreadMessages[message.sender] = (unreadMessages[message.sender] || 0) + 1;
        updateContactUI();
    }
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

        unreadBadge.textContent = unreadCount;
        unreadBadge.style.display = unreadCount > 0 ? "flex" : "none";
    });
}

function setupEventListeners() {
    sendBtn.addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });

    addContactBtn.addEventListener("click", addContact);
    deleteContactBtn.addEventListener("click", deleteCurrentContact);

    notificationBell.addEventListener("click", toggleNotificationPanel);
    closeNotificationBtn.addEventListener("click", () => {
        notificationPanel.style.display = "none";
    });
    
    document.addEventListener("click", (e) => {
        if (!notificationPanel.contains(e.target) && 
            !notificationBell.contains(e.target) && 
            notificationPanel.style.display === "block") {
            notificationPanel.style.display = "none";
        }
    });

    backButtonContact.addEventListener("click", () => {
        document.getElementById("New-contact").style.display = "none";
        noChatSelected.style.display = "flex";
    });
    
    backButtonGroup.addEventListener("click", () => {
        document.getElementById("New-group").style.display = "none";
        noChatSelected.style.display = "flex";
    });
    
    backButtonChat.addEventListener("click", () => {
        activeChat.style.display = "none";
        noChatSelected.style.display = "flex";
        currentChatUID = null;
    });
    
    menuButton.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });
    
    document.addEventListener('click', function() {
        dropdown.style.display = 'none';
    });
    
    let typingTimeout;
    messageInput.addEventListener("input", () => {
        if (ws && ws.readyState === WebSocket.OPEN && currentChatUID) {
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

    logoutBtn.addEventListener("click", logoutUser);
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChatUID) return;

    try {
        const user = getCurrentUser();
        if (!user) throw new Error("User not authenticated");

        const message = {
            text,
            sender: user.uid,
            receiver: currentChatUID,
            timestamp: new Date().toISOString()
        };

        ws.send(JSON.stringify({ 
            type: "message", 
            ...message 
        }));

        if (!messagesData[currentChatUID]) {
            messagesData[currentChatUID] = [];
        }
        messagesData[currentChatUID].push(message);
        renderMessage(message);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        messageInput.value = "";
    } catch (error) {
        console.error("❌ Failed to send message:", error);
    }
}

async function addContact() {
    const user = getCurrentUser();
    const contactUID = contactUidInput.value.trim();
    
    if (!user || !user.token || !contactUID) {
        alert("Invalid user or empty UID!");
        return;
    }

    try {
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

        alert("✅ Contact added successfully! A request has been sent to the user.");
        contactUidInput.value = "";
        document.getElementById("New-contact").style.display = "none";
        noChatSelected.style.display = "flex";
        await loadContacts();
    } catch (error) {
        console.error("❌ Error adding contact:", error);
        alert("Failed to add contact. Try again.");
    }
}

async function deleteCurrentContact() {
    if (!currentChatUID) {
        alert("No contact selected!");
        return;
    }
    
    const user = getCurrentUser();
    
    if (!user || !user.token) {
        alert("Invalid user authentication!");
        return;
    }

    try {
        const response = await fetch(`${BACKEND_URL}/contacts/${user.uid}`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${user.token}`
            },
            body: JSON.stringify({ contact_uid: currentChatUID })
        });

        if (!response.ok) {
            throw new Error(`Failed to delete contact: ${response.statusText}`);
        }

        alert("🗑️ Contact deleted successfully!");
        dropdown.style.display = "none";
        activeChat.style.display = "none";
        noChatSelected.style.display = "flex";
        currentChatUID = null;
        await loadContacts();
    } catch (error) {
        console.error("❌ Error deleting contact:", error);
        alert("Failed to delete contact. Try again.");
    }
}