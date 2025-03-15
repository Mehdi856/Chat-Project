import firebase_admin
from firebase_admin import credentials, firestore
import bcrypt

cred = credentials.Certificate("backend/config/firebase-key.json")  # Add your Firebase key here
firebase_admin.initialize_app(cred)

db = firestore.client()

def create_user(email, username, password):
    user_ref = db.collection("users").document(email)
    hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    user_ref.set({
        "email": email,
        "username": username,
        "password": hashed_password
    })
    return {"message": "User created successfully!"}

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
 
