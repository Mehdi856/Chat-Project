from fastapi import WebSocket
from typing import Dict
import asyncio

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, email: str):
        """Add a new WebSocket connection."""
        await websocket.accept()
        self.active_connections[email] = websocket

    async def disconnect(self, email: str):
        """Remove a WebSocket connection if it exists."""
        self.active_connections.pop(email, None)

    async def send_message(self, email: str, message: str):
        """Send a message to a specific user if they are online."""
        websocket = self.active_connections.get(email)
        if websocket:
            try:
                await websocket.send_text(message)
            except Exception:
                await self.disconnect(email)  # Remove if sending fails

    async def broadcast(self, message: str, sender: str):
        """Broadcast a message to all connected clients except the sender."""
        tasks = [
            self.send_message(email, message)
            for email in self.active_connections
            if email != sender
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
