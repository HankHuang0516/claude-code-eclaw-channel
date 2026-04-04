# EClaw Channel Bridge for Claude Code

透過 Claude Code Channel 接收 [EClaw](https://eclawbot.com) 平台的訊息，讓 Claude 直接在終端機回覆使用者。

## 架構

```
使用者 (EClaw App)
    ↓ 發送訊息
EClaw 平台 (eclawbot.com)
    ↓ Webhook Push
Bridge (bridge.ts, port 18800)
    ↓ WebSocket
Fakechat Plugin (Claude Code built-in, port 8787)
    ↓ MCP Notification
Claude Code (terminal, --channels)
    ↓ fakechat reply tool
Bridge (intercept WebSocket reply)
    ↓ EClaw API
使用者收到回覆
```

## 前置需求

- **Claude Code** v2.1.80+（`npm install -g @anthropic-ai/claude-code`）
- **Bun** runtime（`curl -fsSL https://bun.sh/install | bash`）
- **claude.ai 帳號**（需登入，不支援 API key 認證）
- **tmux**（`brew install tmux`）
- **Fakechat plugin**（Claude Code 內建，需安裝）
- **EClaw Channel API Key**（從 EClaw Portal 取得）
- **公開 URL**（用於接收 webhook，例如 Cloudflare Tunnel / ngrok）

## 快速開始

### 1. 安裝 Fakechat Plugin

```bash
# 啟動 Claude Code
claude

# 在 Claude Code 內安裝 fakechat
/plugin install fakechat@claude-plugins-official

# 退出
/exit
```

### 2. 取得 EClaw Channel API Key

1. 前往 [EClaw Portal](https://eclawbot.com) → Settings → Channel API
2. 點擊「Create API Key」
3. 複製 API Key（格式：`eck_...`）

### 3. Clone 並安裝

```bash
git clone https://github.com/HankHuang0516/claude-code-eclaw-channel.git
cd claude-code-eclaw-channel
bun install
```

### 4. 設定公開 URL

Bridge 需要一個公開 URL 來接收 EClaw 的 webhook 推送。

**Cloudflare Tunnel（推薦）：**
```bash
# Quick Tunnel（臨時 URL）
cloudflared tunnel --url http://localhost:18800

# 或 Named Tunnel（固定 URL）
cloudflared tunnel route dns <tunnel-name> eclaw-bot.yourdomain.com
```

**ngrok：**
```bash
ngrok http 18800
```

### 5. 啟動 Claude Code + Fakechat Channel

```bash
# 用 tmux 背景運行
tmux new-session -d -s eclaw-bot

tmux send-keys -t eclaw-bot 'claude --channels plugin:fakechat@claude-plugins-official' Enter
```

在 tmux 中等 Claude Code 完全啟動（看到 `Listening for channel messages`）。

### 6. 啟動 Bridge

```bash
# 在另一個 tmux session 啟動 bridge
tmux new-session -d -s eclaw-bridge

tmux send-keys -t eclaw-bridge 'cd /path/to/claude-code-eclaw-channel && \
  ECLAW_API_KEY=eck_你的key \
  ECLAW_WEBHOOK_URL=https://你的公開URL \
  ECLAW_BOT_NAME=我的Bot \
  bun bridge.ts' Enter
```

### 7. 驗證

```bash
# 檢查 bridge 狀態
curl http://localhost:18800/health

# 檢查 log
cat /tmp/eclaw-bridge.log

# 手動測試
curl -X POST http://localhost:18800/eclaw-webhook \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","entityId":0,"text":"Hello!","from":"test"}'
```

## 環境變數

| 變數 | 必填 | 說明 | 預設值 |
|------|------|------|--------|
| `ECLAW_API_KEY` | ✅ | Channel API Key（`eck_...`） | — |
| `ECLAW_WEBHOOK_URL` | ✅ | 公開 URL（不含 `/eclaw-webhook`） | — |
| `ECLAW_API_BASE` | | EClaw API 基底 URL | `https://eclawbot.com` |
| `ECLAW_WEBHOOK_PORT` | | Webhook 監聽 port | `18800` |
| `ECLAW_BOT_NAME` | | Bot 顯示名稱 | `Claude Bot` |
| `FAKECHAT_WS` | | Fakechat WebSocket URL | `ws://localhost:8787/ws` |

## 運作原理

1. **EClaw 推送訊息** → webhook POST 到 `bridge.ts` 的 `/eclaw-webhook`
2. **Bridge 轉發** → 透過 WebSocket 送到 fakechat plugin
3. **Fakechat 觸發 MCP notification** → Claude Code 收到 channel event
4. **Claude 處理並回覆** → 呼叫 fakechat 的 `reply` tool
5. **Bridge 攔截回覆** → 從 WebSocket 收到 assistant 回覆
6. **Bridge 轉發到 EClaw API** → 使用者在 EClaw App 收到回覆

## 與 OpenClaw 的差異

| | OpenClaw | Claude Code + Bridge |
|---|---|---|
| **認證** | Anthropic API Key（付費） | claude.ai 帳號（Max 訂閱） |
| **運行方式** | Docker 容器，背景常駐 | tmux session，interactive |
| **同時多 Bot** | 每個容器一個 Bot | 一個帳號一個 session |
| **適合** | 多 Bot、API token 充足 | 單 Bot、善用 Max 訂閱額度 |

## 疑難排解

### Bridge 無法連接 fakechat WebSocket

確認 Claude Code + fakechat 先啟動：
```bash
curl http://localhost:8787/  # 應該回傳 HTML
```

### EClaw 訊息沒有到達 Claude Code

1. 檢查 bridge log：`cat /tmp/eclaw-bridge.log`
2. 確認 webhook 通：`curl http://localhost:18800/health`
3. 確認 WebSocket 連線：health 回應的 `wsConnected` 應為 `true`

### Claude Code 收到訊息但沒回覆

- 檢查 claude.ai 使用量限制（76% weekly limit 等）
- 在 tmux 中手動跟 Claude 說一句話激活 session

### 502 Bad Gateway（Cloudflare Tunnel）

確認 tunnel 指向正確的 port（18800，不是 8787）。

## License

MIT
