import firebase_admin
from firebase_admin import credentials, auth, firestore
import os
import json

# ✅ Load Firebase credentials from environment variable
firebase_config = os.getenv("FIREBASE_CONFIG")

if not firebase_config:
    raise RuntimeError("❌ FIREBASE_CONFIG environment variable is missing!")

try:
    cred_dict = json.loads(firebase_config)
    cred = credentials.Certificate(cred_dict)
    firebase_admin.initialize_app(cred)
    print("🔥 Firebase Auth Initialized!")
except Exception as e:
    raise RuntimeError(f"❌ Firebase Initialization Failed: {e}")

# ✅ Firestore Connection
db = firestore.client()

def verify_token(token: str):
    """Verify Firebase authentication token and return user UID."""
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token["uid"]  # 🔥 Return UID instead of email
    except Exception:
        return None  # Invalid token

def create_user(email, username, password):
    """Register a new user using Firebase Authentication."""
    try:
        user_record = auth.create_user(
            email=email,
            password=password,
            display_name=username
        )
        db.collection("users").document(user_record.uid).set({
            "email": email,
            "username": username,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        return {"status": "success", "message": "User created successfully!", "uid": user_record.uid}
    except Exception as e:
        return {"status": "error", "message": f"User creation failed: {e}"}

def login_user(email, password):
    """Login is handled by Firebase, but we fetch user info."""
    try:
        user_record = auth.get_user_by_email(email)
        user_data = db.collection("users").document(user_record.uid).get()

        if not user_data.exists:
            return {"status": "error", "message": "User not found in Firestore."}

        return {"status": "success", "message": "Login successful!", "uid": user_record.uid, "username": user_data.to_dict()["username"]}
    except Exception as e:
        return {"status": "error", "message": f"Login failed: {e}"}
