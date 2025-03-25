from fastapi import WebSocket
from typing import Dict, List
import asyncio

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # Stores WebSockets by UID

    async def connect(self, websocket: WebSocket, uid: str):
        """Adds a new WebSocket connection or replaces an existing one."""
        await websocket.accept()
        self.active_connections[uid] = websocket  # Store by UID

    async def disconnect(self, uid: str):
        """Removes a WebSocket connection."""
        self.active_connections.pop(uid, None)

    async def send_message(self, uid: str, message: str):
        """Sends a message to a specific user if they're online."""
        websocket = self.active_connections.get(uid)
        if websocket:
            try:
                await websocket.send_text(message)
            except Exception:
                await self.disconnect(uid)  # Remove if sending fails

    async def send_group_message(self, group_members: List[str], message: str, sender_uid: str):
        """Sends a message to all members of a group except the sender."""
        tasks = [
            self.send_message(uid, message)
            for uid in group_members
            if uid != sender_uid  # Don't send to the sender
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
