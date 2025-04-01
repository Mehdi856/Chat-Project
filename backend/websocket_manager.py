from fastapi import WebSocket
from typing import Dict, List
import asyncio
from encryption import encrypt_message  # Assuming you have an encrypt_message function


class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # Stores WebSockets by UID

    async def connect(self, websocket: WebSocket, uid: str):
        """Adds a new WebSocket connection or replaces an existing one."""
        self.active_connections[uid] = websocket  # Store by UID

    async def disconnect(self, uid: str):
        """Removes a WebSocket connection."""
        self.active_connections.pop(uid, None)

    async def send_message(self, uid: str, message: str, sender_uid: str):
        """Sends a message to a specific user if they're online."""
        websocket = self.active_connections.get(uid)
        if websocket:
            try:
                await websocket.send_json({
                    "type": "message",
                    "sender": sender_uid,
                    "text": message
                })
            except Exception:
                await self.disconnect(uid)  # Remove if sending fails

    async def send_group_message(self, group_members: List[str], message: str, sender_uid: str):
        """Sends a message to all members of a group except the sender."""
        encrypted_message = encrypt_message(message)  # Encrypt the message before sending

        tasks = [
            self.send_message(uid, encrypted_message, sender_uid)
            for uid in group_members
            if uid != sender_uid  # Don't send to the sender
        ]

        # Await all tasks to send the messages concurrently
        await asyncio.gather(*tasks, return_exceptions=True)

