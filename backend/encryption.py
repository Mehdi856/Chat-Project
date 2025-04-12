from Crypto.Cipher import AES
import base64
import os

SECRET_KEY = os.getenv("SECRET_KEY")  # 🔥 Must be set in environment variables!

if not SECRET_KEY or len(SECRET_KEY) < 16:
    raise ValueError("SECRET_KEY environment variable must be at least 16 bytes long.")

SECRET_KEY = SECRET_KEY[:16]  # Ensure it's exactly 16 bytes

def encrypt_message(message: str) -> str:
    """Encrypts a message using AES."""
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX)
    nonce = cipher.nonce
    ciphertext, tag = cipher.encrypt_and_digest(message.encode())
    # Include the tag in the encrypted data
    return base64.b64encode(nonce + tag + ciphertext).decode()

def decrypt_message(encrypted_message: str) -> str:
    """Decrypts a message using AES."""
    data = base64.b64decode(encrypted_message)
    nonce = data[:16]
    tag = data[16:32]  # Extract the tag
    ciphertext = data[32:]
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX, nonce=nonce)
    # Verify the tag during decryption
    plaintext = cipher.decrypt_and_verify(ciphertext, tag)
    return plaintext.decode()

def encrypt_file(file_bytes: bytes) -> bytes:
    """Encrypts binary file data (e.g., image or PDF)."""
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX)
    nonce = cipher.nonce
    ciphertext, tag = cipher.encrypt_and_digest(file_bytes)
    # Store nonce + tag + ciphertext
    return nonce + tag + ciphertext

def decrypt_file(encrypted_bytes: bytes) -> bytes:
    """Decrypts binary file data (e.g., image or PDF)."""
    nonce = encrypted_bytes[:16]
    tag = encrypted_bytes[16:32]
    ciphertext = encrypted_bytes[32:]
    
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX, nonce=nonce)
    # Verify the tag during decryption
    return cipher.decrypt_and_verify(ciphertext, tag)