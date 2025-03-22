from fastapi import WebSocket
from typing import Dict

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, email: str):
        """Add a new WebSocket connection."""
        await websocket.accept()
        self.active_connections[email] = websocket

    async def disconnect(self, email: str):
        """Remove a WebSocket connection."""
        if email in self.active_connections:
            del self.active_connections[email]

    async def broadcast(self, message: str, sender: str):
        """Broadcast a message to all connected clients except the sender."""
        for email, websocket in self.active_connections.items():
            if email != sender:
                await websocket.send_text(message)