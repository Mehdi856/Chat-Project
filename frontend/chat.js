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
const userSearchInput = document.getElementById("user-search-input");
const searchResultsContainer = document.getElementById("search-results");

// Tab switching elements
const dmsTab = document.getElementById("dms-tab");
const groupsTab = document.getElementById("groups-tab");
const contactsList = document.getElementById("contacts-list");
const groupsList = document.getElementById("groups-list");

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
    setupSearchListeners();
}

function updateUserHeader(user) {
    if (user && user.name) {
        // Remove the text-skeleton class to prevent box appearance
        userInfoElement.classList.remove("text-skeleton");
        userInfoElement.textContent = user.name;
        
        const firstLetter = user.name.charAt(0).toUpperCase();
        userAvatarElement.innerHTML = firstLetter; // Changed from textContent to innerHTML
        userAvatarElement.classList.remove("avatar-skeleton"); // Remove skeleton class
        
        // Generate a color based on the name
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = user.name.length % colors.length;
        userAvatarElement.style.background = colors[colorIndex];
    } else {
        // Fallback if name isn't available
        userInfoElement.classList.remove("text-skeleton");
        userInfoElement.textContent = "User";
        userAvatarElement.innerHTML = "U";
        userAvatarElement.classList.remove("avatar-skeleton");
        userAvatarElement.style.background = '#6e8efb';
    }
}

function displayUserUid(user) {
    if (user && user.uid) {
        displayUidElement.textContent = `Username: ${user.username}`;
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
        
        // Load messages for each contact first before sorting
        await Promise.all(filteredContacts.map(async contact => {
            const messages = await loadMessages(contact.uid, false); // Changed to get all messages
            messagesData[contact.uid] = messages || [];
        }));

        // Sort contacts by most recent message after all messages are loaded
        sortContactsByRecentMessage(filteredContacts);
        renderContacts(filteredContacts);
    } catch (error) {
        console.error("❌ Failed to load contacts:", error);
    }
}

// Improved function to sort contacts by most recent message
function sortContactsByRecentMessage(contacts) {
    contacts.sort((a, b) => {
        const messagesA = messagesData[a.uid] || [];
        const messagesB = messagesData[b.uid] || [];
        
        // Find the newest message timestamp for each contact
        const latestTimeA = messagesA.length > 0 ? 
            Math.max(...messagesA.map(m => new Date(m.timestamp || 0).getTime())) : 0;
        
        const latestTimeB = messagesB.length > 0 ? 
            Math.max(...messagesB.map(m => new Date(m.timestamp || 0).getTime())) : 0;
        
        // Sort descending (newest first)
        return latestTimeB - latestTimeA;
    });
}

function renderContacts(contacts) {
    contactsContainer.innerHTML = "";
    
    contacts.forEach(contact => {
        const contactItem = document.createElement("div");
        contactItem.classList.add("contact-item");
        contactItem.dataset.uid = contact.uid;
        
        const firstLetter = (contact.name || contact.username)?.charAt(0).toUpperCase() || "?";
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = (contact.name || contact.username)?.length % colors.length || 0;
        const avatarColor = colors[colorIndex];
        
        // Use improved getLastMessagePreview function to always get the most recent message
        const lastMessage = getLastMessagePreview(contact.uid);
        const lastMessageText = lastMessage?.text || "No messages yet";
        
        // Format time based on message age (today, yesterday, or date)
        let timeString = "";
        if (lastMessage?.timestamp) {
            timeString = formatMessageTime(new Date(lastMessage.timestamp));
        }
        
        contactItem.innerHTML = `
            <div class="contact-avatar" style="background: ${avatarColor}">${firstLetter}</div>
            <div class="contact-info">
                <div class="contact-name-row">
                    <span class="contact-name">${contact.name || contact.username}</span>
                    <span class="message-time">${timeString}</span>
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

// Improved function to get the last message
function getLastMessagePreview(contactUID) {
    if (!messagesData[contactUID] || messagesData[contactUID].length === 0) return null;
    
    // Create a copy and sort by timestamp descending (newest first)
    const sortedMessages = [...messagesData[contactUID]].sort(
        (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
    );
    
    // Return the first message (newest)
    return sortedMessages[0];
}

// Function to format message time based on age
function formatMessageTime(date) {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    
    // Same day - show time
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // Yesterday - show "Yesterday"
    else if (date.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
    }
    // Different year - show date with year
    else if (date.getFullYear() !== now.getFullYear()) {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // Different day this year - show date
    else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
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
    
    chatNameElement.textContent = contact.name || contact.username;
    contactUidElement.textContent = `Username: ${contact.username}`;
    
    const firstLetter = (contact.name || contact.username)?.charAt(0).toUpperCase() || "?";
    chatAvatarElement.textContent = firstLetter;
    const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
    const colorIndex = (contact.name || contact.username)?.length % colors.length || 0;
    chatAvatarElement.style.background = colors[colorIndex];

    // Reload messages to ensure we have the latest
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

// Completely revamped function to handle new messages and always move contacts to top
function handleNewMessage(message) {
    const currentUser = getCurrentUser();
    const isSentByMe = message.sender === currentUser.uid;
    
    // Determine the relevant contact UID (whether sender or receiver)
    const contactUID = isSentByMe ? message.receiver : message.sender;
    
    // Initialize message array for this contact if it doesn't exist
    if (!messagesData[contactUID]) {
        messagesData[contactUID] = [];
    }
    
    // Add message to the messages array with proper timestamp
    const newMessage = {
        ...message,
        timestamp: message.timestamp || new Date().toISOString()
    };
    
    // Add the message to the messages data
    messagesData[contactUID].push(newMessage);
    
    // Render message if in active chat
    if (contactUID === currentChatUID || 
        (isSentByMe && message.receiver === currentChatUID)) {
        renderMessage(newMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else if (!isSentByMe) {
        // Only increment unread count for messages we receive
        unreadMessages[contactUID] = (unreadMessages[contactUID] || 0) + 1;
    }
    
    // ALWAYS move contact to the top of the list, for both sent and received messages
    moveContactToTop(contactUID);
}

// Improved function to move a contact to the top of the list
function moveContactToTop(contactUID) {
    // Find the contact in contactsData
    const contactIndex = contactsData.findIndex(c => c.uid === contactUID);
    
    if (contactIndex === -1) return; // Contact not found
    
    // Get the contact
    const contactToMove = contactsData[contactIndex];
    
    // Remove the contact from current position
    contactsData.splice(contactIndex, 1);
    
    // Add to beginning (top) of the array
    contactsData.unshift(contactToMove);
    
    // Re-render contacts with the new order
    const currentUser = getCurrentUser();
    const filteredContacts = contactsData.filter(contact => contact.uid !== currentUser.uid);
    renderContacts(filteredContacts);
    
    // Update the UI for unread counts and latest message previews
    updateContactUI();
}

// Improved function to update contact UI with latest message preview
function updateContactUI() {
    document.querySelectorAll(".contact-item").forEach(item => {
        const uid = item.dataset.uid;
        const unreadCount = unreadMessages[uid] || 0;
        const unreadBadge = item.querySelector(".unread-count");
        
        if (unreadBadge) {
            unreadBadge.textContent = unreadCount;
            unreadBadge.style.display = unreadCount > 0 ? "flex" : "none";
        }
        
        // Always get the most recent message for preview
        const lastMessage = getLastMessagePreview(uid);
        if (lastMessage) {
            const previewElement = item.querySelector(".contact-preview");
            const timeElement = item.querySelector(".message-time");
            
            if (previewElement) {
                previewElement.textContent = lastMessage.text || "No messages yet";
            }
            
            if (timeElement && lastMessage.timestamp) {
                timeElement.textContent = formatMessageTime(new Date(lastMessage.timestamp));
            }
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

function setupEventListeners() {
    // Add this new event listener for the contacts search
    const contactSearchInput = document.querySelector('input[placeholder="Search contacts..."]');
    if (contactSearchInput) {
        contactSearchInput.addEventListener('input', filterContacts);
    }

    // Settings button now opens the name change modal directly
    document.getElementById("settings-button").addEventListener("click", () => {
      document.getElementById("name-change-modal").style.display = "flex";
    });
    
    document.getElementById("name-change-cancel").addEventListener("click", () => {
      document.getElementById("name-change-modal").style.display = "none";
    });
    
    document.getElementById("name-change-submit").addEventListener("click", changeUserName);
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
    
    // Tab switching functionality
    dmsTab.addEventListener("click", () => {
        dmsTab.classList.add("active");
        groupsTab.classList.remove("active");
        contactsList.style.display = "block";
        groupsList.style.display = "none";
        
        // Animation reset
        contactsList.style.animation = 'none';
        contactsList.offsetHeight; // Trigger reflow
        contactsList.style.animation = 'fadeIn 0.3s ease forwards';
    });

    groupsTab.addEventListener("click", () => {
        groupsTab.classList.add("active");
        dmsTab.classList.remove("active");
        contactsList.style.display = "none";
        groupsList.style.display = "block";
        
        // Animation reset
        groupsList.style.animation = 'none';
        groupsList.offsetHeight; // Trigger reflow
        groupsList.style.animation = 'fadeIn 0.3s ease forwards';
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

// Add this new function for filtering contacts
function filterContacts(e) {
    const searchTerm = e.target.value.trim().toLowerCase();
    const contactItems = document.querySelectorAll('.contact-item');
    
    contactItems.forEach(item => {
        const contactName = item.querySelector('.contact-name').textContent.toLowerCase();
        if (contactName.startsWith(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
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

        // Clear input field immediately for better UX
        messageInput.value = "";
        
        // Handle the sent message locally
        handleNewMessage(message);
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

async function changeUserName() {
    const newName = document.getElementById("name-change-input").value.trim();
    if (!newName) {
      alert("Please enter a valid name");
      return;
    }
  
    try {
      const user = getCurrentUser();
      if (!user?.token) throw new Error("User not authenticated");
  
      // Update in Firestore
      const response = await fetch(`${BACKEND_URL}/update_name`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`
        },
        body: JSON.stringify({ name: newName })
      });
  
      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }
  
      // Get current user data from localStorage
      const storedUser = JSON.parse(localStorage.getItem("user"));
      if (!storedUser) {
        throw new Error("User data not found in localStorage");
      }
  
      // Update local user data
      storedUser.name = newName;
      
      // Update in localStorage
      localStorage.setItem("user", JSON.stringify(storedUser));
  
      // Close modal and update UI
      document.getElementById("name-change-modal").style.display = "none";
      document.getElementById("name-change-input").value = "";
      
      // Refresh user display with updated data
      updateUserHeader(storedUser);
      await loadContacts(); // Refresh contacts list if needed
      
      alert("Name updated successfully!");
    } catch (error) {
      console.error("❌ Failed to update name:", error);
      alert("Failed to update name. Please try again.");
    }
  }

// Setup search input event listener
function setupSearchListeners() {
    userSearchInput.addEventListener("input", debounce(handleUserSearch, 300));
}

// Debounce function to limit API calls
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Handle user search
async function handleUserSearch(e) {
    const searchTerm = e.target.value.trim();
    if (searchTerm.length < 2) {
        searchResultsContainer.style.display = "none";
        return;
    }

    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");

        const response = await fetch(`${BACKEND_URL}/search_users?q=${encodeURIComponent(searchTerm)}`, {
            headers: { Authorization: `Bearer ${user.token}` },
        });

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const results = await response.json();
        displaySearchResults(results.users || []);
    } catch (error) {
        console.error("❌ Failed to search users:", error);
        searchResultsContainer.style.display = "none";
    }
}

// Display search results
function displaySearchResults(users) {
    searchResultsContainer.innerHTML = "";
    
    if (users.length === 0) {
        const noResults = document.createElement("div");
        noResults.classList.add("search-result-item");
        noResults.textContent = "No users found";
        searchResultsContainer.appendChild(noResults);
        searchResultsContainer.style.display = "block";
        return;
    }

    users.forEach(user => {
        // Skip the current user in search results
        const currentUser = getCurrentUser();
        if (user.uid === currentUser?.uid) return;

        const resultItem = document.createElement("div");
        resultItem.classList.add("search-result-item");
        
        const firstLetter = user.name?.charAt(0).toUpperCase() || "?";
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = user.name?.length % colors.length || 0;
        const avatarColor = colors[colorIndex];
        
        resultItem.innerHTML = `
    <div class="search-result-avatar" style="background: ${avatarColor}">${firstLetter}</div>
    <div class="search-result-info">
        <div class="search-result-name">${user.name || "Unknown"}</div>
        <div class="search-result-username">@${user.username || ""}</div>
    </div>
    <button class="add-contact-btn" data-uid="${user.uid}">Add Contact</button>
`;
        
        searchResultsContainer.appendChild(resultItem);
    });

    // Add event listeners to all add contact buttons
    document.querySelectorAll(".add-contact-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const uid = btn.dataset.uid;
            addSearchedContact(uid);
        });
    });

    searchResultsContainer.style.display = "block";
}

// Add contact from search results
async function addSearchedContact(contactUID) {
    const user = getCurrentUser();
    
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

        alert("✅ Contact request sent successfully!");
        userSearchInput.value = "";
        searchResultsContainer.style.display = "none";
        await loadContacts();
    } catch (error) {
        console.error("❌ Error adding contact:", error);
        alert("Failed to add contact. Try again.");
    }
}

// Close search results when clicking outside
document.addEventListener("click", (e) => {
    if (!searchResultsContainer.contains(e.target) && 
        !userSearchInput.contains(e.target)) {
        searchResultsContainer.style.display = "none";
    }
});
