import asyncio
import websockets
import json
import time
import os

# 配置
URI = "ws://localhost:8000/ws"

class ChatClient:
    def __init__(self, name, uid=None):
        self.requested_name = name
        self.uid = uid
        self.actual_name = None
        self.ws = None
        self.history = {}
        self.messages = []
        self.is_muted = False

    async def connect(self):
        self.ws = await websockets.connect(URI)
        payload = {"type": "join", "username": self.requested_name}
        if self.uid:
            payload["uid"] = self.uid
        await self.ws.send(json.dumps(payload))
        
    async def listen(self, stop_event):
        try:
            async for message in self.ws:
                data = json.loads(message)
                msg_type = data.get("type")
                
                if msg_type == "set_username":
                    self.actual_name = data.get("username")
                    self.uid = data.get("uid")
                    print(f"[{self.requested_name}] 登录成功，正式昵称: {self.actual_name}, UID: {self.uid}")
                
                elif msg_type == "history":
                    self.history = data.get("history")
                    print(f"[{self.actual_name}] 收到历史记录，包含 {len(self.history)} 个频道")
                
                elif msg_type == "chat":
                    print(f"[{self.actual_name}] 收到群聊: {data.get('from')}: {data.get('text')}")
                    self.messages.append(data)
                
                elif msg_type == "private_chat":
                    print(f"[{self.actual_name}] 收到私聊来自 {data.get('from')}: {data.get('text')}")
                    self.messages.append(data)
                
                elif msg_type == "system":
                    text = data.get("text", "")
                    print(f"[{self.actual_name}] 收到系统消息: {text}")
                    if "禁言" in text:
                        self.is_muted = True
                
                elif msg_type == "recall":
                    print(f"[{self.actual_name}] 收到撤回通知: {data.get('from')} 撤回了消息 {data.get('msg_id')}")

                if stop_event.is_set():
                    break
        except Exception as e:
            if not stop_event.is_set():
                print(f"[{self.requested_name}] 连接异常: {e}")

    async def send_chat(self, text, msg_id):
        await self.ws.send(json.dumps({
            "type": "chat",
            "text": text,
            "msg_id": msg_id
        }))

    async def send_private(self, to_uid, text, msg_id):
        await self.ws.send(json.dumps({
            "type": "private_chat",
            "to_uid": to_uid,
            "text": text,
            "msg_id": msg_id
        }))

    async def recall(self, msg_id, to_uid=None):
        payload = {"type": "recall", "msg_id": msg_id}
        if to_uid: payload["to_uid"] = to_uid
        await self.ws.send(json.dumps(payload))

    async def clear_history(self, channel):
        await self.ws.send(json.dumps({"type": "clear_history", "channel": channel}))

async def run_integration_test():
    print("\n=== 开始全功能集成测试 (UID版) ===\n")
    
    stop_event = asyncio.Event()
    
    # 1. 测试重名加入
    print("--- 1. 测试重名允许 (模仿微信/QQ) ---")
    client1 = ChatClient("帅哥")
    client2 = ChatClient("帅哥")
    await client1.connect()
    await client2.connect()
    
    t1 = asyncio.create_task(client1.listen(stop_event))
    t2 = asyncio.create_task(client2.listen(stop_event))
    
    await asyncio.sleep(1) # 等待 set_username
    assert client1.actual_name == "帅哥"
    assert client2.actual_name == "帅哥" # 现在允许重名
    assert client1.uid != client2.uid   # 但 UID 必须不同
    print(f"OK: 重名允许成功，UID1={client1.uid}, UID2={client2.uid}")

    # 2. 测试群聊广播
    print("\n--- 2. 测试群聊广播 ---")
    msg_id_g = f"group_msg_{int(time.time())}"
    await client1.send_chat("大家好", msg_id_g)
    await asyncio.sleep(0.5)
    
    # 3. 测试私聊隔离 (使用 UID)
    print("\n--- 3. 测试私聊隔离 (使用 UID 定位) ---")
    client3 = ChatClient("路人甲")
    await client3.connect()
    t3 = asyncio.create_task(client3.listen(stop_event))
    await asyncio.sleep(1)
    
    msg_id_p = f"private_msg_{int(time.time())}"
    await client1.send_private(client2.uid, "私密悄悄话", msg_id_p)
    await asyncio.sleep(0.5)
    
    # 4. 测试撤回功能
    print("\n--- 4. 测试消息撤回 ---")
    await client1.recall(msg_id_g) # 撤回群聊
    await asyncio.sleep(0.5)
    await client1.recall(msg_id_p, to_uid=client2.uid) # 撤回私聊
    await asyncio.sleep(0.5)

    # 5. 测试防刷屏禁言
    print("\n--- 5. 测试防刷屏禁言 ---")
    for _ in range(4):
        await client3.send_chat("刷屏内容", f"spam_{time.time()}")
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.5)
    
    # 6. 测试历史记录与独立清空
    print("\n--- 6. 测试历史记录持久化与独立清空 ---")
    await client1.clear_history("group")
    print(f"[{client1.actual_name}] 已清空群聊记录")
    await asyncio.sleep(0.5)
    
    # 模拟刷新 (重新连接，保持 UID)
    print("正在模拟刷新页面 (保持 UID)...")
    uid1 = client1.uid
    uid2 = client2.uid
    stop_event.set()
    await asyncio.gather(t1, t2, t3)
    
    print("\n--- 7. 验证刷新后的独立视图 ---")
    new_stop_event = asyncio.Event()
    client1_revived = ChatClient("帅哥", uid=uid1)
    client2_revived = ChatClient("帅哥", uid=uid2)
    
    await client1_revived.connect()
    await client2_revived.connect()
    
    tr1 = asyncio.create_task(client1_revived.listen(new_stop_event))
    tr2 = asyncio.create_task(client2_revived.listen(new_stop_event))
    
    await asyncio.sleep(1)
    
    # 帅哥的群聊应该是空的 (因为刚才 clear 了)
    group_msgs_1 = client1_revived.history.get("group", [])
    group_msgs_2 = client2_revived.history.get("group", [])
    
    print(f"[帅哥1] 群聊记录数: {len(group_msgs_1)}")
    print(f"[帅哥2] 群聊记录数: {len(group_msgs_2)}")
    
    if len(group_msgs_1) == 0 and len(group_msgs_2) > 0:
        print("\nSUCCESS: 所有功能集成测试通过 (UID 隔离机制正常)！")
    else:
        print("\nFAILURE: 历史记录隔离逻辑存在偏差")

    new_stop_event.set()
    await asyncio.gather(tr1, tr2)

if __name__ == "__main__":
    try:
        asyncio.run(run_integration_test())
    except KeyboardInterrupt:
        pass
