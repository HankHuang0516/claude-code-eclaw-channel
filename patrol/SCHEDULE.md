# Patrol scheduling / cron registration

The patrol is **dark-launched**: it is a no-op unless `PATROL_ENABLED=true`, so
merging never changes runtime behavior. Enable it via one of two mechanisms.

## Option A — EClaw automation mom-card (recommended)

EClaw's own cron primitive is the **kanban automation schedule** (see
`ECLAW_API.md` §110 and `backend/kanban.js` `computeCronNextRun` /
`isAutomation`). A parent "mom-card" with `isAutomation:true` + a recurring cron
spawns a child card on each trigger; the patrol runs on that trigger and files
its own defect cards.

1. Create/choose a parent mom-card and mark it an automation:

   ```bash
   curl -s -X PUT "https://eclawbot.com/api/mission/card/<MOM_CARD_ID>/config" \
     -H "Content-Type: application/json" \
     -d '{"deviceId":"480def4c-2183-4d8e-afd0-b131ae89adcc","entityId":2,"botSecret":"<BOT_SECRET>","isAutomation":true}'
   ```

2. Register a **conservative 6h** recurring schedule (dark-launch cadence):

   ```bash
   curl -s -X PUT "https://eclawbot.com/api/mission/card/<MOM_CARD_ID>/schedule" \
     -H "Content-Type: application/json" \
     -d '{"deviceId":"480def4c-2183-4d8e-afd0-b131ae89adcc","entityId":2,"botSecret":"<BOT_SECRET>","enabled":true,"type":"recurring","cronExpression":"0 */6 * * *","timezone":"Asia/Taipei"}'
   ```

3. The mom-card's SOP body tells the spawned agent to run:

   ```bash
   PATROL_ENABLED=true \
   PATROL_DEVICE_ID=480def4c-2183-4d8e-afd0-b131ae89adcc \
   PATROL_BOT_SECRET=<from vault, never inline> \
   PATROL_ENTITY_ID=2 \
   PATROL_DEVICE_SECRET=<owner deviceSecret from vault; omit for reduced coverage> \
   PATROL_BOUND_ENTITIES=1,2,3,4,5,6 \
   bun patrol/index.ts
   ```

   Keep `enabled:false` until Hank authorizes the owner `PATROL_DEVICE_SECRET`;
   with it absent the run still works at reduced (public-surface) coverage.

## Option B — local launchd (persists an owner session on this machine)

If you'd rather run it on Hank's machine (where an owner session can live),
drop a plist like `~/Library/LaunchAgents/com.eclaw.visual-patrol.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.eclaw.visual-patrol</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/bun</string>
    <string>/ABS/PATH/patrol/index.ts</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATROL_ENABLED</key><string>true</string>
    <key>PATROL_DEVICE_ID</key><string>480def4c-2183-4d8e-afd0-b131ae89adcc</string>
    <key>PATROL_ENTITY_ID</key><string>2</string>
    <key>PATROL_BOUND_ENTITIES</key><string>1,2,3,4,5,6</string>
    <!-- PATROL_BOT_SECRET / PATROL_DEVICE_SECRET: inject from Keychain, not here -->
  </dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>6</integer></dict>
    <dict><key>Hour</key><integer>12</integer></dict>
    <dict><key>Hour</key><integer>18</integer></dict>
  </array>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.eclaw.visual-patrol.plist
```

## Secrets

`PATROL_BOT_SECRET` and `PATROL_DEVICE_SECRET` are vault-class. Pull them from the
device-var vault / Keychain at runtime; never inline them in the plist, the
mom-card body, or a commit. The runner never logs either value.

## Recommended rollout

1. Merge dark-launched (this PR). CI green via `bun test`.
2. Manual `PATROL_DRY_RUN=true` run to eyeball detected findings without opening cards.
3. Enable the 6h mom-card schedule at reduced coverage (public surfaces).
4. Once Hank authorizes an owner `PATROL_DEVICE_SECRET`, add it → full C1/C3 coverage.
```
