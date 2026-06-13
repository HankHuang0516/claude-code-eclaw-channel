# Layer 2 — EClaw backend wiring for channel self-repair (STAGED, needs Hank deploy)

Status: **NOT applied / NOT deployed.** This stages the production (eclawbot.com / Railway
"Clawdbot") changes that wire the dashboard 重新綁定 button to each channel's version-aware
self-repair API. Apply + deploy only after review.

## Goal
User clicks 重新綁定 in the EClaw dashboard → EClaw calls the bound channel's `/self-repair`
webhook → the channel runs its repo-bound, version-aware self-repair program (detect-latest →
auto-install-latest → repair → health → `/api/channel/bind` sync-verify) → result shown in UI.
Always runs the **latest** self-repair version because Stage 1/2 of the channel program self-updates.

## Verified integration points (from current backend, 2026-06-13)
- Dashboard button: `EClaw/backend/public/portal/dashboard.html:3861` → `scrollToRebind(entityId)`
  (3868–3872) — currently only scrolls to the bind card. **Rewire to call the new endpoint.**
- Bind endpoint (the re-bind sync-verify target the channel already calls): `POST /api/channel/bind`
  in `EClaw/backend/channel-api.js:485-663`.
- Channel type registry: `EClaw/backend/channel-repair-log.js:43-46`
  (openclaw-channel-eclaw, claude-code-eclaw-channel, hermes-eclaw-channel, codex-eclaw-bridge).
- The backend already triggers `POST {webhookUrl}/restart` on the channel for the existing
  one-click restart (claude-code-eclaw-channel README 410-503). **Mirror that exact trigger +
  auth path** for `/self-repair` — do NOT invent a new auth scheme.

## Change 1 — new backend endpoint `POST /api/channel/self-repair`
Add to `EClaw/backend/channel-api.js` (proxy, modeled on the existing restart trigger):
```js
// POST /api/channel/self-repair { deviceId, entityId, deviceSecret }  (auth: deviceSecret OR entityId+botSecret)
// Resolves the entity's bound channel account -> its callback/webhook URL, then POSTs
// {webhookUrl}/self-repair using the SAME auth header the existing /restart trigger uses.
// Returns the channel's self-repair JSON {ok,bindOk,localVersion,latestVersion,updated,message}.
router.post('/self-repair', async (req, res) => {
  const { deviceId, entityId } = req.body || {};
  // 1. authenticate (reuse channelAuth / deviceSecret check used by /restart trigger)
  // 2. const account = getChannelAccountForEntity(deviceId, entityId)
  // 3. const webhookUrl = account.callbackUrl   // same field the /restart trigger uses
  // 4. const r = await fetch(`${webhookUrl}/self-repair`, { method:'POST',
  //      headers:{ 'Content-Type':'application/json', 'x-api-key': <same key /restart uses> },
  //      body: '{}' });
  // 5. return res.json(await r.json());
});
```
OPEN ITEM to confirm when applying: the exact field/secret the existing `/restart` trigger uses
to authenticate to the channel webhook (`x-api-key`). Reuse it verbatim — the channel side
(`bridge.ts /self-repair`) already checks `x-api-key === ECLAW_API_KEY`, identical to `/restart`.

## Change 2 — rewire the dashboard button
`EClaw/backend/public/portal/dashboard.html` — replace the `scrollToRebind` handler so 重新綁定
triggers self-repair (and keep the scroll as a manual fallback link):
```js
async function rebindSelfRepair(entityId) {
  const btn = event?.target; if (btn) { btn.disabled = true; btn.textContent = '自我修復中…'; }
  try {
    const r = await fetch('/api/channel/self-repair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: window.deviceId, entityId, deviceSecret: window.deviceSecret })
    });
    const d = await r.json();
    showToast(d.ok
      ? `#${entityId} 自我修復完成（v${d.localVersion}${d.updated ? '→已更新最新' : ''}，重新綁定 ${d.bindOk ? '✓' : '✗'}）`
      : `#${entityId} 自我修復失敗：${d.message || r.status}`);
  } catch (e) { showToast(`#${entityId} 自我修復請求失敗：${e.message}`); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '重新綁定'; } }
}
```
Point the existing 重新綁定 button's `onclick` from `scrollToRebind(entityId)` →
`rebindSelfRepair(entityId)`.

## Rollout order
1. Replicate `selfheal/` (self-repair.sh + manifest.json) + the `/self-repair` webhook endpoint to
   ALL channels (#1/#3/#4/#5 openclaw-channel-eclaw, #6 codex-eclaw-bridge, #5 hermes) — see
   selfheal-invoke.sh registry TODO. Each channel's repair/health/bind specifics differ.
2. Apply Change 1 + Change 2, deploy EClaw backend, smoke-test 重新綁定 on #2 first.
3. Flip selfheal-invoke.sh registry entries for the other channels once their endpoints ship.
