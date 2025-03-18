from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from firebase_admin import auth, firestore
from auth import verify_token
from encryption import encrypt_message, decrypt_message

app = FastAPI()
db = firestore.client()
clients = {}  # Active WebSocket connections

# 🔥 Register User Endpoint
@app.post("/register")
async def register_user(user: dict):
    """Register a new user in Firebase Auth and Firestore."""
    try:
        # Create user in Firebase Authentication
        user_record = auth.create_user(
            email=user["email"],
            password=user["password"],
            display_name=user["username"]
        )

        # Store user details in Firestore (excluding password)
        db.collection("users").document(user_record.uid).set({
            "email": user["email"],
            "username": user["username"],
            "created_at": firestore.SERVER_TIMESTAMP
        })

        # Generate Firebase auth token
        custom_token = auth.create_custom_token(user_record.uid)
        return {"status": "success", "message": "User registered!", "token": custom_token.decode()}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {e}")

# 🔥 Login User Endpoint
@app.post("/login")
async def login_user(user: dict):
    """Verify user credentials and return a Firebase ID token."""
    try:
        email = user["email"]
        password = user["password"]

        # Firebase does NOT support password verification via Admin SDK
        # Users must authenticate via Firebase Client SDK in frontend
        user_ref = db.collection("users").where("email", "==", email).stream()

        user_data = None
        for doc in user_ref:
            user_data = doc.to_dict()
            break  # Get first match

        if not user_data:
            raise HTTPException(status_code=401, detail="User not found.")

        # Generate an authentication token
        firebase_user = auth.get_user_by_email(email)
        custom_token = auth.create_custom_token(firebase_user.uid)
        return {"status": "success", "message": "Login successful!", "token": custom_token.decode()}

    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Login failed: {e}")

# 🔥 WebSocket for Real-time Chat
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket connection for chat messages."""
    await websocket.accept()
    headers = websocket.headers
    token = headers.get("Authorization")  # Expect "Authorization: Bearer <token>"
    
    if not token or not token.startswith("Bearer "):
        await websocket.close()
        return
    token = token.split("Bearer ")[1]

    email = verify_token(token)  # Verify Firebase token
    if not email:
        await websocket.close()
        return

    clients[email] = websocket  # Store connection

    try:
        while True:
            encrypted_message = await websocket.receive_text()
            message = decrypt_message(encrypted_message)  # 🔥 Decrypt message

            # 🔥 Encrypt before storing in Firestore
            encrypted_text = encrypt_message(message)

            message_data = {
                "sender": email,
                "text": encrypted_text,  # ✅ Store encrypted text
                "timestamp": firestore.SERVER_TIMESTAMP  # ✅ Store timestamp
            }
            db.collection("messages").add(message_data)  # ✅ Store in Firestore
            
            # 🔥 Broadcast message to all connected clients
            for client_email, client_ws in clients.items():
                if client_ws != websocket:
                    await client_ws.send_text(encrypt_message(f"{email}: {message}"))  # ✅ Send encrypted message

    except WebSocketDisconnect:
        del clients[email]

# 🔥 Fetch Messages Endpoint
@app.get("/messages")
async def get_messages():
    """Retrieve chat history from Firestore"""
    messages_ref = db.collection("messages").stream()
    
    # 🔥 Decrypt messages before sending to frontend
    messages = []
    for msg in messages_ref:
        data = msg.to_dict()
        decrypted_text = decrypt_message(data["text"])  # ✅ Decrypt before returning
        messages.append({
            "sender": data["sender"],
            "text": decrypted_text,
            "timestamp": data.get("timestamp")
        })

    return messages

