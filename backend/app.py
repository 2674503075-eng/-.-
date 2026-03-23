from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from typing import Callable, Awaitable

_PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_RESOURCE_DIR = getattr(sys, "_MEIPASS", _PROJECT_DIR)
_APP_DIR = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else _PROJECT_DIR

WEB_DIR = os.path.join(_RESOURCE_DIR, "web")
STATIC_DIR = os.path.join(WEB_DIR, "static")

UPLOAD_DIR = os.path.join(_APP_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

HISTORY_DIR = os.path.join(_APP_DIR, "history")
os.makedirs(HISTORY_DIR, exist_ok=True)

# 聊天记录存储路径
HISTORY_FILE = "chat_history.json"

# 1.5GB 上传限制
MAX_UPLOAD_SIZE = 1.5 * 1024 * 1024 * 1024
RECALL_TIMEOUT_MS = 3 * 60 * 1000
VALID_WS_TYPES = {
    "join",
    "rename",
    "chat",
    "private_chat",
    "file",
    "private_file",
    "recall",
    "typing",
    "clear_history",
    "webrtc_signal",
}

class LimitUploadSizeMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_size: int):
        super().__init__(app)
        self.max_size = max_size

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.method == 'POST' and request.headers.get("content-length"):
            try:
                content_length = int(request.headers["content-length"])
                if content_length > self.max_size:
                    return JSONResponse(
                        status_code=413, 
                        content={"detail": f"File too large. Limit is {self.max_size / 1024 / 1024:.0f} MB."}
                    )
            except Exception:
                pass
        response = await call_next(request)
        return response


def _alert(text: str) -> None:
    try:
        sys.stderr.write(f"\x1b[31m[ALERT]\x1b[0m {text}\n")
        sys.stderr.flush()
    except Exception:
        try:
            print(f"[ALERT] {text}", file=sys.stderr, flush=True)
        except Exception:
            pass


@dataclass
class SpamState:
    last_text: str = ""
    repeat_count: int = 0
    message_times: list[float] = field(default_factory=list)
    muted_until: float = 0.0


@dataclass(frozen=True)
class Client:
    uid: str
    username: str
    ws: WebSocket


app = FastAPI(title="LAN Chat")
app.add_middleware(LimitUploadSizeMiddleware, max_size=MAX_UPLOAD_SIZE)

_clients: dict[int, Client] = {}
_spam_states: dict[int, SpamState] = {}


# --- 文件传输 API ---
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        # 安全起见，对文件名进行处理
        safe_filename = f"{int(time.time())}_{os.path.basename(file.filename)}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        
        # 流式写入文件
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(8192): # 8KB 块
                buffer.write(chunk)
        
        return {"filename": safe_filename, "content_type": file.content_type}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.get("/uploads/{filename}")
async def get_file(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    return JSONResponse(status_code=404, content={"detail": "File not found"})
# ---------------------


def _get_user_history(uid: str) -> dict[str, list[dict[str, Any]]]:
    """获取指定用户的完整视图（公共群聊 + 个人私聊）"""
    res = {}
    
    # 1. 加载公共群聊
    pub_file = os.path.join(HISTORY_DIR, "history___public__.json")
    if os.path.exists(pub_file):
        try:
            with open(pub_file, "r", encoding="utf-8") as f:
                res.update(json.load(f))
        except: pass
    
    # 2. 加载用户个人记录（基于 UID 隔离）
    user_file = os.path.join(HISTORY_DIR, f"history_{uid}.json")
    if os.path.exists(user_file):
        try:
            with open(user_file, "r", encoding="utf-8") as f:
                user_data = json.load(f)
                for k, v in user_data.items():
                    if k == "group":
                        if isinstance(v, list) and len(v) == 0:
                            res[k] = v
                        continue
                    res[k] = v
        except: pass
    
    return res


def _add_to_history(channel: str, msg: dict[str, Any]) -> None:
    """
    添加消息到历史。
    channel 为 'group' 或 'uid1-uid2'
    """
    target_uids = []
    if channel == "group":
        target_uids = ["__public__"] 
    else:
        # 私聊消息：仅参与双方 UID
        target_uids = channel.split("-")

    for uid in target_uids:
        user_file = os.path.join(HISTORY_DIR, f"history_{uid}.json")
        history = {}
        if os.path.exists(user_file):
            try:
                with open(user_file, "r", encoding="utf-8") as f:
                    history = json.load(f)
            except: pass
        
        if channel not in history:
            history[channel] = []
        history[channel].append(msg)
        history[channel] = history[channel][-200:] # 限制 200 条
        
        try:
            with open(user_file, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except: pass


def _clear_history(uid: str, channel: str) -> None:
    """仅清空指定用户的某个频道记录，不影响他人。"""
    user_file = os.path.join(HISTORY_DIR, f"history_{uid}.json")
    history = {}
    if os.path.exists(user_file):
        try:
            with open(user_file, "r", encoding="utf-8") as f:
                history = json.load(f)
        except: pass
    
    history[channel] = []
    
    try:
        with open(user_file, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except: pass


def _load_history_file(uid: str) -> dict[str, list[dict[str, Any]]]:
    user_file = os.path.join(HISTORY_DIR, f"history_{uid}.json")
    if not os.path.exists(user_file):
        return {}
    try:
        with open(user_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception as e:
        _alert(f"读取历史文件失败: {user_file} | {e}")
    return {}


def _save_history_file(uid: str, history: dict[str, list[dict[str, Any]]]) -> None:
    user_file = os.path.join(HISTORY_DIR, f"history_{uid}.json")
    try:
        with open(user_file, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        _alert(f"写入历史文件失败: {user_file} | {e}")


def _try_revoke_uploaded_file(filename: str) -> None:
    if not filename:
        return
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        return
    try:
        os.remove(file_path)
        return
    except Exception:
        _alert(f"删除文件失败，将尝试重命名隔离: {file_path}")
    try:
        revoked_path = file_path + ".revoked"
        os.replace(file_path, revoked_path)
    except Exception:
        _alert(f"重命名隔离文件失败: {file_path}")


def _scan_and_mark_group_recalled(msg_id: str, requester_uid: str, now_ms: float) -> None:
    msg_id_str = str(msg_id)
    for name in os.listdir(HISTORY_DIR):
        if not name.startswith("history_") or not name.endswith(".json"):
            continue
        if name == "history___public__.json":
            continue
        name = os.path.join(HISTORY_DIR, name)
        try:
            with open(name, "r", encoding="utf-8") as f:
                history = json.load(f)
            if not isinstance(history, dict):
                continue
            msgs = history.get("group")
            if not isinstance(msgs, list) or len(msgs) == 0:
                continue
            changed = False
            for m in msgs:
                if not isinstance(m, dict):
                    continue
                if str(m.get("msg_id")) != msg_id_str:
                    continue
                if m.get("from_uid") != requester_uid:
                    continue
                m["is_recalled"] = True
                m["recalled_at"] = now_ms
                m["recalled_by_uid"] = requester_uid
                changed = True
            if changed:
                with open(name, "w", encoding="utf-8") as f:
                    json.dump(history, f, ensure_ascii=False, indent=2)
        except Exception:
            continue


def _find_msg_and_mark_recalled(
    history: dict[str, list[dict[str, Any]]],
    channel_key: str,
    msg_id: str,
    requester_uid: str,
    now_ms: float,
) -> tuple[bool, str | None, str | None]:
    msgs = history.get(channel_key, [])
    if not isinstance(msgs, list):
        return False, None, None
    for m in msgs:
        if not isinstance(m, dict):
            continue
        if str(m.get("msg_id")) != str(msg_id):
            continue
        if m.get("from_uid") != requester_uid:
            return False, None, "not_owner"
        ts = m.get("timestamp")
        try:
            ts_ms = float(ts)
        except Exception:
            ts_ms = None
        if ts_ms is None or now_ms - ts_ms > RECALL_TIMEOUT_MS:
            return False, None, "timeout"
        m["is_recalled"] = True
        m["recalled_at"] = now_ms
        m["recalled_by_uid"] = requester_uid
        file_info = m.get("file_info")
        if isinstance(file_info, dict):
            path = file_info.get("path")
            if isinstance(path, str) and path:
                return True, path, None
        return True, None, None
    return False, None, "not_found"


def _safe_text(value: Any, *, max_len: int) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if len(text) > max_len:
        text = text[:max_len]
    return text


async def _broadcast(payload: dict[str, Any]) -> None:
    dead: list[int] = []
    message = json.dumps(payload, ensure_ascii=False)
    for cid, client in list(_clients.items()):
        try:
            await client.ws.send_text(message)
        except Exception:
            dead.append(cid)
    for cid in dead:
        _clients.pop(cid, None)


async def _broadcast_user_list() -> None:
    # 发送 UID 和用户名对，让前端能区分同名用户
    users = [{"uid": c.uid, "username": c.username} for c in _clients.values()]
    await _broadcast({"type": "user_list", "users": users})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.websocket("/ws")
async def ws_chat(ws: WebSocket) -> None:
    await ws.accept()

    client_id = id(ws)
    _spam_states[client_id] = SpamState()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except Exception as e:
                _alert(f"收到非 JSON 数据，已忽略: {e}")
                continue

            msg_type = _safe_text(data.get("type"), max_len=20)
            if msg_type not in VALID_WS_TYPES:
                _alert(f"收到未知消息类型: {msg_type}")
                continue
            now = time.time()
            spam = _spam_states[client_id]

            # 检查是否处于禁言期
            if spam.muted_until > now:
                remaining = int(spam.muted_until - now)
                await ws.send_text(json.dumps({
                    "type": "system",
                    "text": f"你已被禁言，还剩 {remaining} 秒",
                    "from": "系统"
                }, ensure_ascii=False))
                continue

            if msg_type in ("chat", "private_chat", "file", "private_file"):
                # 文本消息检查
                if msg_type in ("chat", "private_chat"):
                    text = _safe_text(data.get("text"), max_len=1000)
                    if not text:
                        continue

                    # 1. 检测连续相同内容
                    if text == spam.last_text:
                        spam.repeat_count += 1
                    else:
                        spam.last_text = text
                        spam.repeat_count = 1

                    # 2. 检测发送频率 (10秒内超过15条)
                    spam.message_times = [t for t in spam.message_times if now - t < 10]
                    spam.message_times.append(now)

                    # 禁言判定
                    mute_reason = ""
                    if spam.repeat_count >= 3: # 连续3次相同内容
                        mute_reason = "快速连续发送相同文字"
                    elif len(spam.message_times) >= 15: # 10秒内超过15条
                        mute_reason = "发送消息过于频繁"

                    if mute_reason:
                        spam.muted_until = now + 10 # 禁言10秒
                        spam.repeat_count = 0
                        spam.message_times = []
                        await ws.send_text(json.dumps({
                            "type": "system",
                            "text": f"检测到{mute_reason}，禁言 10 秒",
                            "from": "系统"
                        }, ensure_ascii=False))
                        continue

            if msg_type == "join":
                requested_name = _safe_text(data.get("username"), max_len=24) or "匿名"
                uid = _safe_text(data.get("uid"), max_len=64)
                if not uid:
                    uid = f"u_{int(now*1000)}_{client_id}"
                
                # 模仿微信/QQ：昵称可以重复，不进行后缀处理
                _clients[client_id] = Client(uid=uid, username=requested_name, ws=ws)
                
                # 通知客户端其最终确定的 UID 和昵称
                await ws.send_text(json.dumps({"type": "set_username", "username": requested_name, "uid": uid}, ensure_ascii=False))
                
                await _broadcast({"type": "system", "text": f"{requested_name} 加入了聊天室", "from": "系统"})
                await _broadcast_user_list()
                
                # 发送该用户可见的历史记录
                history = _get_user_history(uid)
                await ws.send_text(json.dumps({"type": "history", "history": history}, ensure_ascii=False))
                continue

            if msg_type == "rename":
                requested_name = _safe_text(data.get("username"), max_len=24) or "匿名"
                if client_id not in _clients: continue
                
                client = _clients[client_id]
                old_name = client.username
                if requested_name == old_name:
                    continue
                    
                # 更新昵称，UID 保持不变
                _clients[client_id] = Client(uid=client.uid, username=requested_name, ws=ws)
                
                await ws.send_text(json.dumps({"type": "set_username", "username": requested_name, "uid": client.uid}, ensure_ascii=False))
                await _broadcast({"type": "system", "text": f"{old_name} 改名为 {requested_name}", "from": "系统"})
                await _broadcast_user_list()
                continue

            if msg_type == "file" or msg_type == "private_file":
                if client_id not in _clients: continue
                client = _clients[client_id]
                file_info = data.get("file_info")
                msg_id = data.get("msg_id")
                if not file_info or not msg_id:
                    _alert("文件消息缺少 file_info 或 msg_id")
                    continue

                payload = {
                    "type": "file",
                    "from": client.username,
                    "from_uid": client.uid,
                    "msg_id": msg_id,
                    "file_info": file_info,
                    "timestamp": now * 1000
                }

                if msg_type == "private_file":
                    to_uid = _safe_text(data.get("to_uid"), max_len=64)
                    if not to_uid: continue
                    payload["to_uid"] = to_uid
                    channel_name = "-".join(sorted([client.uid, to_uid]))
                    _add_to_history(channel_name, payload)
                    message = json.dumps(payload, ensure_ascii=False)
                    to_client = next((c for c in _clients.values() if c.uid == to_uid), None)
                    try:
                        await client.ws.send_text(message)
                        if to_client:
                            await to_client.ws.send_text(message)
                    except Exception: pass
                else:
                    _add_to_history("group", payload)
                    await _broadcast(payload)
                continue

            if msg_type == "webrtc_signal":
                to_uid = _safe_text(data.get("to_uid"), max_len=64)
                if not to_uid or client_id not in _clients: continue
                
                from_client = _clients[client_id]
                to_client = next((c for c in _clients.values() if c.uid == to_uid), None)

                if to_client:
                    payload = {
                        "type": "webrtc_signal",
                        "from_uid": from_client.uid,
                        "signal": data.get("signal")
                    }
                    try:
                        await to_client.ws.send_text(json.dumps(payload, ensure_ascii=False))
                    except Exception: pass
                continue

            if msg_type == "chat":
                if client_id not in _clients: continue
                client = _clients[client_id]

                text = _safe_text(data.get("text"), max_len=1000)
                msg_id = data.get("msg_id")
                if not text: continue

                msg_payload = {
                    "type": "chat",
                    "from": client.username,
                    "from_uid": client.uid,
                    "text": text,
                    "msg_id": msg_id,
                    "timestamp": now * 1000
                }
                _add_to_history("group", msg_payload)
                await _broadcast(msg_payload)
                continue

            if msg_type == "recall":
                msg_id = data.get("msg_id")
                to_uid = _safe_text(data.get("to_uid"), max_len=64) # 使用 to_uid 而不是 to_username
                
                if not msg_id or client_id not in _clients:
                    _alert("撤回消息缺少 msg_id 或客户端未注册")
                    continue

                client = _clients[client_id]
                now_ms = now * 1000
                msg_id_str = str(msg_id)

                if to_uid:
                    channel_key = "-".join(sorted([client.uid, to_uid]))
                    target_uids = [client.uid, to_uid]
                else:
                    channel_key = "group"
                    target_uids = ["__public__"]

                delete_filename: str | None = None
                marked_any = False
                failure_reason: str | None = None

                for uid in target_uids:
                    history = _load_history_file(uid)
                    marked, maybe_filename, reason = _find_msg_and_mark_recalled(
                        history, channel_key, msg_id_str, client.uid, now_ms
                    )
                    if marked:
                        marked_any = True
                        if maybe_filename:
                            delete_filename = maybe_filename
                        _save_history_file(uid, history)
                    elif reason and reason != "not_found":
                        failure_reason = reason

                if failure_reason == "not_owner":
                    await ws.send_text(json.dumps({"type": "system", "text": "只能撤回自己发送的消息", "from": "系统"}, ensure_ascii=False))
                    continue
                if failure_reason == "timeout":
                    await ws.send_text(json.dumps({"type": "system", "text": "该消息已超过可撤回时间", "from": "系统"}, ensure_ascii=False))
                    continue

                if delete_filename and marked_any:
                    _try_revoke_uploaded_file(delete_filename)
                    if channel_key == "group":
                        _scan_and_mark_group_recalled(msg_id_str, client.uid, now_ms)

                payload = {
                    "type": "recall",
                    "from": client.username,
                    "from_uid": client.uid,
                    "msg_id": msg_id_str
                }
                
                if to_uid:
                    payload["to_uid"] = to_uid
                    message = json.dumps(payload, ensure_ascii=False)
                    # 发送给双方
                    for c in _clients.values():
                        if c.uid in (to_uid, client.uid):
                            try:
                                await c.ws.send_text(message)
                            except Exception: pass
                else:
                    await _broadcast(payload)
                continue

            if msg_type == "typing":
                to_uid = _safe_text(data.get("to_uid"), max_len=64)
                if not to_uid or client_id not in _clients:
                    continue
                client = _clients[client_id]
                to_client = next((c for c in _clients.values() if c.uid == to_uid), None)
                if to_client:
                    await to_client.ws.send_text(json.dumps({
                        "type": "typing",
                        "from": client.username,
                        "from_uid": client.uid
                    }, ensure_ascii=False))
                continue

            if msg_type == "private_chat":
                to_uid = _safe_text(data.get("to_uid"), max_len=64)
                text = _safe_text(data.get("text"), max_len=1000)
                msg_id = data.get("msg_id")

                if not to_uid or not text or client_id not in _clients:
                    continue

                from_client = _clients[client_id]
                to_client = next((c for c in _clients.values() if c.uid == to_uid), None)

                if from_client:
                    payload = {
                        "type": "private_chat",
                        "from": from_client.username,
                        "from_uid": from_client.uid,
                        "to_uid": to_uid,
                        "text": text,
                        "msg_id": msg_id,
                        "timestamp": now * 1000
                    }
                    # 确定私聊频道名称 (UID 排序保证一致性)
                    channel_name = "-".join(sorted([from_client.uid, to_uid]))
                    _add_to_history(channel_name, payload)
                    
                    message = json.dumps(payload, ensure_ascii=False)
                    try:
                        await from_client.ws.send_text(message)
                        if to_client:
                            await to_client.ws.send_text(message)
                    except Exception: pass
                continue

            if msg_type == "clear_history":
                channel = _safe_text(data.get("channel"), max_len=100)
                if not channel or client_id not in _clients: continue
                _clear_history(_clients[client_id].uid, channel)
                await ws.send_text(json.dumps({"type": "system", "text": "已清空该频道历史记录", "from": "系统"}))
                continue

    except WebSocketDisconnect:
        pass
    finally:
        _spam_states.pop(client_id, None)
        client = _clients.pop(client_id, None)
        if client:
            await _broadcast({"type": "system", "text": f"{client.username} 离开了聊天室", "from": "系统"})
            await _broadcast_user_list()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
