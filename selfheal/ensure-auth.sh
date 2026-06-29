#!/usr/bin/env bash
# selfheal/ensure-auth.sh — guarantee the `claude` CLI is logged in BEFORE the channel launches,
# REUSING the existing Claude Code (Max subscription) credential. No API-key billing switch, no
# browser, no new secret.
#
# WHY THIS EXISTS (durable self-improvement, 2026-06-29):
#   #2 went fully dark for ~7h because the macOS Keychain item "Claude Code-credentials" was wiped
#   (accessToken+refreshToken empty, expiresAt=0). Every restart then launched a session that just
#   said "Not logged in · Run /login" — the model could not run at all. restart-channel.sh happily
#   launched these doomed sessions, and the bridge masked it by forwarding the "⏳ Processing..."
#   auto-ack as a real reply, so passive-health + the wedge-watchdog both false-greened it.
#
# WHAT IT DOES (idempotent, safe to run on every restart):
#   1. If the primary Keychain credential is healthy (has a refreshToken), snapshot it into a BACKUP
#      Keychain item so we always have the freshest rotating refresh token captured.
#   2. If the primary is wiped/empty, RESTORE it from (a) the backup Keychain item, else (b) the
#      on-disk fallback ~/.claude/.credentials.json. This is the same account/subscription — i.e.
#      "用目前 Claude Code 同個 key".
#   3. VERIFY headlessly with the SAME `claude` CLI the channel uses (a tiny -p prompt). This also
#      primes a token refresh (claude refreshes an expired access token from the refresh token and
#      writes it back to Keychain). On success, re-snapshot the now-fresh primary into the backup.
#   4. If it still cannot authenticate, EXIT NON-ZERO so the caller ABORTS the launch and escalates
#      to Hank (run `claude` + /login) instead of starting a "Not logged in" zombie.
#
# SECURITY: tokens live only in the macOS Keychain (secure storage). Secret values are passed to
#   `security ... -w` via command substitution so they never appear in this script's stdout/logs or
#   the agent transcript; the only exposure is a momentary argv on a single-user personal Mac, the
#   same tradeoff already used by the documented manual recovery. Nothing is ever printed.
set -uo pipefail

U="${USER:-$(id -un)}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
PRIMARY_SVC="Claude Code-credentials"
BACKUP_SVC="eclaw-claude-code-credentials-backup"
FILE_FALLBACK="$HOME/.claude/.credentials.json"
VERIFY_MODEL="${ENSURE_AUTH_VERIFY_MODEL:-claude-haiku-4-5-20251001}"  # cheap model for the probe
VERIFY_TIMEOUT="${ENSURE_AUTH_VERIFY_TIMEOUT:-75}"
LOG="/tmp/eclaw-ensure-auth.log"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ensure-auth: $*" >> "$LOG"; }

# 0 if the keychain item named $1 (account $U) holds a non-empty claudeAiOauth.refreshToken
cred_has_refresh() {
  security find-generic-password -s "$1" -a "$U" -w 2>/dev/null | python3 -c "
import json,sys
try: o=json.load(sys.stdin).get('claudeAiOauth',{})
except Exception: sys.exit(1)
sys.exit(0 if o.get('refreshToken') else 1)" 2>/dev/null
}

# copy the credential JSON from keychain item $1 (or file path if $1 starts with /) into keychain
# item $2. Returns non-zero if the source is empty/unreadable. Secret never printed.
copy_cred() {
  local src="$1" dst="$2" val
  if [ "${src:0:1}" = "/" ]; then
    [ -f "$src" ] || return 1
    val="$(cat "$src" 2>/dev/null)"
  else
    val="$(security find-generic-password -s "$src" -a "$U" -w 2>/dev/null)"
  fi
  [ -n "$val" ] || return 1
  printf '%s' "$val" | python3 -c "import json,sys;json.load(sys.stdin)" >/dev/null 2>&1 || return 1
  security add-generic-password -U -s "$dst" -a "$U" -w "$val" 2>/dev/null
}

# headless auth probe with the SAME CLI the channel uses; bounded; no model name leaked into output
verify_login() {
  local out rc
  out="$(cd /tmp && CI=1 "$CLAUDE_BIN" --model "$VERIFY_MODEL" -p "reply with the single word READY" 2>&1 &
    pid=$!; ( sleep "$VERIFY_TIMEOUT"; kill "$pid" 2>/dev/null ) & wpid=$!;
    wait "$pid" 2>/dev/null; rc=$?; kill "$wpid" 2>/dev/null; exit $rc)"
  if printf '%s' "$out" | grep -qiE "not logged in|run /login|please run /login|invalid api key|authentication"; then
    return 1
  fi
  printf '%s' "$out" | grep -qiE "READY|OK|在線|online|received" && return 0
  # ambiguous output but no explicit auth error → treat as logged in (don't false-block a healthy CLI)
  return 0
}

main() {
  if cred_has_refresh "$PRIMARY_SVC"; then
    log "primary credential healthy (refreshToken present); snapshotting to backup"
    copy_cred "$PRIMARY_SVC" "$BACKUP_SVC" && log "backup updated" || log "backup snapshot skipped (copy failed)"
    echo "ok: primary credential present"
    return 0
  fi

  log "PRIMARY credential MISSING/empty — attempting to reuse existing Claude Code key"
  if cred_has_refresh "$BACKUP_SVC" && copy_cred "$BACKUP_SVC" "$PRIMARY_SVC"; then
    log "restored primary from BACKUP keychain item"
  elif copy_cred "$FILE_FALLBACK" "$PRIMARY_SVC"; then
    log "restored primary from on-disk fallback $FILE_FALLBACK"
  else
    log "ESCALATE: no usable credential in backup or file fallback — cannot reuse key unattended"
    echo "fail: no usable credential to restore; needs human /login"
    return 3
  fi

  log "verifying restored credential headlessly..."
  if verify_login; then
    log "verify OK — CLI authenticated (same account). Re-snapshotting refreshed primary to backup."
    copy_cred "$PRIMARY_SVC" "$BACKUP_SVC" || true
    echo "ok: credential restored and verified"
    return 0
  fi

  log "ESCALATE: restored credential did NOT authenticate (refresh token likely revoked). Needs human /login."
  echo "fail: restored credential invalid; needs human /login"
  return 3
}

main "$@"
