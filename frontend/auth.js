import { registerUser, loginUser, logoutUser, isAuthenticated } from "./firebase.js";

// Wait for DOM to load
document.addEventListener("DOMContentLoaded", function() {
  // Check if we're on the login page
  const container = document.getElementById("container");
  if (container) {
    setupLoginPage();
  }
  
  // Check if we're on the chat page
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async function() {
      await logoutUser();
    });
  }
  
  // Auto-redirect if authenticated but on login page
  if (isAuthenticated() && document.getElementById("container")) {
    window.location.href = "index.html";
  }
});

/**
 * Setup login and signup forms
 */
function setupLoginPage() {
  const signUpButton = document.getElementById("signUp");
  const signInButton = document.getElementById("signIn");
  const signUpBtn = document.getElementById("signUpBtn");
  const signInBtn = document.getElementById("signInBtn");
  const container = document.getElementById("container");
  
  // Handle form switching
  if (signUpButton) {
    signUpButton.addEventListener("click", function(e) {
      e.preventDefault();
      container.classList.add("right-panel-active");
    });
  }
  
  if (signInButton) {
    signInButton.addEventListener("click", function(e) {
      e.preventDefault();
      container.classList.remove("right-panel-active");
    });
  }
  
  if (signUpBtn) {
    signUpBtn.addEventListener("click", function(e) {
      e.preventDefault();
      container.classList.add("right-panel-active");
    });
  }
  
  if (signInBtn) {
    signInBtn.addEventListener("click", function(e) {
      e.preventDefault();
      container.classList.remove("right-panel-active");
    });
  }
  
  // Handle sign in form submission
  const signinForm = document.getElementById("signin-form");
  if (signinForm) {
    signinForm.addEventListener("submit", async function(e) {
      e.preventDefault();
      const email = document.getElementById("signin-email").value;
      const password = document.getElementById("signin-password").value;
      
      const result = await loginUser(email, password);
      if (result.error) {
        showMessage(result.error, "error");
      }
    });
  }
  
  // Handle sign up form submission
  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async function(e) {
      e.preventDefault();
      const name = document.getElementById("signup-name").value;
      const email = document.getElementById("signup-email").value;
      const password = document.getElementById("signup-password").value;
      
      // Validate password
      if (password.length < 6) {
        showMessage("Password must be at least 6 characters long", "error");
        return;
      }
      
      const result = await registerUser(email, password, name);
      if (result.error) {
        showMessage(result.error, "error");
      }
    });
  }
}

/**
 * Show popup message
 */
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

// Export showMessage function
export { showMessage };
