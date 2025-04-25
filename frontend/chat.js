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
    await loadGroups();
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
    currentGroupId = null; // Ensure group ID is cleared
    messagesContainer.innerHTML = "";
    unreadMessages[contact.uid] = 0;
    updateContactUI();

    noChatSelected.style.display = "none";
    activeChat.style.display = "flex";
    document.getElementById("New-contact").style.display = "none";
    document.getElementById("New-group").style.display = "none";
    
    // Reset menu items to private chat mode
    document.querySelectorAll('.private-chat-only').forEach(el => el.style.display = 'block');
    document.querySelectorAll('.group-chat-only').forEach(el => el.style.display = 'none');
    
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
    
    
    
    messageDiv.textContent = message.text;
    
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
            } else if (data.type === "group_message") {
                handleNewGroupMessage(data);
            } else if (data.type === "typing") {
                showTypingIndicator(data.sender);
            } else if (data.type === "group_typing") {
                showGroupTypingIndicator(data.group_id, data.sender);
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
    if (!text) return;

    try {
        const user = getCurrentUser();
        if (!user) throw new Error("User not authenticated");

        if (currentChatUID) {
            // Private message
            const message = {
                type: "message",
                text,
                sender: user.uid,
                receiver: currentChatUID,
                timestamp: new Date().toISOString()
            };

            ws.send(JSON.stringify({ 
                ...message 
            }));

            // Handle the sent message locally
            handleNewMessage(message);
        } else if (currentGroupId) {
            // Group message
            const message = {
                type:"group_message",
                text,
                sender: user.uid,
                group_id: currentGroupId,
                timestamp: new Date().toISOString()
            };

            ws.send(JSON.stringify({  
                ...message 
            }));

            // Handle the sent message locally
            handleNewGroupMessage(message);
        }

        // Clear input field
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
        return Array.isArray(messages) ? messages : [];
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
            
            const firstLetter = group.name?.charAt(0).toUpperCase() || "G";
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = group.name?.length % colors.length || 0;
            const avatarColor = colors[colorIndex];
            
            const lastMessage = getLastGroupMessagePreview(group.id);
            const lastMessageText = lastMessage?.text || "No messages yet";
            
            let timeString = "";
            if (lastMessage?.timestamp) {
                timeString = formatMessageTime(new Date(lastMessage.timestamp));
            }
            
            groupItem.innerHTML = `
                <div class="contact-avatar" style="background: ${avatarColor}">${firstLetter}</div>
                <div class="contact-info">
                    <div class="contact-name-row">
                        <span class="contact-name">${group.name}</span>
                        <span class="message-time">${timeString}</span>
                    </div>
                    <div class="contact-preview">${lastMessageText}</div>
                    <div class="group-privacy">
                        ${group.is_private 
                            ? '<i class="fas fa-lock"></i> Private' 
                            : '<i class="fas fa-globe"></i> Public'}
                    </div>
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
    
    messageDiv.innerHTML = `
        <small class="group-sender-name">${senderName}</small>
        <div>${message.text}</div>
    `;
    
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
    
    // Render message if in active group chat
    if (message.group_id === currentGroupId) {
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
        
        // For private groups, show a message that only admins can add
        if (currentGroupData && currentGroupData.is_private) {
            searchContainer.innerHTML = `
                <div class="private-group-notice">
                    <i class="fas fa-lock"></i>
                    <p>This is a private group. Only admins can add new members.</p>
                </div>
            `;
            document.getElementById("member-modal-confirm").style.display = "none";
        } else {
            // Regular search input for public groups
            searchContainer.innerHTML = `
                <input type="text" id="member-search-input" placeholder="Search users...">
                <div id="member-search-results" class="search-results"></div>
            `;
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
        
        if (results.users && results.users.length > 0) {
            displayMemberSearchResults(results.users);
        }
    } catch (error) {
        console.error("Failed to search users:", error);
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
        resultsContainer.style.display = "none";
        return;
    }

    filteredUsers.forEach(user => {
        const resultItem = document.createElement("div");
        resultItem.classList.add("member-search-item");
        
        const firstLetter = (user.name || user.username || "?").charAt(0).toUpperCase();
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = (user.name || user.username || "").length % colors.length;
        
        resultItem.innerHTML = `
            <div class="member-search-avatar" style="background: ${colors[colorIndex]}">${firstLetter}</div>
            <div>
                <div>${user.name || "Unknown"}</div>
                <small>@${user.username || ""}</small>
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
        
        if (currentModalAction === 'add') {
            // Call backend to add member by UID
            const response = await fetch(`${BACKEND_URL}/groups/${currentGroupId}/members`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${user.token}`
                },
                body: JSON.stringify({ members: [selectedMember.uid] })
            });
            
            if (!response.ok) throw new Error(`Failed to add member: ${response.statusText}`);
            
            alert(`${selectedMember.name} added to group successfully!`);
        } else if (currentModalAction === 'kick') {
            // Call backend to kick member by UID
            const response = await fetch(`${BACKEND_URL}/groups/${currentGroupId}/members/${selectedMember.uid}`, {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${user.token}`
                }
            });
            
            if (!response.ok) throw new Error(`Failed to kick member: ${response.statusText}`);
            
            alert(`${selectedMember.name} removed from group successfully!`);
        }
        
        // Refresh group data
        await loadGroups();
        
        if (currentGroupId) {
            const updatedGroup = groupsData.find(g => g.id === currentGroupId);
            if (updatedGroup) {
                openGroupChat(updatedGroup);
            } else {
                // Group no longer exists or we were removed
                activeChat.style.display = "none";
                noChatSelected.style.display = "flex";
                currentGroupId = null;
            }
        }

        
        closeMemberModal();
    } catch (error) {
        console.error(`Error in member action:`, error);
        alert(`Failed to ${currentModalAction} member: ${error.message}`);
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
    
    // Clear and populate members list
    membersContainer.innerHTML = "";
    
    // Get detailed member info
    const members = await getGroupMembersDetails(currentGroupData.members);
    
    members.forEach(member => {
        const memberItem = document.createElement("div");
        memberItem.classList.add("member-item");
        
        const firstLetter = (member.name || member.username || "?").charAt(0).toUpperCase();
        const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
        const colorIndex = (member.name || member.username || "").length % colors.length;
        
        memberItem.innerHTML = `
            <div style="display: flex; align-items: center;">
                <div class="member-search-avatar" style="background: ${colors[colorIndex]}">${firstLetter}</div>
                <div>
                    <div>${member.name || "Unknown"}</div>
                    <small>@${member.username || ""}</small>
                </div>
            </div>
            ${member.uid === currentGroupData.creator ? '<small>(Creator)</small>' : ''}
        `;
        
        membersContainer.appendChild(memberItem);
    });

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
    
    const membersContainer = document.getElementById("display-members-container");
    membersContainer.innerHTML = "<div class='loading-message'>Loading members...</div>";
    
    try {
        // Get detailed member info
        const members = await getGroupMembersDetails(currentGroupData.members);
        
        // Filter out the current user (you can't kick yourself)
        const currentUser = getCurrentUser();
        const filteredMembers = members.filter(member => member.uid !== currentUser.uid);
        
        if (filteredMembers.length === 0) {
            membersContainer.innerHTML = "<div class='empty-message'>No members available to kick</div>";
            return;
        }
        
        membersContainer.innerHTML = "";
        
        filteredMembers.forEach(member => {
            const memberItem = document.createElement("div");
            memberItem.classList.add("member-item", "kick-member-item");
            
            const firstLetter = (member.name || member.username || "?").charAt(0).toUpperCase();
            const colors = ['#6e8efb', '#a777e3', '#4CAF50', '#FF5722', '#607D8B'];
            const colorIndex = (member.name || member.username || "").length % colors.length;
            
            memberItem.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <div class="member-search-avatar" style="background: ${colors[colorIndex]}">${firstLetter}</div>
                    <div>
                        <div>${member.name || "Unknown"}</div>
                        <small>@${member.username || ""}</small>
                    </div>
                </div>
                ${member.uid === currentGroupData.creator ? '<small>(Creator)</small>' : ''}
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
            });
            
            membersContainer.appendChild(memberItem);
        });
    } catch (error) {
        console.error("Failed to load members for kicking:", error);
        membersContainer.innerHTML = "<div class='error-message'>Failed to load members</div>";
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
