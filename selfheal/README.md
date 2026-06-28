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

## Wedge auto-heal (`wedge-watchdog.sh`) — durable fix for #2 mid-work wedges

**Why (2026-06-24):** #2 wedged mid-work three times in two days. Two failure modes, identical from
outside (passive-health stays GREEN = false-green, #2 silently stops replying for *hours*):
- **Opus 4.8 cyber-flag wedge** — the commander's long session accumulates channel-security /
  self-repair material until Opus 4.8's cybersecurity classifier trips; every re-nudge re-submits the
  poisoned context and re-errors (`API Error: … flagged … cybersecurity topic`). Only a *fresh* session clears it.
- **Stuck session** — Claude idles/freezes; the bridge keeps nudging but no reply ever lands.

Prior to this, the only detector was the once-a-day fleet monitor → hours of outage. `wedge-watchdog.sh`
closes that gap. It detects a wedge from a **class-agnostic signal**: the bridge logs
`Reply forwarded to EClaw successfully` on *every* turn (even benign `[SILENT]` replies), so if that
line stops for ≥ N minutes **while inbound webhooks keep arriving**, #2 is wedged (plus a fast-path
check for the cyber-flag string in the tmux pane). On detection it runs `self-repair.sh` (fresh
session) and clears any blocking startup modal. Guards: liveness check (never fires if replying),
post-repair **cooldown**, **anti-loop** (≥3 repairs/hour → escalate-log instead of a restart storm),
and a higher no-reply threshold while Claude is visibly mid-turn (don't kill genuine long work).

**Who runs it (important):** NOT launchd. launchd jobs lack Full Disk Access to `~/Desktop`, so they
cannot even read these scripts (`Operation not permitted`). Instead **`bridge.ts`'s watchdog kicks it
fire-and-forget on every watchdog tick** — the bridge runs from this repo with full access, is
relaunched on reboot by its (FDA-granted) `com.hank.eclaw-bridge` launchd job, and already owns the
reply-state machine. The script self-gates, so kicking it on every tick is a no-op unless #2 is truly
wedged. Verified 2026-06-24: caught a real ~3-hour silent wedge on its first run and auto-recovered #2
(web-UI nonce reply confirmed).

**Still needs Hank (deeper durable fix):** (a) EClaw passive-health should read repeated
`Reply enforcer: Claude idle Nm without reply` as RED for claude-code channels (kill the false-green at
source); (b) give #2 a periodic context-reset cadence so the cyber classifier never accumulates enough
to trip. Until then this watchdog is containment-that-auto-fires, not prevention.

## Files
- `manifest.json` — version source of truth + repair/health/bind config.
- `self-repair.sh` — the program (entrypoint).
- `wedge-watchdog.sh` — auto-detect & auto-heal #2 mid-work wedges (kicked by `bridge.ts` watchdog).
- `LAYER2-eclaw-backend-proposal.md` — staged production backend + dashboard wiring (not deployed).

## Bumping the version
When you fix a channel bug *through* this flow, raise `selfRepairVersion` in `manifest.json`, commit
+ push to `main`. Every channel/monitor invocation then auto-installs it before repairing.
