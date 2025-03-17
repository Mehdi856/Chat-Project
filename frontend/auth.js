// ✅ Wait for DOM to load before executing scripts
document.addEventListener("DOMContentLoaded", function () {
  if (document.getElementById("container")) {
    setupLoginPage();
  }

  // ✅ Handle logout button if it exists
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutUser);
  }
});

/**
 * 🔹 Setup login and sign-up form handling
 */
function setupLoginPage() {
  const signUpButton = document.getElementById("signUp");
  const signInButton = document.getElementById("signIn");
  const container = document.getElementById("container");
  const welcomeContent = document.querySelector(".welcome-content");
  const signupContent = document.querySelector(".signup-content");

  // ✅ Handle form submissions
  const signinForm = document.getElementById("signin-form");
  const signupForm = document.getElementById("signup-form");

  if (signinForm) {
    signinForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const email = document.getElementById("signin-email").value.trim();
      const password = document.getElementById("signin-password").value.trim();

      if (!email || !password) {
        showMessage("Please fill in all fields", "error");
        return;
      }

      // ✅ Call Firebase login function
      await loginUser(email, password);
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const email = document.getElementById("signup-email").value.trim();
      const password = document.getElementById("signup-password").value.trim();

      if (!email || !password) {
        showMessage("Please fill in all fields", "error");
        return;
      }

      if (password.length < 6) {
        showMessage("Password must be at least 6 characters", "error");
        return;
      }

      // ✅ Call Firebase register function
      await registerUser(email, password);
    });
  }

  // 🔹 Handle UI switching between login and sign-up
  if (signUpButton) {
    signUpButton.addEventListener("click", (e) => {
      e.preventDefault();
      switchToSignup(container, welcomeContent, signupContent);
    });
  }

  if (signInButton) {
    signInButton.addEventListener("click", (e) => {
      e.preventDefault();
      switchToSignin(container, welcomeContent, signupContent);
    });
  }
}

/**
 * 🔹 Show pop-up messages (success, error, info)
 */
function showMessage(message, type = "info") {
  let messageContainer = document.querySelector(".message-container");
  if (!messageContainer) {
    messageContainer = document.createElement("div");
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
      if (messageContainer.children.length === 0) {
        messageContainer.remove();
      }
    }, 300);
  }, 3000);
}

/**
 * 🔹 Switch UI to Sign-Up
 */
function switchToSignup(container, welcomeContent, signupContent) {
  welcomeContent.style.opacity = 0;
  setTimeout(() => {
    welcomeContent.style.display = "none";
    signupContent.style.display = "flex";
    signupContent.style.opacity = 1;
  }, 300);
  container.classList.add("right-panel-active");
}

/**
 * 🔹 Switch UI to Sign-In
 */
function switchToSignin(container, welcomeContent, signupContent) {
  signupContent.style.opacity = 0;
  setTimeout(() => {
    signupContent.style.display = "none";
    welcomeContent.style.display = "flex";
    welcomeContent.style.opacity = 1;
  }, 300);
  container.classList.remove("right-panel-active");
}

/**
 * 🔹 Check if user is already logged in
 */
document.addEventListener("DOMContentLoaded", function () {
  if (isAuthenticated()) {
    window.location.href = "index.html"; // ✅ Redirect to chat if already logged in
  }
});
