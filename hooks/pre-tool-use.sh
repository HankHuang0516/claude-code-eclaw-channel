#!/usr/bin/env bash
# Claude Code PreToolUse hook — routes sensitive ops to EClaw bridge /ask endpoint
#
# Reads the Claude Code hook JSON from stdin, detects tool operations that
# touch .claude/ paths, and long-polls the bridge for user approval.
#
# Exit codes:
#   0 — allow the tool call to proceed
#   2 — deny the tool call (stderr message shown to Claude)

set -euo pipefail

BRIDGE_URL="${ECLAW_BRIDGE_URL:-http://localhost:18800}"
LOG_FILE="${ECLAW_HOOK_LOG:-/tmp/eclaw-hook.log}"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE" 2>/dev/null || true
}

# Read hook JSON from stdin
INPUT="$(cat)"

# Require jq for safe JSON parsing
if ! command -v jq >/dev/null 2>&1; then
  log "jq not found, allowing by default"
  exit 0
fi

TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')"
TOOL_INPUT="$(printf '%s' "$INPUT" | jq -c '.tool_input // {}')"

COMMAND=""
FILE_PATH=""
SENSITIVE=0

case "$TOOL_NAME" in
  Bash)
    COMMAND="$(printf '%s' "$TOOL_INPUT" | jq -r '.command // empty')"
    if printf '%s' "$COMMAND" | grep -qE '(\.claude/|~/\.claude|\$HOME/\.claude)'; then
      SENSITIVE=1
    fi
    ;;
  Write|Edit)
    FILE_PATH="$(printf '%s' "$TOOL_INPUT" | jq -r '.file_path // empty')"
    if printf '%s' "$FILE_PATH" | grep -qE '\.claude/'; then
      # Whitelist: plans, todos, memory are safe for bot to write
      if printf '%s' "$FILE_PATH" | grep -qE '\.claude/(plans|todos|memory)/'; then
        SENSITIVE=0
      else
        SENSITIVE=1
      fi
    fi
    ;;
  *)
    SENSITIVE=0
    ;;
esac

if [ "$SENSITIVE" -eq 0 ]; then
  exit 0
fi

log "Sensitive op detected: tool=$TOOL_NAME command=\"${COMMAND:0:120}\" file_path=\"$FILE_PATH\""

REASON="Touches .claude/ path — requires approval"
PAYLOAD="$(jq -n \
  --arg tool "$TOOL_NAME" \
  --arg command "$COMMAND" \
  --arg file_path "$FILE_PATH" \
  --arg reason "$REASON" \
  '{tool:$tool, command:$command, file_path:$file_path, reason:$reason}')"

# Long-poll bridge — NO timeout, wait indefinitely for user decision
RESPONSE="$(curl -sS --max-time 0 -X POST "$BRIDGE_URL/ask" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>>"$LOG_FILE" || true)"

if [ -z "$RESPONSE" ]; then
  log "Empty response from bridge, denying by default"
  echo "EClaw bridge unreachable — denying sensitive .claude/ operation" >&2
  exit 2
fi

ACTION="$(printf '%s' "$RESPONSE" | jq -r '.action // empty')"
log "Bridge response: $RESPONSE -> action=$ACTION"

case "$ACTION" in
  approve)
    exit 0
    ;;
  approve_always)
    # TODO: persist allowlist so future identical ops are auto-approved
    exit 0
    ;;
  deny)
    echo "User denied this operation via EClaw (tool=$TOOL_NAME)" >&2
    exit 2
    ;;
  *)
    log "Unknown action '$ACTION', denying"
    echo "Unknown approval response from EClaw bridge — denying" >&2
    exit 2
    ;;
esac
