document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  // DOM 元素
  const connState = $("connState");
  const usernameEl = $("username");
  const connectBtn = $("connectBtn");
  const messagesEl = $("messages");
  const textEl = $("text");
  const sendBtn = $("sendBtn");
  const userListEl = $("userList");
  const userCountEl = $("userCount");
  const chatTitleEl = document.querySelector(".title"); // 使用 querySelector 因为是 class
  const emojiBtn = $("emojiBtn");
  const emojiPicker = $("emojiPicker");
  const contextMenu = $("contextMenu");
  const recallBtn = $("recallBtn");
  const userContextMenu = $("userContextMenu");
  const clearHistoryBtn = $("clearHistoryBtn");
  const fileBtn = $("fileBtn");
  const fileInput = $("fileInput");
  const dragDropOverlay = $("dragDropOverlay");
  const micPermissionModal = $("micPermissionModal");
  const micModalTitle = $("micModalTitle");
  const micModalText = $("micModalText");
  const micAllowBtn = $("micAllowBtn");
  const micDenyBtn = $("micDenyBtn");
  
  // 记录当前右键选中的消息 ID 和 频道
  let contextTarget = { msg_id: null, channel: null };
  // 记录侧边栏右键选中的频道
  let sidebarTargetChannel = null;

  // 状态管理
  const userSearch = $("userSearch");

  // 状态管理
  let ws = null;
  let username = localStorage.getItem("chat_username") || "";
  let myUid = localStorage.getItem("chat_uid") || ""; // 引入 UID
  if (username) usernameEl.value = username;
  
  let activeChannel = "group";
  const chatState = {
    group: { messages: [], lastMsg: "", unread: 0, name: "群聊" },
  };

  // 记录在线用户 UID -> Username
  let onlineUsers = {};

  let lastMessageTime = {};
  const TIME_GAP = 3 * 60 * 1000;
  const RECALL_TIMEOUT = 3 * 60 * 1000; // 统一为 3 分钟
  let typingTimer = null;

  const EMOJIS = [
    "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃",
    "😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙",
    "🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫",
    "🤔","🙄","😏","😒","😞","😔","😟","😕","🙁","☹️",
    "😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡",
    "🤬","😳","🥵","🥶","😱","😨","😰","😥","😓","🤯",
    "😴","🥱","😪","😵","🤐","🥴","🤢","🤮","🤧","😷",
    "🤒","🤕","🫠","🫡","🫢","🫣","🫥","😎","🤓","🧐",
    "👍","👎","👌","🤌","🤏","✌️","🤞","🤟","🤘","👋",
    "🤚","🖐️","✋","🫶","👏","🙌","🙏","💪","🧠","🫀",
    "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔",
    "🔥","✨","💫","⭐","🌟","🎉","🎊","🎈","🎁","🥳",
    "🌹","🌻","🌸","🍀","🍎","🍉","🍓","🍰","🍫","☕",
    "🐶","🐱","🐻","🐼","🐷","🐸","🐵","🦊","🐯","🦁",
    "⚽","🏀","🏓","🎮","🎵","🎶","🎤","🎧","📌","📎",
    "✅","❌","⚠️","❓","❗","💯","🌈","☀️","🌙","🌧️"
  ];

  const STICKERS = [
    { id: "party", label: "🎉", anim: "pop" },
    { id: "love", label: "💖", anim: "bounce" },
    { id: "fire", label: "🔥", anim: "wiggle" },
    { id: "ok", label: "👌", anim: "bounce" },
    { id: "clap", label: "👏", anim: "wiggle" },
    { id: "laugh", label: "🤣", anim: "bounce" },
    { id: "shock", label: "😱", anim: "wiggle" },
    { id: "think", label: "🤔", anim: "wiggle" },
    { id: "cool", label: "😎", anim: "pop" },
    { id: "star", label: "✨", anim: "spin" },
    { id: "gift", label: "🎁", anim: "bounce" },
    { id: "cat", label: "🐱", anim: "wiggle" },
    { id: "dog", label: "🐶", anim: "wiggle" },
    { id: "rocket", label: "🚀", anim: "spin" },
    { id: "rainbow", label: "🌈", anim: "bounce" },
  ];

  // 头像颜色生成
  const getAvatarColor = (name) => {
    if (name === "群聊" || name === "系统") return "var(--accent)";
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ["#4f8cff", "#07c160", "#f5a623", "#ff6b6b", "#b620e0", "#00d1b2", "#ff4757", "#2f3542"];
    return colors[Math.abs(hash) % colors.length];
  };

  const nowTime = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const renderMessageHtml = (text) => {
    const raw = text == null ? "" : String(text);
    let html = escapeHtml(raw);
    for (const s of STICKERS) {
      const token = `[[sticker:${s.id}]]`;
      const re = new RegExp(escapeRegExp(escapeHtml(token)), "g");
      html = html.replace(re, `<span class="sticker ${s.anim}">${escapeHtml(s.label)}</span>`);
    }
    return html;
  };

  // 浏览器通知
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  const showNotification = (from, text) => {
    if (document.visibilityState === "hidden" && Notification.permission === "granted") {
      new Notification(`新消息来自 ${from}`, { body: text, icon: "/static/favicon.ico" });
    }
  };

  const consoleAlert = (text, extra) => {
    try {
      console.error(`%c${text}`, "color:#ff4757;font-weight:700;", extra || "");
    } catch (_) {}
  };

  // 初始化表情选择器
  const initEmojis = () => {
    emojiPicker.innerHTML = "";
    STICKERS.forEach((s) => {
      const span = document.createElement("span");
      span.className = `emoji-item animated`;
      span.textContent = s.label;
      span.onclick = () => {
        textEl.value += `[[sticker:${s.id}]]`;
        emojiPicker.classList.remove("visible");
        textEl.focus();
        handleTyping();
      };
      emojiPicker.appendChild(span);
    });
    EMOJIS.forEach(emoji => {
      const span = document.createElement("span");
      span.className = "emoji-item";
      span.textContent = emoji;
      span.onclick = () => {
        textEl.value += emoji;
        emojiPicker.classList.remove("visible");
        textEl.focus();
        handleTyping();
      };
      emojiPicker.appendChild(span);
    });
  }

  const positionEmojiPicker = () => {
    if (!emojiPicker.classList.contains("visible")) return;
    const btnRect = emojiBtn.getBoundingClientRect();
    const pickerRect = emojiPicker.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;

    let left = btnRect.left;
    left = Math.max(pad, Math.min(left, vw - pickerRect.width - pad));

    let top = btnRect.top - pickerRect.height - pad;
    if (top < pad) top = btnRect.bottom + pad;
    if (top > vh - pickerRect.height - pad) top = Math.max(pad, vh - pickerRect.height - pad);

    emojiPicker.style.left = `${Math.round(left)}px`;
    emojiPicker.style.top = `${Math.round(top)}px`;
    emojiPicker.style.bottom = "auto";
    emojiPicker.style.right = "auto";
  };

  const renderMessages = (channel) => {
    messagesEl.innerHTML = "";
    if (!chatState[channel]) return;
    
    chatState[channel].unread = 0;
    updateUserListUI();

    // 重新设置该频道的时间记录，确保渲染时时间戳显示正确
    lastMessageTime[channel] = 0;
    
    // 渲染时需要处理时间居中逻辑
    const currentMsgs = chatState[channel].messages;
    const tempMessages = [];
    let lastTime = 0;

    currentMsgs.forEach((m) => {
      // 如果是原本的时间元素，我们跳过，统一由渲染逻辑重新计算（或者保留原始逻辑）
      // 为了简单起见，我们移除原有的 time 类型消息，在渲染时动态插入
      if (m.type === "time") return;

      const now = m.timestamp;
      if (now - lastTime > TIME_GAP) {
        const timeDiv = document.createElement("div");
        timeDiv.className = "msg-time-center";
        timeDiv.textContent = formatTime(now);
        messagesEl.appendChild(timeDiv);
        lastTime = now;
      }
      messagesEl.appendChild(m.el);
    });
    
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // 创建消息 DOM 元素
  const createMessageElement = (msg) => {
    const { type, text, to_uid, msg_id, from_uid, file_info } = msg;
    const from = msg.from || msg.username || "匿名";
    const now = Date.now();
    const msgIdStr = String(msg_id ?? "");
    
    // 确定所属频道
    let channel = "group";
    if (type === "private_chat" || type === "private_file") {
      channel = (from_uid === myUid) ? to_uid : from_uid;
    }

    if (!chatState[channel]) {
      chatState[channel] = { messages: [], lastMsg: "", unread: 0, name: from };
    }

    // 处理撤回
    if (type === "recall") {
      for (const channelKey in chatState) {
        const targetMsg = chatState[channelKey].messages.find(m => String(m.msg_id) === String(msgIdStr));
        if (targetMsg) {
          const recallDiv = document.createElement("div");
          recallDiv.className = "msg-recalled";
          recallDiv.textContent = `${from_uid === myUid ? "你" : from} 撤回了一条消息`;
          targetMsg.el.replaceWith(recallDiv);
          targetMsg.el = recallDiv;
          targetMsg.is_recalled = true;
          break;
        }
      }
      return;
    }

    if (!lastMessageTime[channel]) lastMessageTime[channel] = 0;

    let msgElement;
    if (type === "system") {
      msgElement = document.createElement("div");
      msgElement.className = "msg-system";
      msgElement.textContent = text;
    } else if (type === "file" || type === "private_file") {
      const isSelf = from_uid === myUid;
      if (msg.is_recalled) {
        const recallDiv = document.createElement("div");
        recallDiv.className = "msg-recalled";
        recallDiv.textContent = `${isSelf ? "你" : from} 撤回了一条消息`;
        msgElement = recallDiv;
      } else {
      const wrapper = document.createElement("div");
      wrapper.className = `msg-wrapper ${isSelf ? "self" : "other"}`;
      const container = document.createElement("div");
      container.className = "msg-container";
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.backgroundColor = getAvatarColor(from);
      avatar.textContent = (from || "匿")[0];
      const bubble = document.createElement("div");
      bubble.className = "msg-bubble file-bubble";
      bubble.innerHTML = `
        <a href="/uploads/${file_info.path}" target="_blank" download="${file_info.name}" class="file-link">
          <div class="file-icon">📄</div>
          <div class="file-info">
            <div class="file-name">${escapeHtml(file_info.name)}</div>
            <div class="file-size">${(file_info.size / 1024 / 1024).toFixed(2)} MB</div>
          </div>
        </a>
      `;

      // 右键撤回菜单 (文件撤回)
      if (isSelf) {
        bubble.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const timeDiff = Date.now() - (msg.timestamp || now);
          if (timeDiff < RECALL_TIMEOUT) {
            contextTarget = { msg_id: msg_id, channel: channel };
            contextMenu.style.display = "block";
            contextMenu.style.left = e.clientX + "px";
            contextMenu.style.top = e.clientY + "px";
          }
        };
      }

      container.appendChild(avatar);
      container.appendChild(bubble);
      if (!isSelf) {
        const header = document.createElement("div");
        header.className = "msg-header";
        header.textContent = from || "匿名";
        wrapper.appendChild(header);
      }
      wrapper.appendChild(container);
      msgElement = wrapper;
      }
    } else {
      const isSelf = from_uid === myUid;
      const wrapper = document.createElement("div");
      wrapper.className = `msg-wrapper ${isSelf ? "self" : "other"}`;

      const container = document.createElement("div");
      container.className = "msg-container";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.backgroundColor = getAvatarColor(from);
      avatar.textContent = (from || "匿")[0];

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble";
      bubble.innerHTML = renderMessageHtml(text || "");

      // 右键撤回菜单
      if (isSelf) {
        bubble.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const timeDiff = Date.now() - (msg.timestamp || now);
          if (timeDiff < RECALL_TIMEOUT) {
            contextTarget = { msg_id: msg_id, channel: channel };
            contextMenu.style.display = "block";
            contextMenu.style.left = e.clientX + "px";
            contextMenu.style.top = e.clientY + "px";
          }
        };
      }

      container.appendChild(avatar);
      container.appendChild(bubble);

      if (!isSelf) {
        const header = document.createElement("div");
        header.className = "msg-header";
        header.textContent = from || "匿名";
        wrapper.appendChild(header);
      }

      wrapper.appendChild(container);
      msgElement = wrapper;
    }

    chatState[channel].messages.push({ el: msgElement, msg_id: msgIdStr, timestamp: msg.timestamp || now, from, from_uid, type, file_info, is_recalled: !!msg.is_recalled });
    if (type === "file" || type === "private_file") {
      chatState[channel].lastMsg = msg.is_recalled ? "已撤回" : `[文件] ${file_info?.name || ""}`;
    } else if (type === "system") {
      chatState[channel].lastMsg = "系统消息";
    } else {
      chatState[channel].lastMsg = text || "";
    }
    
    if (channel !== activeChannel) {
      chatState[channel].unread++;
      if (type !== "system") showNotification(from, text);
    }

    updateUserListUI();

    if (channel === activeChannel) {
      renderMessages(activeChannel);
    }
  };

  const createProgressIndicator = (msg_id, fileName) => {
    const wrapper = document.createElement("div");
    wrapper.className = "msg-wrapper self";
    wrapper.dataset.msgId = msg_id;

    const container = document.createElement("div");
    container.className = "msg-container";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.backgroundColor = getAvatarColor(username);
    avatar.textContent = (username || "匿")[0];

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble file-bubble";
    bubble.innerHTML = `
      <div class="file-info">
        <div class="file-name">${escapeHtml(fileName)}</div>
        <div class="file-size">上传中...</div>
      </div>
      <div class="progress-bar">
        <div class="progress" style="width: 0%"></div>
      </div>
    `;

    container.appendChild(avatar);
    container.appendChild(bubble);
    wrapper.appendChild(container);
    return wrapper;
  };

  // 专门用于渲染历史记录的轻量级函数
  const createHistoryMessageElement = (msg) => {
    const { from, text, msg_id, from_uid, type, file_info } = msg;
    const isSelf = from_uid === myUid;
    const isRecalled = !!msg.is_recalled;

    if (isRecalled) {
      const recallDiv = document.createElement("div");
      recallDiv.className = "msg-recalled";
      recallDiv.textContent = `${isSelf ? "你" : (from || "匿名")} 撤回了一条消息`;
      return recallDiv;
    }

    if (type === "file") {
      const wrapper = document.createElement("div");
      wrapper.className = `msg-wrapper ${isSelf ? "self" : "other"}`;
      const container = document.createElement("div");
      container.className = "msg-container";
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.backgroundColor = getAvatarColor(from);
      avatar.textContent = (from || "匿")[0];
      const bubble = document.createElement("div");
      bubble.className = "msg-bubble file-bubble";
      bubble.innerHTML = `
        <a href="/uploads/${file_info.path}" target="_blank" download="${file_info.name}" class="file-link">
          <div class="file-icon">📄</div>
          <div class="file-info">
            <div class="file-name">${escapeHtml(file_info.name)}</div>
            <div class="file-size">${(file_info.size / 1024 / 1024).toFixed(2)} MB</div>
          </div>
        </a>
      `;
      
      if (isSelf) {
        bubble.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const timeDiff = Date.now() - msg.timestamp;
          if (timeDiff < RECALL_TIMEOUT) {
            contextTarget = { msg_id: msg_id, channel: activeChannel };
            contextMenu.style.display = "block";
            contextMenu.style.left = e.clientX + "px";
            contextMenu.style.top = e.clientY + "px";
          }
        };
      }

      container.appendChild(avatar);
      container.appendChild(bubble);
      if (!isSelf) {
        const header = document.createElement("div");
        header.className = "msg-header";
        header.textContent = from || "匿名";
        wrapper.appendChild(header);
      }
      wrapper.appendChild(container);
      return wrapper;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `msg-wrapper ${isSelf ? "self" : "other"}`;
    const container = document.createElement("div");
    container.className = "msg-container";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.backgroundColor = getAvatarColor(from);
    avatar.textContent = (from || "匿")[0];
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = renderMessageHtml(text || "");
    
    if (isSelf) {
      bubble.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const timeDiff = Date.now() - msg.timestamp;
        if (timeDiff < RECALL_TIMEOUT) {
          contextTarget = { msg_id: msg_id, channel: activeChannel };
          contextMenu.style.display = "block";
          contextMenu.style.left = e.clientX + "px";
          contextMenu.style.top = e.clientY + "px";
        }
      };
    }

    container.appendChild(avatar);
    container.appendChild(bubble);
    if (!isSelf) {
      const header = document.createElement("div");
      header.className = "msg-header";
      header.textContent = from || "匿名";
      wrapper.appendChild(header);
    }
    wrapper.appendChild(container);
    return wrapper;
  };

  const updateUserListUI = () => {
    const items = userListEl.querySelectorAll(".user-item");
    items.forEach(item => {
      const channel = item.dataset.channel;
      if (!chatState[channel]) return;

      const badge = item.querySelector(".badge");
      const lastMsg = item.querySelector(".last-msg");
      
      if (badge) {
        if (chatState[channel].unread > 0) {
          badge.textContent = chatState[channel].unread;
          badge.style.display = "flex";
        } else {
          badge.style.display = "none";
        }
      }
      
      if (lastMsg) {
        lastMsg.textContent = chatState[channel].lastMsg || "";
      }
    });
  };

  const updateUserList = (users) => {
    userCountEl.textContent = users.length;
    
    // 更新本地在线用户映射
    onlineUsers = {};
    users.forEach(u => onlineUsers[u.uid] = u.username);

    const groupChatEl = userListEl.querySelector('[data-channel="group"]');
    userListEl.innerHTML = "";
    if (groupChatEl) {
      userListEl.appendChild(groupChatEl);
    } else {
      const item = document.createElement("div");
      item.className = `user-item ${activeChannel === "group" ? "active" : ""}`;
      item.dataset.channel = "group";
      item.innerHTML = `<div class="avatar-mini">G</div><div>群聊</div>`;
      userListEl.appendChild(item);
    }

    users.forEach((u) => {
      if (u.uid === myUid) return; // 不显示自己

      const item = document.createElement("div");
      item.className = `user-item ${activeChannel === u.uid ? "active" : ""}`;
      item.dataset.channel = u.uid; // 使用 UID 作为频道标识
      
      // 如果本地没有该频道的名称，初始化它
      if (!chatState[u.uid]) {
        chatState[u.uid] = { messages: [], lastMsg: "", unread: 0, name: u.username };
      } else {
        chatState[u.uid].name = u.username; // 更新可能的更名
      }

      item.innerHTML = `
        <div class="avatar-mini" style="background-color:${getAvatarColor(u.username)}">${u.username[0]}</div>
        <div class="info">
          <div class="name-row">
            <span class="name">${u.username}</span>
            <span class="badge" style="display:none">0</span>
          </div>
          <div class="last-msg"></div>
        </div>
        <div class="actions">
          <button class="btn call-btn" title="语音通话">📞</button>
        </div>
      `;
      userListEl.appendChild(item);
    });
    updateUserListUI();
    applySearch();
  };

  const switchChannel = (newChannel) => {
    console.log("Switching to channel:", newChannel);
    if (newChannel === activeChannel) return;
    
    // 1. 更新全局状态
    activeChannel = newChannel;

    // 2. 强制更新 UI 列表的 active 类
    const items = userListEl.querySelectorAll(".user-item");
    items.forEach((it) => {
      if (it.dataset.channel === activeChannel) {
        it.classList.add("active");
      } else {
        it.classList.remove("active");
      }
    });

    // 3. 确保 chatState 存在
    if (!chatState[activeChannel]) {
      chatState[activeChannel] = { 
        messages: [], 
        lastMsg: "", 
        unread: 0, 
        name: (activeChannel === "group" ? "群聊" : (onlineUsers[activeChannel] || "未知用户"))
      };
    }

    // 4. 更新顶部标题
    const channelName = (activeChannel === "group") ? "局域网聊天室" : `与 ${chatState[activeChannel].name} 的私聊`;
    if (chatTitleEl) {
      chatTitleEl.innerHTML = `${channelName} <span id="typingStatus" class="typing-status" style="display:none">对方正在输入...</span>`;
    }
    
    // 5. 渲染该频道的消息
    renderMessages(activeChannel);
    textEl.focus();
  };

  const applySearch = () => {
    const q = userSearch.value.toLowerCase();
    const items = userListEl.querySelectorAll(".user-item");
    items.forEach(item => {
      const name = item.querySelector(".name")?.textContent.toLowerCase() || "群聊";
      item.style.display = name.includes(q) ? "flex" : "none";
    });
  };

  const handleTyping = () => {
    if (activeChannel !== "group" && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "typing", to_uid: activeChannel }));
    }
  };

  // --- WebRTC 语音通话 ---
  let localStream;
  let peerConnections = {}; // key: 对端 UID, value: RTCPeerConnection
  let activeCalls = new Set(); // 当前正在通话的对端 UID 集合
  const stopLocalMedia = () => {
    if (localStream) {
      try {
        localStream.getTracks().forEach(t => t.stop());
      } catch (_) {}
      localStream = null;
    }
  };
  const stopLocalMediaIfIdle = () => {
    if (activeCalls.size === 0) stopLocalMedia();
  };
  const endCall = (targetUid, tip) => {
    const pc = peerConnections[targetUid];
    if (pc) {
      try { pc.close(); } catch (_) {}
      delete peerConnections[targetUid];
    }
    activeCalls.delete(targetUid);
    stopLocalMediaIfIdle();
    if (tip) createMessageElement({ type: "system", text: tip });
  };

  const setCallButtonState = (uid, isActive) => {
    const item = userListEl.querySelector(`.user-item[data-channel="${uid}"]`);
    if (!item) return;
    const btn = item.querySelector(".call-btn");
    if (!btn) return;
    if (isActive) {
      item.classList.add("calling");
      btn.textContent = "📴";
      btn.title = "挂断";
    } else {
      item.classList.remove("calling");
      btn.textContent = "📞";
      btn.title = "语音通话";
    }
  };

  let pendingOffers = {}; // key: 对端 UID, value: RTCSessionDescriptionInit
  let pendingCandidates = {}; // key: 对端 UID, value: RTCIceCandidateInit[]
  const servers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  const openMicModal = ({ title, text, allowText, denyText }) => {
    return new Promise((resolve) => {
      if (!micPermissionModal) {
        resolve(true);
        return;
      }

      if (micModalTitle) micModalTitle.textContent = title || "语音通话";
      if (micModalText) micModalText.textContent = text || "需要获取麦克风权限才能进行语音通话。";
      if (micAllowBtn) micAllowBtn.textContent = allowText || "允许并继续";
      if (micDenyBtn) micDenyBtn.textContent = denyText || "拒绝";

      const cleanup = () => {
        micAllowBtn?.removeEventListener("click", onAllow);
        micDenyBtn?.removeEventListener("click", onDeny);
        micPermissionModal?.removeEventListener("click", onOverlay);
      };

      const close = () => {
        if (micPermissionModal) micPermissionModal.style.display = "none";
      };

      const onAllow = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        close();
        resolve(true);
      };

      const onDeny = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        close();
        resolve(false);
      };

      const onOverlay = (e) => {
        if (e.target === micPermissionModal) {
          cleanup();
          close();
          resolve(false);
        }
      };

      micAllowBtn?.addEventListener("click", onAllow);
      micDenyBtn?.addEventListener("click", onDeny);
      micPermissionModal?.addEventListener("click", onOverlay);
      micPermissionModal.style.display = "flex";
    });
  };

  const ensureMicrophoneStream = async ({ prePrompt, promptText }) => {
    if (localStream) return { ok: true, stream: localStream };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, reason: "unsupported" };
    }

    const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!window.isSecureContext && !isLocalhost) {
      return { ok: false, reason: "insecure" };
    }

    if (prePrompt) {
      const ok = await openMicModal({
        title: "麦克风权限",
        text: promptText || "需要获取麦克风权限才能进行语音通话。\n点击“允许并继续”后浏览器会弹出麦克风授权窗口。",
        allowText: "允许并继续",
        denyText: "取消",
      });
      if (!ok) return { ok: false, reason: "user_denied_preprompt" };
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return { ok: true, stream: localStream };
    } catch (e) {
      let reason = "unknown";
      if (e && e.name) {
        if (e.name === "NotAllowedError") reason = "permission_denied";
        else if (e.name === "NotFoundError" || e.name === "OverconstrainedError") reason = "no_device";
        else if (e.name === "NotReadableError" || e.name === "NotReadableError") reason = "device_busy";
        else if (e.name === "SecurityError") reason = "insecure";
      }
      return { ok: false, reason };
    }
  };

  const sendSignal = (to_uid, signal) => {
    ws.send(JSON.stringify({ type: "webrtc_signal", to_uid, signal }));
  };

  const addLocalTracksOnce = (pc) => {
    if (!localStream) return;
    if (pc.__lanChatTracksAdded) return;
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    pc.__lanChatTracksAdded = true;
  };

  const createPeerConnection = (targetUid) => {
    if (peerConnections[targetUid]) return peerConnections[targetUid];

    const pc = new RTCPeerConnection(servers);
    peerConnections[targetUid] = pc;

    addLocalTracksOnce(pc);

    pc.onicecandidate = event => {
      if (event.candidate) {
        sendSignal(targetUid, { candidate: event.candidate });
      }
    };

    pc.ontrack = event => {
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.play();
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        endCall(targetUid, "通话已断开。");
      }
    };

    return pc;
  };

  const startCall = async (targetUid) => {
    const res = await ensureMicrophoneStream({ prePrompt: true });
    if (!res.ok) {
      // 主叫侧本地就无法开启麦克风，直接提示
      const map = {
        insecure: "必须在 HTTPS 或 localhost 环境下才能获取麦克风。",
        unsupported: "当前浏览器不支持麦克风采集。",
        permission_denied: "你已拒绝麦克风授权。",
        no_device: "未检测到可用的麦克风设备。",
        device_busy: "麦克风设备正被占用。",
        user_denied_preprompt: "你取消了通话。"
      };
      createMessageElement({ type: "system", text: map[res.reason] || "无法获取麦克风。" });
      return;
    }

    const pc = createPeerConnection(targetUid);
    addLocalTracksOnce(pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(targetUid, { sdp: offer });
    activeCalls.add(targetUid);
    setCallButtonState(targetUid, true);
    createMessageElement({ type: "system", text: `正在呼叫 ${onlineUsers[targetUid] || targetUid}...` });
  };

  const sendHangup = (targetUid) => {
    try {
      sendSignal(targetUid, { action: "hangup" });
    } catch (_) {}
    endCall(targetUid, "你已挂断通话。");
    setCallButtonState(targetUid, false);
  };

  const acceptCall = async (from_uid) => {
    const offer = pendingOffers[from_uid];
    if (!offer) return;

    const res = await ensureMicrophoneStream({ prePrompt: false });
    if (!res.ok) {
      // 被叫侧无法开启麦克风 -> 主动拒绝并告知原因
      sendSignal(from_uid, { action: "reject", reason: res.reason });
      const map = {
        insecure: "必须在 HTTPS 或 localhost 环境下才能获取麦克风。",
        unsupported: "你的浏览器不支持麦克风采集。",
        permission_denied: "你已拒绝麦克风授权。",
        no_device: "未检测到你的麦克风设备。",
        device_busy: "你的麦克风设备正被占用。"
      };
      createMessageElement({ type: "system", text: map[res.reason] || "无法获取麦克风，已拒绝通话。" });
      pendingOffers[from_uid] = null;
      return;
    }

    const pc = createPeerConnection(from_uid);
    addLocalTracksOnce(pc);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(from_uid, { sdp: answer });
    activeCalls.add(from_uid);
    setCallButtonState(from_uid, true);

    const queued = pendingCandidates[from_uid] || [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (_) {}
    }
    pendingCandidates[from_uid] = [];
    pendingOffers[from_uid] = null;
    createMessageElement({ type: "system", text: `与 ${onlineUsers[from_uid] || from_uid} 的通话已连接。` });
  };

  const handleIncomingSignal = async (from_uid, signal) => {
    const pc = createPeerConnection(from_uid);

    if (signal && signal.action === "reject") {
      const map = {
        insecure: "对方环境不安全（需 HTTPS/localhost）。",
        unsupported: "对方浏览器不支持麦克风采集。",
        permission_denied: "对方拒绝了麦克风授权。",
        no_device: "对方没有麦克风设备。",
        device_busy: "对方的麦克风正被占用。"
      };
      const reasonText = map[signal.reason] || "对方已拒绝通话。";
      endCall(from_uid, reasonText);
      setCallButtonState(from_uid, false);
      pendingOffers[from_uid] = null;
      pendingCandidates[from_uid] = [];
      return;
    }

    if (signal.sdp) { // Offer or Answer
      if (signal.sdp.type === "offer") {
        pendingOffers[from_uid] = signal.sdp;
        const ok = await openMicModal({
          title: "语音通话邀请",
          text: `${onlineUsers[from_uid] || from_uid} 邀请你进行语音通话。\n点击“接听”后浏览器会弹出麦克风授权窗口。`,
          allowText: "接听",
          denyText: "拒绝",
        });
        if (!ok) {
          sendSignal(from_uid, { action: "reject" });
          createMessageElement({ type: "system", text: "你已拒绝语音通话。" });
          pendingOffers[from_uid] = null;
          setCallButtonState(from_uid, false);
          return;
        }
        await acceptCall(from_uid);
      } else {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const queued = pendingCandidates[from_uid] || [];
        for (const c of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch (_) {}
        }
        pendingCandidates[from_uid] = [];
        createMessageElement({ type: "system", text: `与 ${onlineUsers[from_uid] || from_uid} 的通话已连接。` });
      }
    } else if (signal.candidate) { // ICE Candidate
      if (!pc.remoteDescription) {
        if (!pendingCandidates[from_uid]) pendingCandidates[from_uid] = [];
        pendingCandidates[from_uid].push(signal.candidate);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } else if (signal.action === "hangup") {
      endCall(from_uid, "对方已挂断通话。");
      setCallButtonState(from_uid, false);
    }
  };

  const setState = (stateText, ok) => {
    connState.textContent = stateText;
    connState.style.color = ok ? "var(--accent2)" : "var(--muted)";
  };

  const wsUrl = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  };

  const doConnect = () => {
    const newName = (usernameEl.value || "").trim() || "匿名";
    usernameEl.value = newName;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (newName !== username) {
        username = newName;
        localStorage.setItem("chat_username", username);
        ws.send(JSON.stringify({ type: "rename", username }));
      }
      return;
    }
    
    username = newName;
    localStorage.setItem("chat_username", username);
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    setState("连接中…", true);
    connectBtn.disabled = true;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      setState("已连接", true);
      connectBtn.disabled = false;
      // 发送 join 时携带本地存储的 UID（如有）
      ws.send(JSON.stringify({ type: "join", username, uid: myUid }));
      textEl.focus();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "set_username") {
          username = msg.username;
          usernameEl.value = username;
          myUid = msg.uid; // 存储服务器分配或确认的 UID
          localStorage.setItem("chat_username", username);
          localStorage.setItem("chat_uid", myUid);
        } else if (msg.type === "history") {
          Object.keys(msg.history).forEach(channelKey => {
            // 关键修复：将 server 端的 uid1-uid2 映射为 client 端的对端 UID
            let channel = channelKey;
            if (channelKey !== "group" && channelKey.includes("-")) {
              const uids = channelKey.split("-");
              channel = uids.find(u => u !== myUid) || channelKey;
            }

            if (!chatState[channel]) {
              chatState[channel] = { 
                messages: [], 
                lastMsg: "", 
                unread: 0, 
                name: channel === "group" ? "群聊" : (onlineUsers[channel] || "私聊") 
              };
            } else {
              chatState[channel].messages = [];
              chatState[channel].lastMsg = "";
              chatState[channel].unread = 0;
            }
            
            const seen = new Set();
            msg.history[channelKey].forEach(hMsg => {
              const idStr = String(hMsg.msg_id ?? "");
              if (idStr && seen.has(idStr)) return;
              if (idStr) seen.add(idStr);
              const el = createHistoryMessageElement(hMsg);
              if (el) {
                chatState[channel].messages.push({ 
                  el, 
                  msg_id: idStr, 
                  timestamp: hMsg.timestamp, 
                  from: hMsg.from,
                  from_uid: hMsg.from_uid,
                  type: hMsg.type,
                  file_info: hMsg.file_info,
                  is_recalled: !!hMsg.is_recalled
                });
                if (hMsg.is_recalled) {
                  chatState[channel].lastMsg = "已撤回";
                } else if (hMsg.type === "file") {
                  chatState[channel].lastMsg = `[文件] ${(hMsg.file_info?.name || "")}`;
                } else if (hMsg.type === "system") {
                  chatState[channel].lastMsg = "系统消息";
                } else {
                  chatState[channel].lastMsg = hMsg.text || "";
                }
              }
            });
          });
          renderMessages(activeChannel);
        } else if (msg.type === "typing") {
          if (msg.from_uid === activeChannel) {
            const status = document.getElementById("typingStatus");
            if (status) {
              status.style.display = "inline";
              clearTimeout(typingTimer);
              typingTimer = setTimeout(() => { status.style.display = "none"; }, 3000);
            }
          }
        } else if (msg.type === "webrtc_signal") {
          handleIncomingSignal(msg.from_uid, msg.signal);
        } else if (["chat", "system", "private_chat", "recall", "file", "private_file"].includes(msg.type)) {
          createMessageElement(msg);
        } else if (msg.type === "user_list") {
          updateUserList(msg.users);
        }
      } catch (err) {
        consoleAlert("收到异常数据（已忽略）", err);
      }
    };
    ws.onclose = () => {
      setState("未连接（已断开）", false);
      connectBtn.disabled = false;
    };
    ws.onerror = () => {
      setState("连接异常", false);
      connectBtn.disabled = false;
    };
  };

  const doSend = () => {
    const text = (textEl.value || "").trim();
    if (!text) return;
    const currentUsername = (usernameEl.value || "").trim() || "匿名";
    if (currentUsername !== username) {
      username = currentUsername;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "rename", username: currentUsername }));
      }
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      createMessageElement({ type: "system", text: "未连接到服务器，请先连接。", from_uid: "system" });
      return;
    }
    const msg_id = Date.now() + Math.random().toString(36).substr(2, 9);
    let payload = { text, msg_id };
    if (activeChannel === "group") {
      payload.type = "chat";
    } else {
      payload.type = "private_chat";
      payload.to_uid = activeChannel;
    }
    ws.send(JSON.stringify(payload));
    textEl.value = "";
    textEl.style.height = "auto";
    textEl.focus();
  };

  const initWebRTC = () => {
    // WebRTC 相关逻辑将在这里实现
  };

  // --- 事件监听 ---
  connectBtn.addEventListener("click", doConnect);
  sendBtn.addEventListener("click", doSend);
  
  // 处理全局撤回按钮点击
  recallBtn.onclick = (e) => {
    e.stopPropagation();
    if (contextTarget.msg_id) {
      const payload = { type: "recall", msg_id: contextTarget.msg_id };
      if (contextTarget.channel !== "group") {
        payload.to_uid = contextTarget.channel;
      }
      ws.send(JSON.stringify(payload));
      contextMenu.style.display = "none";
      contextTarget = { msg_id: null, channel: null };
    }
  };

  // 处理清空历史记录按钮点击
  clearHistoryBtn.onclick = (e) => {
    e.stopPropagation();
    if (sidebarTargetChannel && ws && ws.readyState === WebSocket.OPEN) {
      // 内部计算真正的存储 channel 名
      let storageChannel = sidebarTargetChannel;
      if (sidebarTargetChannel !== "group") {
        storageChannel = [myUid, sidebarTargetChannel].sort().join("-");
      }
      
      ws.send(JSON.stringify({ type: "clear_history", channel: storageChannel }));
      
      // 前端立即清空
      if (chatState[sidebarTargetChannel]) {
        chatState[sidebarTargetChannel].messages = [];
        chatState[sidebarTargetChannel].lastMsg = "";
      }
      
      if (sidebarTargetChannel === activeChannel) {
        renderMessages(activeChannel);
      }
      
      userContextMenu.style.display = "none";
      sidebarTargetChannel = null;
      updateUserListUI();
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024 * 1024) {
      createMessageElement({ type: "system", text: `文件过大，超过 1.5 GB 限制`, from_uid: "system" });
      return;
    }

    const msg_id = Date.now() + Math.random().toString(36).substr(2, 9);
    const progressIndicator = createProgressIndicator(msg_id, file.name);
    messagesEl.appendChild(progressIndicator);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`上传失败: ${response.statusText}`);
      }

      const result = await response.json();
      
      let payload = {
        type: "file",
        msg_id,
        file_info: {
          name: file.name,
          size: file.size,
          path: result.filename,
        },
      };

      if (activeChannel !== "group") {
        payload.type = "private_file"; // 可选，用于区分
        payload.to_uid = activeChannel;
      }

      ws.send(JSON.stringify(payload));
      
      // 移除进度条 (因为马上会收到 websocket 消息并渲染正式的文件卡片)
      progressIndicator.remove();

    } catch (error) {
      console.error("Upload error:", error);
      progressIndicator.querySelector(".file-size").textContent = "上传失败";
      progressIndicator.querySelector(".progress").style.backgroundColor = "red";
    }
  };

  fileBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    handleFileUpload(fileInput.files[0]);
    fileInput.value = ""; // 允许重复上传同名文件
  };

  // 拖拽上传
  const panel = document.querySelector(".panel");
  panel.ondragover = (e) => {
    e.preventDefault();
    dragDropOverlay.classList.add("visible");
  };
  panel.ondragleave = () => {
    dragDropOverlay.classList.remove("visible");
  };
  panel.ondrop = (e) => {
    e.preventDefault();
    dragDropOverlay.classList.remove("visible");
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  usernameEl.addEventListener("keydown", (e) => e.key === "Enter" && doConnect());
  textEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  textEl.addEventListener("input", () => {
    textEl.style.height = "auto";
    textEl.style.height = textEl.scrollHeight + "px";
    handleTyping();
  });
  userSearch.addEventListener("input", applySearch);
  userListEl.addEventListener("click", (e) => {
    const callBtn = e.target.closest(".call-btn");
    if (callBtn) {
      e.preventDefault();
      e.stopPropagation();
      const userItem = callBtn.closest(".user-item");
      const targetUid = userItem?.dataset.channel;
      if (!targetUid) return;
      if (targetUid === "group") {
        createMessageElement({ type: "system", text: "当前只支持一对一语音通话，请点击某个用户右侧的电话按钮。" });
        return;
      }
      // 切换为挂断/呼叫
      if (activeCalls.has(targetUid) || peerConnections[targetUid]) {
        sendHangup(targetUid);
      } else {
        startCall(targetUid);
      }
      return;
    }

    const target = e.target.closest(".user-item");
    if (target && target.dataset.channel) {
      const targetChannel = target.dataset.channel;
      console.log("Clicked sidebar item, channel:", targetChannel);
      switchChannel(targetChannel);
    }
  });

  // 侧边栏右键菜单
  userListEl.addEventListener("contextmenu", (e) => {
    const target = e.target.closest(".user-item");
    if (target && target.dataset.channel) {
      e.preventDefault();
      e.stopPropagation();
      sidebarTargetChannel = target.dataset.channel;
      userContextMenu.style.display = "block";
      userContextMenu.style.left = e.clientX + "px";
      userContextMenu.style.top = e.clientY + "px";
    }
  });

  document.addEventListener("click", () => {
    contextMenu.style.display = "none";
    userContextMenu.style.display = "none";
    emojiPicker.classList.remove("visible");
  });

  emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = !emojiPicker.classList.contains("visible");
    if (next) {
      emojiPicker.classList.add("visible");
      requestAnimationFrame(positionEmojiPicker);
    } else {
      emojiPicker.classList.remove("visible");
    }
  });

  window.addEventListener("resize", () => requestAnimationFrame(positionEmojiPicker));
  window.addEventListener("scroll", () => requestAnimationFrame(positionEmojiPicker), true);

  initEmojis();
  setTimeout(doConnect, 150);
});
