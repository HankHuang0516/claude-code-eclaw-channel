#!/usr/bin/env bash
# start-tunnel.sh — Cloudflared tunnel launcher for the EClaw bridge.
#
# Why this script exists
# ----------------------
# The bridge listens on a private localhost port (default 18800) but EClaw's
# server can only push webhooks to a public URL. We use cloudflared to expose
# that local port through Cloudflare's edge.
#
# Two tunnel modes are supported:
#
#   1. quick   — `cloudflared tunnel --url http://localhost:N`
#                Fully anonymous; gets a random `*.trycloudflare.com` host
#                that Cloudflare can rotate or expire at any time. Good for
#                ad-hoc demos. NOT good for long-lived bots: if the host
#                changes you have to update ECLAW_WEBHOOK_URL and re-register
#                with EClaw, otherwise EClaw silently fails to push and the
#                bot looks like it's "ignoring you" (real-world failure mode
#                we hit at 2026-05-04).
#
#   2. named   — A pre-created Named Tunnel (UUID + credentials JSON) bound
#                to a stable hostname (e.g. b2.eclawbot.com). Survives
#                restarts, network blips, and Cloudflare session resets. Use
#                this for production / long-lived bridges.
#
# Naming convention (see README.md "Bridge naming"):
#   tunnel name / public hostname both = b<entityId>  (e.g. b2, b6)
#   so `cloudflared tunnel run b2` matches `https://b2.example.com`.
#
# Idempotency
# -----------
# This script is safe to re-run: it kills any existing cloudflared bound to
# the SAME local port (so `restart-channel.sh` chained calls don't stack up
# multiple cloudflared processes) but leaves cloudflareds bound to OTHER
# ports alone (so other bots on the same machine — codex on 18801, hermes
# on 18802 — keep running).
#
# What this script does NOT do
# ----------------------------
# - Does NOT create the Named Tunnel resource on Cloudflare's side. That's a
#   one-off bootstrap (`cloudflared tunnel create` or via API). See README
#   for the bootstrap walkthrough.
# - Does NOT manage DNS records. The CNAME b<id>.your-domain.com →
#   <tunnel-uuid>.cfargotunnel.com is a one-off bootstrap step too.
# - Does NOT update ECLAW_WEBHOOK_URL in your shell rc. You set that once.

set -euo pipefail

# ── Config (env-driven, all optional with safe defaults) ─────────────────────
# ECLAW_TUNNEL_MODE: "quick" (default, no setup) or "named" (production).
TUNNEL_MODE="${ECLAW_TUNNEL_MODE:-quick}"

# ECLAW_BRIDGE_PORT: which local port the bridge is listening on. Different
# bridges on the same host MUST use different ports.
BRIDGE_PORT="${ECLAW_BRIDGE_PORT:-18800}"

# ECLAW_TUNNEL_NAME: Cloudflare Named Tunnel UUID OR friendly name. Required
# in "named" mode. We accept both — UUID lets cloudflared skip the API call
# for name→id lookup (which would need a cert.pem we don't have when we
# bootstrap purely via API), so passing the UUID is faster and cert-free.
# Friendly names (e.g. "b2") work too but require a prior `cloudflared tunnel
# login` to have produced cert.pem.
TUNNEL_NAME="${ECLAW_TUNNEL_NAME:-}"

# ECLAW_TUNNEL_CONFIG: Optional path to a cloudflared config.yml. If set,
# its `ingress` rules and `credentials-file` take precedence over per-flag
# args. Useful when you want to terminate multiple hostnames behind one
# tunnel, or pin TLS / origin headers.
TUNNEL_CONFIG="${ECLAW_TUNNEL_CONFIG:-}"

# ECLAW_TUNNEL_CRED_FILE: explicit path to the tunnel credentials JSON
# (the one you got from `cloudflared tunnel create` or the Cloudflare API).
# Only required in named mode when ECLAW_TUNNEL_CONFIG is unset.
TUNNEL_CRED_FILE="${ECLAW_TUNNEL_CRED_FILE:-}"

# ECLAW_TUNNEL_LOG: where cloudflared stdout/stderr is teed. Tail this when
# triaging "EClaw can't reach me" reports — DNS errors and connection drops
# show up here long before /health goes red.
TUNNEL_LOG="${ECLAW_TUNNEL_LOG:-/tmp/eclaw-tunnel-${BRIDGE_PORT}.log}"

# ECLAW_TUNNEL_TMUX_SESSION: tmux session that runs the tunnel. We default
# to a port-suffixed name so multiple bots on the same host don't collide
# on session names (e.g. eclaw-tunnel-18800 for #2, eclaw-tunnel-18801 for
# codex). The bridge tmux session is "eclaw-bridge" — keeping these
# separate makes it possible to bounce one without touching the other.
TUNNEL_TMUX_SESSION="${ECLAW_TUNNEL_TMUX_SESSION:-eclaw-tunnel-${BRIDGE_PORT}}"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() {
  # Stamp + emit to both stderr (visible in caller's terminal) and the same
  # log file cloudflared uses, so a single tail covers both.
  local line
  line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] start-tunnel: $*"
  echo "$line" >&2
  echo "$line" >> "$TUNNEL_LOG"
}

die() {
  log "ERROR: $*"
  exit 1
}

# Find any cloudflared process that belongs to OUR tunnel.
#
# Three matching strategies, OR'd together — a process matches if ANY hits.
# We need all three because cloudflared's argv format depends on launch mode:
#
#  1. Quick mode argv contains "localhost:${BRIDGE_PORT}" directly
#  2. Named mode WITHOUT config.yml has both "localhost:${BRIDGE_PORT}" AND
#     the tunnel UUID/name (covered by either match)
#  3. Named mode WITH config.yml has only "--config /path/to/config.yml run
#     <uuid>" — no port substring, the port lives inside the YAML. We match
#     by the tunnel UUID/name from $TUNNEL_NAME instead.
#
# We MUST NOT touch cloudflareds on OTHER ports (codex on 18801, etc.) —
# those are other bots managed by separate start-tunnel runs. Each strategy
# below is scoped to either OUR port or OUR tunnel name, never a generic
# "any cloudflared".
find_existing_cloudflared() {
  {
    # Strategy 1+2: argv contains our port. We drop the trailing \b that
    # GNU pgrep would honor — BSD pgrep on macOS treats it inconsistently.
    # The "localhost:18800" prefix is followed by either end-of-arg or
    # a path char (e.g. /webhook), neither of which can extend the match
    # into a longer port number that doesn't already start with our port,
    # so collisions like 18800 vs 188000 are not a real concern in practice.
    pgrep -f "cloudflared.*localhost:${BRIDGE_PORT}([^0-9]|$)" 2>/dev/null
    # Strategy 3: argv contains our tunnel UUID/name (named-with-config case)
    if [ -n "$TUNNEL_NAME" ]; then
      # Anchor with a non-word-char tail so a friendly name "b2" does not
      # match "b20". For UUIDs this is harmless (UUIDs don't share
      # prefixes with each other in practice).
      pgrep -f "cloudflared.*${TUNNEL_NAME}([^a-zA-Z0-9_-]|$)" 2>/dev/null
    fi
  } | sort -u
}

kill_existing_cloudflared() {
  local pids
  pids=$(find_existing_cloudflared)
  if [ -z "$pids" ]; then
    log "no existing cloudflared bound to localhost:${BRIDGE_PORT}"
    return 0
  fi
  log "killing existing cloudflared: $pids"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  # Give cloudflared up to 3s for graceful shutdown (it deregisters its edge
  # connections; pulling the rug too fast leaves zombie connections at
  # Cloudflare's side that take ~30s to time out, during which webhooks
  # keep getting "no available connection" errors).
  for _ in 1 2 3; do
    sleep 1
    [ -z "$(find_existing_cloudflared)" ] && return 0
  done
  log "cloudflared still alive after SIGTERM, escalating to SIGKILL"
  pids=$(find_existing_cloudflared)
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  sleep 1
}

# ── Pre-flight ───────────────────────────────────────────────────────────────

command -v cloudflared >/dev/null 2>&1 || \
  die "cloudflared not in PATH. Install: brew install cloudflared (macOS) or see https://github.com/cloudflare/cloudflared"

command -v tmux >/dev/null 2>&1 || \
  die "tmux not in PATH. tmux is used to keep cloudflared running across SSH disconnects and bridge restarts."

if ! [[ "$BRIDGE_PORT" =~ ^[0-9]+$ ]] || [ "$BRIDGE_PORT" -lt 1 ] || [ "$BRIDGE_PORT" -gt 65535 ]; then
  die "ECLAW_BRIDGE_PORT must be 1-65535, got: $BRIDGE_PORT"
fi

# ── Build the cloudflared command per mode ───────────────────────────────────

case "$TUNNEL_MODE" in
  quick)
    # No auth, random hostname. The hostname appears in cloudflared stderr
    # as `https://*.trycloudflare.com` — we don't try to parse it back to
    # update ECLAW_WEBHOOK_URL automatically because (a) parsing terminal
    # output is fragile and (b) the user already set ECLAW_WEBHOOK_URL once
    # to whatever URL they prefer. If you want auto-discovery, switch to
    # named mode where the hostname is stable.
    log "mode=quick port=$BRIDGE_PORT"
    log "WARNING: quick tunnels get a random hostname that Cloudflare can"
    log "         expire. For production use ECLAW_TUNNEL_MODE=named."
    CLOUDFLARED_CMD="cloudflared tunnel --url http://localhost:${BRIDGE_PORT}"
    ;;

  named)
    # Named mode requires either:
    #  (A) a config.yml that points at the tunnel UUID + credentials-file, or
    #  (B) ECLAW_TUNNEL_NAME (UUID preferred) + ECLAW_TUNNEL_CRED_FILE flags.
    if [ -n "$TUNNEL_CONFIG" ]; then
      [ -r "$TUNNEL_CONFIG" ] || die "ECLAW_TUNNEL_CONFIG=$TUNNEL_CONFIG not readable"
      # The config file owns ingress rules; we still pass --url to override
      # for callers that have a single-hostname tunnel. cloudflared honors
      # --url over config.yml's `ingress`. If you need multi-hostname
      # routing, edit the config.yml and DROP the --url override below by
      # exporting ECLAW_TUNNEL_USE_CONFIG_INGRESS=1.
      if [ "${ECLAW_TUNNEL_USE_CONFIG_INGRESS:-0}" = "1" ]; then
        CLOUDFLARED_CMD="cloudflared tunnel --config $TUNNEL_CONFIG run"
        # When we use config.yml's ingress, we MUST also pass the tunnel
        # name/UUID so cloudflared knows which tunnel to run; some configs
        # have a top-level `tunnel:` key that handles this, but if not we
        # still need it on the CLI.
        [ -n "$TUNNEL_NAME" ] && CLOUDFLARED_CMD="$CLOUDFLARED_CMD $TUNNEL_NAME"
        log "mode=named port=$BRIDGE_PORT config=$TUNNEL_CONFIG ingress=config-managed"
      else
        [ -n "$TUNNEL_NAME" ] || die "ECLAW_TUNNEL_NAME required when not using config-managed ingress"
        CLOUDFLARED_CMD="cloudflared tunnel --config $TUNNEL_CONFIG --url http://localhost:${BRIDGE_PORT} run $TUNNEL_NAME"
        log "mode=named port=$BRIDGE_PORT config=$TUNNEL_CONFIG name=$TUNNEL_NAME"
      fi
    else
      [ -n "$TUNNEL_NAME" ] || die "ECLAW_TUNNEL_NAME required in named mode (UUID or friendly name)"
      [ -n "$TUNNEL_CRED_FILE" ] || die "ECLAW_TUNNEL_CRED_FILE required in named mode when no config.yml is set"
      [ -r "$TUNNEL_CRED_FILE" ] || die "ECLAW_TUNNEL_CRED_FILE=$TUNNEL_CRED_FILE not readable"
      # Pass UUID + credentials-file directly so we don't need cert.pem.
      # This is the path that works after pure-API bootstrap (no
      # `cloudflared tunnel login` ever ran).
      CLOUDFLARED_CMD="cloudflared tunnel --credentials-file $TUNNEL_CRED_FILE --url http://localhost:${BRIDGE_PORT} run $TUNNEL_NAME"
      log "mode=named port=$BRIDGE_PORT cred=$TUNNEL_CRED_FILE name=$TUNNEL_NAME"
    fi
    ;;

  *)
    die "ECLAW_TUNNEL_MODE must be 'quick' or 'named', got: $TUNNEL_MODE"
    ;;
esac

# ── Dry-run mode (CI / human verify what would run) ──────────────────────────
# Setting ECLAW_TUNNEL_DRY_RUN=1 prints the resolved command and exits 0
# without launching cloudflared. Useful in CI to confirm config is parseable
# on a host that has no real tunnel credentials.
if [ "${ECLAW_TUNNEL_DRY_RUN:-0}" = "1" ]; then
  log "DRY RUN — would execute:"
  log "  $CLOUDFLARED_CMD"
  log "  via tmux session: $TUNNEL_TMUX_SESSION"
  log "  log file: $TUNNEL_LOG"
  exit 0
fi

# ── Idempotent kill of stale cloudflared on this port ────────────────────────
kill_existing_cloudflared

# ── Recreate tmux session ────────────────────────────────────────────────────
# We always wipe-and-recreate the session so the new cloudflared inherits the
# CALLER's current env (e.g. an updated ECLAW_TUNNEL_NAME when we rotate).
# Reusing an old session would make it inherit the SHELL's frozen env from
# whenever the session was originally created — same bug class as
# restart-channel.sh:--bridge-only with a stale session.
tmux kill-session -t "$TUNNEL_TMUX_SESSION" 2>/dev/null || true
tmux new-session -d -s "$TUNNEL_TMUX_SESSION"
log "tmux session '$TUNNEL_TMUX_SESSION' created"

# Truncate prior log so a tail -F doesn't conflate runs. Append-mode tee
# (-a) lets the log script entry above survive — we wrote it before the
# truncate, so the 'mode=...' line stays at the top of the new log.
: > "$TUNNEL_LOG"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] start-tunnel: launching '$CLOUDFLARED_CMD'" >> "$TUNNEL_LOG"

# Send the actual command. We tee to the log file AND keep stdout in the
# tmux pane so tmux attach gives a live view too.
tmux send-keys -t "$TUNNEL_TMUX_SESSION" \
  "$CLOUDFLARED_CMD 2>&1 | tee -a $TUNNEL_LOG" Enter

# ── Wait for tunnel to register (max 15s) ────────────────────────────────────
# In named mode cloudflared logs `Registered tunnel connection` per edge
# connection (typically 4). In quick mode it logs `Your quick Tunnel has
# been created!`. We accept either as the success signal.
log "waiting for tunnel registration..."
for i in $(seq 1 15); do
  sleep 1
  if grep -q -E "Registered tunnel connection|Your quick Tunnel" "$TUNNEL_LOG" 2>/dev/null; then
    log "tunnel up after ${i}s"
    # Print the public URL so the caller / restart-channel.sh can pick it up.
    if [ "$TUNNEL_MODE" = "quick" ]; then
      QUICK_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$TUNNEL_LOG" | head -1 || true)
      [ -n "$QUICK_URL" ] && log "quick tunnel URL: $QUICK_URL"
    fi
    exit 0
  fi
  # Surface obvious errors fast so the user doesn't wait the full 15s for
  # something that's already toast (e.g. wrong credentials path).
  if grep -q -E "ERR|FATAL|cannot connect|origin cert" "$TUNNEL_LOG" 2>/dev/null; then
    log "cloudflared reported an error (check $TUNNEL_LOG):"
    grep -E "ERR|FATAL|cannot connect|origin cert" "$TUNNEL_LOG" | head -3 | while read -r ln; do log "  $ln"; done
    exit 1
  fi
done

log "WARNING: tunnel did not register within 15s. Check $TUNNEL_LOG"
log "         (this script exits 0 anyway because cloudflared sometimes"
log "          takes longer on flaky networks; bridge /health will tell"
log "          you if EClaw can actually reach localhost:${BRIDGE_PORT}.)"
exit 0
