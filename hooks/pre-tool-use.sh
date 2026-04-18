#!/usr/bin/env bash
# Claude Code PreToolUse hook — routes sensitive ops to EClaw bridge /ask endpoint
#
# Reads the Claude Code hook JSON from stdin, detects tool operations that
# touch .claude/ paths, and long-polls the bridge for user approval.
#
# Persists "approve_always" decisions to an allowlist so the user isn't
# re-prompted for every cat/head/grep on a different tool-results file.
# Entries are keyed by (tool + verb) for Bash or (tool + directory prefix)
# for Write/Edit, with a DENY_VERBS safety net that refuses to persist
# destructive verbs (rm, dd, mkfs, shred, chmod, chown) even if the user
# mis-clicks "approve_always" on a benign-looking command.
#
# Exit codes:
#   0 — allow the tool call to proceed
#   2 — deny the tool call (stderr message shown to Claude)

set -euo pipefail

BRIDGE_URL="${ECLAW_BRIDGE_URL:-http://localhost:18800}"
LOG_FILE="${ECLAW_HOOK_LOG:-/tmp/eclaw-hook.log}"
ALLOWLIST_FILE="${ECLAW_HOOK_ALLOWLIST:-$HOME/.claude/hooks/eclaw-allowlist.txt}"

# Verbs that are NEVER persisted via approve_always. User can still
# one-off approve them; they just don't get stored in the allowlist.
DENY_VERBS_REGEX='^(rm|dd|mkfs|shred|chmod|chown|mv|cp|truncate|unlink|wipe)$'

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
      # DENY-LIST approach: only flag as sensitive if the command touches
      # truly dangerous config files (settings.json, hooks/, keybindings.json)
      # OR uses a destructive verb. Everything else on .claude/ is auto-approved.
      if printf '%s' "$COMMAND" | grep -qE '(settings\.json|keybindings\.json|hooks/)' && \
         printf '%s' "$COMMAND" | grep -qvE '^(cat|head|tail|less|wc|grep|rg|find|ls|stat|file) '; then
        SENSITIVE=1
      else
        SENSITIVE=0
      fi
    fi
    ;;
  Write|Edit)
    FILE_PATH="$(printf '%s' "$TOOL_INPUT" | jq -r '.file_path // empty')"
    if printf '%s' "$FILE_PATH" | grep -qE '\.claude/'; then
      # Only flag writes to settings/hooks/keybindings as sensitive.
      # plans, todos, memory, projects, bin, plugins, scheduled-tasks → auto-approve.
      if printf '%s' "$FILE_PATH" | grep -qE '\.claude/(settings\.json|settings\.local\.json|keybindings\.json|hooks/)'; then
        SENSITIVE=1
      else
        SENSITIVE=0
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

# ── Build an allowlist key for the current op ──
# Bash:  "bash:<first-verb>"           e.g. "bash:cat", "bash:grep"
# Write: "write:<dirname-of-file>/"    e.g. "write:/Users/hank/.claude/projects/-Users-hank-Desktop-Project/memory/"
# Edit:  "edit:<dirname-of-file>/"     e.g. "edit:/Users/hank/.claude/projects/-Users-hank-Desktop-Project/memory/"
ALLOWLIST_KEY=""
case "$TOOL_NAME" in
  Bash)
    # Strip leading whitespace, take first token (the verb). Drop anything
    # that could be a path-embedded verb or contains shell metacharacters
    # in the verb slot itself. The actual command body is allowed to have
    # pipes, redirects, etc. — only the verb needs to be clean.
    VERB="$(printf '%s' "$COMMAND" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]].*//' | tr -d '\n')"
    # Unwrap env/sudo: if the first token is env or sudo, look at the next
    # one (but don't chain further; one hop is enough for common patterns).
    if [ "$VERB" = "env" ] || [ "$VERB" = "sudo" ] || [ "$VERB" = "nohup" ] || [ "$VERB" = "exec" ]; then
      VERB="$(printf '%s' "$COMMAND" | sed -e 's/^[[:space:]]*//' -e "s/^$VERB[[:space:]]*//" -e 's/[[:space:]].*//' | tr -d '\n')"
    fi
    # Sanity: verb must be a plain identifier-ish token (no slash means it's
    # not a path, no metacharacters means we're not matching a shell fragment).
    if printf '%s' "$VERB" | grep -qE '^[A-Za-z_][A-Za-z0-9_.+-]*$'; then
      ALLOWLIST_KEY="bash:$VERB"
    fi
    ;;
  Write|Edit)
    if [ -n "$FILE_PATH" ]; then
      DIR="$(dirname "$FILE_PATH")"
      TOOL_LOWER="$(printf '%s' "$TOOL_NAME" | tr '[:upper:]' '[:lower:]')"
      ALLOWLIST_KEY="$TOOL_LOWER:$DIR/"
    fi
    ;;
esac

# ── Check allowlist BEFORE asking ──
if [ -n "$ALLOWLIST_KEY" ] && [ -f "$ALLOWLIST_FILE" ]; then
  if grep -qxF "$ALLOWLIST_KEY" "$ALLOWLIST_FILE" 2>/dev/null; then
    log "Auto-approved (allowlist hit): key=$ALLOWLIST_KEY tool=$TOOL_NAME"
    exit 0
  fi
fi

log "Sensitive op detected: tool=$TOOL_NAME key=\"$ALLOWLIST_KEY\" command=\"${COMMAND:0:120}\" file_path=\"$FILE_PATH\""

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
log "Bridge response: $RESPONSE -> action=$ACTION key=$ALLOWLIST_KEY"

case "$ACTION" in
  approve)
    exit 0
    ;;
  approve_always)
    # Persist to allowlist so future identical ops skip the prompt.
    if [ -n "$ALLOWLIST_KEY" ]; then
      # Refuse to persist destructive Bash verbs — one-off approval is
      # fine, but we don't want a stray click to silently blanket-allow
      # `rm` on anything under .claude/ forever.
      if [ "$TOOL_NAME" = "Bash" ]; then
        VERB_ONLY="${ALLOWLIST_KEY#bash:}"
        if printf '%s' "$VERB_ONLY" | grep -qE "$DENY_VERBS_REGEX"; then
          log "Refusing to persist destructive verb to allowlist: $ALLOWLIST_KEY (one-off approval only)"
          exit 0
        fi
      fi
      mkdir -p "$(dirname "$ALLOWLIST_FILE")"
      # Only append if not already present
      if ! grep -qxF "$ALLOWLIST_KEY" "$ALLOWLIST_FILE" 2>/dev/null; then
        echo "$ALLOWLIST_KEY" >> "$ALLOWLIST_FILE"
        log "Added to allowlist: $ALLOWLIST_KEY"
      fi
    else
      log "approve_always but no ALLOWLIST_KEY derived — one-off approval"
    fi
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
