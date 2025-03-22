const BACKEND_URL = "https://chat-project-2.onrender.com";

/**
 * Register a new user (Firebase)
 */
async function registerUser(email, password, username) {
  try {
    const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;

    // ✅ Update display name
    await user.updateProfile({ displayName: username });

    // ✅ Get Firebase token
    const token = await user.getIdToken();

    // ✅ Save user data
    localStorage.setItem("user", JSON.stringify({ 
      uid: user.uid, 
      email: user.email, 
      username, 
      token 
    }));

    window.location.href = "index.html"; // Redirect after registration
    return { success: true, message: "Registration successful" };
  } catch (error) {
    console.error("Registration failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Log in a user (Firebase)
 */
async function loginUser(email, password) {
  try {
    const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
    const user = userCredential.user;

    // ✅ Get Firebase token
    const token = await user.getIdToken();

    // ✅ Save user data
    localStorage.setItem("user", JSON.stringify({ 
      uid: user.uid, 
      email: user.email, 
      username: user.displayName || "Unknown", 
      token 
    }));

    window.location.href = "index.html"; // Redirect after login
    return { success: true, message: "Login successful" };
  } catch (error) {
    console.error("Login failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Log out the current user
 */
function logoutUser() {
  firebase.auth().signOut().then(() => {
    localStorage.removeItem("user");
    window.location.href = "login.html"; // Redirect after logout
  });
}

/**
 * Check if a user is authenticated
 */
function isAuthenticated() {
  const user = localStorage.getItem("user");
  return user !== null && JSON.parse(user).token;
}

/**
 * Get current user data
 */
function getCurrentUser() {
  const userStr = localStorage.getItem("user");
  return userStr ? JSON.parse(userStr) : null;
}

export { registerUser, loginUser, logoutUser, isAuthenticated, getCurrentUser };
