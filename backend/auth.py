import firebase_admin
from firebase_admin import credentials, auth
import os
import json

# 🔥 Load Firebase credentials from environment variables
firebase_config = os.getenv("FIREBASE_CONFIG")

if firebase_config:
    try:
        cred_dict = json.loads(firebase_config)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        print("🔥 Firebase Authentication Initialized!")
    except Exception as e:
        print(f"❌ Firebase Initialization Failed: {e}")
else:
    print("❌ FIREBASE_CONFIG environment variable is missing!")

def verify_token(token: str):
    """Verify Firebase authentication token."""
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token["email"]  # Return user's email
    except Exception:
        return None  # Invalid token

