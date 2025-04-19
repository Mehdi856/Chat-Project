from fastapi import WebSocket
from typing import Dict, List
import asyncio

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # Stores WebSockets by UID
    
    async def connect(self, websocket: WebSocket, uid: str):
        """Adds a new WebSocket connection or replaces an existing one."""
        self.active_connections[uid] = websocket
        print(f"✅ User {uid} connected. Total active connections: {len(self.active_connections)}")
    
    async def disconnect(self, uid: str):
        """Removes a WebSocket connection."""
        if uid in self.active_connections:
            self.active_connections.pop(uid)
            print(f"🔴 User {uid} disconnected. Remaining connections: {len(self.active_connections)}")
    
    async def send_message(self, uid: str, text: str, sender_uid: str):
        """Sends a private message to a specific user if they're online."""
        if uid in self.active_connections:
            websocket = self.active_connections[uid]
            try:
                await websocket.send_json({
                    "type": "message",
                    "sender": sender_uid,
                    "text": text,
                    "timestamp": None  # Server timestamp will be used when displayed
                })
                print(f"✉️ Message sent from {sender_uid} to {uid}")
                return True
            except Exception as e:
                print(f"❌ Error sending message to {uid}: {e}")
                await self.disconnect(uid)
                return False
        return False

    async def send_typing_indicator(self, uid: str, sender_uid: str):
        """Sends a typing indicator to a specific user if they're online."""
        if uid in self.active_connections:
            websocket = self.active_connections[uid]
            try:
                await websocket.send_json({
                    "type": "typing",
                    "sender": sender_uid
                })
                return True
            except Exception as e:
                print(f"❌ Error sending typing indicator to {uid}: {e}")
                await self.disconnect(uid)
                return False
        return False

    async def send_notification(self, uid: str, notification_data: dict):
        """Sends a notification to a specific user if they're online."""
        if uid in self.active_connections:
            websocket = self.active_connections[uid]
            try:
                await websocket.send_json(notification_data)
                print(f"🔔 Notification sent to {uid}")
                return True
            except Exception as e:
                print(f"❌ Error sending notification to {uid}: {e}")
                await self.disconnect(uid)
                return False
        return False

    async def send_group_message(self, group_id: str, sender_uid: str, text: str, members: List[str]):
        """Sends a message to all online members of a group."""
        tasks = []
        for member_uid in members:
            if member_uid != sender_uid and member_uid in self.active_connections:
                websocket = self.active_connections[member_uid]
                try:
                    tasks.append(websocket.send_json({
                        "type": "group_message",
                        "group_id": group_id,
                        "sender": sender_uid,
                        "text": text,
                        "timestamp": None  # Server timestamp will be used when displayed
                    }))
                except Exception:
                    await self.disconnect(member_uid)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
            print(f"✉️ Group message sent to {len(tasks)} members in group {group_id}")

    async def send_group_typing_indicator(self, group_id: str, sender_uid: str, members: List[str]):
        """Sends a typing indicator to all group members except sender."""
        tasks = []
        for member_uid in members:
            if member_uid != sender_uid and member_uid in self.active_connections:
                websocket = self.active_connections[member_uid]
                try:
                    tasks.append(websocket.send_json({
                        "type": "group_typing",
                        "group_id": group_id,
                        "sender": sender_uid
                    }))
                except Exception:
                    await self.disconnect(member_uid)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_group_notification(self, group_id: str, notification_type: str, data: dict, members: List[str], exclude_uid: str = None):
        """Sends group-specific notifications to members."""
        tasks = []
        for member_uid in members:
            if member_uid == exclude_uid:
                continue
            if member_uid in self.active_connections:
                websocket = self.active_connections[member_uid]
                try:
                    tasks.append(websocket.send_json({
                        "type": "group_notification",
                        "group_id": group_id,
                        "notification_type": notification_type,
                        **data
                    }))
                except Exception:
                    await self.disconnect(member_uid)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)    
            
    async def broadcast(self, message: dict, exclude_uid: str = None):
        """Broadcasts a message to all connected clients, optionally excluding one."""
        tasks = []
        for uid, websocket in list(self.active_connections.items()):
            if exclude_uid and uid == exclude_uid:
                continue
                
            try:
                tasks.append(websocket.send_json(message))
            except Exception:
                await self.disconnect(uid)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    

