#!/usr/bin/env bash
set -euo pipefail
: "${ECLAW_DEVICE_ID:?set ECLAW_DEVICE_ID}"
: "${ECLAW_BOT_SECRET:?set ECLAW_BOT_SECRET}"
: "${MESSAGE_SNIPPET:?set MESSAGE_SNIPPET}"

curl -s "https://eclawbot.com/api/chat/history?deviceId=${ECLAW_DEVICE_ID}&botSecret=${ECLAW_BOT_SECRET}&entityId=2&limit=10" \
  | jq -r ".messages[] | select(.text | contains(\"$MESSAGE_SNIPPET\")) | .source" \
  | head -1
