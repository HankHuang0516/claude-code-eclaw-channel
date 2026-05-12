# Growth Content Pack — 2026-05 launch (after P0 verified)

**Status:** drafts complete; PUBLISH blocked on Growth-P0 (CTA register-intent + funnel beacons) PR merged + production beacons firing + funnel数字 visible on dashboard.

## Files

- `01-hn-show-hn.md` — Show HN main post + comment-thread strategy
- `02-reddit-localllama.md` — r/LocalLLaMA technical / interop angle
- `03-reddit-sideproject.md` — r/SideProject founder-story / honest economics angle
- `04-x-thread.md` — 5-tweet X thread

## Pre-publish checklist

- [ ] Growth-P0 PR merged (#3 Mac_E, card_bf34558aff15af23c3bc01b3)
- [ ] Production beacons confirmed firing (#6 Codex review, card_d86649d4414fa8457df5fb3e)
- [ ] Dashboard / query can slice funnel by source/channel
- [ ] Replace UTM placeholder `?tab=register&source={X}&utm_campaign=launch_2026_05` with whatever canonical format Mac_E settled on
- [ ] Verify each link manually once before posting (per `feedback_test_urls_before_suggesting`)
- [ ] Line up 24-48h funnel review post-launch (per Mac_F gate)

## Per-platform thresholds (per `feedback_per_platform_post_thresholds`)

- X: ≤200 chars per tweet ✅ all 5 verified
- HN / Reddit: long-form OK (no upper limit)
- Qiita: not in this batch (would need ja translation)

## Don'ts

- DO NOT cross-post identical body across r/LocalLLaMA + r/SideProject (different angles intentionally)
- DO NOT publish before P0 verified — Mac_F explicit gate
- DO NOT bake UTM-less links anywhere
