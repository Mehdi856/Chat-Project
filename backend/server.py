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
    allow_origins=["https://frontend-7snrdsph8-fares-projects-d76a0c1b.vercel.app"],
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


import json
from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handles real-time chat via WebSockets."""
    await websocket.accept()

    try:
        # 🔹 Wait for authentication message
        auth_message = await websocket.receive_text()
        print(f"🔹 Received authentication message: {auth_message}")

        try:
            auth_data = json.loads(auth_message)
            token = auth_data.get("token")
        except json.JSONDecodeError:
            await websocket.send_json({"error": "Invalid JSON format"})
            await websocket.close(code=4001)  # Unauthorized
            print("❌ Invalid JSON format in authentication message")
            return

        if not token:
            await websocket.send_json({"error": "Missing authentication token"})
            await websocket.close(code=4001)  # Unauthorized
            print("❌ Authentication token missing")
            return

        # 🔹 Verify token
        sender_uid = verify_token(token)
        if not sender_uid:
            await websocket.send_json({"error": "Invalid authentication token"})
            await websocket.close(code=4001)  # Unauthorized
            print("❌ Invalid token, could not verify user")
            return

        # ✅ User authenticated
        print(f"✅ User {sender_uid} authenticated")
        await websocket_manager.connect(websocket, sender_uid)

        while True:
            try:
                # 🔹 Receive & parse message
                data = await websocket.receive_json()
                message_type =  "private" # data.get("type", "private")
                plaintext_message = data.get("text") #changed "message to text will need to be changed later"

                if not plaintext_message:
                    print("⚠️ Received empty message, ignoring...")
                    continue

                if message_type == "private":
                    receiver_uid = data.get("receiver")
                    if not receiver_uid:
                        print("⚠️ No receiver provided for private message")
                        continue

                    encrypted_message = encrypt_message(plaintext_message)

                    # ✅ Store message in Firestore
                    db.collection("messages").add({
                        "sender": sender_uid,
                        "receiver": receiver_uid,
                        "message": encrypted_message,
                        "timestamp": firestore.SERVER_TIMESTAMP
                    })

                    # ✅ Forward to receiver if online
                    await websocket_manager.send_message(receiver_uid, plaintext_message,sender_uid)

                elif message_type == "group":
                    group_id = data.get("group_id")
                    if not group_id:
                        print("⚠️ No group ID provided for group message")
                        continue

                    encrypted_message = encrypt_message(plaintext_message)

                    # ✅ Store group message in Firestore
                    db.collection("group_messages").add({
                        "group_id": group_id,
                        "sender": sender_uid,
                        "message": encrypted_message,
                        "timestamp": firestore.SERVER_TIMESTAMP
                    })

                    # ✅ Forward message to group members
                    group_ref = db.collection("groups").document(group_id).get()
                    if group_ref.exists:
                        group_data = group_ref.to_dict()
                        members = group_data.get("members", [])

                        for member in members:
                            if member != sender_uid:
                                await websocket_manager.send_message(member, encrypted_message)

            except json.JSONDecodeError:
                print("❌ Received invalid JSON message")
                continue
            except Exception as e:
                print(f"🔥 Unexpected WebSocket error: {e}")
                break

    except WebSocketDisconnect:
        print(f"🔴 User {sender_uid} disconnected")
        await websocket_manager.disconnect(sender_uid)
    except Exception as e:
        print(f"🔥 Critical WebSocket Error: {e}")
        await websocket.close(code=1011)  # Internal server error




@app.get("/contacts/{uid}")
async def get_contacts(uid: str):
    """Retrieves the contact list of a user, including names and UIDs."""
    user_ref = db.collection("users").document(uid).get()
    
    if not user_ref.exists:
        raise HTTPException(status_code=404, detail="User not found")

    user_data = user_ref.to_dict()
    contact_uids = user_data.get("contacts", [])

    # ✅ Fetch full user details for each contact
    contacts = []
    for contact_uid in contact_uids:
        contact_ref = db.collection("users").document(contact_uid).get()
        if contact_ref.exists:
            contact_data = contact_ref.to_dict()
            contacts.append({
                "uid": contact_uid,
                "username": contact_data.get("name", "Unknown")
            })

    return {"contacts": contacts}  # ✅ Now returning full objects


# 🔥 Add Contact
@app.post("/contacts/{uid}")
async def add_contact(uid: str, contact_data: dict):
    """Adds a contact to the user's contact list."""
    contact_uid = contact_data.get("contact_uid")
    
    if not contact_uid:
        raise HTTPException(status_code=400, detail="Missing contact UID")

    user_ref = db.collection("users").document(uid)
    user_doc = user_ref.get()

    if not user_doc.exists:
        raise HTTPException(status_code=404, detail="User not found")

    user_data = user_doc.to_dict()
    contacts = user_data.get("contacts", [])

    if contact_uid in contacts:
        raise HTTPException(status_code=400, detail="Contact already added")

    contacts.append(contact_uid)
    user_ref.update({"contacts": contacts})

    return {"message": "Contact added successfully"}


# 🔥 Remove Contact
@app.delete("/contacts/{uid}")
async def remove_contact(uid: str, contact_data: dict):
    """Removes a contact from the user's contact list."""
    contact_uid = contact_data.get("contact_uid")

    if not contact_uid:
        raise HTTPException(status_code=400, detail="Missing contact UID")

    user_ref = db.collection("users").document(uid)
    user_doc = user_ref.get()

    if not user_doc.exists:
        raise HTTPException(status_code=404, detail="User not found")

    user_data = user_doc.to_dict()
    contacts = user_data.get("contacts", [])

    if contact_uid not in contacts:
        raise HTTPException(status_code=400, detail="Contact not found")

    contacts.remove(contact_uid)
    user_ref.update({"contacts": contacts})

    return {"message": "Contact removed successfully"}

# 🔥 Fetch Messages (REST API)
# Modified endpoint
@app.get("/messages/{user_id}/{contact_id}")
async def get_messages(user_id: str, contact_id: str):
    """Retrieves chat history between two users."""
    messages = []
    
    # Get messages where user_id sent to contact_id
    sent_messages = db.collection("messages").where("sender", "==", user_id).where("receiver", "==", contact_id).stream()
    
    # Get messages where contact_id sent to user_id
    received_messages = db.collection("messages").where("sender", "==", contact_id).where("receiver", "==", user_id).stream()
    
    # Process sent messages
    for msg in sent_messages:
        data = msg.to_dict()
        messages.append({
            "sender": data["sender"],
            "receiver": data["receiver"],
            "text": decrypt_message(data["message"]),
            "timestamp": data["timestamp"]
        })
    
    # Process received messages
    for msg in received_messages:
        data = msg.to_dict()
        messages.append({
            "sender": data["sender"],
            "receiver": data["receiver"],
            "text": decrypt_message(data["message"]),
            "timestamp": data["timestamp"]
        })
    
    # Sort messages by timestamp
    messages.sort(key=lambda x: x["timestamp"], reverse=True)
    return messages

