from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import auth, firestore
from auth import verify_token
from encryption import encrypt_message, decrypt_message
from websocket_manager import WebSocketManager
import os

app = FastAPI()

# ✅ CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ Initialize Firestore
db = firestore.client()

# ✅ WebSocket Manager
websocket_manager = WebSocketManager()

# ✅ Debugging: Check environment variables
print(f"🔥 FIREBASE_CONFIG exists: {bool(os.getenv('FIREBASE_CONFIG'))}")
print(f"🔥 SECRET_KEY exists: {bool(os.getenv('SECRET_KEY'))}")

# ✅ Helper Function: Get User by Email
def get_user_by_email(email: str):
    """Fetch user document by email."""
    user_ref = db.collection("users").where("email", "==", email).stream()
    return next((doc.to_dict() for doc in user_ref), None)

# 🔥 Register User (REST API)
@app.post("/register")
async def register_user(user: dict):
    """Registers a new user in Firebase Auth & Firestore."""
    try:
        user_record = auth.create_user(
            email=user["email"],
            password=user["password"],
            display_name=user["username"]
        )
        db.collection("users").document(user_record.uid).set({
            "email": user["email"],
            "username": user["username"],
            "created_at": firestore.SERVER_TIMESTAMP
        })
        custom_token = auth.create_custom_token(user_record.uid).decode()
        return {"status": "success", "message": "User registered!", "token": custom_token}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

# 🔥 Login User (REST API)
@app.post("/login")
async def login_user(user: dict):
    """Verifies credentials & returns a Firebase token."""
    email = user.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")

    user_data = get_user_by_email(email)
    if not user_data:
        raise HTTPException(status_code=401, detail="User not found.")

    try:
        firebase_user = auth.get_user_by_email(email)
        custom_token = auth.create_custom_token(firebase_user.uid).decode()
        return {"status": "success", "message": "Login successful!", "token": custom_token}
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Login failed: {str(e)}")

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
            message_type = "private" #data.get("type")  # 'private' or 'group'
            plaintext_message = data.get("message")

            if message_type == "private":
                receiver_uid = data.get("receiver")
                if not receiver_uid or not plaintext_message:
                    continue  # Ignore invalid messages

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