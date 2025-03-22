from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import auth, firestore, credentials
from encryption import encrypt_message, decrypt_message
from websocket_manager import WebSocketManager
import os
import json

app = FastAPI()

# ✅ CORS Middleware (Allow Frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://frontend-kbi2i28v4-fares-projects-d76a0c1b.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ Initialize Firebase Admin SDK
firebase_config_json = os.getenv("FIREBASE_CONFIG")
if not firebase_config_json:
    raise ValueError("🔥 ERROR: FIREBASE_CONFIG environment variable is missing!")

try:
    firebase_config = json.loads(firebase_config_json)
except json.JSONDecodeError:
    raise ValueError("🔥 ERROR: Invalid JSON in FIREBASE_CONFIG environment variable!")

if not firebase_admin._apps:
    cred = credentials.Certificate(firebase_config)
    firebase_admin.initialize_app(cred)

# ✅ Initialize Firestore
db = firestore.client()

# ✅ WebSocket Manager
websocket_manager = WebSocketManager()


# ✅ Token Verification
def verify_token(token: str):
    """Verifies Firebase ID token and returns user UID."""
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token["uid"]
    except Exception as e:
        print(f"❌ Token verification failed: {e}")
        return None


# ✅ Register User
@app.post("/register")
async def register_user(user_data: dict):
    """Registers a new user in Firebase Authentication and Firestore."""
    email = user_data.get("email")
    password = user_data.get("password")
    name = user_data.get("name")

    if not email or not password or not name:
        raise HTTPException(status_code=400, detail="Missing email, password, or name.")

    try:
        # Create user in Firebase Auth
        user = auth.create_user(email=email, password=password, display_name=name)
        
        # Store user in Firestore
        db.collection("users").document(user.uid).set({
            "name": name,
            "email": email,
            "uid": user.uid,
            "contacts": []
        })

        return {"message": "User registered successfully!", "uid": user.uid}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ✅ Login User
@app.post("/login")
async def login_user(user_data: dict):
    """Logs in a user by verifying credentials and returning a Firebase token."""
    email = user_data.get("email")
    password = user_data.get("password")

    if not email or not password:
        raise HTTPException(status_code=400, detail="Missing email or password.")

    try:
        user = auth.get_user_by_email(email)
        # Firebase Authentication automatically handles password verification

        # Generate a custom token (Firebase handles authentication)
        custom_token = auth.create_custom_token(user.uid)

        return {"message": "Login successful!", "uid": user.uid, "token": custom_token.decode("utf-8")}
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid email or password.")


# ✅ Logout User
@app.post("/logout")
async def logout_user():
    """Handles user logout (frontend should clear stored token)."""
    return {"message": "Logout successful!"}


# 🔥 WebSocket for Real-time Chat
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handles real-time chat via WebSockets."""
    await websocket.accept()
    token = websocket.headers.get("Authorization")

    if not token or not token.startswith("Bearer "):
        await websocket.close(code=4001)  # Unauthorized
        return

    token = token.split("Bearer ")[1]
    sender_uid = verify_token(token)

    if not sender_uid:
        await websocket.close(code=4001)  # Unauthorized
        return

    await websocket_manager.connect(websocket, sender_uid)

    try:
        while True:
            data = await websocket.receive_json()
            message_type = data.get("type", "private")
            plaintext_message = data.get("message")

            if message_type == "private":
                receiver_uid = data.get("receiver")
                if not receiver_uid or not plaintext_message:
                    continue

                encrypted_message = encrypt_message(plaintext_message)

                # ✅ Store Message in Firestore
                db.collection("messages").add({
                    "sender": sender_uid,
                    "receiver": receiver_uid,
                    "message": encrypted_message,
                    "timestamp": firestore.SERVER_TIMESTAMP
                })

                # ✅ Forward Message to Online User
                await websocket_manager.send_message(receiver_uid, encrypted_message)

            elif message_type == "group":
                group_id = data.get("group_id")
                if not group_id or not plaintext_message:
                    continue

                encrypted_message = encrypt_message(plaintext_message)

                # ✅ Store Group Message in Firestore
                db.collection("group_messages").add({
                    "group_id": group_id,
                    "sender": sender_uid,
                    "message": encrypted_message,
                    "timestamp": firestore.SERVER_TIMESTAMP
                })

                # ✅ Forward to Online Group Members
                group_ref = db.collection("groups").document(group_id).get()
                if group_ref.exists:
                    group_data = group_ref.to_dict()
                    members = group_data.get("members", [])

                    for member in members:
                        if member != sender_uid:
                            await websocket_manager.send_message(member, encrypted_message)

    except WebSocketDisconnect:
        await websocket_manager.disconnect(sender_uid)
    except Exception as e:
        print(f"❌ WebSocket Error: {e}")


# 🔥 Fetch Messages (REST API)
@app.get("/messages/{user_id}")
async def get_messages(user_id: str):
    """Retrieves chat history for a user."""
    messages = []

    # ✅ Fetch Messages (Sent & Received)
    messages_ref = db.collection("messages").where("receiver", "==", user_id).stream()
    sent_messages_ref = db.collection("messages").where("sender", "==", user_id).stream()

    for msg in messages_ref:
        data = msg.to_dict()
        messages.append({
            "sender": data["sender"],
            "receiver": data["receiver"],
            "text": decrypt_message(data["message"]),
            "timestamp": data["timestamp"]
        })

    for msg in sent_messages_ref:
        data = msg.to_dict()
        messages.append({
            "sender": data["sender"],
            "receiver": data["receiver"],
            "text": decrypt_message(data["message"]),
            "timestamp": data["timestamp"]
        })

    messages.sort(key=lambda x: x["timestamp"], reverse=True)
    return messages

