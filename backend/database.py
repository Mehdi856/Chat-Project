import firebase_admin
from firebase_admin import credentials, firestore
import os
import json
import bcrypt
import sys  # ✅ Import sys to flush logs immediately

# 🔥 Load Firebase credentials from environment variable
firebase_config = os.getenv("FIREBASE_CONFIG")

if firebase_config:
    try:
        cred_dict = json.loads(firebase_config)  # Convert string to dictionary
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        print("🔥 Firebase is Connected!")  
        sys.stdout.flush()  # ✅ Force log to show in Render
    except Exception as e:
        print(f"❌ Firebase Initialization Failed: {e}")
        sys.stdout.flush()
else:
    print("❌ FIREBASE_CONFIG environment variable is missing!")
    sys.stdout.flush()

db = firestore.client()

 
