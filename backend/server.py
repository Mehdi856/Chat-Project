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
    cloud_name=os.getenv("dp5bo6efq"), #CLOUDINARY_CLOUD_NAME
    api_key=os.getenv("745961757372214"), #CLOUDINARY_API_KEY
    api_secret=os.getenv("wCPIFMMQDMD4bFiLbk0Kvt_iy3c") #CLOUDINARY_API_SECRET
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

        # Store user info in Firestore with empty username
        db.collection("users").document(user.uid).set({
            "name": name,
            "email": email,
            "uid": user.uid,
            "username": "",  # Empty initially
            "contacts": [],
            "groups": []
        })

        return {
            "message": "User registered successfully!", 
            "uid": user.uid,
            "name": name,
            "username": ""  # Return empty username
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

        # Generate a custom token
        custom_token = auth.create_custom_token(user.uid)

        return {
            "message": "Login successful!",
            "uid": user.uid,
            "token": custom_token.decode("utf-8"),
            "name": name,
            "username": username  # Include username in response
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
                        

            if message_type == "group_message":
                group_id = data.get("group_id")
                text = data.get("text")
                
                if not group_id or not text:
                    continue
                
                # Verify user is in the group
                group_ref = db.collection("groups").document(group_id).get()
                if not group_ref.exists:
                    continue
                
                group_data = group_ref.to_dict()
                if sender_uid not in group_data.get("members", []):
                    continue
                
                # Encrypt and store message
                encrypted_text = encrypt_message(text)
                db.collection("group_messages").add({
                    "group_id": group_id,
                    "sender": sender_uid,
                    "message": encrypted_text,
                    "timestamp": firestore.SERVER_TIMESTAMP
                })
                
                # Send to group members
                await websocket_manager.send_group_message(
                    group_id=group_id,
                    sender_uid=sender_uid,
                    text=text,
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
                "username": user_data.get("username", "")
            })
        
        return {"users": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



#upload
@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    authorization: str = Header(None)
):
    try:
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization header missing")

        token = authorization.replace("Bearer ", "")
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token["uid"]

        file_bytes = await file.read()

        upload_result = cloudinary.uploader.upload(file_bytes, public_id=file.filename)
        file_url = upload_result["secure_url"]

        # Sauvegarde dans Firestore avec l'UID
        from firebase_admin import firestore
        db = firestore.client()
        db.collection("uploads").add({
            "uid": uid,
            "filename": file.filename,
            "file_url": file_url,
            "timestamp": datetime.utcnow()
        })

        return {"file_url": file_url, "uid": uid}
    except Exception as e:
        return {"error": str(e)}




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
    """Returns detailed information about a specific group."""
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
    
    # Get member details
    members_info = []
    for member_uid in group_data["members"]:
        user_doc = db.collection("users").document(member_uid).get()
        if user_doc.exists:
            user_data = user_doc.to_dict()
            members_info.append({
                "uid": member_uid,
                "name": user_data.get("name"),
                "username": user_data.get("username", "")
            })
    
    return {
        "id": group_id,
        "name": group_data["name"],
        "creator": group_data["creator"],
        "members": members_info,
        "created_at": group_data["created_at"]
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
    """Returns basic user details by UID."""
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
        "username": user_data.get("username", "")
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
    """Uploads a profile picture for the authenticated user."""
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

        file_bytes = await file.read()

        # Upload image to Cloudinary with specific folder and transformation
        upload_result = cloudinary.uploader.upload(
            file_bytes,
            folder="profile_pictures",
            transformation=[
                {"width": 300, "height": 300, "crop": "fill", "gravity": "face"},
                {"radius": "max"}  # Makes the image circular
            ]
        )

        # Get the URL of the uploaded image
        profile_picture_url = upload_result["secure_url"]

        # Update user record in Firestore with the profile picture URL
        user_ref = db.collection("users").document(uid)
        user_ref.update({"profile_picture_url": profile_picture_url})

        return {
            "success": True,
            "message": "Profile picture updated successfully",
            "profile_picture_url": profile_picture_url
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


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