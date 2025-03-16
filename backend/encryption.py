from Crypto.Cipher import AES
import base64
import os

SECRET_KEY = os.getenv("SECRET_KEY", "thisisaverysecretkey!")[:16]  # 16-byte key

def encrypt_message(message: str) -> str:
    """Encrypts a message using AES."""
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX)
    nonce = cipher.nonce
    ciphertext, tag = cipher.encrypt_and_digest(message.encode())
    return base64.b64encode(nonce + ciphertext).decode()

def decrypt_message(encrypted_message: str) -> str:
    """Decrypts a message using AES."""
    data = base64.b64decode(encrypted_message)
    nonce = data[:16]
    ciphertext = data[16:]
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX, nonce=nonce)
    return cipher.decrypt(ciphertext).decode()
