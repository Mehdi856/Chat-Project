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
const memberDetailsCache = {};
let currentModalAction = null;
let currentGroupData = null;
let selectedMember = null;
let groupsData = [];
let currentGroupId = null;
let groupMessagesData = {};
let currentChatUID = null;
let unreadMessages = {};
let contactsData = [];
let messagesData = {};
let pendingContactRequests = [];
let peerConnection;
let localStream;
let remoteStream;
let callTimer;
let callStartTime;
let currentCallType = null; // 'video' or 'voice'
let isCaller = false;

// Initialize chat when page loads
document.addEventListener('DOMContentLoaded', initChat);

// In chat.js, modify the initChat function:
async function initChat() {
    // First check if user is authenticated
    const user = getCurrentUser();
    if (!user || !user.token) {
        window.location.href = "login.html";
        return;
    }

    // Simple token validation (just check if it exists)
    try {
        // Try to validate the token by making a simple API call
        // Use a more reliable endpoint that we know exists (user profile or contacts)
        const testResponse = await fetch(`${BACKEND_URL}/contacts/${user.uid}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${user.token}` }
        });
        
        // If token is invalid, try to refresh it
        if (!testResponse.ok) {
            console.log("Token validation failed, attempting to refresh...");
            const refreshed = await refreshToken(user);
            if (!refreshed) {
                throw new Error("Failed to refresh token");
            }
        }
        
        // Now proceed with initialization
        updateUserHeader(user);
        displayUserUid(user);
        await loadContacts();
        await loadGroups();
        await fetchPendingContactRequests();
        setupWebSocket(user);
        setupEventListeners();
        setupSearchListeners();
        await initProfilePicture();
    } catch (error) {
        console.error("Initialization error:", error);
        // Check if this is an authentication error
        if (error.message && (error.message.includes("authenticated") || error.message.includes("token"))) {
            alert("Your session has expired. Please log in again.");
            logoutUser();
            window.location.href = "login.html";
        }
    }
}

// Add a function to refresh the token
async function refreshToken(user) {
    try {
        if (!user || !user.customToken) {
            return false;
        }
        
        // Import Firebase auth from firebase.js to avoid circular dependencies
        // This function uses the Firebase auth we've already initialized
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js");
        const { app } = await import("./firebase.js");
        const auth = getAuth(app);
        
        // Re-authenticate with Firebase using the stored custom token
        await auth.signInWithCustomToken(user.customToken);
        
        // Get a fresh ID token
        const currentUser = auth.currentUser;
        if (!currentUser) {
            return false;
        }
        
        const freshToken = await currentUser.getIdToken(true); // Force refresh
        
        // Update the user object in localStorage
        user.idToken = freshToken;
        user.token = freshToken; // Also update the token property
        localStorage.setItem("user", JSON.stringify(user));
        
        console.log("Token refreshed successfully");
        return true;
    } catch (error) {
        console.error("Failed to refresh token:", error);
        return false;
    }
}

// Update the updateUserHeader function to handle profile pictures
function updateUserHeader(user) {
    if (user && user.name) {
        userInfoElement.classList.remove("text-skeleton");
        userInfoElement.textContent = user.name;
        
        // Handle profile picture if available
        if (user.profile_picture_url) {
            userAvatarElement.innerHTML = `<img src="${user.profile_picture_url}" alt="Profile">`;
            userAvatarElement.classList.remove("avatar-skeleton");
        } else {
            // Fallback to initials if no profile picture
            const firstLetter = user.name.charAt(0).toUpperCase();
            userAvatarElement.innerHTML = firstLetter;
            userAvatarElement.classList.remove("avatar-skeleton");
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = user.name.length % colors.length;
            userAvatarElement.style.background = colors[colorIndex];
        }
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

// Update renderContacts to properly display contact profile pictures
function renderContacts(contacts) {
    contactsContainer.innerHTML = "";
    
    contacts.forEach(contact => {
        const contactItem = document.createElement("div");
        contactItem.classList.add("contact-item");
        contactItem.dataset.uid = contact.uid;
        
        // Use profile picture if available, otherwise fall back to initials
        let avatarHTML;
        if (contact.profile_picture_url) {
            avatarHTML = `<img src="${contact.profile_picture_url}" alt="${contact.name}" class="contact-avatar-img">`;
        } else {
            const firstLetter = (contact.name || contact.username)?.charAt(0).toUpperCase() || "?";
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = (contact.name || contact.username)?.length % colors.length || 0;
            avatarHTML = `<div class="contact-avatar-initials" style="background: ${colors[colorIndex]}">${firstLetter}</div>`;
        }
        
        const lastMessage = getLastMessagePreview(contact.uid);
        const lastMessageText = lastMessage?.text || "No messages yet";
        let timeString = "";
        if (lastMessage?.timestamp) {
            timeString = formatMessageTime(new Date(lastMessage.timestamp));
        }
        
        contactItem.innerHTML = `
            <div class="contact-avatar">${avatarHTML}</div>
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

// Update openChat to handle profile pictures in chat header
async function openChat(contact) {
    currentChatUID = contact.uid;
    currentGroupId = null;
    messagesContainer.innerHTML = "";
    unreadMessages[contact.uid] = 0;
    updateContactUI();

    noChatSelected.style.display = "none";
    activeChat.style.display = "flex";
    document.getElementById("New-contact").style.display = "none";
    document.getElementById("New-group").style.display = "none";
    
    document.querySelectorAll('.private-chat-only').forEach(el => el.style.display = 'block');
    document.querySelectorAll('.group-chat-only').forEach(el => el.style.display = 'none');
    
    chatNameElement.textContent = contact.name || contact.username;
    contactUidElement.textContent = `Username: ${contact.username}`;
    
    // Handle profile picture in chat header
    if (contact.profile_picture_url) {
        chatAvatarElement.innerHTML = `<img src="${contact.profile_picture_url}" alt="${contact.name}" class="chat-avatar-img">`;
    } else {
        const firstLetter = (contact.name || contact.username)?.charAt(0).toUpperCase() || "?";
        chatAvatarElement.innerHTML = firstLetter;
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = (contact.name || contact.username)?.length % colors.length || 0;
        chatAvatarElement.style.background = colors[colorIndex];
    }

    const messages = await loadMessages(contact.uid);
    messagesData[contact.uid] = messages;
    renderMessages(messages);
    const messageInput = document.getElementById('message-input');
    if (messageInput) messageInput.value = '';
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
        
        // Process messages to ensure file data is properly structured
        return messages.map(msg => ({
            ...msg,
            // Ensure type is properly set for rendering
            type: msg.file_url ? 
                 (msg.file_type.startsWith('image/') ? 'image' : 
                  msg.file_type.startsWith('video/') ? 'video' : 'file') 
                 : 'message',
            // Ensure timestamp is in correct format
            timestamp: msg.timestamp?.toDate?.()?.toISOString() || msg.timestamp
        }));
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

// Update the existing renderMessage function
function renderMessage(message) {
    const messageDiv = document.createElement("div");
    const currentUser = getCurrentUser();
    const isSentByMe = message.sender === currentUser?.uid;
    
    messageDiv.classList.add("message", isSentByMe ? "sent" : "received");
    
    let content = '';
    const timeString = formatTime(new Date(message.timestamp || Date.now()));
    
    // Handle different message types
    switch(message.type) {
        case 'image':
            content = `
                <div class="message-file image">
                    <img src="${message.file_url}" alt="${message.text}" 
                         loading="lazy" class="message-image"
                         onclick="openImagePreview('${message.file_url}')">
                    <div class="message-meta">
                        <span class="message-time">${timeString}</span>
                        ${isSentByMe ? '<i class="fas fa-check-double read-receipt"></i>' : ''}
                    </div>
                </div>`;
            break;
            
        case 'video':
            content = `
                <div class="message-file video">
                    <video controls class="message-video" poster="${getVideoThumbnail(message.file_url)}">
                        <source src="${message.file_url}" type="${message.file_type}">
                        Your browser does not support the video tag.
                    </video>
                    <div class="message-meta">
                        <span class="message-time">${timeString}</span>
                        ${isSentByMe ? '<i class="fas fa-check-double read-receipt"></i>' : ''}
                    </div>
                </div>`;
            break;
            
        case 'file':
            content = `
                <div class="message-file document">
                    <div class="file-icon">
                        <i class="fas ${getFileIcon(message.file_type)}"></i>
                    </div>
                    <div class="file-info">
                        <div class="file-name">${message.text}</div>
                        <div class="file-size">${formatFileSize(message.file_size)}</div>
                        <button class="download-link" data-url="${message.file_url}" data-filename="${message.text}">
                            <i class="fas fa-download"></i> Download
                        </button>
                    </div>
                    <div class="message-meta">
                        <span class="message-time">${timeString}</span>
                        ${isSentByMe ? '<i class="fas fa-check-double read-receipt"></i>' : ''}
                    </div>
                </div>`;
            break;
            
        default:
            // Regular text message
            if (currentGroupId) {
                // Group message with sender name
                const senderName = message.sender_name || "Member";
                content = `
                    <div class="message-content">
                        <small class="group-sender-name">${isSentByMe ? "You" : senderName}</small>
                        <div class="message-text">${message.text}</div>
                        <div class="message-meta">
                            <span class="message-time">${timeString}</span>
                        </div>
                    </div>`;
            } else {
                // Private message
                content = `
                        <div class="message-text">${message.text}</div>
                        <div class="message-meta">
                            <span class="message-time">${timeString}</span>
                        </div>`;
            }
    }
    
    messageDiv.innerHTML = content;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

        // Remove from pending requests
        pendingContactRequests = pendingContactRequests.filter(req => req.request_id !== requestId);
        updateNotificationCount();
        renderNotifications();
        
        if (response === "accept") {
        
             await loadContacts();
        }
        
        // Show success message
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

            // Check if message has file attributes and set the appropriate type for rendering
            if (data.file_url && (data.type === "message" || data.type === "group_message")) {
                // Detect message type from mime type if possible
                const fileType = data.file_type || '';
                
                // Clone the data for safe modification
                const messageData = {...data};
                
                // Set message type for proper rendering
                if (fileType.startsWith('image/')) {
                    messageData.type = 'image';
                } else if (fileType.startsWith('video/')) {
                    messageData.type = 'video';
                } else if (data.file_url) {
                    messageData.type = 'file';
                }
                
                // Process based on message category
                if (data.type === "message") {
                    handleNewMessage(messageData);
                } else if (data.type === "group_message") {
                    handleNewGroupMessage(messageData);
                }
            } else {
                // Handle normal messages
                if (data.type === "message") {
                    handleNewMessage(data);
                } else if (data.type === "group_message") {
                    handleNewGroupMessage(data);
                } else if (data.type === "contact_request_accepted") {
                    // Handle contact request acceptance
                    handleContactRequestAccepted(data);
                } else if (data.type === "typing") {
                    showTypingIndicator(data.sender);
                } else if (data.type === "group_typing") {
                    showGroupTypingIndicator(data.group_id, data.sender);
                } else if (data.type === "notification") {
                    fetchPendingContactRequests();
                } else if (data.type === "profile_picture_update") {
                    // Update profile picture in UI
                    const user = getCurrentUser();
                    if (user && data.profile_picture_url) {
                        user.profile_picture_url = data.profile_picture_url;
                        localStorage.setItem("user", JSON.stringify(user));
                        updateProfilePictureUI(user);
                    }
                } else if (data.type === 'webrtc_offer') {
                    handleIncomingCall(data);
                } else if (data.type === 'webrtc_answer') {
                    handleAnswer(data);
                } else if (data.type === 'webrtc_ice') {
                    handleICECandidate(data);
                } else if (data.type === 'webrtc_end') {
                    handleCallEnd();
                }
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
    
    // Determine the relevant contact UID
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
    
    // Render message if:
    // 1. It's in the active chat (either sent or received)
    // OR
    // 2. We sent it (show our own messages immediately)
    if (contactUID === currentChatUID || 
        (isSentByMe && message.receiver === currentChatUID) ||
        (isSentByMe && currentChatUID === null)) {  // Also handle case when no chat is open
        renderMessage(newMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Only increment unread count for received messages if not currently viewing this chat
    if (!isSentByMe && contactUID !== currentChatUID) {
        unreadMessages[contactUID] = (unreadMessages[contactUID] || 0) + 1;
    }
    
    // Always move contact to the top of the list, for both sent and received messages
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
    if (senderUID === currentChatUID || senderUID === currentGroupId) {
        typingIndicator.style.display = "block";
        typingIndicator.textContent = currentGroupId 
            ? `${getMemberName(senderUID)} is typing...` 
            : "typing...";
        clearTimeout(typingIndicator.timeout);
        typingIndicator.timeout = setTimeout(() => {
            typingIndicator.style.display = "none";
        }, 2000);
    }
}
function getMemberName(uid) {
    if (!currentGroupData) return "Member";
    const member = currentGroupData.members.find(m => m.uid === uid);
    return member ? member.name || member.username || "Member" : "Member";
}
function setupEventListeners() {
    console.log("Setting up event listeners...");
console.log("Send button:", document.getElementById('send-btn'));
console.log("Message input:", document.getElementById('message-input'));
        // Get the send button and message input elements
    const sendButton = document.getElementById('send-btn');
    const messageInput = document.getElementById('message-input');

    // Remove any existing event listeners first to avoid duplicates
    sendButton.removeEventListener('click', handleSendMessage);
    messageInput.removeEventListener('keydown', handleKeyDown);

    // Add new event listeners
    sendButton.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keydown', handleKeyDown);
    // Prevent form submission if the message input is inside a form
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
        });
    });
    // Fix for attachment button
    const attachmentBtn = document.getElementById('attachment-btn');
    const attachmentMenu = document.querySelector('.attachment-menu');
    
    if (attachmentBtn) {
        attachmentBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            attachmentMenu.classList.toggle('show');
        });
    }

    // Fix for file input changes
    document.getElementById('image-upload')?.addEventListener('change', handleFileSelect);
    document.getElementById('video-upload')?.addEventListener('change', handleFileSelect);
    document.getElementById('file-upload')?.addEventListener('change', handleFileSelect);

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.attachment-container')) {
            attachmentMenu?.classList.remove('show');
        }
    });
        // Enhanced message sending
    sendBtn.addEventListener("click", (e) => {
        e.preventDefault();
        sendMessage();
    });
    
    messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Add file attachment handling
    document.getElementById('attachment-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelector('.attachment-menu').classList.toggle('show');
    });

    // File input handlers
    document.getElementById('image-upload').addEventListener('change', handleFileSelect);
    document.getElementById('video-upload').addEventListener('change', handleFileSelect);
    document.getElementById('file-upload').addEventListener('change', handleFileSelect);
    
    // Close attachment menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.attachment-container')) {
            document.querySelector('.attachment-menu').classList.remove('show');
        }
    });
    // Add this new event listener for the contacts search
    const contactSearchInput = document.querySelector('input[placeholder="Search contacts..."]');
    if (contactSearchInput) {
        contactSearchInput.addEventListener('input', filterContacts);
    }
    // Group chat menu actions
    document.getElementById("add-member-btn").addEventListener("click", () => showMemberModal('add'));
    document.getElementById("kick-member-btn").addEventListener("click", () => showMemberModal('kick'));
    document.getElementById("display-members-btn").addEventListener("click", displayGroupMembers);
    document.getElementById("delete-group-btn").addEventListener("click", deleteGroup);
    // Member search input
    const memberSearchInput = document.getElementById("member-search-input");
    if (memberSearchInput) {
        memberSearchInput.addEventListener("input", debounce(searchUsersForMember, 300));
    }
    // Member modal actions
    document.getElementById("member-modal-cancel").addEventListener("click", closeMemberModal);
    document.getElementById("member-modal-confirm").addEventListener("click", confirmMemberAction);

    // Settings button now opens the name change modal directly
    document.getElementById("settings-button").addEventListener("click", () => {
      // Get current user data for pre-filling
      const user = getCurrentUser();
      if (user && user.name) {
        document.getElementById("name-change-input").value = user.name;
      }
      
      // Reset to show name tab by default
      document.getElementById("name-tab").classList.add("active");
      document.getElementById("picture-tab").classList.remove("active");
      document.getElementById("name-change-section").style.display = "block";
      document.getElementById("profile-picture-section").style.display = "none";
      
      // Show the modal
      document.getElementById("name-change-modal").style.display = "flex";
    });
    
    // Tab switching in profile settings modal
    document.getElementById("name-tab").addEventListener("click", () => {
      document.getElementById("name-tab").classList.add("active");
      document.getElementById("picture-tab").classList.remove("active");
      document.getElementById("name-change-section").style.display = "block";
      document.getElementById("profile-picture-section").style.display = "none";
    });
    
    document.getElementById("picture-tab").addEventListener("click", () => {
      document.getElementById("picture-tab").classList.add("active");
      document.getElementById("name-tab").classList.remove("active");
      document.getElementById("profile-picture-section").style.display = "block";
      document.getElementById("name-change-section").style.display = "none";
      
      // Update profile picture preview with current user image
      const user = getCurrentUser();
      if (user && user.profile_picture_url) {
        document.getElementById("profile-picture-preview").innerHTML = `
          <img src="${user.profile_picture_url}" alt="Profile" class="profile-picture-preview-img">
        `;
      } else {
        document.getElementById("profile-picture-preview").innerHTML = `
          <i class="fas fa-user-circle default-avatar"></i>
        `;
      }
    });
    
    document.getElementById("name-change-cancel").addEventListener("click", () => {
      document.getElementById("name-change-modal").style.display = "none";
    });
    
    // Handle modal submission for both name and picture changes
    document.getElementById("name-change-submit").addEventListener("click", async () => {
      // Check which tab is active
      if (document.getElementById("name-tab").classList.contains("active")) {
        // Handle name change submission
        await changeUserName();
      } else {
        // Handle profile picture change submission
        const fileInput = document.getElementById("profile-picture-file");
        if (fileInput.files.length > 0) {
          const success = await uploadProfilePicture(fileInput.files[0]);
          if (success) {
            fileInput.value = ""; // Clear the file input
            document.getElementById("name-change-modal").style.display = "none";
          }
        } else {
          alert("Please select an image file first");
        }
      }
    });
    
    sendBtn.addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });
    document.getElementById("create-group-btn").addEventListener("click", createGroup);
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
    const createGroupHeaderBtn = document.getElementById("create-group-header-btn");
    if (createGroupHeaderBtn) {
        createGroupHeaderBtn.addEventListener("click", () => {
            noChatSelected.style.display = "none";
            activeChat.style.display = "none";
            document.getElementById("no-chat-selected").style.display = "none";
            document.getElementById("New-group").style.display = "flex";
            currentChatUID = null;
            currentGroupId = null;
        });
    }
    backButtonContact.addEventListener("click", () => {
        document.getElementById("New-contact").style.display = "none";
        noChatSelected.style.display = "flex";
    });
    
    backButtonGroup.addEventListener("click", () => {
        document.getElementById("New-group").style.display = "none";
        noChatSelected.style.display = "flex";
        currentChatUID = null;
        currentGroupId = null;
    });
    
    // Remove the profile picture button from dropdown menu since it's now in the settings modal
    
    backButtonChat.addEventListener("click", () => {
        activeChat.style.display = "none";
        noChatSelected.style.display = "flex";
        currentChatUID = null;
        currentGroupId = null;
        document.querySelectorAll('.private-chat-only').forEach(el => el.style.display = 'block');
        document.querySelectorAll('.group-chat-only').forEach(el => el.style.display = 'none');
    });
    
    menuButton.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });
    
    document.addEventListener('click', function() {
        dropdown.style.display = 'none';
    });
    
    // Profile picture file input change
    document.getElementById("profile-picture-file").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById("profile-picture-preview").innerHTML = `
                    <img src="${event.target.result}" alt="Preview" class="profile-picture-preview-img">
                `;
            };
            reader.readAsDataURL(file);
        }
    });

    // Tab switching functionality
    dmsTab.addEventListener("click", () => {
        dmsTab.classList.add("active");
        groupsTab.classList.remove("active");
        contactsList.style.display = "block";
        groupsList.style.display = "none";
        // Hide the header button when DMs tab is active
        document.querySelector('.groups-list-header').style.display = 'none';
        
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
        // Show the header button when groups tab is active
        document.querySelector('.groups-list-header').style.display = 'flex';
        // Animation reset
        groupsList.style.animation = 'none';
        groupsList.offsetHeight; // Trigger reflow
        groupsList.style.animation = 'fadeIn 0.3s ease forwards';
    });
    
    
    let typingTimeout;
    messageInput.addEventListener("input", () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (currentChatUID) {
            // Private chat typing indicator
            ws.send(JSON.stringify({ 
                type: "typing", 
                sender: getCurrentUser().uid,
                receiver: currentChatUID
            }));
        } else if (currentGroupId) {
            // Group chat typing indicator
            ws.send(JSON.stringify({ 
                type: "group_typing", 
                sender: getCurrentUser().uid,
                group_id: currentGroupId
            }));
        }
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            typingIndicator.style.display = "none";
        }, 2000);
    });
    // Handle file downloads
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('download-link') || e.target.closest('.download-link')) {
            e.preventDefault();
            const downloadBtn = e.target.classList.contains('download-link') ? e.target : e.target.closest('.download-link');
            const fileUrl = downloadBtn.dataset.url;
            const fileName = downloadBtn.dataset.filename;
            
            try {
                // Show loading state
                downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
                
                // Fetch the file with authorization
                const user = getCurrentUser();
                const response = await fetch(fileUrl, {
                    headers: {
                        Authorization: `Bearer ${user.token}`
                    }
                });
                
                if (!response.ok) throw new Error('Failed to download file');
                
                // Get the blob data
                const blob = await response.blob();
                
                // Create download link
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName || 'download';
                document.body.appendChild(a);
                a.click();
                
                // Clean up
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
            } catch (error) {
                console.error('Download failed:', error);
                alert('Failed to download file. Please try again.');
            } finally {
                // Reset button state
                downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
            }
        }
    });
    logoutBtn.addEventListener("click", logoutUser);
    document.getElementById('voice-call-btn').addEventListener('click', () => initiateCall('voice'));
    document.getElementById('video-call-btn').addEventListener('click', () => initiateCall('video'));
    document.getElementById('end-call-btn').addEventListener('click', endCall);
    document.getElementById('toggle-mic-btn').addEventListener('click', toggleMic);
    document.getElementById('toggle-camera-btn').addEventListener('click', toggleCamera);
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

const rtcConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// Initialize call functionality
async function initiateCall(callType) {
    if (!currentChatUID && !currentGroupId) {
        alert('Please select a chat first');
        return;
    }
    
    try {
        currentCallType = callType;
        isCaller = true;
        
        // Show calling UI
        document.getElementById('call-status').textContent = `Calling ${chatNameElement.textContent}...`;
        document.getElementById('call-modal').style.display = 'flex';
        
        // Get local media
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: callType === 'video'
        });
        
        // Display local video if it's a video call
        if (callType === 'video') {
            document.getElementById('local-video').srcObject = localStream;
            document.getElementById('local-video').style.display = 'block';
        } else {
            document.getElementById('local-video').style.display = 'none';
        }
        
        // Create peer connection
        peerConnection = new RTCPeerConnection(rtcConfiguration);
        
        // Add local stream to connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Set up remote stream
        remoteStream = new MediaStream();
        document.getElementById('remote-video').srcObject = remoteStream;
        
        // ICE candidate handler
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                // Send the candidate to the other peer via your signaling (WebSocket)
                ws.send(JSON.stringify({
                    type: 'webrtc_ice',
                    candidate: event.candidate,
                    target: currentChatUID || currentGroupId,
                    isGroup: !!currentGroupId
                }));
            }
        };
        
        // Track handler for remote stream
        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track);
            });
        };
        
        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        // Send offer via signaling
        ws.send(JSON.stringify({
            type: 'webrtc_offer',
            offer: offer,
            callType: callType,
            target: currentChatUID || currentGroupId,
            isGroup: !!currentGroupId
        }));
        
    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Failed to start call. Please check your microphone/camera permissions.');
        endCall();
    }
}


// Handle incoming call
async function handleIncomingCall(data) {
    if (document.getElementById('call-modal').style.display === 'flex') {
        // Already in a call, reject new one
        ws.send(JSON.stringify({
            type: 'webrtc_end',
            target: data.sender,
            isGroup: data.isGroup
        }));
        return;
    }
    
    try {
        currentCallType = data.callType;
        isCaller = false;
        
        // Show incoming call UI
        document.getElementById('call-status').textContent = `Incoming ${data.callType} call from ${data.senderName}`;
        document.getElementById('call-modal').style.display = 'flex';
        
        // Create accept/reject buttons for incoming call
        const callControls = document.querySelector('.call-controls');
        callControls.innerHTML = `
            <button id="accept-call-btn" class="call-control-btn accept-call">
                <i class="fas fa-phone"></i>
            </button>
            <button id="reject-call-btn" class="call-control-btn end-call">
                <i class="fas fa-phone-slash"></i>
            </button>
        `;
        
        document.getElementById('accept-call-btn').addEventListener('click', () => acceptCall(data));
        document.getElementById('reject-call-btn').addEventListener('click', endCall);
        
        // Store the offer for later
        window.pendingOffer = data;
        
    } catch (error) {
        console.error('Error handling incoming call:', error);
        endCall();
    }
}

// Accept incoming call
async function acceptCall(data) {
    try {
        // Get local media
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: currentCallType === 'video'
        });
        
        // Display local video if it's a video call
        if (currentCallType === 'video') {
            document.getElementById('local-video').srcObject = localStream;
            document.getElementById('local-video').style.display = 'block';
        } else {
            document.getElementById('local-video').style.display = 'none';
        }
        
        // Create peer connection
        peerConnection = new RTCPeerConnection(rtcConfiguration);
        
        // Add local stream to connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Set up remote stream
        remoteStream = new MediaStream();
        document.getElementById('remote-video').srcObject = remoteStream;
        
        // ICE candidate handler
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                // Send the candidate to the other peer via your signaling (WebSocket)
                ws.send(JSON.stringify({
                    type: 'webrtc_ice',
                    candidate: event.candidate,
                    target: data.sender,
                    isGroup: data.isGroup
                }));
            }
        };
        
        // Track handler for remote stream
        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                remoteStream.addTrack(track);
            });
        };
        
        // Set remote description
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        // Send answer via signaling
        ws.send(JSON.stringify({
            type: 'webrtc_answer',
            answer: answer,
            target: data.sender,
            isGroup: data.isGroup
        }));
        
        // Update UI to show call in progress
        document.getElementById('call-status').textContent = `In call with ${chatNameElement.textContent}`;
        startCallTimer();
        
        // Restore normal call controls
        const callControls = document.querySelector('.call-controls');
        callControls.innerHTML = `
            <button id="end-call-btn" class="call-control-btn end-call">
                <i class="fas fa-phone-slash"></i>
            </button>
            <button id="toggle-mic-btn" class="call-control-btn toggle-mic">
                <i class="fas fa-microphone"></i>
            </button>
            <button id="toggle-camera-btn" class="call-control-btn toggle-camera">
                <i class="fas fa-video"></i>
            </button>
        `;
        
        document.getElementById('end-call-btn').addEventListener('click', endCall);
        document.getElementById('toggle-mic-btn').addEventListener('click', toggleMic);
        document.getElementById('toggle-camera-btn').addEventListener('click', toggleCamera);
        
    } catch (error) {
        console.error('Error accepting call:', error);
        endCall();
    }
}

// Handle answer from callee
async function handleAnswer(data) {
    if (!peerConnection) return;
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        document.getElementById('call-status').textContent = `In call with ${chatNameElement.textContent}`;
        startCallTimer();
    } catch (error) {
        console.error('Error handling answer:', error);
        endCall();
    }
}

// Handle ICE candidate
async function handleICECandidate(data) {
    if (!peerConnection) return;
    
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

// Handle call end from remote
function handleCallEnd() {
    endCall();
    alert('The other party has ended the call');
}

// End call
function endCall() {
    // Send end call signal if we're the ones ending it
    if (peerConnection && (isCaller || document.getElementById('call-modal').style.display === 'flex')) {
        ws.send(JSON.stringify({
            type: 'webrtc_end',
            target: currentChatUID || currentGroupId,
            isGroup: !!currentGroupId
        }));
    }
    
    // Stop all media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
    }
    
    // Reset variables
    peerConnection = null;
    localStream = null;
    remoteStream = null;
    currentCallType = null;
    isCaller = false;
    
    // Stop call timer
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
    
    // Hide call modal
    document.getElementById('call-modal').style.display = 'none';
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('local-video').srcObject = null;
}

// Toggle microphone
function toggleMic() {
    if (!localStream) return;
    
    const micBtn = document.getElementById('toggle-mic-btn');
    const audioTracks = localStream.getAudioTracks();
    
    if (audioTracks.length > 0) {
        const enabled = audioTracks[0].enabled;
        audioTracks[0].enabled = !enabled;
        
        if (enabled) {
            micBtn.classList.add('muted');
        } else {
            micBtn.classList.remove('muted');
        }
    }
}

// Toggle camera
function toggleCamera() {
    if (!localStream || currentCallType !== 'video') return;
    
    const cameraBtn = document.getElementById('toggle-camera-btn');
    const videoTracks = localStream.getVideoTracks();
    
    if (videoTracks.length > 0) {
        const enabled = videoTracks[0].enabled;
        videoTracks[0].enabled = !enabled;
        
        if (enabled) {
            cameraBtn.classList.add('off');
        } else {
            cameraBtn.classList.remove('off');
        }
    }
}

// Start call timer
function startCallTimer() {
    callStartTime = new Date();
    document.getElementById('call-timer').textContent = '00:00';
    
    callTimer = setInterval(() => {
        const now = new Date();
        const elapsed = new Date(now - callStartTime);
        const minutes = elapsed.getMinutes().toString().padStart(2, '0');
        const seconds = elapsed.getSeconds().toString().padStart(2, '0');
        document.getElementById('call-timer').textContent = `${minutes}:${seconds}`;
    }, 1000);
}

async function sendMessage(messageContent) {
    // Use the passed content if provided, otherwise check input
    const text = messageContent || messageInput.value.trim() || "";
    if (!text && !currentFile) {
        console.log("No content to send");
        return;
    }

    try {
        const user = getCurrentUser();
        if (!user) {
            throw new Error("User not authenticated");
        }

        // Check WebSocket connection
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket not connected, attempting to reconnect...");
            setupWebSocket(user);
            throw new Error("Please try sending again. Connecting to chat...");
        }

        // Handle file upload if present
        if (currentFile) {
            try {
                await handleFileUpload(currentFile, currentFileType);
                // Clear file after upload
                currentFile = null;
                currentFileType = null;
                document.getElementById('file-preview').style.display = 'none';
                // Clear any file inputs
                document.getElementById('image-upload').value = '';
                document.getElementById('video-upload').value = '';
                document.getElementById('file-upload').value = '';
                return; // File upload will trigger its own message
            } catch (error) {
                console.error("File upload failed:", error);
                showMessageError("Failed to upload file. Please try again.");
                return;
            }
        }

        // Prepare the message object
        const message = {
            type: currentGroupId ? "group_message" : "message",
            text: text,
            sender: user.uid,
            timestamp: new Date().toISOString()
        };

        // Add receiver/group info
        if (currentGroupId) {
            message.group_id = currentGroupId;
        } else if (currentChatUID) {
            message.receiver = currentChatUID;
        } else {
            throw new Error("No active chat selected");
        }
         // Add file data if present
        if (currentFile) {
            message.file_url = currentFile.url;
            message.file_type = currentFile.type;
            message.file_size = currentFile.size;
        }

        // Send via WebSocket
        ws.send(JSON.stringify(message));

        // Handle the sent message locally
        if (currentGroupId) {
            handleNewGroupMessage(message);
        } else {
            handleNewMessage(message);
        }

        // Clear input field
        messageInput.value = "";
        currentFile = null;
        document.getElementById('file-preview').style.display = 'none';
    } catch (error) {
        console.error("Failed to send message:", error);
        showMessageError(error.message || "Failed to send message. Please try again.");
        
        // If it's a WebSocket error, try to reconnect
        if (error.message.includes("WebSocket")) {
            const user = getCurrentUser();
            if (user) {
                setupWebSocket(user);
            }
        }
    }
}

function showMessageError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message-error';
    errorDiv.textContent = message;
    messagesContainer.appendChild(errorDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 5000);
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
    try {
        let user = getCurrentUser();
        if (!user?.token) {
            // Try to refresh the token first
            const refreshed = await refreshToken(user);
            if (!refreshed) {
                throw new Error("User not authenticated - token refresh failed");
            }
            // Get updated user data
            user = getCurrentUser();
        }
        
        const nameInput = document.getElementById("name-change-input");
        const newName = nameInput.value.trim();
        
        if (!newName) {
            alert("Please enter a name");
            return;
        }
        
        // UI feedback - disable button, show loading
        const submitBtn = document.getElementById("name-change-submit");
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving...";
        
        let response = await fetch(`${BACKEND_URL}/update_name`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${user.token}`
            },
            body: JSON.stringify({ name: newName })
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                // Token issue - try to refresh and retry
                const refreshed = await refreshToken(user);
                if (refreshed) {
                    // Get updated user with new token
                    const updatedUser = getCurrentUser();
                    // Retry the request
                    const retryResponse = await fetch(`${BACKEND_URL}/update_name`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${updatedUser.token}`
                        },
                        body: JSON.stringify({ name: newName })
                    });
                    
                    if (!retryResponse.ok) {
                        throw new Error(`Name update failed after token refresh: ${retryResponse.status}`);
                    }
                    
                    // Use the retry response
                    response = retryResponse;
                } else {
                    throw new Error("Authentication failed - please log in again");
                }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Failed to update name");
            }
        }
        
        // Update local storage
        user.name = newName;
        localStorage.setItem("user", JSON.stringify(user));
        
        // Update UI
        userInfoElement.textContent = newName;
        
        // Close modal
        document.getElementById("name-change-modal").style.display = "none";
        
        // Optional: show success message
        alert("Name updated successfully!");
    } catch (error) {
        console.error("Failed to change name:", error);
        if (error.message.includes("authenticated") || error.message.includes("token")) {
            // This is an auth error - suggest logging in again
            alert("Your session has expired. Please log in again.");
            setTimeout(() => {
                logoutUser();
                window.location.href = "login.html";
            }, 1500);
        } else {
            alert(`Error changing name: ${error.message}`);
        }
    } finally {
        // Reset button state
        const submitBtn = document.getElementById("name-change-submit");
        submitBtn.disabled = false;
        submitBtn.textContent = "Save";
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

// Update displaySearchResults to show profile pictures in search results
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
        const currentUser = getCurrentUser();
        if (user.uid === currentUser?.uid) return;

        const resultItem = document.createElement("div");
        resultItem.classList.add("search-result-item");
        
        // Handle profile picture or initials
        let avatarHTML;
        if (user.profile_picture_url) {
            avatarHTML = `<img src="${user.profile_picture_url}" alt="${user.name}" class="search-result-avatar-img">`;
        } else {
            const firstLetter = user.name?.charAt(0).toUpperCase() || "?";
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = user.name?.length % colors.length || 0;
            avatarHTML = `<div class="search-result-avatar-initials" style="background: ${colors[colorIndex]}">${firstLetter}</div>`;
        }
        
        resultItem.innerHTML = `
            <div class="search-result-avatar">${avatarHTML}</div>
            <div class="search-result-info">
                <div class="search-result-name">${user.name || "Unknown"}</div>
                <div class="search-result-username">@${user.username || ""}</div>
            </div>
            <button class="add-contact-btn" data-uid="${user.uid}">Add Contact</button>
        `;
        
        searchResultsContainer.appendChild(resultItem);
    });

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
async function loadGroups() {
    try {
        const user = getCurrentUser();
        if (!user?.token || !user?.uid) throw new Error("User not authenticated");

        const response = await fetch(`${BACKEND_URL}/groups/${user.uid}`, {
            headers: { Authorization: `Bearer ${user.token}` },
        });

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const data = await response.json();
        groupsData = data.groups || [];
        
        // Load messages for each group
        await Promise.all(groupsData.map(async group => {
            const messages = await loadGroupMessages(group.id, false);
            groupMessagesData[group.id] = messages || [];
        }));

        renderGroups(groupsData);
    } catch (error) {
        console.error("❌ Failed to load groups:", error);
    }
}

async function loadGroupMessages(groupId, getLastOnly = false) {
    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");

        let url = `${BACKEND_URL}/groups/${groupId}/messages`;
        if (getLastOnly) url += '?limit=1';

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${user.token}` },
        });

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const messages = await response.json();
        
        // Process messages to ensure file data is properly structured
        return messages.map(msg => ({
            ...msg,
            // Ensure type is properly set for rendering
            type: msg.file_url ? 
                 (msg.file_type.startsWith('image/') ? 'image' : 
                  msg.file_type.startsWith('video/') ? 'video' : 'file') 
                 : 'group_message',
            // Ensure timestamp is in correct format
            timestamp: msg.timestamp?.toDate?.()?.toISOString() || msg.timestamp
        }));
    } catch (error) {
        console.error("❌ Failed to load group messages:", error);
        return [];
    }
}

function renderGroups(groups) {
    const groupsList = document.getElementById("groups-list");
    
    // Clear existing content
    groupsList.innerHTML = '';

    // Add the header first
    const header = document.createElement('div');
    header.className = 'groups-list-header';
    groupsList.appendChild(header);
    
    // Create the groups container
    const groupsContainer = document.createElement('div');
    groupsContainer.className = 'groups-container';
    
    if (groups.length === 0) {
        // When no groups, show the empty state
        groupsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users empty-icon"></i>
                <p>No groups available yet</p>
                <small>Create a group to start chatting with multiple people</small>
                <button id="Create-group-small" class="create-group-small">Create Group</button>
            </div>
        `;
    } else {
        // Render each group
        groups.forEach(group => {
            const groupItem = document.createElement("div");
            groupItem.classList.add("contact-item");
            groupItem.dataset.groupId = group.id;
            
            // Use same pattern for creating avatar as in renderContacts
            const firstLetter = group.name?.charAt(0).toUpperCase() || "G";
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = group.name?.length % colors.length || 0;
            const avatarColor = colors[colorIndex];
            
            // Create avatar HTML using the same pattern as contact avatars
            const avatarHTML = `<div class="contact-avatar-initials" style="background: ${avatarColor}">${firstLetter}</div>`;
            
            const lastMessage = getLastGroupMessagePreview(group.id);
            const lastMessageText = lastMessage?.text || "No messages yet";
            
            let timeString = "";
            if (lastMessage?.timestamp) {
                timeString = formatMessageTime(new Date(lastMessage.timestamp));
            }
            
            groupItem.innerHTML = `
                <div class="contact-avatar">${avatarHTML}</div>
                <div class="contact-info">
                    <div class="contact-name-row">
                        <span class="contact-name">${group.name}</span>
                        <span class="message-time">${timeString}</span>
                    </div>
                    <div class="contact-preview">${lastMessageText}</div>
                </div>
                <div class="group-privacy">
                    ${group.is_private 
                        ? '<i class="fas fa-lock"></i> Private' 
                        : '<i class="fas fa-globe"></i> Public'}
                </div>
                <span class="unread-count" style="display: none">
                    0
                </span>
            `;
            
            groupItem.addEventListener("click", () => openGroupChat(group));
            groupsContainer.appendChild(groupItem);
        });
    }
    
    // Add the groups container to the list
    groupsList.appendChild(groupsContainer);
    
    // Always add the floating action button at the end
    const fabBtn = document.createElement('button');
    fabBtn.className = 'create-group-fab';
    fabBtn.id = 'create-group-fab';
    fabBtn.innerHTML = '<i class="fas fa-plus"></i>';
    fabBtn.addEventListener("click", showCreateGroupForm);
    groupsList.appendChild(fabBtn);
    
    // Set up event listener for small create button if it exists
    const smallCreateBtn = document.getElementById("Create-group-small");
    if (smallCreateBtn) {
        smallCreateBtn.addEventListener("click", showCreateGroupForm);
    }
}

function getLastGroupMessagePreview(groupId) {
    if (!groupMessagesData[groupId] || groupMessagesData[groupId].length === 0) return null;
    
    const sortedMessages = [...groupMessagesData[groupId]].sort(
        (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
    );
    
    return sortedMessages[0];
}
async function openGroupChat(group) {
    currentGroupId = group.id;
    currentGroupData = group;
    currentChatUID = null; // Ensure private chat UID is cleared
    messagesContainer.innerHTML = "";

    // Toggle menu items
    document.querySelectorAll('.private-chat-only').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.group-chat-only').forEach(el => el.style.display = 'block');
    // Show delete button only for creator
    const user = getCurrentUser();
    const deleteGroupBtn = document.getElementById("delete-group-btn");
    if (deleteGroupBtn) {
        deleteGroupBtn.style.display = group.creator === user.uid ? "block" : "none";
    }
    noChatSelected.style.display = "none";
    activeChat.style.display = "flex";
    
    chatNameElement.textContent = group.name;
    // Add privacy indicator to chat header
    const privacyIndicator = group.is_private 
        ? '<span class="privacy-indicator"><i class="fas fa-lock"></i> Private</span>'
        : '<span class="privacy-indicator"><i class="fas fa-globe"></i> Public</span>';
    
    contactUidElement.innerHTML = `Members: ${group.members.length} ${privacyIndicator}`;
    
    // Get member details first
    const members = await getGroupMembersDetails(group.members);
    contactUidElement.textContent = `Members: ${members.length}`;
    
    const firstLetter = group.name?.charAt(0).toUpperCase() || "G";
    chatAvatarElement.textContent = firstLetter;
    const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
    const colorIndex = group.name?.length % colors.length || 0;
    chatAvatarElement.style.background = colors[colorIndex];

    // Load group messages
    const messages = await loadGroupMessages(group.id);
    groupMessagesData[group.id] = messages;
    
    // Render messages with member details
    renderGroupMessages(messages, members);
    const messageInput = document.getElementById('message-input');
    if (messageInput) messageInput.value = '';
}

function renderGroupMessages(messages, members) {
    messagesContainer.innerHTML = "";
    
    const groupedMessages = groupMessagesByDate(messages);
    const sortedDates = Object.keys(groupedMessages).sort((a, b) => new Date(a) - new Date(b));
    
    sortedDates.forEach(date => {
        const dateDivider = document.createElement("div");
        dateDivider.classList.add("date-divider");
        dateDivider.textContent = date;
        messagesContainer.appendChild(dateDivider);
        
        groupedMessages[date].forEach(message => {
            renderGroupMessage(message, members);
        });
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderGroupMessage(message, members) {
    const messageDiv = document.createElement("div");
    const currentUser = getCurrentUser();
    const isSentByMe = message.sender === currentUser?.uid;
    
    messageDiv.classList.add("message", isSentByMe ? "sent" : "received");
    
    const timeString = formatTime(new Date(message.timestamp || Date.now()));
    
    // Sender name resolution - more robust handling
    let senderName = "Member";
    if (isSentByMe) {
        senderName = "You";
    } else if (Array.isArray(members)) {
        // First try to find in members array (might be full objects or just UIDs)
        const sender = members.find(m => 
            (m.uid && m.uid === message.sender) || 
            (typeof m === 'string' && m === message.sender)
        );
        
        if (sender) {
            if (typeof sender === 'object') {
                senderName = sender.name || sender.username || "Member";
            } else {
                // If it's just a UID string, try to get from cache
                const cached = memberDetailsCache[message.sender];
                if (cached) {
                    senderName = cached.name || cached.username || "Member";
                }
            }
        }
    }

    let content = '';
    
    // Handle different message types
    switch(message.type) {
        case 'image':
            content = `
                <small class="group-sender-name">${senderName}</small>
                <div class="message-file image">
                    <img src="${message.file_url}" alt="${message.text}" 
                         loading="lazy" class="message-image"
                         onclick="openImagePreview('${message.file_url}')">
                    <div class="message-meta">
                        <span class="message-time">${timeString}</span>
                        ${isSentByMe ? '<i class="fas fa-check-double read-receipt"></i>' : ''}
                    </div>
                </div>`;
            break;
            
        case 'video':
            content = `
                <small class="group-sender-name">${senderName}</small>
                <div class="message-file video">
                    <video controls class="message-video" poster="${getVideoThumbnail(message.file_url)}">
                        <source src="${message.file_url}" type="${message.file_type}">
                        Your browser does not support the video tag.
                    </video>
                    <div class="message-meta">
                        <span class="message-time">${timeString}</span>
                        ${isSentByMe ? '<i class="fas fa-check-double read-receipt"></i>' : ''}
                    </div>
                </div>`;
            break;
            
        case 'file':
            content = `
                <small class="group-sender-name">${senderName}</small>
                <div class="message-file document">
                    <div class="file-icon">
                        <i class="fas ${getFileIcon(message.file_type)}"></i>
                    </div>
                    <div class="file-info">
                        <div class="file-name">${message.text}</div>
                        <div class="file-size">${formatFileSize(message.file_size)}</div>
                        <button class="download-link" data-url="${message.file_url}" data-filename="${message.text}">
                            <i class="fas fa-download"></i> Download
                        </button>
                    </div>
                    <div class="message-meta">
                        <span class="message-time">${timeString}</span>
                        ${isSentByMe ? '<i class="fas fa-check-double read-receipt"></i>' : ''}
                    </div>
                </div>`;
            break;
            
        default:
            // Regular text message
            content = `
                <small class="group-sender-name">${senderName}</small>
                <div class="message-text">${message.text}</div>
                <div class="message-meta">
                    <span class="message-time">${timeString}</span>
                </div>`;
    }
    
    messageDiv.innerHTML = content;
    messagesContainer.appendChild(messageDiv);
}

function handleNewGroupMessage(message) {
    const currentUser = getCurrentUser();
    const isSentByMe = message.sender === currentUser.uid;
    
    if (!groupMessagesData[message.group_id]) {
        groupMessagesData[message.group_id] = [];
    }
    
    const newMessage = {
        ...message,
        timestamp: message.timestamp || new Date().toISOString()
    };
    
    groupMessagesData[message.group_id].push(newMessage);
    
    // Render message if:
    // 1. It's in the active group (either sent or received)
    // OR
    // 2. We sent it (show our own messages immediately)
    if (message.group_id === currentGroupId || 
        (isSentByMe && currentGroupId === null)) {  // Also handle case when no group is open
        // Get the group from groupsData
        const group = groupsData.find(g => g.id === message.group_id);
        if (group) {
            // Get fresh member details for this group
            getGroupMembersDetails(group.members).then(members => {
                renderGroupMessage(newMessage, members);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            });
        }
    }
    
    // Update group in list
    updateGroupInList(message.group_id);
}

function updateGroupInList(groupId) {
    const groupItem = document.querySelector(`.contact-item[data-group-id="${groupId}"]`);
    if (groupItem) {
        const lastMessage = getLastGroupMessagePreview(groupId);
        if (lastMessage) {
            const previewElement = groupItem.querySelector(".contact-preview");
            const timeElement = groupItem.querySelector(".message-time");
            
            if (previewElement) {
                previewElement.textContent = lastMessage.text;
            }
            
            if (timeElement) {
                timeElement.textContent = formatMessageTime(new Date(lastMessage.timestamp));
            }
        }
    }
}

function showGroupTypingIndicator(groupId, senderUid) {
    if (groupId === currentGroupId) {
        // Find sender name
        const group = groupsData.find(g => g.id === groupId);
        if (group) {
            const sender = group.members.find(m => m.uid === senderUid);
            if (sender) {
                typingIndicator.style.display = "block";
                typingIndicator.textContent = `${sender.name || sender.username} is typing...`;
                setTimeout(() => {
                    typingIndicator.style.display = "none";
                }, 2000);
            }
        }
    }
}
function showCreateGroupForm() {
    noChatSelected.style.display = "none";
    activeChat.style.display = "none";
    document.getElementById("no-chat-selected").style.display = "none";
    document.getElementById("New-group").style.display = "flex";
    currentChatUID = null;
    currentGroupId = null;

}

// create group ,update to handle privacy toggle
async function createGroup() {
    const groupName = document.getElementById("group-name-input").value.trim();
    if (!groupName) {
        alert("Please enter a group name");
        return;
    }

    const isPrivate = document.getElementById("group-privacy-toggle").checked;

    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");

        const response = await fetch(`${BACKEND_URL}/groups`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${user.token}`
            },
            body: JSON.stringify({
                name: groupName,
                members: [user.uid], // Start with just the creator
                is_private: isPrivate // Include privacy setting
            })
        });

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const data = await response.json();
        alert(`Group created successfully! (${isPrivate ? 'Private' : 'Public'})`);
        
        // Reset form
        document.getElementById("group-name-input").value = "";
        document.getElementById("group-privacy-toggle").checked = false;
        document.getElementById("New-group").style.display = "none";
        noChatSelected.style.display = "flex";
        
        // Reload groups
        await loadGroups();
    } catch (error) {
        console.error("❌ Failed to create group:", error);
        alert("Failed to create group. Please try again.");
    }
}
function showMemberModal(action) {
    currentModalAction = action;
    const modal = document.getElementById("member-modal");
    const title = document.getElementById("member-modal-title");
    const searchContainer = modal.querySelector(".search-container");
    const selectedDisplay = document.getElementById("selected-member-display");
    const membersContainer = document.getElementById("display-members-container");
    const user = getCurrentUser();
    // Reset modal state
    selectedMember = null;
    document.getElementById("member-search-input").value = "";
    document.getElementById("member-search-results").innerHTML = "";
    selectedDisplay.style.display = "none";
    membersContainer.style.display = "none";
    searchContainer.style.display = "block";

    if (action === 'add') {
        title.textContent = "Add Member";
        document.getElementById("member-modal-confirm").style.display = "block";
        // --- FIX: Only show lock for non-owners in private groups ---
        if (currentGroupData && currentGroupData.is_private && user.uid !== currentGroupData.creator) {
            searchContainer.innerHTML = `
                <div class="private-group-notice">
                    <i class="fas fa-lock"></i>
                    <p>This is a private group. Only admins can add new members.</p>
                </div>
            `;
            document.getElementById("member-modal-confirm").style.display = "none";
        } else {
            // Real add member UI for owner or public group
            searchContainer.innerHTML = `
                <input type="text" id="member-search-input" placeholder="Search users...">
                <div id="member-search-results" class="search-results"></div>
            `;
            // Re-attach the event listener since we recreated the input element
            const memberSearchInput = document.getElementById("member-search-input");
            if (memberSearchInput) {
                memberSearchInput.addEventListener("input", debounce(searchUsersForMember, 300));
            }
        }
    } else if (action === 'kick') {
        title.textContent = "Kick Member";
        document.getElementById("member-modal-confirm").style.display = "block";
        // Show current members for kicking
        searchContainer.style.display = "none";
        membersContainer.style.display = "block";
        displayCurrentMembersForKick();
    }
    modal.style.display = "flex";
}

function closeMemberModal() {
    const modal = document.getElementById("member-modal");
    modal.style.display = "none";
    
    // Reset search state
    document.getElementById("member-search-input").value = "";
    document.getElementById("member-search-results").style.display = "none";
    document.getElementById("member-search-results").innerHTML = "";
    document.getElementById("selected-member-display").style.display = "none";
    selectedMember = null;
}

async function searchUsersForMember(e) {
    const searchTerm = e.target.value.trim();
    const resultsContainer = document.getElementById("member-search-results");
    
    // Clear previous results
    resultsContainer.innerHTML = "";
    resultsContainer.style.display = "none";
    
    if (searchTerm.length < 2) {
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
        
        // Always display results, even if empty
        displayMemberSearchResults(results.users || []);
    } catch (error) {
        console.error("Failed to search users:", error);
        // Show error in results container
        resultsContainer.innerHTML = `<div class="no-results">Error searching users</div>`;
        resultsContainer.style.display = "block";
    }
}

function displayMemberSearchResults(users) {
    const resultsContainer = document.getElementById("member-search-results");
    resultsContainer.innerHTML = "";
    
    // Filter out current user and existing members
    const currentUser = getCurrentUser();
    const filteredUsers = users.filter(user => {
        return user.uid !== currentUser?.uid && 
               !(currentGroupData && currentGroupData.members.includes(user.uid));
    });

    if (filteredUsers.length === 0) {
        // Show "No results found" message
        resultsContainer.innerHTML = `<div class="no-results">No users found</div>`;
        resultsContainer.style.display = "block";
        return;
    }

    filteredUsers.forEach(user => {
        const resultItem = document.createElement("div");
        resultItem.classList.add("member-search-item");
        
        // Use profile picture if available, otherwise fallback to first letter
        let avatarHTML = '';
        const firstLetter = (user.name || user.username || "?").charAt(0).toUpperCase();
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = (user.name || user.username || "").length % colors.length;
        
        if (user.profile_picture_url) {
            avatarHTML = `<div class="member-avatar-container"><img src="${user.profile_picture_url}" alt="${firstLetter}" class="member-avatar-img"></div>`;
        } else {
            avatarHTML = `<div class="member-avatar-container"><div class="member-avatar" style="background: ${colors[colorIndex]}">${firstLetter}</div></div>`;
        }
        
        resultItem.innerHTML = `
            <div class="member-info">
                ${avatarHTML}
                <div class="member-details">
                    <div class="member-name">${user.name || "Unknown"}</div>
                    <div class="member-username">@${user.username || ""}</div>
                </div>
            </div>
        `;
        
        resultItem.addEventListener("click", () => {
            selectedMember = {
                uid: user.uid,
                name: user.name || user.username,
                username: user.username
            };
            
            document.getElementById("selected-member-name").textContent = 
                `${user.name || user.username} (@${user.username})`;
            document.getElementById("selected-member-uid").value = user.uid;
            document.getElementById("selected-member-display").style.display = "block";
            resultsContainer.style.display = "none";
            resultsContainer.innerHTML = "";
            document.getElementById("member-search-input").value = "";
            
            // Show confirm button after selection
            document.getElementById("member-modal-confirm").style.display = "block";
        });
        
        resultsContainer.appendChild(resultItem);
    });
    
    resultsContainer.style.display = "block";
}

async function confirmMemberAction() {
    if (!selectedMember) {
        alert("Please select a member first");
        return;
    }

    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");
        
        // Show loading state
        const confirmButton = document.getElementById("member-modal-confirm");
        const originalText = confirmButton.textContent;
        confirmButton.disabled = true;
        
        if (currentModalAction === 'add') {
            confirmButton.textContent = "Adding...";
            
            // Call backend to add member by UID
            const response = await fetch(`${BACKEND_URL}/groups/${currentGroupId}/members`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${user.token}`
                },
                body: JSON.stringify({ members: [selectedMember.uid] })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Failed to add member: ${response.statusText}`);
            }
            
            alert(`${selectedMember.name} added to group successfully!`);
        } else if (currentModalAction === 'kick') {
            confirmButton.textContent = "Removing...";
            
            // Call backend to kick member by UID
            const response = await fetch(`${BACKEND_URL}/groups/${currentGroupId}/members/${selectedMember.uid}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${user.token}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Failed to remove member: ${response.statusText}`);
            }
            
            alert(`${selectedMember.name} removed from group successfully!`);
        }
        
        // Reset button state
        confirmButton.textContent = originalText;
        confirmButton.disabled = false;
        
        // Close the modal
        closeMemberModal();
        
        // Refresh current group data
        await refreshCurrentGroup();
    } catch (error) {
        console.error(`Error in member action:`, error);
        alert(`Error: ${error.message}`);
        
        // Reset button state
        const confirmButton = document.getElementById("member-modal-confirm");
        confirmButton.textContent = currentModalAction === 'add' ? "Add Member" : "Kick Member";
        confirmButton.disabled = false;
    }
}

// Add a new function to refresh the current group data
async function refreshCurrentGroup() {
    if (!currentGroupId) return;
    
    try {
        await loadGroups();
        
        // Find the updated group data
        const updatedGroup = groupsData.find(group => group.id === currentGroupId);
        if (updatedGroup) {
            // Update current group data
            currentGroupData = updatedGroup;
            
            // Update UI if needed
            const memberCountElement = document.querySelector(`[data-group-id="${currentGroupId}"] .group-member-count`);
            if (memberCountElement) {
                memberCountElement.textContent = `${updatedGroup.members.length} members`;
            }
        }
    } catch (error) {
        console.error("Failed to refresh group data:", error);
    }
}

async function displayGroupMembers() {
    if (!currentGroupData) return;
    
    const modal = document.getElementById("member-modal");
    const title = document.getElementById("member-modal-title");
    const searchContainer = modal.querySelector(".search-container");
    const selectedDisplay = document.getElementById("selected-member-display");
    const membersContainer = document.getElementById("display-members-container");
    const confirmButton = document.getElementById("member-modal-confirm");
    const cancelButton = document.getElementById("member-modal-cancel");
    
    // Setup modal for display mode
    title.textContent = "Group Members";
    searchContainer.style.display = "none";
    selectedDisplay.style.display = "none";
    confirmButton.style.display = "none"; // Hide confirm button
    cancelButton.textContent = "Close"; // Change text to "Close"
    membersContainer.style.display = "block";
    
    // Show loading indicator
    membersContainer.innerHTML = '<div class="loading-members">Loading members...</div>';
    
    try {
        // Get detailed member info
        const members = await getGroupMembersDetails(currentGroupData.members);
        
        // Clear and populate members list
        membersContainer.innerHTML = "";
        
        members.forEach(member => {
            const memberItem = document.createElement("div");
            memberItem.classList.add("member-item");
            
            // Use profile picture if available, otherwise fallback to first letter
            let avatarHTML = '';
            const firstLetter = (member.name || member.username || "?").charAt(0).toUpperCase();
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = (member.name || member.username || "").length % colors.length;
            
            if (member.profile_picture_url) {
                avatarHTML = `<img src="${member.profile_picture_url}" alt="${firstLetter}" class="member-avatar-img">`;
            } else {
                avatarHTML = `<div class="member-avatar" style="background: ${colors[colorIndex]}">${firstLetter}</div>`;
            }
            
            memberItem.innerHTML = `
                <div class="member-info">
                    <div class="member-avatar-container">${avatarHTML}</div>
                    <div class="member-details">
                        <div class="member-name">${member.name || "Unknown"}</div>
                        <div class="member-username">@${member.username || ""}</div>
                    </div>
                    ${member.uid === currentGroupData.creator ? '<div class="creator-badge">Creator</div>' : ''}
                </div>
            `;
            
            membersContainer.appendChild(memberItem);
        });
    } catch (error) {
        console.error("Error loading members:", error);
        membersContainer.innerHTML = `<div class="error-message">Error loading members</div>`;
    }

    modal.style.display = "flex";
}

async function getGroupMembersDetails(memberUids) {
    const members = [];
    
    // Ensure we only have valid-looking UIDs
    const validUids = memberUids.filter(uid => 
        typeof uid === 'string' && uid.length > 10
    );
    
    // Check cache first
    const cachedMembers = validUids
        .filter(uid => memberDetailsCache[uid])
        .map(uid => memberDetailsCache[uid]);
    
    const uncachedUids = validUids.filter(uid => !memberDetailsCache[uid]);
    
    // Fetch details for uncached members
    for (const uid of uncachedUids) {
        try {
            const user = getCurrentUser();
            if (!user?.token) continue;
            
            // Fetch details for each user individually
            const response = await fetch(`${BACKEND_URL}/user_details/${uid}`, {
                headers: { Authorization: `Bearer ${user.token}` },
            });
            
            if (response.ok) {
                const userData = await response.json();
                // Add to cache
                memberDetailsCache[uid] = userData;
                members.push(userData);
            } else {
                const fallback = { uid, name: "Member", username: "" };
                memberDetailsCache[uid] = fallback;
                members.push(fallback);
            }
        } catch (error) {
            console.error(`Error fetching user ${uid}:`, error);
            const fallback = { uid, name: "Member", username: "" };
            memberDetailsCache[uid] = fallback;
            members.push(fallback);
        }
    }
    
    // Combine cached and newly fetched members
    return [...cachedMembers, ...members];
}
async function displayCurrentMembersForKick() {
    if (!currentGroupData) return;
    
    const modal = document.getElementById("member-modal");
    const searchContainer = modal.querySelector(".search-container");
    const membersContainer = document.getElementById("display-members-container");
    const confirmButton = document.getElementById("member-modal-confirm");
    
    // Show loading indicator
    searchContainer.style.display = "none";
    membersContainer.style.display = "block";
    membersContainer.innerHTML = `<div class="loading-members">Loading members...</div>`;
    confirmButton.style.display = "none";
    
    try {
        // Get detailed member info
        const members = await getGroupMembersDetails(currentGroupData.members);
        
        // Filter out current user if not creator
        const currentUser = getCurrentUser();
        const filteredMembers = members.filter(member => {
            // If current user is not creator, filter out creator
            if (currentUser.uid !== currentGroupData.creator && member.uid === currentGroupData.creator) {
                return false;
            }
            // Filter out current user if not viewing own profile
            if (member.uid === currentUser.uid) {
                return false;
            }
            return true;
        });
        
        membersContainer.innerHTML = "";
        
        if (filteredMembers.length === 0) {
            membersContainer.innerHTML = `<div class="no-members-message">No members available to remove</div>`;
            confirmButton.style.display = "none";
            return;
        }
        
        filteredMembers.forEach(member => {
            const memberItem = document.createElement("div");
            memberItem.classList.add("member-item", "kick-member-item");
            
            // Use profile picture if available, otherwise fallback to first letter
            let avatarHTML = '';
            const firstLetter = (member.name || member.username || "?").charAt(0).toUpperCase();
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = (member.name || member.username || "").length % colors.length;
            
            if (member.profile_picture_url) {
                avatarHTML = `<img src="${member.profile_picture_url}" alt="${firstLetter}" class="member-avatar-img">`;
            } else {
                avatarHTML = `<div class="member-avatar" style="background: ${colors[colorIndex]}">${firstLetter}</div>`;
            }
            
            memberItem.innerHTML = `
                <div class="member-info">
                    <div class="member-avatar-container">${avatarHTML}</div>
                    <div class="member-details">
                        <div class="member-name">${member.name || "Unknown"}</div>
                        <div class="member-username">@${member.username || ""}</div>
                    </div>
                </div>
            `;
            
            memberItem.addEventListener("click", () => {
                // Highlight selected member
                document.querySelectorAll(".kick-member-item").forEach(item => {
                    item.classList.remove("selected");
                });
                memberItem.classList.add("selected");
                
                selectedMember = {
                    uid: member.uid,
                    name: member.name || member.username,
                    username: member.username
                };
                
                document.getElementById("selected-member-name").textContent = 
                    `${member.name || member.username} (@${member.username})`;
                document.getElementById("selected-member-uid").value = member.uid;
                document.getElementById("selected-member-display").style.display = "block";
                confirmButton.style.display = "block";
                confirmButton.textContent = "Kick Member";
            });
            
            membersContainer.appendChild(memberItem);
        });
    } catch (error) {
        console.error("Error loading members:", error);
        membersContainer.innerHTML = `<div class="error-message">Error loading members</div>`;
    }
}
async function deleteGroup() {
    if (!currentGroupId) {
        alert("No group selected!");
        return;
    }
    
    const user = getCurrentUser();
    if (!user?.token) {
        alert("Invalid user authentication!");
        return;
    }

    if (!confirm("Are you sure you want to delete this group? This action cannot be undone.")) {
        return;
    }

    try {
        const response = await fetch(`${BACKEND_URL}/groups/${currentGroupId}`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${user.token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to delete group: ${response.statusText}`);
        }

        alert("🗑️ Group deleted successfully!");
        
        // Close chat and refresh groups list
        activeChat.style.display = "none";
        noChatSelected.style.display = "flex";
        currentGroupId = null;
        await loadGroups();
    } catch (error) {
        console.error("❌ Error deleting group:", error);
        alert("Failed to delete group. Try again.");
    }
}
async function initProfilePicture() {
    try {
        const user = getCurrentUser();
        if (!user) return;

        // Check if we already have the profile picture URL
        if (!user.profile_picture_url) {
            const response = await fetch(`${BACKEND_URL}/get_profile_picture`, {
                headers: { Authorization: `Bearer ${user.token}` },
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.profile_picture_url) {
                    // Update local user data
                    user.profile_picture_url = data.profile_picture_url;
                    localStorage.setItem("user", JSON.stringify(user));
                }
            }
        }

        // Update UI with profile picture
        updateProfilePictureUI(user);
    } catch (error) {
        console.error("Failed to load profile picture:", error);
    }
}

function updateProfilePictureUI(user) {
    if (!user) return;

    // Update user avatar in header
    const userAvatar = document.getElementById("user-avatar");
    if (userAvatar) {
        if (user.profile_picture_url) {
            userAvatar.innerHTML = `<img src="${user.profile_picture_url}" alt="Profile" class="header-avatar-img">`;
            userAvatar.classList.remove("avatar-skeleton");
        } else {
            // Fallback to initials
            const firstLetter = user.name?.charAt(0).toUpperCase() || "U";
            userAvatar.innerHTML = firstLetter;
            userAvatar.classList.remove("avatar-skeleton");
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = user.name?.length % colors.length || 0;
            userAvatar.style.background = colors[colorIndex];
        }
    }
}

async function uploadProfilePicture(file) {
    try {
        let user = getCurrentUser();
        if (!user?.token) {
            // Try to refresh the token first
            const refreshed = await refreshToken(user);
            if (!refreshed) {
                throw new Error("User not authenticated - token refresh failed");
            }
            // Get updated user data
            user = getCurrentUser();
        }

        // Show loading state
        const submitBtn = document.getElementById("name-change-submit");
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

        const formData = new FormData();
        formData.append("file", file);

        // Log the token being used (with first few chars for debugging)
        console.log(`Using token: ${user.token.substring(0, 15)}...`);

        let response = await fetch(`${BACKEND_URL}/upload_profile_picture`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${user.token}`
            },
            body: formData
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Token issue - try to refresh and retry
                const refreshed = await refreshToken(user);
                if (refreshed) {
                    // Get updated user with new token
                    const updatedUser = getCurrentUser();
                    // Retry the upload
                    const retryResponse = await fetch(`${BACKEND_URL}/upload_profile_picture`, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${updatedUser.token}`
                        },
                        body: formData
                    });
                    
                    if (!retryResponse.ok) {
                        throw new Error(`Upload failed after token refresh: ${retryResponse.status}`);
                    }
                    
                    // Use the retry response
                    response = retryResponse;
                } else {
                    throw new Error("Authentication failed - please log in again");
                }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Failed to upload profile picture");
            }
        }

        const data = await response.json();
        
        // Update local user data
        user.profile_picture_url = data.profile_picture_url;
        localStorage.setItem("user", JSON.stringify(user));
        
        // Update UI immediately
        updateProfilePictureUI(user);
        
        // Broadcast the update to all connected clients via WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "profile_picture_update",
                profile_picture_url: data.profile_picture_url,
                uid: user.uid
            }));
        }
        
        // Close modal
        document.getElementById("name-change-modal").style.display = "none";
        
        alert("Profile picture updated successfully!");
        return true;
    } catch (error) {
        console.error("Upload error:", error);
        if (error.message.includes("authenticated") || error.message.includes("token")) {
            // This is an auth error - suggest logging in again
            alert("Your session has expired. Please log in again.");
            setTimeout(() => {
                logoutUser();
                window.location.href = "login.html";
            }, 1500);
        } else {
            alert(`Upload failed: ${error.message}`);
        }
        return false;
    } finally {
        const submitBtn = document.getElementById("name-change-submit");
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Save';
        }
    }
}

// --- Private Group Member Request/Approval Logic ---

// UI Elements for new modals
const memberRequestModal = document.getElementById('member-request-modal');
const memberRequestCancel = document.getElementById('member-request-cancel');
const memberRequestConfirm = document.getElementById('member-request-confirm');
const requestMemberSearchInput = document.getElementById('request-member-search-input');
const requestMemberSearchResults = document.getElementById('request-member-search-results');
const requestSelectedMemberDisplay = document.getElementById('request-selected-member-display');
const requestSelectedMemberName = document.getElementById('request-selected-member-name');
const requestSelectedMemberUid = document.getElementById('request-selected-member-uid');

const reviewRequestsModal = document.getElementById('review-requests-modal');
const reviewRequestsClose = document.getElementById('review-requests-close');
const pendingRequestsList = document.getElementById('pending-requests-list');

let pendingAddRequests = [];
let selectedRequestUser = null;

// Helper: Show/Hide modals
function showModal(modal) { modal.style.display = 'flex'; }
function hideModal(modal) { modal.style.display = 'none'; }

// --- Add buttons to group menu dynamically ---
function updateGroupMenuButtons(group) {
  const user = getCurrentUser();
  const addMemberBtn = document.getElementById('add-member-btn');
  const kickMemberBtn = document.getElementById('kick-member-btn');
  const displayMembersBtn = document.getElementById('display-members-btn');
  const deleteGroupBtn = document.getElementById('delete-group-btn');
  const groupMenu = document.querySelector('.group-chat-only');
  // Remove any custom buttons first
  let requestBtn = document.getElementById('request-add-member-btn');
  if (requestBtn) requestBtn.remove();
  let reviewBtn = document.getElementById('review-add-requests-btn');
  if (reviewBtn) reviewBtn.remove();

  // Only show for private groups
  if (group.is_private) {
    if (group.creator === user.uid) {
      // OWNER: Show all admin options
      addMemberBtn.style.display = 'block';
      addMemberBtn.disabled = false;
      kickMemberBtn.style.display = 'block';
      kickMemberBtn.disabled = false;
      displayMembersBtn.style.display = 'block';
      displayMembersBtn.disabled = false;
      deleteGroupBtn.style.display = 'block';
      deleteGroupBtn.disabled = false;
      // Add review requests button
      const review = document.createElement('button');
      review.id = 'review-add-requests-btn';
      review.className = 'group-action-btn';
      review.innerHTML = '<i class="fas fa-user-clock"></i> Review Add Requests';
      review.onclick = () => openReviewRequestsModal(group.id);
      groupMenu.insertBefore(review, displayMembersBtn);
    } else {
      // NON-OWNER: Only show request to add and view members
      addMemberBtn.style.display = 'none';
      kickMemberBtn.style.display = 'none';
      deleteGroupBtn.style.display = 'none';
      displayMembersBtn.style.display = 'block';
      displayMembersBtn.disabled = false;
      // Add request to add member button
      const request = document.createElement('button');
      request.id = 'request-add-member-btn';
      request.className = 'group-action-btn';
      request.innerHTML = '<i class="fas fa-user-plus"></i> Request to Add Member';
      request.onclick = () => openMemberRequestModal(group.id);
      groupMenu.insertBefore(request, displayMembersBtn);
    }
  } else {
    // Public group: show add/kick/delete for owner only, view members for all
    addMemberBtn.style.display = group.creator === user.uid ? 'block' : 'none';
    addMemberBtn.disabled = group.creator === user.uid ? false : true;
    kickMemberBtn.style.display = group.creator === user.uid ? 'block' : 'none';
    kickMemberBtn.disabled = group.creator === user.uid ? false : true;
    deleteGroupBtn.style.display = group.creator === user.uid ? 'block' : 'none';
    deleteGroupBtn.disabled = group.creator === user.uid ? false : true;
    displayMembersBtn.style.display = 'block';
    displayMembersBtn.disabled = false;
  }
}

// --- Open Request to Add Member Modal ---
let currentRequestGroupId = null;
function openMemberRequestModal(groupId) {
  currentRequestGroupId = groupId;
  requestMemberSearchInput.value = '';
  requestMemberSearchResults.innerHTML = '';
  requestSelectedMemberDisplay.style.display = 'none';
  selectedRequestUser = null;
  memberRequestConfirm.disabled = true;
  showModal(memberRequestModal);
  // Always re-attach the input event listener with debounce
  requestMemberSearchInput.removeEventListener('input', requestMemberSearchInput._debouncedHandler || (()=>{}));
  const debounced = debounce(handleRequestMemberSearch, 300);
  requestMemberSearchInput.addEventListener('input', debounced);
  requestMemberSearchInput._debouncedHandler = debounced;
}

async function handleRequestMemberSearch(e) {
  const query = e.target.value.trim();
  requestMemberSearchResults.style.display = 'none';
  requestMemberSearchResults.innerHTML = '';
  
  if (query.length < 2) {
    memberRequestConfirm.disabled = true;
    return;
  }
  
  try {
    const user = getCurrentUser();
    const res = await fetch(`${BACKEND_URL}/search_users?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${user.token}` }
    });
    
    if (!res.ok) throw new Error(`Server error: ${res.statusText}`);
    
    const data = await res.json();
    let found = false;
    
    data.users.forEach(u => {
      // Don't show self or current group members
      if (u.uid === user.uid || (currentGroupData && currentGroupData.members.includes(u.uid))) return;
      
      found = true;
      const div = document.createElement('div');
      div.className = 'search-result-item';
      
      // Avatar and info like add member modal
      let avatarHTML;
      if (u.profile_picture_url) {
        avatarHTML = `<img src="${u.profile_picture_url}" alt="${u.name}" class="search-result-avatar-img">`;
      } else {
        const firstLetter = u.name?.charAt(0).toUpperCase() || "?";
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = u.name?.length % colors.length || 0;
        avatarHTML = `<div class="search-result-avatar-initials" style="background: ${colors[colorIndex]}">${firstLetter}</div>`;
      }
      
      div.innerHTML = `
        <div class="search-result-avatar">${avatarHTML}</div>
        <div class="search-result-info">
          <div class="search-result-name">${u.name || "Unknown"}</div>
          <div class="search-result-username">@${u.username || ""}</div>
        </div>
      `;
      
      div.onclick = () => {
        requestSelectedMemberDisplay.style.display = 'block';
        requestSelectedMemberName.textContent = `${u.name || u.username} (@${u.username})`;
        requestSelectedMemberUid.value = u.uid;
        selectedRequestUser = u;
        requestMemberSearchResults.style.display = 'none';
        requestMemberSearchInput.value = '';
        memberRequestConfirm.disabled = false;
      };
      
      requestMemberSearchResults.appendChild(div);
    });
    
    if (!found) {
      requestMemberSearchResults.innerHTML = '<div class="no-results">No users found</div>';
    }
    
    // Always show the results container if we have query
    requestMemberSearchResults.style.display = 'block';
    
  } catch (error) {
    console.error('Failed to search users:', error);
    requestMemberSearchResults.innerHTML = '<div class="no-results">Error searching users</div>';
    requestMemberSearchResults.style.display = 'block';
  }
}

memberRequestCancel.onclick = () => {
  hideModal(memberRequestModal);
  requestMemberSearchInput.value = '';
  requestMemberSearchResults.innerHTML = '';
  requestSelectedMemberDisplay.style.display = 'none';
  selectedRequestUser = null;
  memberRequestConfirm.disabled = true;
};

memberRequestConfirm.onclick = async function() {
  if (!selectedRequestUser || !currentRequestGroupId) return;
  const user = getCurrentUser();
  memberRequestConfirm.disabled = true;
  // Call backend to submit request
  const res = await fetch(`${BACKEND_URL}/groups/${currentRequestGroupId}/add_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ new_member_uid: selectedRequestUser.uid })
  });
  if (res.ok) {
    alert('Request sent to group owner!');
    hideModal(memberRequestModal);
  } else {
    const err = await res.json();
    alert('Error: ' + (err.detail || 'Could not send request.'));
  }
  // Reset modal state
  requestMemberSearchInput.value = '';
  requestMemberSearchResults.innerHTML = '';
  requestSelectedMemberDisplay.style.display = 'none';
  selectedRequestUser = null;
  memberRequestConfirm.disabled = true;
};

// --- Owner: Review Add Requests ---
let currentReviewGroupId = null;
async function openReviewRequestsModal(groupId) {
  currentReviewGroupId = groupId;
  await loadPendingAddRequests(groupId);
  showModal(reviewRequestsModal);
}

reviewRequestsClose.onclick = () => hideModal(reviewRequestsModal);

async function loadPendingAddRequests(groupId) {
  const user = getCurrentUser();
  const res = await fetch(`${BACKEND_URL}/groups/${groupId}/add_requests`, {
    headers: { Authorization: `Bearer ${user.token}` }
  });
  const data = await res.json();
  pendingAddRequests = data.requests || [];
  renderPendingRequests();
}

async function renderPendingRequests() {
  pendingRequestsList.innerHTML = '';
  if (pendingAddRequests.length === 0) {
    pendingRequestsList.innerHTML = '<div class="empty-state">No pending requests.</div>';
    return;
  }
  for (const req of pendingAddRequests) {
    // Fetch requester and new member details
    const [requester, newMember] = await Promise.all([
      fetchUserDetails(req.requester_uid),
      fetchUserDetails(req.new_member_uid)
    ]);
    const div = document.createElement('div');
    div.className = 'pending-request-item';
    div.innerHTML = `
      <div class="pending-request-info">
        <div class="pending-request-label"><b>${requester.username}</b> requests to add:</div>
        <div class="pending-request-user">
          <span class="pending-request-username">${newMember.username}</span>
          <span class="pending-request-name">(${newMember.name})</span>
        </div>
      </div>
      <div class="pending-request-actions">
        <button class="accept-btn">Accept</button>
        <button class="decline-btn">Decline</button>
      </div>
    `;
    div.querySelector('.accept-btn').onclick = () => respondToAddRequest(req.id, 'accept');
    div.querySelector('.decline-btn').onclick = () => respondToAddRequest(req.id, 'decline');
    pendingRequestsList.appendChild(div);
  }
}

async function respondToAddRequest(requestId, action) {
  const user = getCurrentUser();
  const res = await fetch(`${BACKEND_URL}/groups/${currentReviewGroupId}/add_requests/${requestId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ action })
  });
  if (res.ok) {
    await loadPendingAddRequests(currentReviewGroupId);
    await refreshCurrentGroup();
  } else {
    const err = await res.json();
    alert('Error: ' + (err.detail || 'Could not process request.'));
  }
}

async function fetchUserDetails(uid) {
  const user = getCurrentUser();
  const res = await fetch(`${BACKEND_URL}/user_details/${uid}`, {
    headers: { Authorization: `Bearer ${user.token}` }
  });
  if (!res.ok) return { username: uid, name: '' };
  return await res.json();
}

// --- Patch openGroupChat to update menu buttons ---
const originalOpenGroupChat = openGroupChat;
openGroupChat = async function(group) {
  await originalOpenGroupChat(group);
  updateGroupMenuButtons(group);
};

// Add this after the memberRequestModal declaration
document.addEventListener('click', (e) => {
  // Close search results if clicking outside
  if (!requestMemberSearchResults.contains(e.target) && 
      !requestMemberSearchInput.contains(e.target)) {
    requestMemberSearchResults.style.display = 'none';
  }
});

// Add this after the message input container HTML
const messageInputContainer = document.querySelector('.message-input-container');
messageInputContainer.innerHTML = `
  <div class="attachment-container">
    <button id="attachment-btn" class="attachment-btn">
      <i class="fas fa-image"></i>
    </button>
    <div class="attachment-menu">
      <div class="attachment-option" data-type="image">
        <i class="fas fa-image"></i>
        <span>Image</span>
      </div>
      <div class="attachment-option" data-type="video">
        <i class="fas fa-video"></i>
        <span>Video</span>
      </div>
      <div class="attachment-option" data-type="file">
        <i class="fas fa-file"></i>
        <span>File</span>
      </div>
    </div>
  </div>
  <input type="text" id="message-input" placeholder="Type a message...">
  <button id="send-btn"></button>
`;

// Add hidden file inputs for each type
const fileInputsHTML = `
  <input type="file" id="image-upload" accept="image/*" style="display: none;">
  <input type="file" id="video-upload" accept="video/*" style="display: none;">
  <input type="file" id="file-upload" style="display: none;">
`;
document.body.insertAdjacentHTML('beforeend', fileInputsHTML);

// Setup attachment button functionality
const attachmentBtn = document.getElementById('attachment-btn');
const attachmentMenu = document.querySelector('.attachment-menu');
const imageUpload = document.getElementById('image-upload');
const videoUpload = document.getElementById('video-upload');
const fileUpload = document.getElementById('file-upload');

// Toggle attachment menu
attachmentBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  attachmentMenu.classList.toggle('show');
});

// Close attachment menu when clicking outside
document.addEventListener('click', () => {
  attachmentMenu.classList.remove('show');
});

// Handle attachment option clicks
document.querySelectorAll('.attachment-option').forEach(option => {
  option.addEventListener('click', (e) => {
    e.stopPropagation();
    const type = option.dataset.type;
    switch(type) {
      case 'image':
        imageUpload.click();
        break;
      case 'video':
        videoUpload.click();
        break;
      case 'file':
        fileUpload.click();
        break;
    }
    attachmentMenu.classList.remove('show');
  });
});

// Handle file selection
async function handleFileUpload(file, type) {
    try {
        const user = getCurrentUser();
        if (!user?.token) throw new Error("User not authenticated");

        // Show upload progress
        const uploadId = `upload-${Date.now()}`;
        const progressDiv = document.createElement('div');
        progressDiv.id = uploadId;
        progressDiv.className = 'upload-progress';
        progressDiv.innerHTML = `
            <div class="upload-progress-inner">
                <div class="upload-progress-bar" style="width: 0%"></div>
                <div class="upload-info">
                    <span class="upload-filename">${file.name}</span>
                    <span class="upload-percent">0%</span>
                    <button class="cancel-upload">×</button>
                </div>
            </div>
        `;
        messagesContainer.appendChild(progressDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Create FormData
        const formData = new FormData();
        formData.append('file', file);

        // Create XHR request
        const xhr = new XMLHttpRequest();
        window.currentXHR = xhr; // Store for potential cancellation
        
        xhr.open('POST', `${BACKEND_URL}/upload`, true);
        xhr.setRequestHeader('Authorization', `Bearer ${user.token}`);

        // Track upload progress
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                const progressBar = progressDiv.querySelector('.upload-progress-bar');
                const percentText = progressDiv.querySelector('.upload-percent');
                
                progressBar.style.width = `${percent}%`;
                percentText.textContent = `${percent}%`;
            }
        };

        // Handle response
        xhr.onload = () => {
            window.currentXHR = null; // Clear when done
            
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                if (response.success) {
                    // Remove progress indicator
                    progressDiv.remove();

                    // Create message data
                    const messageData = {
                        text: file.name,
                        file_url: response.file_url,
                        file_type: response.file_type,
                        file_size: response.file_size,
                        sender: user.uid,
                        timestamp: new Date().toISOString()
                    };

                    // Determine message type based on file type
                    let messageType;
                    if (response.file_type.startsWith('image/')) {
                        messageType = 'image';
                    } else if (response.file_type.startsWith('video/')) {
                        messageType = 'video';
                    } else {
                        messageType = 'file';
                    }

                    // Add to local messages data immediately
                    if (currentChatUID) {
                        // Private chat
                        if (!messagesData[currentChatUID]) {
                            messagesData[currentChatUID] = [];
                        }
                        messagesData[currentChatUID].push({
                            ...messageData,
                            type: messageType
                        });
                        renderMessage({
                            ...messageData,
                            type: messageType
                        });
                    } else if (currentGroupId) {
                        // Group chat
                        if (!groupMessagesData[currentGroupId]) {
                            groupMessagesData[currentGroupId] = [];
                        }
                        groupMessagesData[currentGroupId].push({
                            ...messageData,
                            type: messageType,
                            group_id: currentGroupId
                        });
                        
                        // Get members for rendering
                        const group = groupsData.find(g => g.id === currentGroupId);
                        if (group) {
                            getGroupMembersDetails(group.members).then(members => {
                                renderGroupMessage({
                                    ...messageData,
                                    type: messageType,
                                    group_id: currentGroupId
                                }, members);
                            });
                        }
                    }

                    // Send via WebSocket
                    if (currentChatUID) {
                        // Private chat
                        ws.send(JSON.stringify({
                            type: "message",
                            receiver: currentChatUID,
                            ...messageData
                        }));
                    } else if (currentGroupId) {
                        // Group chat
                        ws.send(JSON.stringify({
                            type: "group_message",
                            group_id: currentGroupId,
                            ...messageData
                        }));
                    }

                    // Clear file input and preview
                    clearFilePreview();
                } else {
                    throw new Error(response.error || 'Upload failed');
                }
            } else {
                throw new Error(`Upload failed: ${xhr.statusText}`);
            }
        };

        xhr.onerror = () => {
            window.currentXHR = null;
            throw new Error('Upload failed');
        };

        xhr.onabort = () => {
            window.currentXHR = null;
            progressDiv.remove();
            clearFilePreview();
        };

        xhr.send(formData);

    } catch (error) {
        console.error('File upload failed:', error);
        showMessageError(error.message || 'Failed to upload file');
        
        // Remove progress indicator if still present
        const progressDiv = document.getElementById(uploadId);
        if (progressDiv) progressDiv.remove();
    }
}

// Add this helper function to clear file preview
function clearFilePreview() {
    currentFile = null;
    currentFileType = null;
    document.getElementById('file-preview').style.display = 'none';
    document.getElementById('image-upload').value = '';
    document.getElementById('video-upload').value = '';
    document.getElementById('file-upload').value = '';
}

// Add CSS for upload progress and error messages
const style = document.createElement('style');
style.textContent = `
    .upload-progress {
        padding: 10px;
        margin: 10px;
        background: rgba(46, 87, 223, 0.1);
        border-radius: 8px;
        text-align: center;
    }
    
    .upload-progress-inner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: #2e57df;
    }
    
    .message-error {
        padding: 10px;
        margin: 10px;
        background: rgba(255, 0, 0, 0.1);
        color: #ff3333;
        border-radius: 8px;
        text-align: center;
        animation: fadeIn 0.3s ease-in;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(style);
let currentFile = null;
let currentFileType = null;

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    currentFile = file;
    currentFileType = e.target.id.replace('-upload', ''); // 'image', 'video', or 'file'
    
    // Show preview
    const previewDiv = document.getElementById('file-preview');
    previewDiv.style.display = 'flex';
    previewDiv.innerHTML = '';
    
    if (currentFileType === 'image') {
        const reader = new FileReader();
        reader.onload = (event) => {
            previewDiv.innerHTML = `
                <img src="${event.target.result}" alt="Preview" class="file-preview-img">
                <div class="file-info">
                    <span>${file.name}</span>
                    <button class="remove-file-btn">&times;</button>
                </div>
            `;
            // Add event listener to the cancel button
            previewDiv.querySelector('.remove-file-btn').addEventListener('click', cancelFileUpload);
        };
        reader.readAsDataURL(file);
    } else if (currentFileType === 'video') {
        const videoURL = URL.createObjectURL(file);
        previewDiv.innerHTML = `
            <video controls class="file-preview-video">
                <source src="${videoURL}" type="${file.type}">
                Your browser does not support the video tag.
            </video>
            <div class="file-info">
                <span>${file.name}</span>
                <button class="remove-file-btn">&times;</button>
            </div>
        `;
        // Add event listener to the cancel button
        previewDiv.querySelector('.remove-file-btn').addEventListener('click', cancelFileUpload);
    } else {
        previewDiv.innerHTML = `
            <div class="file-preview-icon">
                <i class="fas fa-file"></i>
            </div>
            <div class="file-info">
                <span>${file.name}</span>
                <button class="remove-file-btn">&times;</button>
            </div>
        `;
        // Add event listener to the cancel button
        previewDiv.querySelector('.remove-file-btn').addEventListener('click', cancelFileUpload);
    }
}

// Add this new function to handle file upload cancellation
function cancelFileUpload() {
    currentFile = null;
    currentFileType = null;
    document.getElementById('file-preview').style.display = 'none';
    
    // Reset all file inputs
    document.getElementById('image-upload').value = '';
    document.getElementById('video-upload').value = '';
    document.getElementById('file-upload').value = '';
    
    // If there's an ongoing upload, cancel it
    if (window.currentXHR) {
        window.currentXHR.abort();
        window.currentXHR = null;
    }
    
    // Remove any upload progress indicators
    const progressDivs = document.querySelectorAll('.upload-progress');
    progressDivs.forEach(div => div.remove());
}
// Separate handler for send button click
function handleSendMessage(e) {
    e.preventDefault();
    const messageInput = document.getElementById('message-input');
    const text = messageInput.value.trim();
    if (text) {
        sendMessage(text);
        messageInput.value = '';
    }
}
// Separate handler for keydown events
function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const messageInput = document.getElementById('message-input');
        const text = messageInput.value.trim();
        if (text) {
            sendMessage(text);
            messageInput.value = '';
        }
    }
}
// Helper function to get file icon based on type
function getFileIcon(fileType) {
    if (!fileType) return 'fa-file';
    
    if (fileType.includes('pdf')) return 'fa-file-pdf';
    if (fileType.includes('word')) return 'fa-file-word';
    if (fileType.includes('excel')) return 'fa-file-excel';
    if (fileType.includes('zip')) return 'fa-file-archive';
    
    return 'fa-file';
}
// Helper function to get video thumbnail (you might need to implement this differently)
function getVideoThumbnail(videoUrl) {
    // In a real app, you might want to generate thumbnails on upload
    return ''; // Return a placeholder or actual thumbnail URL
}

// Function to open image in lightbox
function openImagePreview(imageUrl) {
    // Implement a lightbox or modal to view the image
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';
    lightbox.innerHTML = `
        <div class="lightbox-content">
            <img src="${imageUrl}" alt="Preview">
            <button class="close-lightbox">&times;</button>
        </div>
    `;
    document.body.appendChild(lightbox);
    
    lightbox.querySelector('.close-lightbox').addEventListener('click', () => {
        lightbox.remove();
    });
    
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            lightbox.remove();
        }
    });
}
async function handleContactRequestAccepted(data) {
    const user = getCurrentUser();
    if (!user) return;

    // Show a notification to the user
    alert(`Your contact request to ${data.receiver_name} has been accepted!`);

    // Reload contacts to show the new contact
    await loadContacts();
    
    
    // Update notification count if needed
    await fetchPendingContactRequests();
}