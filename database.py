import firebase_admin
from firebase_admin import credentials, firestore


cred = credentials.Certificate(r"C:\Users\abdou\PProjects\Chat-Project\backend\config\firebase-key.json")
firebase_admin.initialize_app(cred)

# Connect to Firestore
db = firestore.client()

# Function to create a new user in Firestore
def create_user(user_id, email, username):
    user_ref = db.collection("users").document(user_id)
    user_ref.set({
        "email": email,
        "username": username
    })

# Function to store messages
def save_message(sender_id, receiver_id, message):
    messages_ref = db.collection("messages").document()
    messages_ref.set({
        "sender": sender_id,
        "receiver": receiver_id,
        "message": message
    });