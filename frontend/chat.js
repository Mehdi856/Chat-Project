// ✅ Wait for DOM to fully load
document.addEventListener("DOMContentLoaded", async function () {
  if (!isAuthenticated()) {
    window.location.href = "login.html"; // ✅ Redirect if not authenticated
    return;
  }

  // ✅ DOM Elements
  const messageInput = document.getElementById("message-input");
  const sendButton = document.getElementById("send-btn");
  const messagesContainer = document.getElementById("messages-container");
  const contactsList = document.getElementById("contacts-list");
  const chatContent = document.getElementById("chat-content");
  const noChatSelected = document.getElementById("no-chat-selected");
  const backButton = document.getElementById("back-button");

  // ✅ Get user details
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  document.getElementById("user-info").textContent = user.username || user.email;

  // ✅ Fetch and display contacts from Firestore
  await loadContacts();

  // ✅ Connect to WebSocket
  const ws = new WebSocket("wss://chat-project-2.onrender.com/ws");

  ws.onopen = () => {
    console.log("✅ Connected to WebSocket");
    ws.send(JSON.stringify({ type: "auth", token: user.token })); // Send authentication
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "message") {
      displayMessage(data.sender, data.message, true);
    }
  };

  ws.onclose = () => console.log("❌ WebSocket closed");

  // ✅ Function to send a message
  async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    const activeContact = document.querySelector(".contact.active");
    if (!activeContact) return;

    const receiverEmail = activeContact.getAttribute("data-contact-email");

    const messageData = {
      sender: user.email,
      receiver: receiverEmail,
      message: message,
    };

    ws.send(JSON.stringify(messageData)); // ✅ Send via WebSocket
    displayMessage(user.email, message, false);

    messageInput.value = "";
  }

  // ✅ Display messages in chat
  function displayMessage(sender, message, isReceived) {
    const messageGroup = document.createElement("div");
    messageGroup.className = `message-group ${isReceived ? "received" : "sent"}`;

    const messageElement = document.createElement("div");
    messageElement.className = `message ${isReceived ? "received" : "sent"}`;

    const messageContent = document.createElement("div");
    messageContent.className = "message-content";
    messageContent.textContent = message;

    const timeElement = document.createElement("div");
    timeElement.className = "message-time";
    timeElement.textContent = new Date().toLocaleTimeString();

    messageElement.appendChild(messageContent);
    messageElement.appendChild(timeElement);
    messageGroup.appendChild(messageElement);

    messagesContainer.appendChild(messageGroup);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // ✅ Send message when button is clicked
  sendButton.addEventListener("click", sendMessage);

  // ✅ Send message when pressing Enter
  messageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      sendMessage();
    }
  });

  // ✅ Load chat messages from Firestore
  async function loadMessages(receiverEmail) {
    try {
      const response = await fetch(`https://chat-project-2.onrender.com/messages?receiver=${receiverEmail}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      });

      const messages = await response.json();
      messagesContainer.innerHTML = "";

      messages.forEach((msg) => {
        if (msg.sender === receiverEmail || msg.receiver === receiverEmail) {
          displayMessage(msg.sender, msg.message, msg.sender !== user.email);
        }
      });
    } catch (error) {
      console.error("Error loading messages:", error);
    }
  }

  // ✅ Show chat window & hide placeholder
  function showChatContent() {
    noChatSelected.style.display = "none";
    chatContent.style.display = "flex";
    chatContent.style.flexDirection = "column";
  }

  // ✅ Handle back button (mobile view)
  backButton.addEventListener("click", function () {
    noChatSelected.style.display = "flex";
    chatContent.style.display = "none";
    document.querySelectorAll(".contact").forEach((c) => c.classList.remove("active"));
  });

  // ✅ Fetch contacts dynamically from Firestore
  async function loadContacts() {
    try {
      const contacts = await fetchContacts(); // ✅ Call the function from `firebase.js`
      contactsList.innerHTML = ""; // Clear old contacts

      contacts.forEach((contact) => {
        if (contact.email !== user.email) {
          const contactElement = document.createElement("div");
          contactElement.classList.add("contact");
          contactElement.setAttribute("data-contact-email", contact.email);

          contactElement.innerHTML = `
            <div class="contact-avatar">${contact.username.charAt(0).toUpperCase()}</div>
            <div class="contact-info">
              <div class="contact-name">${contact.username}</div>
              <div class="contact-preview">Click to chat</div>
            </div>
          `;

          contactsList.appendChild(contactElement);

          // ✅ Add event listener for selecting contact
          contactElement.addEventListener("click", function () {
            document.querySelectorAll(".contact").forEach((c) => c.classList.remove("active"));
            contactElement.classList.add("active");

            document.querySelector(".chat-header .contact-name").textContent = contact.username;
            showChatContent();
            loadMessages(contact.email);
          });
        }
      });

      // ✅ Auto load first contact
      const firstContact = document.querySelector(".contact");
      if (firstContact) {
        firstContact.classList.add("active");
        const firstEmail = firstContact.getAttribute("data-contact-email");
        const firstName = firstContact.querySelector(".contact-name").textContent;
        document.querySelector(".chat-header .contact-name").textContent = firstName;
        loadMessages(firstEmail);
      }
    } catch (error) {
      console.error("Error loading contacts:", error);
    }
  }
});

