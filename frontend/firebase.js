// Import Firebase libraries
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";
import { getFirestore, collection, getDocs, setDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

// ✅ Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBuGGwsMdxtxDjPBJ8YcqVIX3OixffyO8E",
  authDomain: "chat-room-6db06.firebaseapp.com",
  projectId: "chat-room-6db06",
  storageBucket: "chat-room-6db06.firebasestorage.app",
  messagingSenderId: "441142419097",
  appId: "1:441142419097:web:beb9d622a6c11272496208"
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/**
 * 🔹 Sign up a new user
 */
async function registerUser(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    const username = email.split('@')[0]; // Generate a simple username

    // ✅ Store user in Firestore
    await setDoc(doc(db, "users", user.uid), {
      username,
      email: user.email,
      created_at: new Date().toISOString()
    });

    // ✅ Get Firebase Auth Token
    const token = await user.getIdToken();

    // ✅ Send user details to backend
    const response = await fetch("https://chat-project-2.onrender.com/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ email: user.email, username })
    });

    const data = await response.json();
    if (data.status === "success") {
      localStorage.setItem("user", JSON.stringify({ email: user.email, username, token }));
      window.location.href = "index.html"; // ✅ Redirect to chat
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

/**
 * 🔹 Log in a user
 */
async function loginUser(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    const token = await user.getIdToken();

    // ✅ Fetch user data from Firestore
    const usersSnapshot = await getDocs(collection(db, "users"));
    let username = "";
    usersSnapshot.forEach((doc) => {
      if (doc.data().email === email) {
        username = doc.data().username;
      }
    });

    // ✅ Send token to backend for login
    const response = await fetch("https://chat-project-2.onrender.com/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ email: user.email })
    });

    const data = await response.json();
    if (data.status === "success") {
      localStorage.setItem("user", JSON.stringify({ email: user.email, username, token }));
      window.location.href = "index.html"; // ✅ Redirect to chat
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

/**
 * 🔹 Log out user
 */
async function logoutUser() {
  try {
    await signOut(auth);
    localStorage.removeItem("user");
    window.location.href = "login.html"; // ✅ Redirect to login page
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

/**
 * 🔹 Check if user is authenticated
 */
function isAuthenticated() {
  return localStorage.getItem("user") !== null;
}

/**
 * 🔹 Fetch all users (Contacts)
 */
async function fetchContacts() {
  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    const contacts = [];
    querySnapshot.forEach((doc) => {
      contacts.push(doc.data());
    });
    return contacts;
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return [];
  }
}

// ✅ Expose functions globally
window.registerUser = registerUser;
window.loginUser = loginUser;
window.logoutUser = logoutUser;
window.isAuthenticated = isAuthenticated;
window.fetchContacts = fetchContacts;

