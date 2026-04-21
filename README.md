# EClaw Channel Bridge for Claude Code

> **TL;DR (English)** — Turn Claude Code into a chat agent. Receive messages from the EClaw mobile app (iOS/Android), reply from your terminal automatically, and approve dangerous ops from your phone. Two modes: a WebSocket bridge (`bridge.ts`) using the fakechat plugin, or a native MCP Channel server (`server.ts`). 5-minute setup on macOS, Bun + tmux. Full docs below in Chinese — key commands and API examples are bilingual.
>
> **Use cases**: remote Claude Code from phone · multi-user bot on a shared Claude subscription · mobile approval gate for `--dangerously-skip-permissions` · channel-based CI/CD commands.

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

### 2. macOS 權限設定（macOS 限定）

`bun` 執行時需要存取檔案系統，macOS 首次執行會彈出授權視窗。執行以下腳本一次完成：

```bash
./setup-macos-permissions.sh
```

腳本會：
1. 偵測目前 terminal 的授權狀態（查 TCC.db）
2. 若未授權，自動開啟**系統設定 → 隱私權與安全性 → 檔案與資料夾**
3. 顯示分步驟引導，完成一次性手動點擊允許

> Windows / Linux 用戶跳過此步驟。

### 3. 安裝 Fakechat Plugin

```bash
# 啟動 Claude Code
claude

# 在 Claude Code 中安裝 fakechat plugin
/plugin install fakechat@claude-plugins-official

# 退出 Claude Code
/exit
```

### 3.1 套用 Fakechat Instructions Patch（必要）

官方 fakechat plugin 的預設 instructions 太寬鬆，Claude Code 收到 channel 訊息時可能只在 transcript 顯示文字，**沒實際呼叫 `reply` tool 送回**，導致 EClaw 使用者收不到回覆。

執行 patch 套用我們的中英雙語強制規則（每次 fakechat plugin 更新後都要重跑）：

```bash
./patch-fakechat.sh
```

腳本會：
1. 自動定位 fakechat plugin 安裝路徑（cache + marketplace mirror）
2. 備份原始 `server.ts.original`
3. 替換 instructions 為強制 reply tool 規則（含 auto i18n）
4. 同步到 marketplace dir 確保 Claude Code 載入修改版

### 4. 取得 EClaw Channel API Key

1. 前往 [EClaw Portal](https://eclawbot.com) → Settings → Channel API
2. 點擊「Create API Key」
3. 複製 API Key（格式：`eck_...`）

### 5. 建立公開 URL

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

### 6. 設定環境變數

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
| `ECLAW_WATCHDOG_TIMEOUT` | | Watchdog 超時秒數 | `30` |
| `ECLAW_WATCHDOG_ENABLED` | | 是否啟用看門狗機制 | `true` |
| `ECLAW_FORWARD_KANBAN` | | 轉發 kanban 工作佇列訊息（設 `false` 為緊急靜音用） | `true` |
| `ECLAW_CONTEXT_WATCH_ENABLED` | | Context 壓力監控（20% 警告 / 5% auto-clear） | `true` |
| `ECLAW_REPLY_TIMEOUT_S` | | Claude 收訊後未用 reply tool 的提醒秒數 | `120` |

## 啟動方式

使用 tmux 在背景運行兩個 session：

### Bridge 模式（推薦）

```bash
# Session 1：啟動 Claude Code + fakechat channel
#   --dangerously-skip-permissions 避免確認 prompt 卡住整個 session
tmux new-session -d -s eclaw-bot
tmux send-keys -t eclaw-bot 'claude --dangerously-skip-permissions --channels plugin:fakechat@claude-plugins-official' Enter

# 等待 Claude Code 完全啟動（約 15 秒）
sleep 15

# Session 2：啟動 Bridge
tmux new-session -d -s eclaw-bridge
tmux send-keys -t eclaw-bridge 'cd /path/to/claude-code-eclaw-channel && \
  ECLAW_API_KEY=eck_your_key \
  ECLAW_WEBHOOK_URL=https://your-public-url \
  ECLAW_BOT_NAME=My_Bot \
  bun bridge.ts' Enter
```

> ⚠️ `--dangerously-skip-permissions` 會跳過所有確認提示（檔案讀寫、指令執行等）。如果沒加這個 flag，任何需要確認的操作都會卡住 session，導致後續訊息無法處理。

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

## 互動式權限確認 (Interactive Permission Approval)

> ✅ **已驗證可用**（2026-04-08）— 端對端測試通過：Claude Code 觸發 `.claude/` 操作 → hook 攔截 → bridge 送 rich card → EClaw App 顯示按鈕 → 使用者點按 → Claude Code 執行/拒絕。

### 問題背景

Claude Code 原生的權限 prompt 在 tmux session 中會**阻塞整個 channel**：
任何需要確認的操作（讀寫 `.claude/` 底下的設定、執行敏感指令）都會讓 Claude
卡在互動 prompt，導致後續 EClaw 訊息無法處理。目前的 workaround 是加上
`--dangerously-skip-permissions`，但這等於**完全關閉**所有權限檢查。

### 解決方案

Bridge 新增了一個 `POST /ask` long-poll 端點，搭配 Claude Code 的
`PreToolUse` hook，把權限確認**推到 EClaw 使用者的手機**上：

```
Claude Code 要執行 Bash / Write / Edit (.claude/...)
    │
    ▼
PreToolUse hook (hooks/pre-tool-use.sh)
    │ POST /ask {tool, command, file_path, reason}
    ▼
bridge.ts  ─── 產生 ask_id，送出含按鈕的 card 訊息
    │
    ▼
EClaw App 顯示：✅ 同意 / ✅ 全程允許 / ❌ 拒絕
    │  使用者點擊
    ▼
EClaw webhook (event: card_action) → bridge
    │ resolve(action)
    ▼
hook 拿到 action → exit 0 (allow) / exit 2 (deny)
```

整個流程是 **long-poll，沒有 timeout**，bridge 會一直等到使用者做出決定為止。

### 安裝 hook

```bash
mkdir -p ~/.claude/hooks
cp hooks/pre-tool-use.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/pre-tool-use.sh
```

然後編輯 `~/.claude/settings.json`，加入：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          { "type": "command", "command": "~/.claude/hooks/pre-tool-use.sh" }
        ]
      }
    ]
  }
}
```

建議在 `~/.claude/settings.json` 的 `env` 區塊明確設定 bridge URL：

```json
{
  "env": {
    "ECLAW_BRIDGE_URL": "http://localhost:18800"
  }
}
```

預設 bridge URL 也是 `http://localhost:18800`。Hook log 寫到 `/tmp/eclaw-hook.log`。

> ⚠️ **修改 `~/.claude/settings.json` 後必須重啟 Claude Code session**（`tmux kill-session -t eclaw-bot && 重新啟動`），新 hook 才會載入。runtime 改 settings 不會生效。

### 平台端依賴

EClaw 平台需同時支援這兩個 endpoint 的 `card` 欄位（兩者都已合併並部署）：

- `POST /api/transform`（botSecret auth）— [PR #1641](https://github.com/HankHuang0516/EClaw/pull/1641)
- `POST /api/channel/message`（channel_api_key auth，bridge 用的）— [PR #1643](https://github.com/HankHuang0516/EClaw/pull/1643)

如果你 fork 自己的 EClaw 部署，記得 cherry-pick 這兩個 PR。

### 限制

- **只攔截 `.claude/` 底下的操作** — 其他 Bash / Write / Edit 直接放行，避免
  無關的操作也跳到 EClaw 打擾使用者。範圍可在 `pre-tool-use.sh` 裡的
  `case` 區塊自行擴充。
- **沒有 timeout** — 使用者不回覆 hook 就會一直等，Claude Code 會卡住。
  如果不想被卡住可以在 hook 最前面加 `--max-time`。
- **`approve_always` 目前等同 `approve`** — 還沒實作 allowlist 持久化
  （TODO 標在 hook script 裡）。
- **需要 `jq`** — hook script 用 `jq` 解析 hook JSON，沒安裝會直接放行。

## 看門狗機制 (Watchdog)

當使用者透過 EClaw 發送訊息後，Claude Code 若超過一定時間沒有回覆（預設 30 秒），bridge 會自動送出一張 rich card 通知使用者目前正在處理中，並提供三個操作按鈕：

| 按鈕 | 行為 |
|------|------|
| **✅ 確認** | 不做任何事，Claude 處理完會自己回覆 |
| **⚡ 打斷** | 透過 tmux 中斷 Claude 當前工作，並注入指令要求立即回覆最新訊息 |
| **↩️ 撤回** | 放棄等待，不再追蹤該訊息 |

### 設定

| 環境變數 | 說明 | 預設值 |
|----------|------|--------|
| `ECLAW_WATCHDOG_TIMEOUT` | 超時秒數 | `30` |
| `ECLAW_WATCHDOG_ENABLED` | 是否啟用（`"true"` / `"false"`） | `"true"` |

### 行為細節

- 多條訊息快速送入時，只會對第一條未回覆的訊息觸發一次 watchdog card（不會洗版）
- 每次收到新訊息會重置計時器（debounce）
- 如果 Claude 在 watchdog card 送出後、使用者點按鈕前回覆了，watchdog 狀態會自動清除
- 健康檢查端點 `GET /health` 會顯示 watchdog 狀態：

```bash
curl http://localhost:18800/health
# {"ok":true,"channel":"eclaw-bridge","wsConnected":true,"watchdogEnabled":true,"watchdogTimeoutSeconds":30,"watchdogTimerActive":false,"pendingWatchdogs":0}
```

### 停用

```bash
ECLAW_WATCHDOG_ENABLED=false bun bridge.ts
```

## 限制事項

- **週使用量限制** — claude.ai 帳號有每週使用上限（Max 方案約 5x），達到上限後 Claude 將無法回覆
- **需要互動式 session** — Claude Code 必須在 tmux 等互動式終端中運行，不能完全 daemon 化
- **一個帳號對應一個 session** — 每個 claude.ai 帳號同一時間只能運行一個 Claude Code channel session
- **Webhook 需公開 URL** — 本地開發需透過 Cloudflare Tunnel 或 ngrok 暴露 port

## 重啟 / 維護 Workflow

### 一鍵重啟（推薦）

在 EClaw Dashboard 上按「重新連線」按鈕即可。後端會自動呼叫 bridge 的 `/restart` endpoint，執行智慧重啟。

**流程：**
```
Dashboard 重新連線 → Railway POST /api/entity/refresh
  → POST {webhookUrl}/restart → bridge.ts spawn restart-channel.sh
    → kill eclaw-bot tmux → recreate → 等 fakechat 回來 (~3 秒)
  ← Dashboard 顯示「🔄 通道已成功重啟」
```

也可以直接用 curl 觸發（需 API Key）：
```bash
curl -X POST https://a.eclawbot.com/restart \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ECLAW_API_KEY" \
  -d '{"mode":"--smart"}'
# 回傳: {"ok":true,"action":"restarted","message":"Claude Code restarted successfully in 3s"}
```

`/restart` endpoint 參數：
| mode | 行為 |
|------|------|
| `--smart` (預設) | 等同 `--force`，因為 infra 健康不代表 bot 會回應 |
| `--force` | 強制 kill + recreate eclaw-bot tmux session |
| `--bridge-only` | 只重啟 bridge，不動 Claude Code |

### 手動完整重啟（備用）

如果 tunnel 斷了、bridge 也掛了，dashboard 打不到 `/restart`，需要手動操作：

```bash
# 1. 停掉 bridge
pkill -f "bun.*bridge.ts"

# 2. 停掉 Claude Code
tmux kill-session -t eclaw-bot 2>/dev/null

# 3. 等 3 秒讓 port 釋放
sleep 3

# 4. 重新啟動 Claude Code + fakechat
tmux new-session -d -s eclaw-bot
tmux send-keys -t eclaw-bot 'claude --dangerously-skip-permissions --channels plugin:fakechat@claude-plugins-official' Enter

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
tmux send-keys -t eclaw-bot 'claude --dangerously-skip-permissions --channels plugin:fakechat@claude-plugins-official' Enter
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
| Bot 不回應 | Claude Code 卡住/frozen | **Dashboard 按「重新連線」** 一鍵重啟 |
| EClaw 訊息完全沒到 | Tunnel 斷了 / bridge 沒跑 | 確認 Docker Desktop + cloudflared 在跑，再按重新連線 |
| Dashboard 重新連線顯示「通道重啟失敗」| Tunnel 斷了，bridge 收不到 | 手動完整重啟（見上方備用流程） |
| bridge log 顯示 "Forwarded" 但沒回覆 | fakechat WS 斷線或 Claude Code idle | Dashboard 重新連線 |
| Claude Code 卡在 permission prompt | pre-tool-use hook 等待審批 | Dashboard 重新連線（會 kill 整個 session） |
| 回覆一下有一下沒有 | Claude Code channel 實驗性限制 | 正常現象，考慮改用 OpenClaw |
| "Weekly limit reached" | claude.ai 用量到頂 | 等每週重置，或改用 OpenClaw + API Key |
| 安裝新 MCP 後 bot 說要重啟 | Claude Code 需重新載入 | Dashboard 重新連線 |
| bridge log: "WS error" 一直重連 | Claude Code / fakechat 沒啟動 | 先確認 `curl localhost:8787` 有回應 |
| 502 Bad Gateway | Tunnel 指向錯誤 port | 確認指向 18800（bridge），不是 8787 |

### Bridge 無法連接 fakechat WebSocket

```bash
# 確認 fakechat 在跑
curl http://localhost:8787/  # 應回傳 HTML

# 如果沒回應，重啟 Claude Code
tmux kill-session -t eclaw-bot
tmux new-session -d -s eclaw-bot
tmux send-keys -t eclaw-bot 'claude --dangerously-skip-permissions --channels plugin:fakechat@claude-plugins-official' Enter
```

### EClaw 訊息沒有到達 Claude Code

1. 檢查 bridge log：`cat /tmp/eclaw-bridge.log`
2. 確認 webhook 可達：`curl http://localhost:18800/health`
3. 確認 WebSocket 已連線：health 回應中 `wsConnected` 應為 `true`
4. 如果都正常但 Claude Code 沒反應，在 tmux 裡手動輸入一句話激活 session

## 已知問題與修復紀錄

### 2026-04-21 Context Overflow + Kanban Flood + Playwright 旁路事件

**現象**：eclaw-bot Claude Code channel 連續 13 小時未回覆，期間累積 140 筆 pending webhook 訊息（104 筆是 kanban 自動觸發）。eclaw-bot session 吃到 111.9k / 200k tokens，Claude 放棄 `reply` tool，改用 Playwright 開瀏覽器點 EClaw web UI 的 ↩ 按鈕，導致回覆完全沒進到正常流程。

**根因（兩個 bot 端失效 + 一個人為補救缺失）**：
1. **Bot 沒在處理 kanban 任務** — kanban 卡累積是**結果**不是原因；bot 的正常職責就是消化工作佇列
2. **Context 壓力無監測** — 近滿時 Claude 行為變異（放棄 MCP tool、改跑瀏覽器自動化）
3. **Reply tool 強制失效** — `patch-fakechat.sh` 的 instructions 在 context 壓力下被 Claude「忽略」

**修復**（本次提交，bridge 側自動化）：
- `ECLAW_CONTEXT_WATCH_ENABLED=true`（預設）— bridge 每 60s 讀 tmux 畫面偵測 `N% until auto-compact`，20% 警告 / 5% 自動 `/clear`
- `ECLAW_REPLY_TIMEOUT_S=120`（預設）— 收訊 2 分鐘後 Claude 還在 busy 但沒 reply，自動注入提醒訊息：「不要用 Playwright 點 UI，請用 reply tool」
- `ECLAW_FORWARD_KANBAN=true`（預設）— kanban 是 bot 的工作佇列，**不**應該過濾掉。此旗標僅保留作為緊急靜音：context overflow 復原過程中如果 bot 還沒穩定，可以暫時設 `false` 減緩湧入

**設計原則**：Kanban 是 bot 的工作本身，不是噪音。修復方向是「幫 bot 處理好」，不是「把工作藏起來」。Context 監測 + reply enforcer 讓 bot 在瀕臨失效前自我修正，無須人工介入。

**復原程序**（如未來重現）：
```bash
# 1. 立即釋放 context
tmux send-keys -t eclaw-bot Escape
tmux send-keys -t eclaw-bot '/clear' Enter

# 2. 檢查 bridge log 找 root cause
tail -200 /tmp/eclaw-bridge.log | grep -E "kanban|Forwarding reply|Reply forward"

# 3. 確認沒有遺留 Playwright session
ps aux | grep -i "playwright\|chromium" | grep -v grep

# 4. 如果有 Playwright 卡在 headless session，kill 掉再重啟 bridge
pkill -f "playwright"
tmux kill-session -t eclaw-bridge
tmux new-session -d -s eclaw-bridge
tmux send-keys -t eclaw-bridge 'cd $REPO && bun bridge.ts' Enter
```

**驗證新配置已生效**：
```bash
curl -s http://localhost:18800/health | jq
# 應看到：forwardKanban=false, contextWatchEnabled=true, replyTimeoutSeconds=120
```

## License

MIT
