# #2 Auth Recovery — reuse the existing Claude Code key (no browser, no API-key switch)

This documents the durable fix shipped 2026-06-29 after #2 (Mac_ClaudeAce主管) went dark for ~7h
because the macOS Keychain credential `Claude Code-credentials` was wiped. The goal: **never recur,
and always reuse the same Claude Code (Max subscription) key** — not an API-key billing switch.

## What broke

- Keychain item `Claude Code-credentials` had `accessToken`/`refreshToken` **empty**, `expiresAt=0`.
- The channel CLI (`claude`) therefore showed **`Not logged in · Run /login`** on every turn — the
  model could not run at all.
- `restart-channel.sh` happily launched these doomed "Not logged in" sessions, and `bridge.ts`
  masked the outage by forwarding the `⏳ Processing...` auto-ack as a real reply — so both
  `passive-health` and `selfheal/wedge-watchdog.sh` reported #2 **GREEN** (false-green).
- Separately, the smart model resolver in `restart-channel.sh` would walk the whole `latest[]` chain
  and land on **Haiku 4.5 with fakechat (port 8787) down**, because rapid kill→relaunch cycling
  raced the fakechat `server.ts` (bun) port bind.

## The fix (three parts, all in this repo)

### 1. `selfheal/ensure-auth.sh` — reuse the key, refuse to launch unauthenticated
Run automatically by `restart-channel.sh` before every launch (bypass with `SKIP_AUTH_GUARD=1`):

- If the **primary** Keychain credential is healthy (has a `refreshToken`), it snapshots it into a
  **backup** Keychain item `eclaw-claude-code-credentials-backup`, so the freshest rotating refresh
  token is always captured while the channel is healthy.
- If the primary is **wiped**, it restores it from the backup Keychain item, or failing that from the
  on-disk fallback `~/.claude/.credentials.json`. Same account/subscription = "用目前 Claude Code
  同個 key".
- It then **verifies** headlessly with the same `claude` CLI (a tiny `-p` probe, which also primes a
  token refresh) and re-snapshots the now-fresh credential.
- If it still cannot authenticate (refresh token revoked, nothing to restore), it exits non-zero and
  `restart-channel.sh` **aborts** with `auth_unavailable` instead of starting a zombie — escalating
  to a human to run `claude` + `/login`.

Secrets live only in the macOS Keychain; values are passed via command substitution so they never
appear in logs/stdout/transcript (only a momentary argv on this single-user Mac).

### 2. `restart-channel.sh` — no more Haiku-without-fakechat
- Calls the auth guard above first.
- `clean_slate()` before each launch: kills the prior `eclaw-bot` session **and** orphaned
  `channels plugin:fakechat` claude processes (which `tmux kill-session` does not reap), then waits
  with `wait_port_free` until port 8787 is fully released so the next `server.ts` binds cleanly.
- Each model gets `ATTEMPTS_PER_MODEL` (default 2) tries, because a missing fakechat is usually a
  transient `server.ts` spawn race (model-independent) — retrying the **same** model beats
  prematurely downgrading toward Haiku.
- On total failure, it tears down the leftover broken session so it can't masquerade as "running".

### 3. `selfheal/wedge-watchdog.sh` — Class 3 now auto-heals
Previously the watchdog only **escalated** on `Not logged in` (self-repair was futile). Now that
`restart-channel.sh` auto-restores the key, the watchdog treats `Not logged in` as a wedge and lets
the normal self-repair flow run — which reuses the key and relaunches cleanly. It still escalates if
`ensure-auth.sh` cannot reuse the key.

## Manual recovery (if ever needed by hand)

```bash
# 1. Reuse the key: restore Keychain from the on-disk fallback (refresh token), value never printed
security add-generic-password -U -s "Claude Code-credentials" -a "$USER" \
  -w "$(cat ~/.claude/.credentials.json)"

# 2. Verify headlessly with the SAME CLI the channel uses (prints OK if the refresh token is valid)
cd /tmp && claude --model claude-haiku-4-5-20251001 -p "reply OK"

# 3. Relaunch the channel (auth guard + clean resolver now handle the rest)
cd /Users/hank/Desktop/Project/claude-code-eclaw-channel && ./restart-channel.sh --force
```

If step 2 still says `Not logged in`, the refresh token is revoked — then re-auth interactively with
`claude` + `/login` (same Max account), or set `CLAUDE_CODE_OAUTH_TOKEN` in `.env`.

## Remaining durable asks (EClaw Layer C, needs Hank)
- `passive-health` must treat pane `Not logged in` as RED and must **not** count the
  `⏳ Processing...` auto-ack as a real reply.
- Investigate **what wiped the Keychain** (last real reply 02:44Z, empty by ~09:35Z on 2026-06-29):
  a stray `claude logout`, a failed token refresh writing empties, or a second claude process.
