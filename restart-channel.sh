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

# Claude Code launch command
CLAUDE_BIN="claude"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-sonnet-4-20250514}"
CLAUDE_ARGS="--dangerously-skip-permissions --model $CLAUDE_MODEL"

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

# ── Mode: --smart (default), --force, --bridge-only ──
MODE="${1:---smart}"

log "restart-channel.sh invoked with mode=$MODE"

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
      "cd $CHANNEL_DIR && ECLAW_API_KEY=\$ECLAW_API_KEY ECLAW_WEBHOOK_URL=\$ECLAW_WEBHOOK_URL ECLAW_BOT_NAME=\$ECLAW_BOT_NAME bun bridge.ts" Enter
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

# Create new tmux session and launch Claude Code
log "Creating tmux session $TMUX_SESSION and launching Claude Code..."
tmux new-session -d -s "$TMUX_SESSION" -c "$CHANNEL_DIR"
sleep 1

# Launch Claude Code with the channel plugin
tmux send-keys -t "$TMUX_SESSION" \
  "$CLAUDE_BIN $CLAUDE_ARGS --channels plugin:fakechat@claude-plugins-official" Enter

# Wait for fakechat to come back online. Note: HTTP 200 only means the
# HTTP server bound to 8787 — it does NOT guarantee the MCP-to-Claude
# pipe is alive. After /model restart, if the old orphan fakechat was
# the one holding 8787 (cleanup above should prevent this, but just
# in case), HTTP would respond but Claude's `reply` tool would be
# unusable. An extra check: verify the bun process running server.ts
# is a child of the new tmux-spawned Claude Code, not a leftover.
log "Waiting for fakechat to start (max ${MAX_WAIT}s)..."
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  sleep 3
  WAITED=$((WAITED + 3))
  if check_fakechat; then
    # Also check that a fakechat bun process exists (started by new Claude Code)
    if pgrep -f "bun.*fakechat.*server\.ts" >/dev/null; then
      log "fakechat is back online after ${WAITED}s (HTTP OK + bun process up)"
      json_out "true" "restarted" "Claude Code restarted successfully in ${WAITED}s"
      exit 0
    else
      log "fakechat HTTP responds but no bun process — retrying..."
    fi
  fi
done

log "fakechat did not come back within ${MAX_WAIT}s"
json_out "false" "timeout" "Claude Code restart timed out after ${MAX_WAIT}s. fakechat not responding."
exit 1
