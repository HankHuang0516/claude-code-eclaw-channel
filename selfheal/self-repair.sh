#!/usr/bin/env bash
# selfheal/self-repair.sh — repo-bound, version-aware self-repair program
# Channel: #2 claude-code-eclaw-channel (reference implementation of the shared
# EClaw channel self-repair contract).
#
# Contract (identical across every EClaw channel):
#   1. Detect whether THIS self-repair program is the latest version
#      (compare selfheal/manifest.json::selfRepairVersion vs the repo's GitHub raw manifest).
#   2. If behind, auto-install the latest self-repair program (update only selfheal/ to avoid
#      clobbering unrelated in-progress work; skip if the working tree is dirty) and re-exec once.
#   3. Run the channel's repair (restart-channel.sh --smart).
#   4. Health-verify the channel.
#   5. Sync-verify EClaw's 重新綁定 (re-bind) via idempotent POST /api/channel/bind.
#
# Emits exactly one JSON line on stdout for programmatic consumption.
# NEVER prints ECLAW_API_KEY or any secret.
set -uo pipefail

SELFHEAL_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANNEL_DIR="$(cd "$SELFHEAL_DIR/.." && pwd)"
MANIFEST="$SELFHEAL_DIR/manifest.json"

mf() { python3 -c "import json,sys;print(json.load(open('$MANIFEST')).get('$1',''))" 2>/dev/null; }

CHANNEL_TYPE="$(mf channelType)"
REPO="$(mf repo)"
BRANCH="$(mf branch)"
ENTITY_ID="$(mf entityId)"
LOCAL_VERSION="$(mf selfRepairVersion)"
RAW_MANIFEST_URL="https://raw.githubusercontent.com/$REPO/$BRANCH/selfheal/manifest.json"

API_BASE="${ECLAW_API_BASE:-https://eclawbot.com}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] selfheal($CHANNEL_TYPE): $*" >> /tmp/eclaw-selfheal.log; }

emit() { # emit <ok> <stage> <updated> <healthOk> <bindOk> <publicCode> <message>
  python3 - "$@" <<'PY'
import json,sys
ok,stage,updated,healthOk,bindOk,publicCode,msg=sys.argv[1:8]
print(json.dumps({
  "ok": ok=="true","channelType":sys.argv[8],"entityId":int(sys.argv[9]),
  "stage":stage,"localVersion":sys.argv[10],"latestVersion":sys.argv[11],
  "updated":updated=="true","healthOk":healthOk=="true","bindOk":bindOk=="true",
  "publicCode":publicCode or None,"message":msg
}))
PY
}

# Load channel env (ECLAW_API_KEY etc.) without echoing secrets.
if [ -f "$CHANNEL_DIR/.env" ]; then set -a; . "$CHANNEL_DIR/.env"; set +a; fi

# ── Stage 1+2: version self-detection + auto-install latest ──────────────────
LATEST_VERSION="$LOCAL_VERSION"
UPDATED="false"
if [ "${SELFHEAL_UPDATED:-0}" != "1" ] && command -v git >/dev/null 2>&1; then
  REMOTE_MANIFEST="$(curl -sf --max-time 8 "$RAW_MANIFEST_URL" 2>/dev/null || true)"
  if [ -n "$REMOTE_MANIFEST" ]; then
    LATEST_VERSION="$(printf '%s' "$REMOTE_MANIFEST" | python3 -c "import json,sys;print(json.load(sys.stdin).get('selfRepairVersion',''))" 2>/dev/null || echo "$LOCAL_VERSION")"
    # newer? (sort -V: if latest is the greater of the two and differs, we're behind)
    if [ "$LATEST_VERSION" != "$LOCAL_VERSION" ] && \
       [ "$(printf '%s\n%s\n' "$LOCAL_VERSION" "$LATEST_VERSION" | sort -V | tail -1)" = "$LATEST_VERSION" ]; then
      log "behind: local=$LOCAL_VERSION latest=$LATEST_VERSION"
      cd "$CHANNEL_DIR"
      # only auto-install if selfheal/ is clean — never clobber in-progress work
      if [ -z "$(git status --porcelain -- selfheal/ 2>/dev/null)" ]; then
        if git fetch --quiet origin "$BRANCH" 2>/dev/null && \
           git checkout --quiet "origin/$BRANCH" -- selfheal/ 2>/dev/null; then
          UPDATED="true"
          log "auto-installed latest selfheal/ ($LOCAL_VERSION -> $LATEST_VERSION); re-exec"
          SELFHEAL_UPDATED=1 exec bash "$SELFHEAL_DIR/self-repair.sh" "$@"
        else
          log "auto-install failed (git fetch/checkout); proceeding with local $LOCAL_VERSION"
        fi
      else
        log "selfheal/ working tree dirty; skip auto-install, proceed with local $LOCAL_VERSION"
      fi
    fi
  else
    log "remote manifest unreachable; proceed with local $LOCAL_VERSION"
  fi
fi

# ── Stage 3: run the channel repair ──────────────────────────────────────────
REPAIR_OUT="$(bash "$CHANNEL_DIR/restart-channel.sh" --smart 2>>/tmp/eclaw-selfheal.log | tail -1)"
REPAIR_OK="$(printf '%s' "$REPAIR_OUT" | python3 -c "import json,sys;print(json.load(sys.stdin).get('ok',False))" 2>/dev/null || echo "False")"
log "repair result: $REPAIR_OUT"
if [ "$REPAIR_OK" != "True" ]; then
  emit "false" "repair_failed" "$UPDATED" "false" "false" "" "restart-channel.sh did not report ok" \
       "$CHANNEL_TYPE" "$ENTITY_ID" "$LOCAL_VERSION" "$LATEST_VERSION"
  exit 1
fi

# ── Stage 4: health verify ───────────────────────────────────────────────────
HEALTH_OK="false"
if curl -sf --max-time 3 "http://localhost:8787/" >/dev/null 2>&1; then HEALTH_OK="true"; fi

# ── Stage 5: EClaw re-bind sync-verify (idempotent /api/channel/bind) ─────────
BIND_OK="false"; PUBLIC_CODE=""
if [ -n "${ECLAW_API_KEY:-}" ]; then
  BIND_RESP="$(curl -sf --max-time 10 -X POST "$API_BASE/api/channel/bind" \
    -H 'Content-Type: application/json' \
    -d "{\"channel_api_key\":\"$ECLAW_API_KEY\",\"entityId\":$ENTITY_ID,\"name\":\"${ECLAW_BOT_NAME:-Mac_ClaudeAce主管}\"}" 2>/dev/null || true)"
  BIND_ENTITY="$(printf '%s' "$BIND_RESP" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('entityId','')) if d.get('success') else print('')" 2>/dev/null || echo "")"
  PUBLIC_CODE="$(printf '%s' "$BIND_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('publicCode',''))" 2>/dev/null || echo "")"
  if [ "$BIND_ENTITY" = "$ENTITY_ID" ]; then BIND_OK="true"; fi
  log "rebind verify: entity=$BIND_ENTITY publicCode=$PUBLIC_CODE"
else
  log "ECLAW_API_KEY not set; cannot sync-verify rebind"
fi

OK="false"; [ "$HEALTH_OK" = "true" ] && [ "$BIND_OK" = "true" ] && OK="true"
emit "$OK" "complete" "$UPDATED" "$HEALTH_OK" "$BIND_OK" "$PUBLIC_CODE" \
     "self-repair done (repair+health+rebind verify)" \
     "$CHANNEL_TYPE" "$ENTITY_ID" "$LOCAL_VERSION" "$LATEST_VERSION"
[ "$OK" = "true" ] && exit 0 || exit 1
