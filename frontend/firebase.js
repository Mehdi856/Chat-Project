// Import Firebase libraries
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";
import { 
  getFirestore, collection, getDocs, addDoc, setDoc, doc, query, where, orderBy, getDoc, onSnapshot, updateDoc
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
/**
 * Save message to Firestore
 */
async function saveMessage(sender, receiver, message) {
  try {
    await addDoc(collection(db, "messages"), {
      sender: sender,
      receiver: receiver,
      message: message,
      timestamp: new Date().toISOString(),
      seen: false // Add seen status
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

/**
 * Update message seen status
 * @param {string} currentUserId - Current user's ID
 * @param {string} chatUserId - Chat user's ID
 */
export async function updateMessageSeen(currentUserId, chatUserId) {
  try {
    // Get messages between these two users
    const messagesRef = collection(db, "messages");
    const q = query(
      messagesRef,
      where("sender", "==", chatUserId),
      where("receiver", "==", currentUserId),
      where("seen", "==", false)
    );
    
    const querySnapshot = await getDocs(q);
    
    // Update each message to seen status
    for (const docSnapshot of querySnapshot.docs) {
      await updateDoc(doc(db, "messages", docSnapshot.id), { 
        seen: true 
      });
    }
  } catch (error) {
    console.error("Error updating message seen status:", error);
  }
}

/**
 * Update typing status
 * @param {string} currentUserId - Current user's ID
 * @param {string} chatUserId - Chat user's ID
 * @param {Object} typingData - Typing status data
 */
export async function updateTypingStatus(currentUserId, chatUserId, typingData) {
  try {
    // Get the chat ID
    const chatId = getChatId(currentUserId, chatUserId);
    
    // Create typing collection if it doesn't exist
    await setDoc(doc(db, "typing", chatId), {
      [currentUserId]: typingData
    }, { merge: true });
    
  } catch (error) {
    console.error("Error updating typing status:", error);
  }
}

/**
 * Listen for typing status changes
 * @param {string} userId - User ID to listen for typing status
 * @param {Function} callback - Callback function when typing status changes
 */
export function listenForTypingStatus(userId, callback) {
  try {
    // Get current user
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    // Get the chat ID
    const chatId = getChatId(currentUser.uid, userId);
    
    // Listen for changes
    return onSnapshot(doc(db, "typing", chatId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        
        // Check if the other user is typing
        if (data && data[userId]) {
          const typingData = data[userId];
          
          // Check if typing status is recent (within last 3 seconds)
          const isRecent = (new Date().getTime() - typingData.timestamp) < 3000;
          
          // Call callback with typing status
          callback(typingData.isTyping && isRecent);
        } else {
          callback(false);
        }
      } else {
        callback(false);
      }
    });
  } catch (error) {
    console.error("Error listening for typing status:", error);
    callback(false);
    return () => {}; // Return empty unsubscribe function
  }
}

/**
 * Helper function to get chat ID from two user IDs
 * @param {string} uid1 - First user ID
 * @param {string} uid2 - Second user ID
 * @returns {string} Chat ID
 */
function getChatId(uid1, uid2) {
  // Sort IDs to ensure consistent chat ID regardless of order
  return [uid1, uid2].sort().join('_');
}

// Export functions
export { 
  auth, db, 
  registerUser, loginUser, logoutUser, 
  isAuthenticated, getCurrentUser, 
  fetchContacts, saveMessage, listenForMessages 
};
