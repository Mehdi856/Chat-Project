// Wait for DOM to load
document.addEventListener("DOMContentLoaded", function () {
  // If on login page, setup login/signup logic
  if (document.getElementById("container")) {
    setupLoginPage();
  }

  // If on chat page, setup logout button
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutUser);
  }

  // Redirect authenticated users away from login page
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

  // Handle sign-in form submission
  document.getElementById("signin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("signin-email").value;
    const password = document.getElementById("signin-password").value;

    const result = await loginUser(email, password);
    if (result.error) showMessage(result.error, "error");
  });

  // Handle sign-up form submission
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

/**
 * Register a new user with FastAPI
 */
async function registerUser(email, password, name) {
  try {
    const response = await fetch("https://chat-project-2.onrender.com/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Registration failed");

    showMessage("Registration successful! You can log in now.", "success");
    return true;
  } catch (error) {
    console.error("Registration error:", error);
    return { error: error.message };
  }
}

/**
 * Log in a user with FastAPI
 */
async function loginUser(email, password) {
  try {
    const response = await fetch("https://chat-project-2.onrender.com/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Login failed");

    // Store token in localStorage
    localStorage.setItem("user", JSON.stringify(data));

    window.location.href = "index.html";
    return true;
  } catch (error) {
    console.error("Login error:", error);
    return { error: error.message };
  }
}

/**
 * Log out the current user
 */
function logoutUser() {
  localStorage.removeItem("user");
  window.location.href = "login.html";
}

/**
 * Check if a user is authenticated
 */
function isAuthenticated() {
  return localStorage.getItem("user") !== null;
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
export { showMessage , registerUser , loginUser };

