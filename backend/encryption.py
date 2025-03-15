from Crypto.Cipher import AES
import base64
import os

SECRET_KEY = os.getenv("AES_SECRET_KEY", "thisisaverysecretkey")[:16]  # Must be 16 bytes

def encrypt_message(message):
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX)
    ciphertext, tag = cipher.encrypt_and_digest(message.encode())
    return base64.b64encode(cipher.nonce + tag + ciphertext).decode()

def decrypt_message(encrypted_message):
    decoded = base64.b64decode(encrypted_message)
    nonce, tag, ciphertext = decoded[:16], decoded[16:32], decoded[32:]
    cipher = AES.new(SECRET_KEY.encode(), AES.MODE_EAX, nonce=nonce)
    return cipher.decrypt_and_verify(ciphertext, tag).decode()

