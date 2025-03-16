from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from firebase_admin import auth, firestore
from auth import verify_token

app = FastAPI()
db = firestore.client()
clients = {}  # Stores active WebSocket connections

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str):
    """WebSocket connection for chat messages"""
    email = verify_token(token)  # Verify Firebase token
    if not email:
        await websocket.close()
        return
    
    await websocket.accept()
    clients[email] = websocket  # Store connection
    
    try:
        while True:
            message = await websocket.receive_text()
            message_data = {
                "sender": email,
                "text": message
            }
            db.collection("messages").add(message_data)  # Save to Firestore
            
            # Send message to all connected clients
            for client_email, client_ws in clients.items():
                if client_ws != websocket:
                    await client_ws.send_text(f"{email}: {message}")

    except WebSocketDisconnect:
        del clients[email]

@app.get("/messages")
async def get_messages():
    """Retrieve chat history from Firestore"""
    messages_ref = db.collection("messages").stream()
    messages = [{"sender": msg.get("sender"), "text": msg.get("text")} for msg in messages_ref]
    return messages
