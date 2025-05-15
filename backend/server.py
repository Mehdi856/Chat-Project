from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Request, UploadFile, File, Form ,Header
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import auth, firestore, credentials, storage
from encryption import encrypt_message, decrypt_message
from websocket_manager import WebSocketManager
import os
import json
import uuid
from datetime import datetime
from typing import Optional, List
import cloudinary
import cloudinary.uploader

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


# ✅ Initialize Cloudinary
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"), 
    api_secret=os.getenv("CLOUDINARY_API_SECRET")
)





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
from fastapi import Request


@app.post("/register")
async def register_user(user_data: dict, request: Request):
    """Registers a new user with a unique username in Firebase Auth and Firestore."""
    email = user_data.get("email")
    password = user_data.get("password")
    name = user_data.get("name")  # Full name

    if not email or not password or not name:
        raise HTTPException(status_code=400, detail="Missing email, password, or name.")

    try:
        # Create the user in Firebase Auth
        user = auth.create_user(email=email, password=password, display_name=name)

        # Store user info in Firestore with empty username and no profile picture initially
        db.collection("users").document(user.uid).set({
            "name": name,
            "email": email,
            "uid": user.uid,
            "username": "",  # Empty initially
            "profile_picture_url": None,  # Add this field
            "contacts": [],
            "groups": []
        })

        return {
            "message": "User registered successfully!", 
            "uid": user.uid,
            "name": name,
            "username": "",  # Return empty username
            "profile_picture_url": None  # Return empty profile picture
        }
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
        # Get user's data from Firestore
        user_doc = db.collection("users").document(user.uid).get()
        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="User data not found")
        
        user_data = user_doc.to_dict()
        name = user_data.get("name", "User")
        username = user_data.get("username", "")  # Get username (empty if not set)
        profile_picture_url = user_data.get("profile_picture_url", None)  # Get profile picture

        # Generate a custom token
        custom_token = auth.create_custom_token(user.uid)

        return {
            "message": "Login successful!",
            "uid": user.uid,
            "token": custom_token.decode("utf-8"),
            "name": name,
            "username": username,  # Include username in response
            "profile_picture_url": profile_picture_url  # Include profile picture
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
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handles real-time chat via WebSockets with improved message handling."""
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
            data = await websocket.receive_json()
            message_type = data.get("type", "message")
            
            if message_type == "message":
                receiver_uid = data.get("receiver")
                text = data.get("text")
                file_url = data.get("file_url")
                file_type = data.get("file_type")
                file_size = data.get("file_size")

                if not receiver_uid or not text:
                    continue

                # Create message data
                message_data = {
                    "sender": sender_uid,
                    "receiver": receiver_uid,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "type": "text",
                    "text": text
                }

                # Add file data if present
                if file_url:
                    message_data.update({
                        "file_url": file_url,
                        "file_type": file_type,
                        "file_size": file_size,
                        "type": file_type.split('/')[0]  # 'image', 'video', etc.
                    })

                # Encrypt message text
                message_data["message"] = encrypt_message(text)

                # Store in Firestore
                db.collection("messages").add(message_data)

                # Prepare data to send to receiver
                send_data = {
                    "type": "message",
                    "sender": sender_uid,
                    "text": text,
                    "timestamp": datetime.now().isoformat()
                }
                if file_url:
                    send_data.update({
                        "file_url": file_url,
                        "file_type": file_type,
                        "file_size": file_size
                    })

                # Send to receiver if online
                await websocket_manager.send_message(receiver_uid, send_data, sender_uid)

            elif message_type == "typing":
                receiver_uid = data.get("receiver")
                if receiver_uid:
                    # Forward typing indicator to receiver
                    await websocket_manager.send_typing_indicator(receiver_uid, sender_uid)
                        
            elif message_type == "group_message":
                group_id = data.get("group_id")
                text = data.get("text")
                file_url = data.get("file_url")
                file_type = data.get("file_type")
                file_size = data.get("file_size")
                
                if not group_id or not text:
                    continue
                
                # Verify user is in the group
                group_ref = db.collection("groups").document(group_id).get()
                if not group_ref.exists:
                    continue
                
                group_data = group_ref.to_dict()
                if sender_uid not in group_data.get("members", []):
                    continue
                
                # Create message data
                message_data = {
                    "group_id": group_id,
                    "sender": sender_uid,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "type": "text",
                    "text": text
                }

                # Add file data if present
                if file_url:
                    message_data.update({
                        "file_url": file_url,
                        "file_type": file_type,
                        "file_size": file_size,
                        "type": file_type.split('/')[0]  # 'image', 'video', etc.
                    })

                # Encrypt message text
                message_data["message"] = encrypt_message(text)
                
                # Store in Firestore
                db.collection("group_messages").add(message_data)
                
                # Prepare data to send to group members
                send_data = {
                    "type": "group_message",
                    "group_id": group_id,
                    "sender": sender_uid,
                    "text": text,
                    "timestamp": datetime.now().isoformat()
                }
                if file_url:
                    send_data.update({
                        "file_url": file_url,
                        "file_type": file_type,
                        "file_size": file_size
                    })

                # Send to group members
                await websocket_manager.send_group_message(
                    group_id=group_id,
                    sender_uid=sender_uid,
                    message_data=send_data,
                    members=group_data.get("members", [])
                )

            elif message_type == "group_typing":
                group_id = data.get("group_id")
                
                if not group_id:
                    continue
                
                # Verify user is in the group
                group_ref = db.collection("groups").document(group_id).get()
                if not group_ref.exists:
                    continue
                
                group_data = group_ref.to_dict()
                if sender_uid not in group_data.get("members", []):
                    continue
                
                await websocket_manager.send_group_typing_indicator(
                    group_id=group_id,
                    sender_uid=sender_uid,
                    members=group_data.get("members", [])
                )

            elif message_type == "notification":
                # Handle custom notification types if needed
                pass

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
    """Retrieves the contact list of a user, including names, UIDs, and profile pictures."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    user_ref = db.collection("users").document(uid).get()

    if not user_ref.exists:
        raise HTTPException(status_code=404, detail="User not found")

    user_data = user_ref.to_dict()
    contact_uids = user_data.get("contacts", [])

    # Fetch full user details for each contact
    contacts = []
    for contact_uid in contact_uids:
        contact_ref = db.collection("users").document(contact_uid).get()
        if contact_ref.exists:
            contact_data = contact_ref.to_dict()
            contacts.append({
                "uid": contact_uid,
                "name": contact_data.get("name", "Unknown"),
                "username": contact_data.get("username", ""),
                "profile_picture_url": contact_data.get("profile_picture_url", None)  # Add profile picture
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
    """Retrieves pending contact requests for a user with sender profile pictures."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Query requests where user is the receiver and status is pending
    requests_query = db.collection("contact_requests").where("receiver", "==", uid).where("status", "==", "pending")
    
    pending_requests = []
    for req in requests_query.stream():
        data = req.to_dict()
        # Get sender's profile picture
        sender_ref = db.collection("users").document(data["sender"]).get()
        if sender_ref.exists:
            sender_data = sender_ref.to_dict()
            data["sender_profile_picture_url"] = sender_data.get("profile_picture_url", None)
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
    """Creates a new group chat with private/public option."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    group_name = group_data.get("name")
    members = group_data.get("members", [])
    is_private = group_data.get("is_private", False)  # Default to public if not specified

    if not group_name:
        raise HTTPException(status_code=400, detail="Group name is required")

    # Ensure creator is in members list
    if uid not in members:
        members.append(uid)

    # Create group in Firestore with privacy setting
    group_ref = db.collection("groups").add({
        "name": group_name,
        "creator": uid,
        "members": members,
        "is_private": is_private,  # Add privacy flag
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
                    "creator": uid,
                    "is_private": is_private
                })

    return {"message": "Group created successfully", "group_id": group_id, "is_private": is_private}


# ✅ Get Groups
@app.get("/groups/{uid}")
async def get_groups(uid: str, request: Request):
    """Retrieves all groups a user belongs to (with usernames instead of UIDs)."""
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
        group_doc = db.collection("groups").document(group_id).get()
        if group_doc.exists:
            group_data = group_doc.to_dict()
            
            # Ensure members are UIDs, not usernames
            member_uids = group_data.get("members", [])
            
            
            groups.append({
                "id": group_id,
                "name": group_data.get("name"),
                "members": member_uids,  # Send UIDs only
                "creator": group_data.get("creator"),
                "is_private": group_data.get("is_private", False)
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
@app.post("/set_username")
async def set_username(user_data: dict, request: Request):
    """Sets the username for a user after registration."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    uid = user_data.get("uid")
    username = user_data.get("username")

    if not uid or not username:
        raise HTTPException(status_code=400, detail="Missing uid or username")

    # Validate username
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    
    if not username.isalnum():
        raise HTTPException(status_code=400, detail="Username can only contain letters and numbers")

    # Check if username is already taken
    existing_users = db.collection("users").where("username", "==", username).get()
    if existing_users:
        raise HTTPException(status_code=400, detail="Username already taken")

    # Update the user's document with the username
    user_ref = db.collection("users").document(uid)
    user_ref.update({"username": username})

    return {"message": "Username set successfully"}
# ✅ Update User Name
@app.post("/update_name")
async def update_user_name(user_data: dict, request: Request):
    """Updates a user's name in Firestore."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    new_name = user_data.get("name")
    
    if not new_name:
        raise HTTPException(status_code=400, detail="Name is required")
    
    try:
        # Update the user's document with the new name
        user_ref = db.collection("users").document(uid)
        user_ref.update({"name": new_name})
        
        # Also update the display name in Firebase Auth
        auth.update_user(uid, display_name=new_name)
        
        return {"message": "Name updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
@app.get("/search_users")
async def search_users(q: str, request: Request):
    """Searches for users by name."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not q or len(q) < 2:
        return {"users": []}

    try:
        # Search for users whose name starts with the query (case insensitive)
        users_ref = db.collection("users")
        query = users_ref.where("username", ">=", q).where("username", "<=", q + "\uf8ff")
        
        results = []
        for doc in query.stream():
            user_data = doc.to_dict()
            # Don't return sensitive information
            results.append({
                "uid": user_data.get("uid"),
                "name": user_data.get("name"),
                "username": user_data.get("username", ""),
                "profile_picture_url": user_data.get("profile_picture_url", None)  # Add profile picture
            })
        
        return {"users": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# File upload constants
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB limit
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime"}
ALLOWED_FILE_TYPES = {
    *ALLOWED_IMAGE_TYPES,
    *ALLOWED_VIDEO_TYPES,
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "application/zip",
    "application/x-rar-compressed"
}

# Update the file upload endpoint
@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    authorization: str = Header(None)
):
    try:
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization header missing")

        token = authorization.replace("Bearer ", "")
        uid = verify_token(token)
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Check file size
        file_size = 0
        file_content = bytearray()
        
        # Read file in chunks
        while chunk := await file.read(8192):
            file_size += len(chunk)
            if file_size > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large. Maximum size is {MAX_FILE_SIZE / (1024 * 1024)}MB"
                )
            file_content.extend(chunk)

        # Check file type
        content_type = file.content_type
        if content_type not in ALLOWED_FILE_TYPES:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported file type: {content_type}"
            )

        # Generate unique filename
        file_ext = os.path.splitext(file.filename)[1].lower()
        unique_filename = f"{uid}_{uuid.uuid4()}{file_ext}"

        try:
            # Upload to Cloudinary with optimizations
            upload_options = {
                "resource_type": "auto",
                "folder": f"chat_files/{uid}",
                "public_id": os.path.splitext(unique_filename)[0],  # Remove extension as Cloudinary adds it
                "overwrite": True
            }

            # Add specific optimizations based on file type
            if content_type.startswith('image/'):
                upload_options.update({
                    "eager": [
                        {"width": 800, "height": 800, "crop": "limit", "quality": "auto"},
                        {"width": 400, "height": 400, "crop": "limit", "quality": "auto"}
                    ],
                    "eager_async": True
                })
            elif content_type.startswith('video/'):
                upload_options.update({
                    "resource_type": "video",
                    "eager": [
                        {"width": 640, "height": 480, "crop": "limit", "quality": "auto"}
                    ],
                    "eager_async": True
                })

            # Upload file
            upload_result = cloudinary.uploader.upload(file_content, **upload_options)

            if not upload_result or "secure_url" not in upload_result:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to upload file to storage"
                )

            # Store file info in Firestore
            db.collection("uploads").add({
                "uid": uid,
                "filename": file.filename,
                "file_url": upload_result["secure_url"],
                "file_type": content_type,
                "file_size": file_size,
                "timestamp": firestore.SERVER_TIMESTAMP
            })

            return {
                "success": True,
                "file_url": upload_result["secure_url"],
                "file_type": content_type,
                "file_size": file_size
            }

        except Exception as upload_error:
            print(f"Cloudinary upload error: {str(upload_error)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to upload file to storage service"
            )

    except HTTPException as http_error:
        raise http_error
    except Exception as e:
        print(f"Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))




# Get_uploads
@app.get("/uploads/{uid}")
async def get_uploads(uid: str, request: Request):
    """Retrieve all files uploaded by a specific user."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not auth.verify_id_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        db = firestore.client()
        uploads = db.collection("uploads").where("uid", "==", uid).order_by("timestamp", direction=firestore.Query.DESCENDING).stream()


        results = []
        for doc in uploads:
            data = doc.to_dict()
            results.append({
                "filename": data.get("filename"),
                "file_url": data.get("file_url"),
                "timestamp": data.get("timestamp")
            })

        return {"uploads": results}
    except Exception as e:
        return {"error": str(e)}


#a new endpoint to get group details
@app.get("/groups/{group_id}/details")
async def get_group_details(group_id: str, request: Request):
    """Returns detailed information about a specific group including privacy status."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    group_ref = db.collection("groups").document(group_id).get()
    if not group_ref.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group_data = group_ref.to_dict()
    if uid not in group_data.get("members", []):
        raise HTTPException(status_code=403, detail="Not a group member")
    
    # Get member details with profile pictures
    members_info = []
    for member_uid in group_data["members"]:
        user_doc = db.collection("users").document(member_uid).get()
        if user_doc.exists:
            user_data = user_doc.to_dict()
            members_info.append({
                "uid": member_uid,
                "name": user_data.get("name"),
                "username": user_data.get("username", ""),
                "profile_picture_url": user_data.get("profile_picture_url", None)  # Add profile picture
            })
    
    return {
        "id": group_id,
        "name": group_data["name"],
        "creator": group_data["creator"],
        "members": members_info,
        "created_at": group_data["created_at"],
        "is_private": group_data.get("is_private", False)
    }
@app.post("/groups/{group_id}/members")
async def add_group_members(group_id: str, member_data: dict, request: Request):
    """Adds members to an existing group."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    new_members = member_data.get("members", [])
    if not new_members:
        raise HTTPException(status_code=400, detail="No members provided")
    
    # Verify group exists and user is the creator
    group_ref = db.collection("groups").document(group_id)
    group_doc = group_ref.get()
    
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group_data = group_doc.to_dict()
    if group_data["creator"] != uid:
        raise HTTPException(status_code=403, detail="Only group creator can add members")
    
    # Get current members
    current_members = group_data.get("members", [])
    added_members = []
    
    # Add new members
    for member_uid in new_members:
        if member_uid not in current_members:
            current_members.append(member_uid)
            added_members.append(member_uid)
    
    # Update group
    group_ref.update({"members": current_members})
    
    # Add group to new members' groups list
    for member_uid in added_members:
        user_ref = db.collection("users").document(member_uid)
        user_doc = user_ref.get()
        
        if user_doc.exists:
            user_data = user_doc.to_dict()
            user_groups = user_data.get("groups", [])
            if group_id not in user_groups:
                user_groups.append(group_id)
                user_ref.update({"groups": user_groups})
            
            # Notify new members
            await websocket_manager.send_notification(member_uid, {
                "type": "notification",
                "notification_type": "added_to_group",
                "group_id": group_id,
                "group_name": group_data["name"],
                "adder_uid": uid
            })
    
    return {"message": "Members added successfully", "added_members": added_members}

@app.delete("/groups/{group_id}/members/{member_uid}")
async def remove_group_member(group_id: str, member_uid: str, request: Request):
    """Removes a member from a group (creator only)."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    # Verify group exists and user is the creator
    group_ref = db.collection("groups").document(group_id)
    group_doc = group_ref.get()
    
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group_data = group_doc.to_dict()
    if group_data["creator"] != uid:
        raise HTTPException(status_code=403, detail="Only group creator can remove members")
    
    if member_uid == uid:
        raise HTTPException(status_code=400, detail="Creator cannot remove themselves")
    
    # Remove member from group
    current_members = group_data.get("members", [])
    if member_uid not in current_members:
        raise HTTPException(status_code=400, detail="User is not a group member")
    
    current_members.remove(member_uid)
    group_ref.update({"members": current_members})
    
    # Remove group from member's groups list
    user_ref = db.collection("users").document(member_uid)
    user_doc = user_ref.get()
    
    if user_doc.exists:
        user_data = user_doc.to_dict()
        user_groups = user_data.get("groups", [])
        if group_id in user_groups:
            user_groups.remove(group_id)
            user_ref.update({"groups": user_groups})
        
        # Notify removed member
        await websocket_manager.send_notification(member_uid, {
            "type": "notification",
            "notification_type": "removed_from_group",
            "group_id": group_id,
            "group_name": group_data["name"]
        })
    
    return {"message": "Member removed successfully"}
@app.get("/user_details/{uid}")
async def get_user_details(uid: str, request: Request):
    """Returns basic user details by UID including profile picture."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    user_ref = db.collection("users").document(uid).get()
    if not user_ref.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_data = user_ref.to_dict()
    return {
        "uid": uid,
        "name": user_data.get("name"),
        "username": user_data.get("username", ""),
        "profile_picture_url": user_data.get("profile_picture_url", None)  # Add profile picture
    }
@app.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request):
    """Deletes a group (creator only)."""
    # Verify the token from Authorization header
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    uid = verify_token(token)
    if not token or not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    # Get group data
    group_ref = db.collection("groups").document(group_id)
    group_doc = group_ref.get()
    
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    
    group_data = group_doc.to_dict()
    
    # Verify user is the creator
    if group_data["creator"] != uid:
        raise HTTPException(status_code=403, detail="Only group creator can delete the group")
    
    try:
        # Delete group messages first
        messages_query = db.collection("group_messages").where("group_id", "==", group_id)
        for message in messages_query.stream():
            message.reference.delete()
        
        # Remove group from all members' groups list
        for member_uid in group_data.get("members", []):
            user_ref = db.collection("users").document(member_uid)
            user_doc = user_ref.get()
            
            if user_doc.exists:
                user_data = user_doc.to_dict()
                user_groups = user_data.get("groups", [])
                if group_id in user_groups:
                    user_groups.remove(group_id)
                    user_ref.update({"groups": user_groups})
        
        # Finally delete the group
        group_ref.delete()
        
        return {"message": "Group deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload_profile_picture")
async def upload_profile_picture(
    file: UploadFile = File(...),
    authorization: str = Header(None)
):
    try:
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization header missing")

        token = authorization.replace("Bearer ", "")
        uid = verify_token(token)
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Validate file type
        if file.content_type not in ["image/jpeg", "image/png", "image/gif", "image/webp"]:
            raise HTTPException(status_code=400, detail="File must be an image (JPEG, PNG, GIF, or WEBP)")

        # Upload to Cloudinary with user-specific folder
        upload_result = cloudinary.uploader.upload(
            file.file,
            folder=f"profile_pictures/{uid}",
            transformation=[
                {"width": 300, "height": 300, "crop": "fill"},
                {"quality": "auto"},
                {"fetch_format": "auto"}
            ]
        )

        # Get secure URL
        profile_picture_url = upload_result.get("secure_url")
        if not profile_picture_url:
            raise HTTPException(status_code=500, detail="Failed to get image URL")
        # ✅ Update Firebase Auth (like display_name)
        auth.update_user(uid, photo_url=profile_picture_url)  # Critical fix
        # Update user record
        db.collection("users").document(uid).update({
            "profile_picture_url": profile_picture_url
        })

        # Notify client
        await websocket_manager.send_profile_picture_update(uid, profile_picture_url)

        return {
            "success": True,
            "profile_picture_url": profile_picture_url
        }

    except Exception as e:
        print(f"Failed to upload profile picture: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/get_profile_picture")
async def get_profile_picture(authorization: str = Header(None)):
    """Fetches the profile picture URL for the authenticated user."""
    try:
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization header missing")

        token = authorization.replace("Bearer ", "")
        uid = verify_token(token)
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid token")

        user_ref = db.collection("users").document(uid)
        user_doc = user_ref.get()

        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="User not found")

        profile_picture_url = user_doc.to_dict().get("profile_picture_url")

        if not profile_picture_url:
            return {"success": True, "message": "No profile picture set yet", "profile_picture_url": None}

        return {
            "success": True,
            "profile_picture_url": profile_picture_url
        }

    except Exception as e:
        return {"success": False, "error": str(e)}
@app.post("/batch_user_details")
async def batch_user_details(uids: List[str], request: Request):
    """Returns basic user details for multiple UIDs at once."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    users = []
    for uid in uids:
        user_ref = db.collection("users").document(uid).get()
        if user_ref.exists:
            user_data = user_ref.to_dict()
            users.append({
                "uid": uid,
                "name": user_data.get("name"),
                "username": user_data.get("username", ""),
                "profile_picture_url": user_data.get("profile_picture_url", None)
            })
    
    return {"users": users}

@app.post("/groups/{group_id}/add_request")
async def request_add_member(group_id: str, request_data: dict, request: Request):
    """Allows a group member to request adding a new member to a private group."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    requester_uid = verify_token(token)
    if not token or not requester_uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    new_member_uid = request_data.get("new_member_uid")
    if not new_member_uid:
        raise HTTPException(status_code=400, detail="No new member UID provided")

    group_ref = db.collection("groups").document(group_id)
    group_doc = group_ref.get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    group_data = group_doc.to_dict()
    if requester_uid not in group_data.get("members", []):
        raise HTTPException(status_code=403, detail="Only group members can request to add members")
    if not group_data.get("is_private", False):
        raise HTTPException(status_code=400, detail="This is not a private group")
    if new_member_uid in group_data.get("members", []):
        raise HTTPException(status_code=400, detail="User is already a member")

    # Store request in subcollection
    add_requests_ref = group_ref.collection("add_requests")
    # Prevent duplicate requests
    existing = add_requests_ref.where("new_member_uid", "==", new_member_uid).where("status", "==", "pending").get()
    if existing:
        raise HTTPException(status_code=400, detail="A pending request for this user already exists")
    add_requests_ref.add({
        "requester_uid": requester_uid,
        "new_member_uid": new_member_uid,
        "status": "pending",
        "timestamp": firestore.SERVER_TIMESTAMP
    })
    return {"message": "Request submitted"}

@app.get("/groups/{group_id}/add_requests")
async def list_add_requests(group_id: str, request: Request):
    """Allows the group owner to list all pending add-member requests."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    owner_uid = verify_token(token)
    if not token or not owner_uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    group_ref = db.collection("groups").document(group_id)
    group_doc = group_ref.get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    group_data = group_doc.to_dict()
    if group_data["creator"] != owner_uid:
        raise HTTPException(status_code=403, detail="Only the group owner can view requests")
    add_requests_ref = group_ref.collection("add_requests")
    requests = []
    for req in add_requests_ref.where("status", "==", "pending").stream():
        data = req.to_dict()
        data["id"] = req.id
        requests.append(data)
    return {"requests": requests}

@app.post("/groups/{group_id}/add_requests/{request_id}/respond")
async def respond_add_request(group_id: str, request_id: str, response_data: dict, request: Request):
    """Allows the group owner to accept or decline an add-member request."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    owner_uid = verify_token(token)
    if not token or not owner_uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    group_ref = db.collection("groups").document(group_id)
    group_doc = group_ref.get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")
    group_data = group_doc.to_dict()
    if group_data["creator"] != owner_uid:
        raise HTTPException(status_code=403, detail="Only the group owner can respond to requests")
    add_requests_ref = group_ref.collection("add_requests")
    req_doc = add_requests_ref.document(request_id).get()
    if not req_doc.exists:
        raise HTTPException(status_code=404, detail="Request not found")
    req_data = req_doc.to_dict()
    if req_data["status"] != "pending":
        raise HTTPException(status_code=400, detail="Request already handled")
    action = response_data.get("action")  # "accept" or "decline"
    if action not in ["accept", "decline"]:
        raise HTTPException(status_code=400, detail="Invalid action")
    if action == "accept":
        # Add member to group
        current_members = group_data.get("members", [])
        if req_data["new_member_uid"] not in current_members:
            current_members.append(req_data["new_member_uid"])
            group_ref.update({"members": current_members})
            # Add group to user's group list
            user_ref = db.collection("users").document(req_data["new_member_uid"])
            user_doc = user_ref.get()
            if user_doc.exists:
                user_data = user_doc.to_dict()
                user_groups = user_data.get("groups", [])
                if group_id not in user_groups:
                    user_groups.append(group_id)
                    user_ref.update({"groups": user_groups})
        add_requests_ref.document(request_id).update({"status": "accepted"})
        # Optionally: notify user(s)
        return {"message": "Member added to group"}
    else:
        add_requests_ref.document(request_id).update({"status": "declined"})
        return {"message": "Request declined"}
