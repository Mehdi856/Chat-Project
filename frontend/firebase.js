// Import Firebase libraries
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";
import { 
  getFirestore, collection, getDocs, addDoc, setDoc, doc, query, where, orderBy, getDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

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
const db = getFirestore(app);

/**
 * Sign up a new user
 */
async function registerUser(email, password, name) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    const username = name || email.split('@')[0];

    await setDoc(doc(db, "users", user.uid), {
      username: username,
      email: user.email,
      created_at: new Date().toISOString()
    });

    const token = await user.getIdToken();
    localStorage.setItem("user", JSON.stringify({ 
      email: user.email, 
      username: username, 
      token: token,
      uid: user.uid 
    }));

    window.location.href = "index.html";
    return true;
  } catch (error) {
    console.error("Registration error:", error);
    return { error: error.message };
  }
}

/**
 * Log in a user
 */
async function loginUser(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    const token = await user.getIdToken();
    
    const userDocRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userDocRef);
    const userData = userDoc.data();
    const username = userData?.username || email.split('@')[0];
    
    localStorage.setItem("user", JSON.stringify({ 
      email: user.email, 
      username: username, 
      token: token,
      uid: user.uid 
    }));

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
async function logoutUser() {
  try {
    await signOut(auth);
    localStorage.removeItem("user");
    window.location.href = "login.html";
    return true;
  } catch (error) {
    console.error("Logout error:", error);
    return { error: error.message };
  }
}

/**
 * Check if a user is authenticated
 */
function isAuthenticated() {
  return localStorage.getItem("user") !== null;
}

/**
 * Get current user data
 */
function getCurrentUser() {
  const userStr = localStorage.getItem("user");
  return userStr ? JSON.parse(userStr) : null;
}

/**
 * Fetch all users (for contacts list)
 */
async function fetchContacts() {
  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    const contacts = [];
    querySnapshot.forEach((doc) => {
      contacts.push({
        uid: doc.id,
        ...doc.data()
      });
    });
    return contacts;
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return [];
  }
}

/**
 * Save message to Firestore
 */
async function saveMessage(sender, receiver, message) {
  try {
    await addDoc(collection(db, "messages"), {
      sender: sender,
      receiver: receiver,
      message: message,
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error("Error saving message:", error);
    return false;
  }
}

/**
 * Listen for real-time messages
 */
function listenForMessages(user1, user2, callback) {
  const messagesRef = collection(db, "messages");
  const q = query(
    messagesRef,
    where("sender", "in", [user1, user2]),
    where("receiver", "in", [user1, user2]),
    orderBy("timestamp", "asc")
  );

  return onSnapshot(q, (snapshot) => {
    const messages = [];
    snapshot.forEach((doc) => {
      messages.push({ id: doc.id, ...doc.data() });
    });
    callback(messages); // Update UI
  });
}

// Export functions
export { 
  auth, db, 
  registerUser, loginUser, logoutUser, 
  isAuthenticated, getCurrentUser, 
  fetchContacts, saveMessage, listenForMessages 
};
