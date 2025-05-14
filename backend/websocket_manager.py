from fastapi import WebSocket
from typing import Dict, List, Set
import asyncio

class WebSocketManager:
    def __init__(self):
        # Change to store multiple connections per user
        self.active_connections: Dict[str, Set[WebSocket]] = {}  # Stores WebSockets by UID
    
    async def connect(self, websocket: WebSocket, uid: str):
        """Adds a new WebSocket connection for a user (allows multiple connections)."""
        if uid not in self.active_connections:
            self.active_connections[uid] = set()
        self.active_connections[uid].add(websocket)
        print(f"✅ User {uid} connected. Total active connections: {sum(len(v) for v in self.active_connections.values())}")
    
    async def disconnect(self, uid: str, websocket: WebSocket = None):
        """Removes a specific WebSocket connection or all connections for a user."""
        if uid in self.active_connections:
            if websocket:
                self.active_connections[uid].discard(websocket)
                if not self.active_connections[uid]:
                    del self.active_connections[uid]
            else:
                del self.active_connections[uid]
        print(f"🔴 User {uid} disconnected. Remaining connections: {sum(len(v) for v in self.active_connections.values())}")
    
    async def send_message(self, uid: str, message_data: dict, sender_uid: str):
        """Sends a message to a specific user if they're online."""
        if uid in self.active_connections:
            tasks = []
            for websocket in list(self.active_connections[uid]):
                try:
                    # Create message with all data
                    message = {
                        "type": message_data.get("type", "message"),
                        "sender": sender_uid,
                        "text": message_data.get("text"),
                        "timestamp": None
                    }

                    # Add file data if present
                    if message_data.get("file_url"):
                        message.update({
                            "file_url": message_data.get("file_url"),
                            "file_type": message_data.get("file_type"),
                            "file_size": message_data.get("file_size")
                        })

                    tasks.append(websocket.send_json(message))
                except Exception as e:
                    print(f"❌ Error sending message to {uid}: {e}")
                    await self.disconnect(uid, websocket)
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
                print(f"✉️ Message sent from {sender_uid} to {uid}")
                return True
        return False

    async def send_typing_indicator(self, uid: str, sender_uid: str):
        """Sends a typing indicator to a specific user if they're online."""
        if uid in self.active_connections:
            tasks = []
            for websocket in list(self.active_connections[uid]):
                try:
                    tasks.append(websocket.send_json({
                        "type": "typing",
                        "sender": sender_uid
                    }))
                except Exception as e:
                    print(f"❌ Error sending typing indicator to {uid}: {e}")
                    await self.disconnect(uid, websocket)
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
                return True
        return False

    async def send_notification(self, uid: str, notification_data: dict):
        """Sends a notification to a specific user if they're online."""
        if uid in self.active_connections:
            tasks = []
            for websocket in list(self.active_connections[uid]):
                try:
                    tasks.append(websocket.send_json(notification_data))
                except Exception as e:
                    print(f"❌ Error sending notification to {uid}: {e}")
                    await self.disconnect(uid, websocket)
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
                print(f"🔔 Notification sent to {uid}")
                return True
        return False

    async def send_group_message(self, group_id: str, sender_uid: str, message_data: dict, members: List[str]):
        """Sends a message to all online members of a group."""
        tasks = []
        for member_uid in members:
            if member_uid != sender_uid and member_uid in self.active_connections:
                for websocket in list(self.active_connections[member_uid]):
                    try:
                        # Create message with all data
                        message = {
                            "type": message_data.get("type", "group_message"),
                            "group_id": group_id,
                            "sender": sender_uid,
                            "text": message_data.get("text"),
                            "timestamp": None
                        }

                        # Add file data if present
                        if message_data.get("file_url"):
                            message.update({
                                "file_url": message_data.get("file_url"),
                                "file_type": message_data.get("file_type"),
                                "file_size": message_data.get("file_size")
                            })

                        tasks.append(websocket.send_json(message))
                    except Exception as e:
                        print(f"❌ Error sending group message to {member_uid}: {e}")
                        await self.disconnect(member_uid, websocket)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
            print(f"✉️ Group message sent to {len(tasks)} members in group {group_id}")
    
    async def send_group_typing_indicator(self, group_id: str, sender_uid: str, members: List[str]):
        """Sends a typing indicator to all group members except sender."""
        tasks = []
        for member_uid in members:
            if member_uid != sender_uid and member_uid in self.active_connections:
                for websocket in list(self.active_connections[member_uid]):
                    try:
                        tasks.append(websocket.send_json({
                            "type": "group_typing",
                            "group_id": group_id,
                            "sender": sender_uid
                        }))
                    except Exception as e:
                        print(f"❌ Error sending group typing indicator to {member_uid}: {e}")
                        await self.disconnect(member_uid, websocket)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_group_notification(self, group_id: str, notification_type: str, data: dict, members: List[str], exclude_uid: str = None):
        """Sends group-specific notifications to members."""
        tasks = []
        for member_uid in members:
            if member_uid == exclude_uid:
                continue
            if member_uid in self.active_connections:
                for websocket in list(self.active_connections[member_uid]):
                    try:
                        tasks.append(websocket.send_json({
                            "type": "group_notification",
                            "group_id": group_id,
                            "notification_type": notification_type,
                            **data
                        }))
                    except Exception as e:
                        print(f"❌ Error sending group notification to {member_uid}: {e}")
                        await self.disconnect(member_uid, websocket)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)    
            
    async def broadcast(self, message: dict, exclude_uid: str = None):
        """Broadcasts a message to all connected clients, optionally excluding one."""
        tasks = []
        for uid, connections in list(self.active_connections.items()):
            if exclude_uid and uid == exclude_uid:
                continue
                
            for websocket in list(connections):
                try:
                    tasks.append(websocket.send_json(message))
                except Exception as e:
                    print(f"❌ Error broadcasting to {uid}: {e}")
                    await self.disconnect(uid, websocket)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_profile_picture_update(self, uid: str, profile_picture_url: str):
        """Notify all connected devices of a user about their profile picture update."""
        if uid in self.active_connections:
            tasks = []
            for websocket in list(self.active_connections[uid]):
                try:
                    tasks.append(websocket.send_json({
                        "type": "profile_picture_update",
                        "profile_picture_url": profile_picture_url
                    }))
                except Exception as e:
                    print(f"❌ Error sending profile picture update to {uid}: {e}")
                    await self.disconnect(uid, websocket)
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
                print(f"🖼️ Profile picture update sent to {uid}")
                return True
        return False