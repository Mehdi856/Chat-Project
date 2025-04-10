from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import auth, firestore, credentials
from encryption import encrypt_message, decrypt_message
from websocket_manager import WebSocketManager
import os
import json
import uuid
from datetime import datetime
from typing import Optional, List

app = FastAPI()

# ✅ CORS Middleware (Allow Frontend and development origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development; restrict in production
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
            "contacts": [],
            "groups": []
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
        # Get user's name from Firestore
        user_doc = db.collection("users").document(user.uid).get()
        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="User data not found")
        
        user_data = user_doc.to_dict()
        name = user_data.get("name", "User")  #  if name not found it puts User left for testing

        # Generate a custom token (Firebase handles authentication)
        custom_token = auth.create_custom_token(user.uid)

        return {
            "message": "Login successful!",
            "uid": user.uid,
            "token": custom_token.decode("utf-8"),
            "name": name  # Add name to response
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid email or password.")

# ✅ Logout User
@app.post("/logout")
async def logout_user():
    """Handles user logout (frontend should clear stored token)."""
    return {"message": "Logout successful!"}


# ✅ WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handles real-time chat via WebSockets."""
    await websocket.accept()
    sender_uid = None

    try:
        # 🔹 Wait for authentication message
        auth_message = await websocket.receive_text()
        print(f"🔹 Received authentication message")

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
            # 🔹 Receive & parse message
            data = await websocket.receive_json()
            message_type = data.get("type", "message")

            if message_type == "message":
                receiver_uid = data.get("receiver")
                text = data.get("text")
                timestamp = data.get("timestamp")

                if not receiver_uid or not text:
                    continue

                # Encrypt message text
                encrypted_text = encrypt_message(text)

                # Store message in Firestore
                message_data = {
                    "sender": sender_uid,
                    "receiver": receiver_uid,
                    "message": encrypted_text,
                    "timestamp": firestore.SERVER_TIMESTAMP
                }
                db.collection("messages").add(message_data)

                # Send to receiver if online
                await websocket_manager.send_message(receiver_uid, text, sender_uid)

            elif message_type == "typing":
                receiver_uid = data.get("receiver")
                if receiver_uid:
                    # Forward typing indicator to receiver
                    await websocket_manager.send_typing_indicator(receiver_uid, sender_uid)

    except WebSocketDisconnect:
        print(f"🔴 User {sender_uid} disconnected")
        if sender_uid:
            await websocket_manager.disconnect(sender_uid)
    except Exception as e:
        print(f"🔥 WebSocket Error: {e}")
        if sender_uid:
            await websocket_manager.disconnect(sender_uid)
        await websocket.close(code=1011)


# ✅ Get Contacts
@app.get("/contacts/{uid}")
async def get_contacts(uid: str, request: Request):
    """Retrieves the contact list of a user, including names and UIDs."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

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

    return {"contacts": contacts}


# ✅ Add Contact (now with contact request)
@app.post("/contacts/{uid}")
async def add_contact(uid: str, contact_data: dict, request: Request):
    """Creates a contact request. The contact is added only after acceptance."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    contact_uid = contact_data.get("contact_uid")
    
    if not contact_uid:
        raise HTTPException(status_code=400, detail="Missing contact UID")

    # Check if users exist
    user_ref = db.collection("users").document(uid).get()
    contact_ref = db.collection("users").document(contact_uid).get()

    if not user_ref.exists or not contact_ref.exists:
        raise HTTPException(status_code=404, detail="User or contact not found")

    user_data = user_ref.to_dict()
    contacts = user_data.get("contacts", [])

    if contact_uid == uid:
        raise HTTPException(status_code=400, detail="Cannot add yourself as a contact")

    if contact_uid in contacts:
        raise HTTPException(status_code=400, detail="Contact already added")

    # Generate unique request ID
    request_id = str(uuid.uuid4())
    
    # Store request in Firestore
    db.collection("contact_requests").document(request_id).set({
        "request_id": request_id,
        "sender": uid,
        "sender_name": user_data.get("name", "Unknown"),
        "receiver": contact_uid,
        "status": "pending",
        "timestamp": firestore.SERVER_TIMESTAMP
    })

    # Notify the receiver via WebSocket if they're online
    await websocket_manager.send_notification(contact_uid, {
        "type": "notification",
        "notification_type": "contact_request",
        "sender": uid,
        "sender_name": user_data.get("name", "Unknown"),
        "request_id": request_id
    })

    return {"message": "Contact request sent successfully"}


# ✅ Remove Contact
@app.delete("/contacts/{uid}")
async def remove_contact(uid: str, contact_data: dict, request: Request):
    """Removes a contact from the user's contact list."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

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

    # Remove contact from user's contacts
    contacts.remove(contact_uid)
    user_ref.update({"contacts": contacts})

    # Also remove user from contact's contacts list (two-way removal)
    contact_ref = db.collection("users").document(contact_uid)
    contact_doc = contact_ref.get()
    
    if contact_doc.exists:
        contact_data = contact_doc.to_dict()
        contact_contacts = contact_data.get("contacts", [])
        
        if uid in contact_contacts:
            contact_contacts.remove(uid)
            contact_ref.update({"contacts": contact_contacts})

    return {"message": "Contact removed successfully"}


# ✅ Get Messages
@app.get("/messages/{user_id}/{contact_id}")
async def get_messages(user_id: str, contact_id: str, request: Request, limit: Optional[int] = None):
    """Retrieves chat history between two users."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    messages = []
    
    # Get messages where user_id sent to contact_id
    sent_query = db.collection("messages").where("sender", "==", user_id).where("receiver", "==", contact_id)
    
    # Get messages where contact_id sent to user_id
    received_query = db.collection("messages").where("sender", "==", contact_id).where("receiver", "==", user_id)
    
    if limit:
        sent_query = sent_query.limit(limit)
        received_query = received_query.limit(limit)
    
    # Process sent messages
    for msg in sent_query.stream():
        data = msg.to_dict()
        try:
            messages.append({
                "sender": data["sender"],
                "receiver": data["receiver"],
                "text": decrypt_message(data["message"]),
                "timestamp": data["timestamp"]
            })
        except Exception as e:
            print(f"Error decrypting message: {e}")
    
    # Process received messages
    for msg in received_query.stream():
        data = msg.to_dict()
        try:
            messages.append({
                "sender": data["sender"],
                "receiver": data["receiver"],
                "text": decrypt_message(data["message"]),
                "timestamp": data["timestamp"]
            })
        except Exception as e:
            print(f"Error decrypting message: {e}")
    
    # Sort messages by timestamp (newest first)
    messages.sort(key=lambda x: x["timestamp"] if x["timestamp"] else datetime.min, reverse=True)
    
    # Limit the total number of messages if requested
    if limit and len(messages) > limit:
        messages = messages[:limit]
        
    return messages


# ✅ Get Contact Requests
@app.get("/contact_requests/{uid}")
async def get_contact_requests(uid: str, request: Request):
    """Retrieves pending contact requests for a user."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Query requests where user is the receiver and status is pending
    requests_query = db.collection("contact_requests").where("receiver", "==", uid).where("status", "==", "pending")
    
    pending_requests = []
    for req in requests_query.stream():
        data = req.to_dict()
        pending_requests.append(data)
    
    return {"requests": pending_requests}


# ✅ Respond to Contact Request
@app.post("/contact_requests/{request_id}/respond")
async def respond_to_contact_request(request_id: str, response_data: dict, request: Request):
    """Accepts or declines a contact request."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    response = response_data.get("response")  # "accept" or "decline"
    
    if response not in ["accept", "decline"]:
        raise HTTPException(status_code=400, detail="Invalid response. Must be 'accept' or 'decline'")
    
    # Get the request from Firestore
    req_ref = db.collection("contact_requests").document(request_id)
    req_doc = req_ref.get()
    
    if not req_doc.exists:
        raise HTTPException(status_code=404, detail="Contact request not found")
    
    req_data = req_doc.to_dict()
    
    # Update request status
    req_ref.update({"status": response})
    
    # If accepted, add contacts to each other's list
    if response == "accept":
        sender_uid = req_data.get("sender")
        receiver_uid = req_data.get("receiver")
        
        # Add sender to receiver's contacts
        receiver_ref = db.collection("users").document(receiver_uid)
        receiver_doc = receiver_ref.get()
        if receiver_doc.exists:
            receiver_data = receiver_doc.to_dict()
            receiver_contacts = receiver_data.get("contacts", [])
            if sender_uid not in receiver_contacts:
                receiver_contacts.append(sender_uid)
                receiver_ref.update({"contacts": receiver_contacts})
        
        # Add receiver to sender's contacts
        sender_ref = db.collection("users").document(sender_uid)
        sender_doc = sender_ref.get()
        if sender_doc.exists:
            sender_data = sender_doc.to_dict()
            sender_contacts = sender_data.get("contacts", [])
            if receiver_uid not in sender_contacts:
                sender_contacts.append(receiver_uid)
                sender_ref.update({"contacts": sender_contacts})
        
        # Notify the sender that request was accepted
        await websocket_manager.send_notification(sender_uid, {
            "type": "notification",
            "notification_type": "contact_request_accepted",
            "receiver": receiver_uid,
        })
    
    return {"message": f"Contact request {response}ed successfully"}


# ✅ Create Group
@app.post("/groups")
async def create_group(group_data: dict, request: Request):
    """Creates a new group chat."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    group_name = group_data.get("name")
    members = group_data.get("members", [])
    
    if not group_name:
        raise HTTPException(status_code=400, detail="Group name is required")
    
    # Ensure creator is in members list
    if uid not in members:
        members.append(uid)
    
    # Create group in Firestore
    group_ref = db.collection("groups").add({
        "name": group_name,
        "creator": uid,
        "members": members,
        "created_at": firestore.SERVER_TIMESTAMP
    })
    
    group_id = group_ref[1].id
    
    # Add group ID to each member's groups list
    for member_uid in members:
        user_ref = db.collection("users").document(member_uid)
        user_doc = user_ref.get()
        
        if user_doc.exists:
            user_data = user_doc.to_dict()
            user_groups = user_data.get("groups", [])
            user_groups.append(group_id)
            user_ref.update({"groups": user_groups})
            
            # Notify members about new group (except creator)
            if member_uid != uid:
                await websocket_manager.send_notification(member_uid, {
                    "type": "notification",
                    "notification_type": "new_group",
                    "group_id": group_id,
                    "group_name": group_name,
                    "creator": uid
                })
    
    return {"message": "Group created successfully", "group_id": group_id}


# ✅ Get Groups
@app.get("/groups/{uid}")
async def get_groups(uid: str, request: Request):
    """Retrieves all groups a user belongs to."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    user_ref = db.collection("users").document(uid).get()
    
    if not user_ref.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_data = user_ref.to_dict()
    group_ids = user_data.get("groups", [])
    
    groups = []
    for group_id in group_ids:
        group_ref = db.collection("groups").document(group_id).get()
        if group_ref.exists:
            group_data = group_ref.to_dict()
            groups.append({
                "id": group_id,
                "name": group_data.get("name"),
                "members": group_data.get("members", []),
                "creator": group_data.get("creator")
            })
    
    return {"groups": groups}


# ✅ Send Group Message
@app.post("/groups/{group_id}/messages")
async def send_group_message(group_id: str, message_data: dict, request: Request):
    """Sends a message to a group."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    sender_uid = verify_token(token)
    if not token or not sender_uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    text = message_data.get("text")
    
    if not text:
        raise HTTPException(status_code=400, detail="Message text is required")
    
    # Check if group exists and user is a member
    group_ref = db.collection("groups").document(group_id).get()
    
    if not group_ref.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group_data = group_ref.to_dict()
    members = group_data.get("members", [])
    
    if sender_uid not in members:
        raise HTTPException(status_code=403, detail="User is not a member of this group")
    
    # Encrypt message text
    encrypted_text = encrypt_message(text)
    
    # Store message in Firestore
    message_ref = db.collection("group_messages").add({
        "group_id": group_id,
        "sender": sender_uid,
        "message": encrypted_text,
        "timestamp": firestore.SERVER_TIMESTAMP
    })
    
    # Send message to all online group members except sender
    await websocket_manager.send_group_message(
        group_id=group_id,
        sender_uid=sender_uid,
        text=text,
        members=members
    )
    
    return {"message": "Message sent to group successfully"}


# ✅ Get Group Messages
@app.get("/groups/{group_id}/messages")
async def get_group_messages(group_id: str, request: Request, limit: Optional[int] = None):
    """Retrieves messages from a group chat."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Check if group exists and user is a member
    group_ref = db.collection("groups").document(group_id).get()
    
    if not group_ref.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group_data = group_ref.to_dict()
    members = group_data.get("members", [])
    
    if uid not in members:
        raise HTTPException(status_code=403, detail="User is not a member of this group")
    
    # Query messages
    query = db.collection("group_messages").where("group_id", "==", group_id).order_by("timestamp", direction=firestore.Query.DESCENDING)
    
    if limit:
        query = query.limit(limit)
    
    messages = []
    for msg in query.stream():
        data = msg.to_dict()
        try:
            messages.append({
                "id": msg.id,
                "group_id": data["group_id"],
                "sender": data["sender"],
                "text": decrypt_message(data["message"]),
                "timestamp": data["timestamp"]
            })
        except Exception as e:
            print(f"Error decrypting message: {e}")
    
    return messages