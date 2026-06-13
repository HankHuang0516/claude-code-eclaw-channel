# Channel Self-Repair (repo-bound, version-aware)

Reference implementation of the shared EClaw channel self-repair contract for **#2
claude-code-eclaw-channel**. Per Hank's standing rule (2026-06-13): every channel repairs via this
program; every future bug fix lands *in this flow* (not out-of-band); it self-detects whether it is
the latest version and auto-installs the latest before repairing; and the fleet monitor + the EClaw
dashboard 重新綁定 button both trigger it via API.

## Contract (identical for every channel)
`self-repair.sh` runs, in order:
1. **Detect latest** — compare `manifest.json::selfRepairVersion` vs the repo's GitHub raw manifest.
2. **Auto-install latest** — if behind, update only `selfheal/` to latest (skipped if the working
   tree is dirty, to never clobber in-progress work) and re-exec once.
3. **Repair** — run the channel's repair (`restart-channel.sh --smart`).
4. **Health-verify** — channel health probe (fakechat `:8787`).
5. **Re-bind sync-verify** — idempotent `POST /api/channel/bind`; confirm it returns this entity.

Emits one JSON line: `{ok, channelType, entityId, stage, localVersion, latestVersion, updated,
healthOk, bindOk, publicCode, message}`. Never prints `ECLAW_API_KEY` or any secret.

## Trigger surfaces (API)
- **Channel webhook:** `POST /self-repair` (bridge.ts) — `x-api-key: $ECLAW_API_KEY`, body `{}`.
  Activates after the next bridge restart/deploy.
- **Fleet monitor:** `eclaw-reboot-wake/scripts/selfheal-invoke.sh <entityId>` (called from the
  monitor repair path) — invokes the webhook and reads back `bindOk`.
- **EClaw dashboard 重新綁定 button:** via `POST /api/channel/self-repair` (backend) — see
  `LAYER2-eclaw-backend-proposal.md` (staged, needs deploy).

## Files
- `manifest.json` — version source of truth + repair/health/bind config.
- `self-repair.sh` — the program (entrypoint).
- `LAYER2-eclaw-backend-proposal.md` — staged production backend + dashboard wiring (not deployed).

## Bumping the version
When you fix a channel bug *through* this flow, raise `selfRepairVersion` in `manifest.json`, commit
+ push to `main`. Every channel/monitor invocation then auto-installs it before repairing.
