# 局域网聊天（服务端 + 网页端）

这是一个在局域网内使用的聊天室：后端使用 FastAPI + WebSocket，前端是纯静态网页（HTML/CSS/JS）。服务启动后，局域网内任意设备用浏览器访问即可使用。

## 目录结构

- `backend/app.py`：后端服务（HTTP + WebSocket），并负责静态资源与上传文件路由
- `web/`：前端页面（`index.html` + `static/`）
- `uploads/`：上传文件存储目录（运行后自动创建）
- `history/`：聊天记录存储目录（运行后自动创建）
- `lan_chat_launcher.py`：启动入口（便于打包成 exe，并会自动打开浏览器）
- `dist/`：打包输出目录（生成后存在）

## 运行方式（推荐）

### 方式 A：直接运行 exe（无需 Python 环境）

双击运行：

- `dist/LANChat.exe`

运行后会：

- 启动服务：`http://0.0.0.0:8000`
- 自动打开浏览器：`http://127.0.0.1:8000/`

### 方式 B：源码运行（Windows PowerShell）

在项目根目录执行：

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
py -3 lan_chat_launcher.py
```

如果你不想自动打开浏览器，也可以用 uvicorn 启动：

```powershell
py -3 -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

注意：不要在 `--port 8000` 后面加反斜杠 `\`，否则会报：

```text
Invalid value for '--port': '8000\' is not a valid integer.
```

## 访问方式（局域网）

- 本机访问：`http://127.0.0.1:8000/`
- 局域网其他设备访问：`http://你的服务器IP:8000/`

查看本机 IP（选一个局域网网卡的 IPv4）：

```powershell
ipconfig
```

## 关闭服务（释放端口 8000）

### 方法 1：在运行窗口停止

在运行服务的 PowerShell/控制台窗口按：

```text
Ctrl + C
```

### 方法 2：端口被占用时强制结束（WinError 10048）

1) 找出占用 8000 的 PID：

```powershell
netstat -ano | findstr :8000
```

你会看到类似：

```text
TCP    0.0.0.0:8000    0.0.0.0:0    LISTENING    12345
```

2) 强制结束该 PID：

```powershell
taskkill /F /PID 12345
```

## 验证服务是否正常

### HTTP 是否正常（返回 200）

```powershell
powershell -NoProfile -Command "(Invoke-WebRequest -UseBasicParsing http://localhost:8000/).StatusCode"
```

输出 `200` 表示正常。

### 端口是否在监听

```powershell
netstat -ano | findstr :8000
```

看到 `LISTENING` 表示服务已运行。

## 数据与文件存储位置

程序会把“可写数据”放在启动目录下：

- 源码运行：项目根目录下的 `history/` 与 `uploads/`
- exe 运行：`LANChat.exe` 同目录下的 `history/` 与 `uploads/`

### 聊天记录

聊天记录都在 `history/` 目录中：

- 群聊公共池（如存在）：`history/history___public__.json`
- 每个用户独立文件（按 UID 隔离）：`history/history_<uid>.json`

### 上传文件

上传的文件位于：

- `uploads/`

文件撤回时会尝试删除上传文件；若删除失败，会改名为 `.revoked` 让链接立刻失效。

## 清空数据（恢复“出厂”）

建议先停服再清理。

### 方式 A：在界面内清除单个聊天频道

在左侧用户列表里，对某个频道（群聊/私聊用户）右键，选择“清除聊天记录”。

说明：这是按频道清空，只影响当前服务器保存的对应频道记录。

### 方式 B：手动清空全部聊天记录

删除 `history/` 目录下的所有 `history*.json` 文件。

### 方式 C：清空聊天记录 + 上传文件

- 清空 `history/` 下所有历史文件
- 清空 `uploads/` 下所有文件

## 打包成 exe（开发者）

在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe -m pip install -U pyinstaller
.\.venv\Scripts\pyinstaller.exe --noconfirm --clean --onefile --name LANChat --add-data "web;web" lan_chat_launcher.py
```

生成文件位置：

- `dist/LANChat.exe`

## 常见问题

### 1) 局域网其他设备打不开

- 确认用的是服务器的局域网 IP（不是 `127.0.0.1`）
- 在 Windows 防火墙中放行 `8000` 端口（或允许 `LANChat.exe` / Python / uvicorn 通过）

### 2) 麦克风权限（语音通话）无法获取

多数浏览器要求 HTTPS 或 localhost 才允许获取麦克风（`getUserMedia`）。如果你用 `http://192.168.x.x:8000` 打开，可能会被限制。
