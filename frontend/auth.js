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

async function registerUser(email, password, name) {
  try {
    const response = await fetch("https://chat-project-2.onrender.com/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Registration failed");

    // Automatically log in after registration
    return await loginUser(email, password);
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

    // 1️⃣ Sign in using Firebase custom token
    const userCredential = await signInWithCustomToken(auth, data.token);
    const user = userCredential.user;

    // 2️⃣ Get Firebase ID token
    const idToken = await user.getIdToken();
    const userData = { 
      email,
      uid: data.uid,        // 🔥 Store UID from backend 
      name: data.name,      // 🔥 Store name from backend
      customToken: data.token,  // Backend custom token
      idToken: idToken          // Firebase ID token
    }
    
    // 3️⃣ Store all user data
    localStorage.setItem("user", JSON.stringify(userData));
    console.log("✅ User saved to localStorage:", userData);
    window.location.href = "index.html";
    return true;
  } catch (error) {
    console.error("Login error:", error);
    return { error: error.message };
  }
}



// Get current user from localStorage
// Get current user from localStorage
function getCurrentUser() {
  const user = JSON.parse(localStorage.getItem("user"));
    if (!user || !user.idToken || !user.uid) return null;

    return {
        email: user.email,
        uid: user.uid,
        name: user.name,      // Add name to returned object
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
