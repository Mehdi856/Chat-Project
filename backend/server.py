from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import auth, firestore
from auth import verify_token
from encryption import encrypt_message, decrypt_message
from websocket_manager import WebSocketManager
import os

app = FastAPI()

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (update for production)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Firestore
db = firestore.client()

# Initialize WebSocket Manager
websocket_manager = WebSocketManager()

# Debugging: Check environment variables
print(f"🔥 FIREBASE_CONFIG exists: {bool(os.getenv('FIREBASE_CONFIG'))}")
print(f"🔥 SECRET_KEY exists: {bool(os.getenv('SECRET_KEY'))}")

# 🔥 Register User Endpoint (REST API)
@app.post("/register")
async def register_user(user: dict):
    """Register a new user in Firebase Auth and Firestore."""
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
        custom_token = auth.create_custom_token(user_record.uid)
        return {"status": "success", "message": "User registered!", "token": custom_token.decode()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {e}")

# 🔥 Login User Endpoint (REST API)
@app.post("/login")
async def login_user(user: dict):
    """Verify user credentials and return a Firebase ID token."""
    try:
        email = user["email"]
        user_ref = db.collection("users").where("email", "==", email).stream()
        user_data = next((doc.to_dict() for doc in user_ref), None)

        if not user_data:
            raise HTTPException(status_code=401, detail="User not found.")

        firebase_user = auth.get_user_by_email(email)
        custom_token = auth.create_custom_token(firebase_user.uid)
        return {"status": "success", "message": "Login successful!", "token": custom_token.decode()}
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Login failed: {e}")

# 🔥 WebSocket for Real-time Chat
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket connection for real-time chat."""
    await websocket.accept()
    token = websocket.headers.get("Authorization")  # Expect "Authorization: Bearer <token>"

    if not token or not token.startswith("Bearer "):
        await websocket.close()
        return
    token = token.split("Bearer ")[1]

    sender_uid = verify_token(token)  # Verify Firebase token
    if not sender_uid:
        await websocket.close()
        return

    await websocket_manager.connect(websocket, sender_uid)

    try:
        while True:
            data = await websocket.receive_json()
            receiver_uid = data.get("receiver")
            plaintext_message = data.get("message")

            if not receiver_uid or not plaintext_message:
                continue  # Skip invalid messages

            encrypted_message = encrypt_message(plaintext_message)

            message_data = {
                "sender": sender_uid,
                "receiver": receiver_uid,
                "message": encrypted_message,
                "timestamp": firestore.SERVER_TIMESTAMP
            }
            db.collection("messages").add(message_data)  # ✅ Store in Firestore
            
            # Send message to recipient if online
            await websocket_manager.send_message(receiver_uid, encrypted_message)

    except WebSocketDisconnect:
        await websocket_manager.disconnect(sender_uid)

# 🔥 Fetch Messages Endpoint
@app.get("/messages/{user_id}")
async def get_messages(user_id: str):
    """Retrieve chat history for a user (both sent & received)."""
    messages_ref = db.collection("messages").where(
        "receiver", "==", user_id
    ).stream()  # Fetch messages received by user

    sent_messages_ref = db.collection("messages").where(
        "sender", "==", user_id
    ).stream()  # Fetch messages sent by user

    messages = []
    for msg in messages_ref:
        data = msg.to_dict()
        decrypted_text = decrypt_message(data["message"])
        messages.append({
            "sender": data["sender"],
            "receiver": data["receiver"],
            "text": decrypted_text,
            "timestamp": data["timestamp"]
        })

    for msg in sent_messages_ref:
        data = msg.to_dict()
        decrypted_text = decrypt_message(data["message"])
        messages.append({
            "sender": data["sender"],
            "receiver": data["receiver"],
            "text": decrypted_text,
            "timestamp": data["timestamp"]
        })

    # Sort messages by timestamp (newest first)
    messages.sort(key=lambda x: x["timestamp"], reverse=True)

    return messages
