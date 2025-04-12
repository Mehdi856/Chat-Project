// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js";
import { 
  getAuth, signInWithCustomToken, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBuGGwsMdxtxDjPBJ8YcqVIX3OixffyO8E",
  authDomain: "chat-room-6db06.firebaseapp.com",
  projectId: "chat-room-6db06",
  storageBucket: "chat-room-6db06.appspot.com",
  messagingSenderId: "441142419097",
  appId: "1:441142419097:web:beb9d622a6c11272496208"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Wait for DOM to load
document.addEventListener("DOMContentLoaded", function () {
  if (document.getElementById("container")) {
    setupLoginPage();
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutUser);
  }

  if (isAuthenticated() && document.getElementById("container")) {
    window.location.href = "index.html";
  }
});

// Setup login/signup forms
function setupLoginPage() {
  const signUpButton = document.getElementById("signUp");
  const signInButton = document.getElementById("signIn");
  const signUpBtn = document.getElementById("signUpBtn");
  const signInBtn = document.getElementById("signInBtn");
  const container = document.getElementById("container");

  signUpButton?.addEventListener("click", (e) => {
    e.preventDefault();
    container.classList.add("right-panel-active");
  });

  signInButton?.addEventListener("click", (e) => {
    e.preventDefault();
    container.classList.remove("right-panel-active");
  });

  signUpBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    container.classList.add("right-panel-active");
  });

  signInBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    container.classList.remove("right-panel-active");
  });

  document.getElementById("signin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("signin-email").value;
    const password = document.getElementById("signin-password").value;

    const result = await loginUser(email, password);
    if (result.error) showMessage(result.error, "error");
  });

  document.getElementById("signup-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("signup-name").value;
    const email = document.getElementById("signup-email").value;
    const password = document.getElementById("signup-password").value;

    if (password.length < 6) {
      showMessage("Password must be at least 6 characters long", "error");
      return;
    }

    const result = await registerUser(email, password, name);
    if (result.error) showMessage(result.error, "error");
  });
}

async function registerUser(email, password, name) {  // Remove username parameter
  try {
    const response = await fetch("https://chat-project-2.onrender.com/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),  // Remove username from body
    });

    // Rest of the function remains the same
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Registration failed");

    // Automatically log in after registration
    const loginResult = await loginUser(email, password);
    if (!loginResult) {
      return { error: "Login after registration failed" };
    }
    return { success: true };
  } catch (error) {
    console.error("Registration error:", error);
    return { error: error.message };
  }
}


async function loginUser(email, password) {
  try {
    const response = await fetch("https://chat-project-2.onrender.com/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Login failed");

    // Sign in using Firebase custom token
    const userCredential = await signInWithCustomToken(auth, data.token);
    const user = userCredential.user;

    // Get Firebase ID token
    const idToken = await user.getIdToken();
    const userData = { 
      email,
      uid: data.uid,
      name: data.name,
      username: data.username,
      customToken: data.token,
      idToken: idToken
    };
    
    // Store all user data
    localStorage.setItem("user", JSON.stringify(userData));
    
    // Check if username is empty and show prompt if needed
    if (!data.username || data.username === "") {
      showUsernamePrompt(data.uid, idToken);
      return false; // Don't redirect yet
    }
    
    window.location.href = "index.html";
    return { success: true };
  } catch (error) {
    console.error("Login error:", error);
    return { error: error.message };
  }
}
async function showUsernamePrompt(uid, token) {
  // Create a modal for username input
  const modal = document.createElement('div');
  modal.className = 'username-modal';
  modal.innerHTML = `
    <div class="username-modal-content">
      <h3>Welcome!</h3>
      <p>Please choose a username to continue</p>
      <input type="text" id="username-input" placeholder="Enter your username (letters and numbers only)" />
      <button id="submit-username">Submit</button>
      <p id="username-error" class="error-message"></p>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Handle submit button click
  document.getElementById('submit-username').addEventListener('click', async () => {
    const username = document.getElementById('username-input').value.trim();
    const errorElement = document.getElementById('username-error');
    errorElement.textContent = "";
    
    try {
      if (!username) {
        throw new Error('Username cannot be empty');
      }
      
      if (username.length < 3) {
        throw new Error('Username must be at least 3 characters');
      }
      
      if (!/^[a-zA-Z0-9]+$/.test(username)) {
        throw new Error('Username can only contain letters and numbers');
      }
      
      const response = await fetch('https://chat-project-2.onrender.com/set_username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ uid, username })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to set username');
      }
      
      // Update local storage with new username
      const user = JSON.parse(localStorage.getItem('user'));
      user.username = username;
      localStorage.setItem('user', JSON.stringify(user));
      
      // Remove modal and redirect
      modal.remove();
      window.location.href = 'index.html';
    } catch (error) {
      errorElement.textContent = error.message;
      console.error('Username setting error:', error);
    }
  });
}



// Get current user from localStorage
function getCurrentUser() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user || !user.idToken || !user.uid) return null;

  return {
    email: user.email,
    uid: user.uid,
    name: user.name,
    username: user.username,
    token: user.idToken,
    customToken: user.customToken
  };
}

// Log out user
async function logoutUser() {
  try {
    await signOut(auth);
    localStorage.removeItem("user");
    window.location.href = "login.html";
  } catch (error) {
    console.error("Logout error:", error);
    showMessage("Logout failed!", "error");
  }
}

// Check if user is authenticated
function isAuthenticated() {
  return localStorage.getItem("user") !== null;
}

// Show messages
function showMessage(message, type = "info") {
  let messageContainer = document.getElementById("message-container");

  if (!messageContainer) {
    messageContainer = document.createElement("div");
    messageContainer.id = "message-container";
    messageContainer.className = "message-container";
    document.body.appendChild(messageContainer);
  }

  const messageElement = document.createElement("div");
  messageElement.className = `message ${type}`;
  messageElement.textContent = message;

  messageContainer.appendChild(messageElement);

  setTimeout(() => {
    messageElement.classList.add("fade-out");
    setTimeout(() => {
      messageElement.remove();
    }, 300);
  }, 3000);
}

// Export functions
export { showMessage, registerUser, loginUser, getCurrentUser, logoutUser };
