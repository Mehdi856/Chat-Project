import firebase_admin
from firebase_admin import credentials, firestore
import os
import json
import bcrypt

# 🔥 Load Firebase credentials from environment variable
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

db = firestore.client()

# ✅ Function to create a user
def create_user(email, username, password):
    user_ref = db.collection("users").document(email)
    
    if user_ref.get().exists:
        return {"status": "error", "message": "User already exists"}

    hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    
    user_ref.set({
        "email": email,
        "username": username,
        "password": hashed_password
    })
    return {"status": "success", "message": "User created successfully!"}

# ✅ Function to log in a user
def login_user(email, password):
    user_ref = db.collection("users").document(email).get()

    if user_ref.exists:
        user_data = user_ref.to_dict()
        stored_password = user_data["password"].encode()

        if bcrypt.checkpw(password.encode(), stored_password):
            return {"status": "success", "message": "Login successful"}
        else:
            return {"status": "error", "message": "Incorrect password"}
    else:
        return {"status": "error", "message": "User not found"}

 
