#!/usr/bin/env bash
# selfheal/wedge-watchdog.sh — auto-detect & auto-heal #2's mid-work wedges.
#
# WHY THIS EXISTS (durable self-improvement, 2026-06-24):
#   #2 (Mac_ClaudeAce主管, the commander) wedged mid-work two days running (06-23, 06-24):
#     - Class 2 — Opus 4.8 cyber-flag wedge: long commander context accumulates
#       channel-security / self-repair material until Opus 4.8's cybersecurity classifier
#       trips. Every re-nudged turn re-submits the poisoned context and re-errors
#       ("API Error: ... flagged this message for a cybersecurity topic") -> silent non-reply.
#     - Class 1 — stuck/idle session: bridge keeps nudging, Claude is idle, no reply ever lands.
#   In BOTH classes passive-health reports GREEN (false-green), so the only prior detector was
#   the once-a-day fleet monitor — meaning hours of silent outage before a human/cron noticed.
#   Only a FRESH session clears either wedge (selfheal/self-repair.sh).
#
#   This watchdog closes that gap: it runs every couple of minutes, detects the wedge from
#   signals that are reliable regardless of class, and fires the SAME sanctioned self-repair
#   automatically — turning a multi-hour outage into a ~2-minute auto-recovery.
#
# DETECTION (class-agnostic, with a fast-path for the cyber-flag):
#   The bridge logs "Reply forwarded to EClaw successfully" on EVERY turn — including the
#   benign "[SILENT]" replies to routing-policy webhooks. So while #2 is alive that line keeps
#   appearing even when idle. If it STOPS for >= NO_REPLY_MIN minutes WHILE inbound webhooks are
#   still arriving, #2 is wedged. The cyber-flag string in the live tmux pane is an extra
#   fast-path confirmation.
#
# SAFETY:
#   - Liveness guard: never fires if a reply was forwarded recently (it would be healthy).
#   - Cooldown: after a repair, stay quiet for COOLDOWN_MIN so the fresh session can settle.
#   - Anti-loop: if it had to repair >= MAX_REPAIRS_HR times in the last hour, it STOPS
#     auto-repairing and only logs an escalation (something deeper than a wedge is wrong; a
#     human / the fleet monitor should look). This prevents a restart storm.
#   - Never prints secrets (delegates all EClaw calls to self-repair.sh).
set -uo pipefail

SELFHEAL_DIR="$(cd "$(dirname "$0")" && pwd)"
TMUX_SESSION="eclaw-bot"
BRIDGE_LOG="/tmp/eclaw-bridge.log"
STATE_DIR="/tmp/eclaw-wedge-watchdog"
LOG="/tmp/eclaw-wedge-watchdog.log"
REPAIR_HISTORY="$STATE_DIR/repair-history"   # one epoch per line, last N repairs

# ── Tunables ──
NO_REPLY_MIN=8          # forwarded-reply silence (min) at an IDLE prompt that counts as wedged
BUSY_NO_REPLY_MIN=25    # higher bar when the pane shows an active work spinner (avoid killing a
                        # genuinely long task; a real turn almost never runs this long silently)
INBOUND_WINDOW_SEC=600  # only "wedged" if a webhook arrived within this window (real traffic)
COOLDOWN_MIN=12         # quiet period after a repair (let the fresh session settle)
MAX_REPAIRS_HR=3        # > this many repairs in 60 min -> escalate, stop auto-repairing

mkdir -p "$STATE_DIR"
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] wedge-watchdog: $*" >> "$LOG"; }

now_epoch() { date -u +%s; }

# epoch of the most recent bridge-log line matching $1 (ISO ts in [..]); empty if none
last_epoch_for() {
  local pat="$1"
  grep -aE "$pat" "$BRIDGE_LOG" 2>/dev/null | tail -1 | \
    grep -oE '^\[[0-9T:.-]+Z\]' | tr -d '[]' | \
    python3 -c "import sys,datetime
s=sys.stdin.read().strip()
if not s: sys.exit(0)
try:
  dt=datetime.datetime.strptime(s.split('.')[0],'%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc)
  print(int(dt.timestamp()))
except Exception: pass" 2>/dev/null
}

# count repairs in the last 60 min from REPAIR_HISTORY
repairs_last_hour() {
  [ -f "$REPAIR_HISTORY" ] || { echo 0; return; }
  local cutoff; cutoff=$(( $(now_epoch) - 3600 ))
  awk -v c="$cutoff" '$1>=c' "$REPAIR_HISTORY" 2>/dev/null | wc -l | tr -d ' '
}

# ── 0. Preconditions ──
if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  log "eclaw-bot tmux session absent — channel down (not a wedge); leaving to self-repair/monitor"
  exit 0
fi
[ -f "$BRIDGE_LOG" ] || { log "no bridge log at $BRIDGE_LOG; skip"; exit 0; }

NOW=$(now_epoch)

# ── 1. Cooldown guard ──
if [ -f "$STATE_DIR/last-repair" ]; then
  LAST_REPAIR=$(cat "$STATE_DIR/last-repair" 2>/dev/null || echo 0)
  if [ $(( NOW - LAST_REPAIR )) -lt $(( COOLDOWN_MIN * 60 )) ]; then
    log "in cooldown ($(( (NOW-LAST_REPAIR)/60 ))m < ${COOLDOWN_MIN}m since last repair); skip"
    exit 0
  fi
fi

# ── 2. Gather signals ──
LAST_REPLY_EPOCH=$(last_epoch_for "Reply forwarded to EClaw successfully")
LAST_WEBHOOK_EPOCH=$(last_epoch_for "Webhook received")

PANE="$(tmux capture-pane -t "$TMUX_SESSION" -p -S -80 2>/dev/null || true)"
CYBER_FLAG=0
echo "$PANE" | grep -q "safety measures that flagged this message for a cybersecurity topic" && CYBER_FLAG=1

# ── Class 3 — credential/login expiry (added 2026-06-29) ──
# Symptom: the eclaw-bot pane shows "Not logged in · Run /login" (often alongside a
# "API Usage Billing" header) on EVERY turn — the macOS Keychain "Claude Code-credentials" OAuth
# blob was wiped/expired (accessToken+refreshToken empty). HISTORY: self-repair USED to be futile
# here (a fresh session re-read the same empty Keychain). FIXED 2026-06-29: restart-channel.sh now
# runs selfheal/ensure-auth.sh first, which RESTORES the existing Claude Code key from a Keychain
# backup (or ~/.claude/.credentials.json) and verifies it — so self-repair IS now effective for an
# auth wipe. We therefore treat "Not logged in" as a wedge and let the normal heal flow run; it only
# escalates if ensure-auth cannot reuse the key (refusing to relaunch a doomed session).
NOT_LOGGED_IN=0
if echo "$PANE" | grep -qiE "Not logged in|Run /login|Please run /login"; then
  NOT_LOGGED_IN=1
  log "Class 3 credential/login expiry detected (pane 'Not logged in') — self-repair will auto-restore the existing Claude Code key via ensure-auth.sh; proceeding to heal."
fi

# Is Claude visibly mid-turn? Claude Code shows a spinner glyph + "esc to interrupt" while a turn
# is actively running. If so, it's (probably) doing legitimate long work — hold fire unless the
# silence is egregious. NOTE: a FROZEN spinner (stuck compaction) also matches, which is why the
# BUSY threshold still eventually triggers a repair.
BUSY=0
echo "$PANE" | grep -qiE "esc to interrupt|[✻✽✶✢·]+ +[A-Za-z]+…|tokens\)" && BUSY=1

# minutes since last forwarded reply (huge if never)
if [ -n "$LAST_REPLY_EPOCH" ]; then
  MINS_NO_REPLY=$(( (NOW - LAST_REPLY_EPOCH) / 60 ))
else
  MINS_NO_REPLY=9999
fi
# inbound traffic recently? (else a long no-reply is just genuine quiet, not a wedge)
RECENT_INBOUND=0
if [ -n "$LAST_WEBHOOK_EPOCH" ] && [ $(( NOW - LAST_WEBHOOK_EPOCH )) -lt "$INBOUND_WINDOW_SEC" ]; then
  RECENT_INBOUND=1
fi

# ── 3. Decide ──
# Threshold depends on whether Claude looks busy: an idle prompt with no reply is a wedge fast;
# a visible (possibly frozen) spinner gets a longer leash so we don't kill genuine long work.
THRESHOLD="$NO_REPLY_MIN"; [ "$BUSY" -eq 1 ] && THRESHOLD="$BUSY_NO_REPLY_MIN"
WEDGED=0
REASON=""
if [ "$NOT_LOGGED_IN" -eq 1 ]; then
  WEDGED=1; REASON="Class 3 credential/login expiry (pane 'Not logged in') — self-repair auto-restores the Claude Code key via ensure-auth.sh"
elif [ "$CYBER_FLAG" -eq 1 ] && [ "$MINS_NO_REPLY" -ge 3 ]; then
  WEDGED=1; REASON="cyber-flag in pane + no reply ${MINS_NO_REPLY}m (Class 2 Opus 4.8 safety wedge)"
elif [ "$RECENT_INBOUND" -eq 1 ] && [ "$MINS_NO_REPLY" -ge "$THRESHOLD" ]; then
  WEDGED=1; REASON="inbound traffic but no forwarded reply for ${MINS_NO_REPLY}m (busy=$BUSY, threshold ${THRESHOLD}m; stuck session)"
fi

if [ "$WEDGED" -eq 0 ]; then
  log "healthy (cyber=$CYBER_FLAG busy=$BUSY mins_no_reply=$MINS_NO_REPLY recent_inbound=$RECENT_INBOUND threshold=${THRESHOLD}m); no action"
  exit 0
fi

# ── 4. Anti-loop guard ──
RPH=$(repairs_last_hour)
if [ "$RPH" -ge "$MAX_REPAIRS_HR" ]; then
  log "ESCALATE: wedged ($REASON) but already repaired ${RPH}x in last hour (>= ${MAX_REPAIRS_HR}); NOT auto-repairing. Deeper issue — needs human/fleet-monitor. (cyber=$CYBER_FLAG)"
  exit 2
fi

# ── 5. Heal: fresh session via self-repair, then clear any blocking startup modal ──
log "WEDGE DETECTED: $REASON -> running self-repair.sh (repair #$((RPH+1)) this hour)"
REPAIR_JSON="$(bash "$SELFHEAL_DIR/self-repair.sh" 2>>"$LOG" | tail -1)"
echo "$NOW" >> "$REPAIR_HISTORY"
echo "$NOW" > "$STATE_DIR/last-repair"
log "self-repair result: $REPAIR_JSON"

# Fresh Claude Code sessions can show a one-time startup modal ("Try the new fullscreen
# renderer?") or a "How is Claude doing this session?" feedback card that blocks channel
# injects. Dismiss defensively so the channel is actually ready to reply.
sleep 6
PANE2="$(tmux capture-pane -t "$TMUX_SESSION" -p -S -25 2>/dev/null || true)"
if echo "$PANE2" | grep -qiE "fullscreen renderer|Not now"; then
  tmux send-keys -t "$TMUX_SESSION" "2" 2>/dev/null; sleep 1; tmux send-keys -t "$TMUX_SESSION" Enter 2>/dev/null
  log "dismissed 'fullscreen renderer?' startup modal"
fi
if echo "$PANE2" | grep -qiE "How is Claude doing this session"; then
  tmux send-keys -t "$TMUX_SESSION" "0" 2>/dev/null; sleep 1; tmux send-keys -t "$TMUX_SESSION" Enter 2>/dev/null
  log "dismissed feedback overlay card"
fi

REPAIR_OK="$(printf '%s' "$REPAIR_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo False)"
if [ "$REPAIR_OK" = "True" ]; then
  log "RECOVERED: #2 self-healed ($REASON). healthOk+bindOk per self-repair JSON. NOTE: a real reply-path verify is still the fleet monitor's job (this JSON shares the false-green signals)."
else
  log "WARN: self-repair did not report ok; fleet monitor should re-verify #2 via web-UI probe"
fi
exit 0
