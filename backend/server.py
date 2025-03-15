from fastapi import FastAPI, WebSocket
import uvicorn

app = FastAPI()

clients = []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)

    try:
        while True:
            message = await websocket.receive_text()
            for client in clients:
                if client != websocket:
                    await client.send_text(message)
    except:
        clients.remove(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

"# Restarting Render" 
