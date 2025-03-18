import firebase_admin
from firebase_admin import credentials, auth, firestore
import os
import json
import bcrypt

# ✅ Load Firebase credentials from environment variable
firebase_config = os.getenv("FIREBASE_CONFIG")
# ✅ Check if environment variables exist
print(f"🔥 FIREBASE_CONFIG exists: {bool(os.getenv('FIREBASE_CONFIG'))}")
print(f"🔥 SECRET_KEY exists: {bool(os.getenv('SECRET_KEY'))}")
if firebase_config:
    try:
        cred_dict = json.loads(firebase_config)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        print("🔥 Firebase Auth Initialized!")
    except Exception as e:
        print(f"❌ Firebase Initialization Failed: {e}")
else:
    print("❌ FIREBASE_CONFIG environment variable is missing!")

# ✅ Firestore Connection
db = firestore.client()

def verify_token(token: str):
    """Verify Firebase authentication token."""
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token["email"]
    except Exception:
        return None  # Invalid token

# ✅ Function to create a user (hashed password)
def create_user(email, username, password):
    user_ref = db.collection("users").document(email)
    
    if user_ref.get().exists:
        return {"status": "error", "message": "User already exists"}

    hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    
    user_ref.set({
        "email": email,
        "username": username,
        "password": hashed_password,
        "created_at": firestore.SERVER_TIMESTAMP
    })
    return {"status": "success", "message": "User created successfully!"}

# ✅ Function to log in a user
def login_user(email, password):
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
