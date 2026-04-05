# EClaw Channel Bridge for Claude Code

透過 Claude Code 的 Channel 機制接收 [EClaw](https://eclawbot.com) 平台的即時訊息，讓 Claude 直接在終端機中自動回覆使用者。

> ⚠️ **實驗性功能** — Claude Code Channel 依賴 `--dangerously-load-development-channels`，此為 Claude Code 的實驗性 API，穩定性不如 OpenClaw Channel。建議生產環境使用 [OpenClaw Channel](https://github.com/HankHuang0516/openclaw-channel-eclaw)。

本專案包含兩種架構模式：
- **bridge 模式**（`bridge.ts`）：透過 fakechat plugin 的 WebSocket 橋接
- **server 模式**（`server.ts`）：原生 MCP Channel plugin，直接與 Claude Code 整合

## 架構流程

```
使用者 (EClaw App)
    │ 發送訊息
    ▼
EClaw 平台 (eclawbot.com)
    │ Webhook POST
    ▼
bridge.ts (port 18800)          ← 接收 EClaw 推送
    │ WebSocket
    ▼
fakechat plugin (port 8787)     ← Claude Code 內建 plugin
    │ MCP Notification
    ▼
Claude Code (terminal)          ← 在 tmux session 中運行
    │ fakechat reply tool
    ▼
bridge.ts                       ← 攔截 WebSocket 回覆
    │ EClaw API POST
    ▼
使用者收到回覆
```

**server 模式（替代方案）：**

```
EClaw 平台 → Webhook → server.ts (MCP Server + HTTP)
    → MCP notification → Claude Code
    → eclaw_reply tool → server.ts → EClaw API → 使用者
```

## 前置需求

- **Bun** runtime — `curl -fsSL https://bun.sh/install | bash`
- **Claude Code** v2.1.80+（含 fakechat plugin 支援）— `npm install -g @anthropic-ai/claude-code`
- **claude.ai 帳號** — 需登入，不支援 API Key 認證（建議 Max 訂閱）
- **tmux** — `brew install tmux`
- **EClaw Channel API Key** — 從 [EClaw Portal](https://eclawbot.com) 取得（格式：`eck_...`）
- **公開 URL**（用於接收 webhook）：
  - [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)（推薦）
  - 或 [ngrok](https://ngrok.com/)

## 安裝步驟

### 1. Clone 專案

```bash
git clone https://github.com/HankHuang0516/claude-code-eclaw-channel.git
cd claude-code-eclaw-channel
bun install
```

### 2. 安裝 Fakechat Plugin

```bash
# 啟動 Claude Code
claude

# 在 Claude Code 中安裝 fakechat plugin
/plugin install fakechat@claude-plugins-official

# 退出 Claude Code
/exit
```

### 3. 取得 EClaw Channel API Key

1. 前往 [EClaw Portal](https://eclawbot.com) → Settings → Channel API
2. 點擊「Create API Key」
3. 複製 API Key（格式：`eck_...`）

### 4. 建立公開 URL

Bridge 需要一個公開 URL 來接收 EClaw 的 webhook 推送。

**Cloudflare Tunnel（推薦，固定 URL）：**
```bash
# Quick Tunnel（臨時 URL，測試用）
cloudflared tunnel --url http://localhost:18800

# Named Tunnel（固定 URL，正式環境）
cloudflared tunnel route dns <tunnel-name> eclaw-bot.yourdomain.com
```

**ngrok（替代方案）：**
```bash
ngrok http 18800
```

### 5. 設定環境變數

複製範例設定檔並填入你的值：
```bash
cp .mcp.json.example .mcp.json
```

編輯 `.mcp.json`，填入你的 `ECLAW_API_KEY` 和 `ECLAW_WEBHOOK_URL`。

## 環境變數

| 變數 | 必填 | 說明 | 預設值 |
|------|:----:|------|--------|
| `ECLAW_API_KEY` | ✅ | Channel API Key（`eck_...`） | — |
| `ECLAW_WEBHOOK_URL` | ✅ | 公開 URL（不含 `/eclaw-webhook` 路徑） | — |
| `ECLAW_API_BASE` | | EClaw API 基底 URL | `https://eclawbot.com` |
| `ECLAW_WEBHOOK_PORT` | | Webhook 監聽 port | `18800` |
| `ECLAW_BOT_NAME` | | Bot 顯示名稱 | `Claude Bot` |
| `FAKECHAT_WS` | | Fakechat WebSocket URL（bridge 模式用） | `ws://localhost:8787/ws` |

## 啟動方式

使用 tmux 在背景運行兩個 session：

### Bridge 模式（推薦）

```bash
# Session 1：啟動 Claude Code + fakechat channel
tmux new-session -d -s eclaw-bot
tmux send-keys -t eclaw-bot 'claude --channels plugin:fakechat@claude-plugins-official' Enter

# 等待 Claude Code 完全啟動（看到 "Listening for channel messages"）

# Session 2：啟動 Bridge
tmux new-session -d -s eclaw-bridge
tmux send-keys -t eclaw-bridge 'cd /path/to/claude-code-eclaw-channel && \
  ECLAW_API_KEY=eck_your_key \
  ECLAW_WEBHOOK_URL=https://your-public-url \
  ECLAW_BOT_NAME=My_Bot \
  bun bridge.ts' Enter
```

### 驗證啟動狀態

```bash
# 檢查 bridge 健康狀態
curl http://localhost:18800/health

# 檢查 log
cat /tmp/eclaw-bridge.log

# 手動傳送測試訊息
curl -X POST http://localhost:18800/eclaw-webhook \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","entityId":0,"text":"Hello!","from":"tester"}'
```

## 檔案結構

```
.
├── bridge.ts           # Bridge 模式：webhook → WebSocket → fakechat
├── server.ts           # Server 模式：原生 MCP Channel plugin
├── package.json
├── .mcp.json.example   # MCP 設定範例（複製為 .mcp.json 使用）
├── .claude-plugin/     # Claude Code plugin 定義
│   └── plugin.json
├── Dockerfile          # Docker 容器化部署（實驗性）
├── AGENTS.md           # Agent 行為指引
├── SOUL.md             # Bot 人設定義
├── TOOLS.md            # 可用工具文件
├── IDENTITY.md         # Bot 身份資訊
├── MEMORY.md           # 記憶機制說明
├── ECLAW_API.md        # EClaw API 參考文件
└── memory/             # Bot 對話記憶儲存
```

## 限制事項

- **週使用量限制** — claude.ai 帳號有每週使用上限（Max 方案約 5x），達到上限後 Claude 將無法回覆
- **需要互動式 session** — Claude Code 必須在 tmux 等互動式終端中運行，不能完全 daemon 化
- **一個帳號對應一個 session** — 每個 claude.ai 帳號同一時間只能運行一個 Claude Code channel session
- **Webhook 需公開 URL** — 本地開發需透過 Cloudflare Tunnel 或 ngrok 暴露 port

## 重啟 / 維護 Workflow

Claude Code Channel 需要手動管理 tmux session。以下是常見操作的完整流程。

### 完整重啟（推薦，解決大多數問題）

```bash
# 1. 停掉 bridge
pkill -f "bun.*bridge.ts"

# 2. 停掉 Claude Code
tmux kill-session -t eclaw-bot 2>/dev/null

# 3. 等 3 秒讓 port 釋放
sleep 3

# 4. 重新啟動 Claude Code + fakechat
tmux new-session -d -s eclaw-bot
tmux send-keys -t eclaw-bot 'claude --channels plugin:fakechat@claude-plugins-official' Enter

# 5. 等 Claude Code 完全啟動（約 10-15 秒）
sleep 15

# 6. 確認 fakechat 已啟動
curl -s http://localhost:8787/ > /dev/null && echo "✅ fakechat OK" || echo "❌ fakechat 未啟動"

# 7. 重新啟動 bridge
tmux new-session -d -s eclaw-bridge
tmux send-keys -t eclaw-bridge 'cd /path/to/claude-code-eclaw-channel && \
  ECLAW_API_KEY=eck_your_key \
  ECLAW_WEBHOOK_URL=https://your-public-url \
  ECLAW_BOT_NAME=My_Bot \
  bun bridge.ts' Enter

# 8. 等 bridge 啟動（約 5 秒）
sleep 5

# 9. 驗證全部元件
echo "=== Health Check ==="
curl -s http://localhost:8787/ > /dev/null && echo "✅ fakechat (8787)" || echo "❌ fakechat"
curl -s http://localhost:18800/health | grep -q "wsConnected.*true" && echo "✅ bridge (18800) + WS connected" || echo "❌ bridge"
```

### 只重啟 Claude Code（安裝新 MCP 後）

Bot 要求你重啟 Claude Code 載入新 MCP 時：

```bash
# 1. 先停 bridge（避免推送到斷線的 session）
pkill -f "bun.*bridge.ts"

# 2. 在 tmux 裡重啟 Claude Code
tmux send-keys -t eclaw-bot C-c C-c  # 送兩次 Ctrl+C 停止
sleep 3
tmux send-keys -t eclaw-bot 'claude --channels plugin:fakechat@claude-plugins-official' Enter
sleep 15

# 3. 確認 fakechat 啟動後，重啟 bridge
curl -s http://localhost:8787/ > /dev/null && echo "✅ fakechat OK"
tmux new-session -d -s eclaw-bridge
tmux send-keys -t eclaw-bridge 'cd /path/to/claude-code-eclaw-channel && \
  ECLAW_API_KEY=eck_your_key \
  ECLAW_WEBHOOK_URL=https://your-public-url \
  ECLAW_BOT_NAME=My_Bot \
  bun bridge.ts' Enter
```

### 只重啟 Bridge（webhook 設定改變後）

```bash
pkill -f "bun.*bridge.ts"
sleep 2
cd /path/to/claude-code-eclaw-channel && \
  ECLAW_API_KEY=eck_your_key \
  ECLAW_WEBHOOK_URL=https://your-public-url \
  ECLAW_BOT_NAME=My_Bot \
  nohup bun bridge.ts > /dev/null 2>&1 &
sleep 3
curl -s http://localhost:18800/health
```

### 查看 tmux session 狀態

```bash
# 列出所有 session
tmux ls

# 查看 Claude Code 畫面
tmux attach -t eclaw-bot
# 按 Ctrl+B 然後 D 離開（不會關掉 session）

# 查看 bridge 畫面
tmux attach -t eclaw-bridge
```

---

## 疑難排解

### 快速健康檢查

```bash
echo "=== 元件狀態 ==="
curl -s http://localhost:8787/ > /dev/null 2>&1 && echo "✅ fakechat (8787)" || echo "❌ fakechat 未啟動 → 重啟 Claude Code"
curl -s http://localhost:18800/health 2>&1 | grep -q "wsConnected.*true" && echo "✅ bridge (18800)" || echo "❌ bridge 未啟動或 WS 斷線"
curl -s -o /dev/null -w "%{http_code}" -X POST "https://YOUR_URL/eclaw-webhook" -H "Content-Type: application/json" -d '{}' 2>&1 | grep -q "200" && echo "✅ Cloudflare Tunnel" || echo "❌ Tunnel 斷線"
tmux has-session -t eclaw-bot 2>/dev/null && echo "✅ tmux eclaw-bot" || echo "❌ tmux session 不存在"
tmux has-session -t eclaw-bridge 2>/dev/null && echo "✅ tmux eclaw-bridge" || echo "❌ tmux bridge session 不存在"
cat /tmp/eclaw-bridge.log 2>/dev/null | tail -3
```

### 常見問題

| 症狀 | 原因 | 解法 |
|------|------|------|
| EClaw 訊息完全沒到 | Tunnel 斷了 / bridge 沒跑 | 執行健康檢查，重啟 bridge |
| bridge log 顯示 "Forwarded" 但沒回覆 | fakechat WS 斷線或 Claude Code idle | 完整重啟 |
| Claude Code 顯示 "Listening" 但不處理 | 需要先互動一次激活 session | 在 tmux 裡手動輸入一句話 |
| 回覆一下有一下沒有 | Claude Code channel 實驗性限制 | 正常現象，考慮改用 OpenClaw |
| "Weekly limit reached" | claude.ai 用量到頂 | 等每週重置，或改用 OpenClaw + API Key |
| 安裝新 MCP 後 bot 說要重啟 | Claude Code 需重新載入 | 按「只重啟 Claude Code」流程操作 |
| bridge log: "WS error" 一直重連 | Claude Code / fakechat 沒啟動 | 先確認 `curl localhost:8787` 有回應 |
| 502 Bad Gateway | Tunnel 指向錯誤 port | 確認指向 18800（bridge），不是 8787 |

### Bridge 無法連接 fakechat WebSocket

```bash
# 確認 fakechat 在跑
curl http://localhost:8787/  # 應回傳 HTML

# 如果沒回應，重啟 Claude Code
tmux kill-session -t eclaw-bot
tmux new-session -d -s eclaw-bot
tmux send-keys -t eclaw-bot 'claude --channels plugin:fakechat@claude-plugins-official' Enter
```

### EClaw 訊息沒有到達 Claude Code

1. 檢查 bridge log：`cat /tmp/eclaw-bridge.log`
2. 確認 webhook 可達：`curl http://localhost:18800/health`
3. 確認 WebSocket 已連線：health 回應中 `wsConnected` 應為 `true`
4. 如果都正常但 Claude Code 沒反應，在 tmux 裡手動輸入一句話激活 session

## License

MIT
