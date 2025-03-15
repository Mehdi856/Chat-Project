from fastapi import FastAPI, HTTPException
from database import create_user, login_user

app = FastAPI()

@app.post("/register")
def register(email: str, username: str, password: str):
    return create_user(email, username, password)

@app.post("/login")
def login(email: str, password: str):
    return login_user(email, password)
 
