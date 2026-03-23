import asyncio
import websockets
import json
import time

async def client_task(name, uri, actions):
    """
    模拟一个用户的行为
    actions: 一个包含 (delay, action_type, payload) 的列表
    """
    async with websockets.connect(uri) as ws:
        # 1. Join
        await ws.send(json.dumps({"type": "join", "username": name}))
        print(f"[{name}] 已加入聊天室")
        
        # 启动一个后台任务来持续接收消息
        async def receiver():
            try:
                while True:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    msg_type = data.get('type')
                    from_user = data.get('from', '系统')
                    text = data.get('text', '')
                    msg_id = data.get('msg_id', '')
                    
                    if msg_type == 'chat':
                        print(f"[{name}] 收到群聊来自 {from_user}: {text} (ID: {msg_id})")
                    elif msg_type == 'private_chat':
                        print(f"[{name}] 收到私聊来自 {from_user}: {text} (ID: {msg_id})")
                    elif msg_type == 'recall':
                        print(f"[{name}] 收到撤回通知: {from_user} 撤回了消息 {msg_id}")
                    elif msg_type == 'system':
                        print(f"[{name}] 收到系统消息: {text}")
                    elif msg_type == 'typing':
                        print(f"[{name}] 收到正在输入: {from_user} 正在输入...")
            except websockets.exceptions.ConnectionClosed:
                pass

        recv_task = asyncio.create_task(receiver())

        # 2. 执行预定动作
        for delay, action_type, payload in actions:
            await asyncio.sleep(delay)
            if action_type == 'send_chat':
                p = {"type": "chat", "username": name, "text": payload['text'], "msg_id": payload['msg_id']}
                await ws.send(json.dumps(p))
                print(f"[{name}] 发送群聊: {payload['text']}")
            elif action_type == 'send_private':
                p = {"type": "private_chat", "from": name, "to": payload['to'], "text": payload['text'], "msg_id": payload['msg_id']}
                await ws.send(json.dumps(p))
                print(f"[{name}] 发送私聊给 {payload['to']}: {payload['text']}")
            elif action_type == 'recall':
                p = {"type": "recall", "msg_id": payload['msg_id']}
                if 'to' in payload: p['to'] = payload['to']
                await ws.send(json.dumps(p))
                print(f"[{name}] 撤回消息: {payload['msg_id']}")
            elif action_type == 'typing':
                p = {"type": "typing", "to": payload['to']}
                await ws.send(json.dumps(p))
                print(f"[{name}] 正在输入给 {payload['to']}...")

        # 等待一会儿观察后续消息
        await asyncio.sleep(2)
        recv_task.cancel()

async def main():
    uri = "ws://localhost:8000/ws"
    
    # 定义 3 个用户的动作序列
    # 用户 A: 发群聊 -> 撤回群聊 -> 私聊 B
    actions_a = [
        (1, 'send_chat', {'text': '大家好，我是 A', 'msg_id': 'a_group_1'}),
        (1, 'recall', {'msg_id': 'a_group_1'}),
        (2, 'send_private', {'to': 'User_B', 'text': '嘿 B，这是私聊', 'msg_id': 'a_private_b_1'})
    ]
    
    # 用户 B: 收到 A 消息 -> 给 A 发正在输入 -> 回复 A 私聊
    actions_b = [
        (4, 'typing', {'to': 'User_A'}),
        (1, 'send_private', {'to': 'User_A', 'text': '收到 A，我是 B', 'msg_id': 'b_private_a_1'})
    ]
    
    # 用户 C: 观察群聊和撤回 -> 发个群聊
    actions_c = [
        (6, 'send_chat', {'text': '我是 C，我看到了 A 撤回了消息', 'msg_id': 'c_group_1'})
    ]

    print("--- 开始 3 用户模拟测试 ---")
    await asyncio.gather(
        client_task("User_A", uri, actions_a),
        client_task("User_B", uri, actions_b),
        client_task("User_C", uri, actions_c)
    )
    print("--- 测试结束 ---")

if __name__ == "__main__":
    asyncio.run(main())
