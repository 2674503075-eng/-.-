import asyncio
import websockets
import json

async def test_private_recall():
    uri = "ws://localhost:8000/ws"
    try:
        async with websockets.connect(uri) as ws1, \
                   websockets.connect(uri) as ws2:
            
            # User1 Join
            await ws1.send(json.dumps({"type": "join", "username": "User1"}))
            # User2 Join
            await ws2.send(json.dumps({"type": "join", "username": "User2"}))
            
            # User1 send private message to User2
            msg_id = "private_id_001"
            await ws1.send(json.dumps({
                "type": "private_chat", 
                "from": "User1", 
                "to": "User2", 
                "text": "Secret Message", 
                "msg_id": msg_id
            }))
            
            # Listen on ws2 for the private message
            while True:
                msg = await ws2.recv()
                data = json.loads(msg)
                print(f"User2 received: {data}")
                if data.get('type') == 'private_chat' and data.get('text') == 'Secret Message':
                    if data.get('msg_id') == msg_id:
                        print("OK: Received private chat with msg_id")
                        break

            # User1 recall private message
            await ws1.send(json.dumps({
                "type": "recall", 
                "msg_id": msg_id, 
                "to": "User2" # Private recall needs 'to'
            }))
            
            # Listen on ws2 for the recall message
            while True:
                msg = await ws2.recv()
                data = json.loads(msg)
                print(f"User2 received: {data}")
                if data.get('type') == 'recall':
                    if data.get('msg_id') == msg_id:
                        print("SUCCESS: Private recall received on client 2")
                        return

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_private_recall())
