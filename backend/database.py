import firebase_admin
from firebase_admin import credentials, firestore
import os
import json
import bcrypt

print(f"🔥 FIREBASE_CONFIG exists: {bool(os.getenv('FIREBASE_CONFIG'))}")
print(f"🔥 SECRET_KEY exists: {bool(os.getenv('SECRET_KEY'))}")

# ✅ Load Firebase credentials from environment variable
firebase_config = os.getenv("FIREBASE_CONFIG")

if firebase_config:
    try:
        cred_dict = json.loads(firebase_config)  # Convert string to dictionary
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        print("🔥 Firebase is Connected!")  # ✅ Print success message
    except Exception as e:
        print(f"❌ Firebase Initialization Failed: {e}")  # ❌ Print error message
else:
    print("❌ FIREBASE_CONFIG environment variable is missing!")

# ✅ Connect to Firestore
db = firestore.client()

# ✅ Function to create a user (with password hashing)
# ✅ Function to create a user (with ordered fields)
def create_user(username, password, email):
    try:
        # Reference the document by the user's email
        user_ref = db.collection("users").document(email)

        # Check if the user already exists
        if user_ref.get().exists:
            return {"status": "error", "message": "User already exists"}

        # Hash the password
        hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

        # Use an ordered dictionary to ensure field order
        user_data = {
            "username": username,
            "password": hashed_password,  # Store hashed password
            "email": email,
            "created_at": firestore.SERVER_TIMESTAMP  # Track user creation time
        }

        # Save user data to Firestore
        user_ref.set(user_data)

        return {"status": "success", "message": "User created successfully!"}

    except Exception as e:
        return {"status": "error", "message": f"Failed to create user: {e}"}


# ✅ Function to log in a user
def login_user(email, password):
    try:
        user_ref = db.collection("users").document(email).get()

        if user_ref.exists:
            user_data = user_ref.to_dict()
            stored_password = user_data["password"].encode()

            if bcrypt.checkpw(password.encode(), stored_password):
                return {"status": "success", "message": "Login successful", "username": user_data["username"]}
            else:
                return {"status": "error", "message": "Incorrect password"}
        else:
            return {"status": "error", "message": "User not found"}
    
    except Exception as e:
        return {"status": "error", "message": f"Login failed: {e}"}

# ✅ Function to save messages
def save_message(sender_email, receiver_email, message):
    try:
        messages_ref = db.collection("messages").document()
        messages_ref.set({
            "sender": sender_email,
            "receiver": receiver_email,
            "message": message,
            "timestamp": firestore.SERVER_TIMESTAMP  # Store time automatically
        })
        return {"status": "success", "message": "Message saved!"}
    
    except Exception as e:
        return {"status": "error", "message": f"Message saving failed: {e}"}
