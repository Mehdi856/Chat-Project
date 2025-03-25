import { getCurrentUser, logoutUser } from "./auth.js";

const BACKEND_URL = "https://chat-project-2.onrender.com";
let ws = null; // WebSocket connection

const messagesContainer = document.getElementById("messages-container");
const contactsContainer = document.getElementById("contacts-list");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const logoutBtn = document.getElementById("logout-btn");
const typingIndicator = document.getElementById("typing-indicator");

let currentChatUID = null; // Stores the UID of the currently opened chat
let unreadMessages = {}; // Stores unread message counts per user

async function initChat() {
    const user = getCurrentUser();
    if (!user ) {
        window.location.href = "login.html"; // Redirect if not logged in
        return;
    }

    await loadContacts(); // Load contact list from backend
    setupWebSocket(user); // Connect to WebSocket server
    setupEventListeners(); // Attach event listeners
}

async function loadContacts() {
  try {
      const user = getCurrentUser();
      if (!user || !user.token || !user.uid) throw new Error("User not authenticated");

      const response = await fetch(`${BACKEND_URL}/contacts/${user.uid}`, {
          headers: { Authorization: `Bearer ${user.token}` },
      });

      if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

      const data = await response.json();
      const contacts = data.contacts || []; // Ensure contacts is an array
      const filteredContacts = contacts.filter(contact => contact !== user.uid); // Exclude self
      renderContacts(filteredContacts);
  } catch (error) {
      console.error("❌ Failed to load contacts:", error);
  }
}


function setupWebSocket(user) {
    ws = new WebSocket(`wss://chat-project-2.onrender.com/ws`);
    
    ws.onopen = () => {
        const user = getCurrentUser();
        console.log("✅ WebSocket connected");
        ws.send(JSON.stringify({ token: user.token })); // Authenticate user
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);

            if (message.type === "message") {
                if (message.sender === currentChatUID) {
                    renderMessage(message);
                } else {
                    unreadMessages[message.sender] = (unreadMessages[message.sender] || 0) + 1;
                    updateContactUI(); // Update unread message count
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

async function openChat(contact) {
  currentChatUID = contact.uid;
  messagesContainer.innerHTML = ""; // Clear previous messages
  unreadMessages[contact.uid] = 0; // Reset unread count
  updateContactUI(); // Refresh contact list

  // ✅ Hide the "no chat selected" message
  document.getElementById("no-chat-selected").style.display = "none";

  // ✅ Show the main chat interface
  document.getElementById("active-chat").style.display = "flex";

  // ✅ Update chat header
  document.getElementById("chat-name").textContent = contact.username || contact.uid;

  await loadMessages(contact.uid);
}


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

function setupEventListeners() {
    sendBtn.addEventListener("click", sendMessage);
    messageInput.addEventListener("input", () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "typing", sender: getCurrentUser().uid }));
        }
    });

    logoutBtn.addEventListener("click", logoutUser);
}

// Utility function to update unread messages UI
function updateContactUI() {
    document.querySelectorAll(".contact-item").forEach(item => {
        const uid = item.dataset.uid;
        const unreadCount = unreadMessages[uid] || 0;
        const unreadBadge = item.querySelector(".unread-count");

        if (unreadCount > 0) {
            unreadBadge.textContent = unreadCount;
            unreadBadge.style.display = "inline-block";
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
          <span>${contact.uid || "Unknown"}</span> <!-- Avoid undefined -->
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
    messagesContainer.appendChild(messageDiv);
}

// Initialize chat on page load
initChat();
