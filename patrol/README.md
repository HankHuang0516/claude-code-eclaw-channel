# Visual/UX Patrol

**Why:** every existing EClaw cron is API-style — it asserts HTTP 200 and stops.
That structurally cannot see a *visual* regression: a fallback emoji where a real
partner avatar should render, a broken `<img>`, a right column bleeding past the
viewport. Three such bugs shipped past every green check because no machine ever
*looked* at the rendered page. This patrol is the "eye": it renders the **real
prod portal** at mobile 390×844 and desktop 1280×800, runs DOM/pixel criteria,
and auto-opens a kanban card (with screenshot) per **new** regression — deduped
against currently-open cards. Turns "wait for Hank to notice" into "the machine
notices first."

Card: `card_f116705030a22522adfb8d6c` (P1, self-improve).

## Architecture (pure core + thin live shell)

| File | Role | Deps | Tested |
| --- | --- | --- | --- |
| `visual-detector.ts` | **Pure** detector: `PageSnapshot` in → `Finding[]` out. Six defect classes C1–C6. | none | ✅ `tests/patrol-visual-detector.test.ts` |
| `dedup.ts` | **Pure** dedup by stable signature vs open cards. | none | ✅ `tests/patrol-dedup.test.ts` |
| `card-opener.ts` | Pure request builders + a 3-step open flow (create card → upload shot → attach) over an injected `fetch`. | none | ✅ `tests/patrol-card-opener.test.ts` |
| `browser-probe.ts` | **Pure** in-page extractor: DOM → `PageSnapshot`. Runs inside `page.evaluate`. | none | ✅ `tests/patrol-probe-extract.test.ts` |
| `runner.ts` | Live shell: lazily `import()`s Playwright, renders surfaces × viewports, detects, dedups, opens. | playwright (lazy) | — (integration) |
| `index.ts` | CLI entrypoint. Dark-launched behind `PATROL_ENABLED`. | — | — |

The whole **detection core has zero heavy deps** and is unit-tested with fixtures
(no browser, no live auth). That's the CI-gated deliverable: `bun test` proves the
detector distinguishes healthy vs regressed markup. Playwright is only needed for
the live render and is loaded lazily, so CI never needs a browser.

## Detection signatures (from REAL source, not assumptions)

Verified against `EClaw-plazacta/backend/public/portal/shared/entity-utils.js`
`renderAvatarHtml`:

- **Healthy partner avatar** = `<canvas class="entity-avatar-canvas" data-petdx-entity-id="N">` (line 214-219) **that has actually drawn** (non-transparent pixels).
- **URL avatar** = `<img class="entity-avatar-img">` (line 221) — broken if `naturalWidth===0`.
- **Fallback (regression) avatar** = `<span class="entity-avatar-emoji" data-entity-id="N">emoji</span>` (line 225). Default lobster fallback glyph = `🦞` (`\u{1F99E}`).
- **Blank canvas** = canvas present but zero pixels — the exact bug `portal-entity-avatar-canvas-guard.test.js` was written to prevent.
- **Broken chat image** markers: `onerror="this.style.display='none'"` (chat.html:5749) and the `🖼️` `.file-thumb-icon` swap (files.html:1062).

## Six defect classes

- **C1 fallback_avatar** — a *bound* entity renders emoji-span or a blank canvas.
- **C2 horizontal_overflow** — `documentScrollWidth > clientWidth`, or a tracked element's box past the right viewport edge.
- **C3 wrong_entity_avatar** — the active-entity slot renders a different entity's id.
- **C4 broken_image** — `<img>` naturalWidth 0 / empty src / hidden by onerror.
- **C5 text_overflow** — content overflows its box (`scrollWidth/Height > clientWidth/Height`).
- **C6 empty_placeholder** — a visible empty-state masking a *load error* (silent failure an API check can't see).

## Dedup / flood control

Each finding has a stable `signature = surface :: viewport-bucket :: defect-class :: selector`.
Viewport is **bucketed** (`mobile`/`desktop`) so 390 vs 412 don't double-file. When
a card is opened its body embeds `[patrol-sig]: <signature>`; the next run recovers
those via `extractSignatures` and skips anything already covered by an **open** card
(a `done` card does *not* suppress a recurrence — it reopens). Findings within one
run also collapse by signature.

## Auth & coverage

The full patrol needs an owner-account authed portal to see real partners. **We do
not fetch or hardcode owner creds.** Pass a deviceSecret via `PATROL_DEVICE_SECRET`
(seeded into the browser's localStorage, **never logged**). Absent → the runner
skips `requiresAuth` surfaces and logs **REDUCED COVERAGE** (public surfaces only:
arena, community, marketplace). Only the owner device `480def4c` has real partners.

> **Remaining wiring** (needs Hank to authorize a credential for the patrol): supply
> `PATROL_DEVICE_SECRET` for the owner device so C1/C3 run against real bound partners.
> Until then the loop is proven end-to-end on public surfaces + fixtures.

## Enable / schedule

See `SCHEDULE.md`. Default is **dark-launch (off)**. Two options: an EClaw
automation mom-card (`PUT /api/mission/card/:id/schedule`, recommended 6h), or a
local launchd plist. Manual run:

```bash
PATROL_ENABLED=true PATROL_DRY_RUN=true \
PATROL_DEVICE_ID=... PATROL_BOT_SECRET=... \
bun patrol/index.ts
```
