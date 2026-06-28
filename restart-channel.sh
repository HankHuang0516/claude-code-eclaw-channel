#!/usr/bin/env bash
# restart-channel.sh — Smart Claude Channel restart script
# Called by bridge.ts POST /restart or manually.
# Outputs JSON to stdout for programmatic consumption.
set -euo pipefail

# ── Config ──
TMUX_SESSION="eclaw-bot"
FAKECHAT_URL="http://localhost:8787"
FAKECHAT_PLUGIN_DIR="$HOME/.claude/plugins/cache/claude-plugins-official/fakechat/0.0.1"
CHANNEL_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_TMUX_SESSION="eclaw-bridge"
MAX_WAIT=45   # seconds to wait for fakechat to come back

load_channel_env() {
  if [ -f "$CHANNEL_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$CHANNEL_DIR/.env"
    set +a
  fi

  if [ -f "$CHANNEL_DIR/TOOLS.local.md" ]; then
    while IFS= read -r line; do
      eval "$line"
    done < <(grep '^export ' "$CHANNEL_DIR/TOOLS.local.md" || true)
  fi

  export ECLAW_WEBHOOK_URL="${ECLAW_WEBHOOK_URL:-https://b2.eclawbot.com}"
  export ECLAW_BOT_NAME="${ECLAW_BOT_NAME:-Mac_ClaudeAce主管}"
  export ECLAW_ENTITY_ID="${ECLAW_ENTITY_ID:-2}"
}

# ── Helpers ──
json_out() {
  local ok="$1" action="$2" msg="$3"
  echo "{\"ok\":$ok,\"action\":\"$action\",\"message\":\"$msg\"}"
}

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> /tmp/eclaw-restart.log
}

check_fakechat() {
  curl -sf --max-time 3 "$FAKECHAT_URL/" > /dev/null 2>&1
}

check_tmux_session() {
  tmux has-session -t "$1" 2>/dev/null
}

check_fakechat_process() {
  local pid
  pid="$(lsof -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  if [ -z "$pid" ]; then
    return 1
  fi
  ps -p "$pid" -ww -o command= 2>/dev/null | grep -Eq 'bun( |.*/)?server\.ts'
}

# ── Smart model resolution (#2 智慧默認使用最新模型) ──────────────────────────
# resolve_latest_model: the newest/most-capable model id. Source of truth =
# model-policy.json "latest"[0]; if ANTHROPIC_API_KEY is set, prefer the live newest id
# of that family from /v1/models. Always returns a concrete, non-empty id.
resolve_latest_model() {
  local pol="$CHANNEL_DIR/model-policy.json" first=""
  [ -f "$pol" ] && first="$(python3 -c "import json;l=json.load(open('$pol')).get('latest',[]);print(l[0] if l else '')" 2>/dev/null)"
  if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ -n "$first" ]; then
    local fam live
    fam="$(printf '%s' "$first" | sed -E 's/^claude-([a-z]+).*/\1/')"
    live="$(curl -sf --max-time 4 'https://api.anthropic.com/v1/models?limit=100' \
      -H "x-api-key: $ANTHROPIC_API_KEY" -H 'anthropic-version: 2023-06-01' 2>/dev/null \
      | python3 -c "import sys,json;d=json.load(sys.stdin).get('data',[]);ms=[m for m in d if '$fam' in m.get('id','')];ms.sort(key=lambda m:m.get('created_at',''),reverse=True);print(ms[0]['id'] if ms else '')" 2>/dev/null)"
    [ -n "$live" ] && first="$live"
  fi
  printf '%s' "${first:-claude-opus-4-7}"
}

# resolve_model_candidates: ordered launch candidates (one per line). An explicit pin yields
# just that model; a sentinel (latest/auto/default/empty) yields the full ordered latest[]
# list so the launch falls through to a working model if the newest is unavailable. Strips
# any [..] context suffix (zsh-glob-unsafe in the unquoted launch).
resolve_model_candidates() {
  local m; m="$(printf '%s' "${CLAUDE_MODEL:-}" | tr '[:upper:]' '[:lower:]')"
  if [ -n "${CLAUDE_MODEL:-}" ] && [ "$m" != latest ] && [ "$m" != auto ] && [ "$m" != default ]; then
    printf '%s\n' "${CLAUDE_MODEL%%[[]*}"
    return
  fi
  local pol="$CHANNEL_DIR/model-policy.json"
  [ -f "$pol" ] && python3 -c "import json;[print(str(x).split('[')[0]) for x in json.load(open('$pol')).get('latest',[])]" 2>/dev/null
  printf '%s\n' "claude-opus-4-7"   # ultimate known-good fallback (deduped at launch)
}

# ── Mode: --smart (default), --force, --bridge-only ──
MODE="${1:---smart}"

load_channel_env
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
# #2 fleet policy: default to Opus 4.7 unless Hank explicitly changes the pin.
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-4-7}"
log "restart-channel.sh invoked with mode=$MODE (model=$CLAUDE_MODEL)"
if [ -z "${ECLAW_API_KEY:-}" ]; then
  log "ERROR: ECLAW_API_KEY is not set; create $CHANNEL_DIR/.env or export it before restart"
  json_out "false" "missing_env" "ECLAW_API_KEY is not set"
  exit 1
fi

# ── Smart restart ──
case "$MODE" in
  --bridge-only)
    log "Bridge-only restart requested"
    if check_tmux_session "$BRIDGE_TMUX_SESSION"; then
      tmux send-keys -t "$BRIDGE_TMUX_SESSION" C-c C-c 2>/dev/null || true
      sleep 1
    fi
    # Kill any existing bridge process
    pkill -f "bun.*bridge.ts" 2>/dev/null || true
    sleep 1
    # Restart bridge in its tmux session
    if ! check_tmux_session "$BRIDGE_TMUX_SESSION"; then
      tmux new-session -d -s "$BRIDGE_TMUX_SESSION" -c "$CHANNEL_DIR"
    fi
    tmux send-keys -t "$BRIDGE_TMUX_SESSION" \
      "cd $CHANNEL_DIR && set -a; [ -f .env ] && . ./.env; set +a; bun bridge.ts" Enter
    sleep 3
    json_out "true" "bridge_restarted" "Bridge process restarted"
    exit 0
    ;;

  --force)
    log "Force restart: killing eclaw-bot tmux session"
    ;;

  --smart|*)
    # Smart mode = force restart. A "healthy" fakechat/tmux doesn't mean
    # Claude Code is actually responsive (it could be stuck on a permission
    # prompt or frozen mid-task). Restart is fast (~3s), so always do it.
    log "Smart mode: always restart (healthy infra != responsive bot)"
    ;;
esac

# ── Full restart: Kill and recreate Claude Code session ──
log "Performing full Claude Code restart..."

# Kill existing tmux session
if check_tmux_session "$TMUX_SESSION"; then
  log "Killing existing tmux session: $TMUX_SESSION"
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  sleep 2
fi

# Kill any process holding port 8787 (the fakechat HTTP port).
# Bun MCP children sometimes don't receive SIGHUP from tmux kill-session
# cleanly, leaving fakechat bound to 8787 as an orphan. If the port
# stays occupied, the new Claude Code's fakechat MCP spawn silently
# fails → /mcp shows "plugin:fakechat:fakechat ✘ failed" and the reply
# tool is unavailable. This was the root cause of /model switches
# leaving the bot unable to reply.
#
# Port-based targeting (lsof) is more reliable than pattern matching
# against command lines — Bun spawns fakechat as `bun server.ts` with
# no "fakechat" text in argv, so pgrep patterns miss it.
PORT_HOLDERS=$(lsof -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "$PORT_HOLDERS" ]; then
  log "Killing process(es) holding port 8787: $PORT_HOLDERS"
  # shellcheck disable=SC2086
  kill $PORT_HOLDERS 2>/dev/null || true
  sleep 1
  # Hard kill if still alive
  STILL_ALIVE=$(lsof -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$STILL_ALIVE" ]; then
    log "Hard-killing leftover fakechat: $STILL_ALIVE"
    # shellcheck disable=SC2086
    kill -9 $STILL_ALIVE 2>/dev/null || true
    sleep 2
  fi
fi

# Verify port 8787 is free before launching new Claude Code.
# If something is still holding it, abort and report so caller doesn't
# think the restart succeeded when it actually didn't.
if lsof -iTCP:8787 -sTCP:LISTEN -t >/dev/null 2>&1; then
  HOLDER=$(lsof -iTCP:8787 -sTCP:LISTEN -t | head -1)
  log "ERROR: port 8787 still held by PID $HOLDER after cleanup"
  json_out "false" "port_busy" "Port 8787 still held by PID $HOLDER — refusing to restart"
  exit 1
fi

# Also need to update the check further down: fakechat HTTP might come
# back quickly (within 3s of restart) because Bun is fast. But we want
# to verify it's the NEW instance, not a stale one. The port-clear
# check above ensures the new fakechat is spawned fresh.

# Launch Claude Code, trying each candidate model until fakechat comes up.
# #2 智慧默認使用最新模型: a sentinel CLAUDE_MODEL expands to the ordered latest[] list, so the
# newest model is used when available and a missing/unavailable newest model never bricks #2 —
# the loop falls through to the next candidate (ending at the known-good fallback).
launched_model=""
seen_models=" "
for CAND in $(resolve_model_candidates); do
  [ -z "$CAND" ] && continue
  case "$seen_models" in *" $CAND "*) continue ;; esac
  seen_models="$seen_models$CAND "

  log "Creating tmux session $TMUX_SESSION and launching Claude Code (model=$CAND)..."
  # Clean slate for each attempt (a failed launch can orphan fakechat on 8787).
  tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  sleep 1
  RETRY_PORT_HOLDERS=$(lsof -iTCP:8787 -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$RETRY_PORT_HOLDERS" ]; then
    # shellcheck disable=SC2086
    kill $RETRY_PORT_HOLDERS 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $RETRY_PORT_HOLDERS 2>/dev/null || true
  fi

  tmux new-session -d -s "$TMUX_SESSION" -c "$CHANNEL_DIR"
  sleep 1
  tmux send-keys -t "$TMUX_SESSION" \
    "$CLAUDE_BIN --dangerously-skip-permissions --model $CAND --channels plugin:fakechat@claude-plugins-official --settings '{\"ultracode\": true}'" Enter

  # Wait for fakechat. HTTP 200 alone is insufficient (could be a stale orphan) — also
  # require the bun server.ts process, confirming the new Claude Code spawned it.
  log "Waiting for fakechat to start (max ${MAX_WAIT}s) on model $CAND..."
  WAITED=0
  while [ $WAITED -lt $MAX_WAIT ]; do
    sleep 3
    WAITED=$((WAITED + 3))
    if check_fakechat && check_fakechat_process; then
      launched_model="$CAND"
      break
    fi
  done

  if [ -n "$launched_model" ]; then
    log "fakechat is back online after ${WAITED}s on model $launched_model (HTTP OK + bun process up)"
    break
  fi
  log "model $CAND did not bring fakechat up within ${MAX_WAIT}s; trying next candidate"
done

if [ -n "$launched_model" ]; then
  json_out "true" "restarted" "Claude Code restarted on model $launched_model"
  exit 0
fi

log "no candidate model brought fakechat up"
json_out "false" "timeout" "Claude Code restart timed out; no candidate model started fakechat."
exit 1
