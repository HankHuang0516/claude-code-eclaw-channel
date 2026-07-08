/**
 * Visual/UX patrol — the live runner.
 *
 * Renders the REAL prod portal at mobile 390x844 AND desktop 1280x800 across a
 * set of surfaces, extracts a PageSnapshot per (surface × viewport), runs the
 * pure detector, dedups against currently-open cards, and auto-opens a kanban
 * card + screenshot per NEW finding.
 *
 * WHY LAZY playwright: Playwright is NOT a dependency of this channel repo (CI
 * runs `bun test` only). So this runner `import()`s playwright at call time and
 * fails loud with an install hint if it's missing. The DETECTION CORE
 * (visual-detector / dedup / card-opener / browser-probe) has zero heavy deps and
 * is fully unit-tested without a browser — that's the CI-gated deliverable.
 *
 * AUTH: never fetch/hardcode owner creds. Reads a deviceSecret from
 * PATROL_DEVICE_SECRET. Only the owner device (480def4c) sees real partners, so
 * without it the patrol still renders public surfaces and logs REDUCED COVERAGE.
 * The secret is used only to seed the portal session in-browser and is NEVER
 * logged.
 *
 * ENABLEMENT: dark-launch by default. Set PATROL_ENABLED=true to run. Schedule
 * is registered as an EClaw automation mom-card (see patrol/SCHEDULE.md).
 */

import { detectAll, type Finding, type PageSnapshot, type Viewport } from "./visual-detector.ts";
import { dedupeFindings, type OpenCard } from "./dedup.ts";
import { extractSnapshot, type ProbeConfig } from "./browser-probe.ts";
import { openCardForFinding, type PatrolAuth, type FetchLike, type OpenedCard } from "./card-opener.ts";

export const MOBILE: Viewport = { width: 390, height: 844 };
export const DESKTOP: Viewport = { width: 1280, height: 800 };

/** One portal surface to patrol. `requiresAuth` = only meaningful when authed. */
export interface Surface {
  name: string;
  path: string; // e.g. "/portal/card-holder.html"
  requiresAuth: boolean;
}

/**
 * The 9 surfaces from the build spec. Highest-leverage first: card-holder
 * (bound-partner avatars) then arena leaderboard, then the rest.
 */
export const SURFACES: Surface[] = [
  { name: "card-holder", path: "/portal/card-holder.html", requiresAuth: true },
  { name: "arena", path: "/arena/index.html", requiresAuth: false },
  { name: "arena-exam", path: "/arena/exam.html", requiresAuth: false },
  { name: "chat", path: "/portal/chat.html", requiresAuth: true },
  { name: "dashboard", path: "/portal/dashboard.html", requiresAuth: true },
  { name: "kanban", path: "/portal/kanban.html", requiresAuth: true },
  { name: "settings", path: "/portal/settings.html", requiresAuth: true },
  { name: "community", path: "/portal/community.html", requiresAuth: false },
  { name: "marketplace", path: "/portal/marketplace.html", requiresAuth: false },
];

export interface PatrolConfig {
  portalBase: string; // e.g. "https://eclawbot.com"
  auth: PatrolAuth; // card-opener creds (botSecret path)
  deviceSecret: string | null; // portal session seed; null = reduced coverage
  activeEntityId: number | null;
  boundEntityIds: number[];
  surfaces?: Surface[];
  viewports?: Viewport[];
  dryRun?: boolean; // detect + dedup, do NOT open cards
}

export interface PatrolResult {
  rendered: number;
  findings: Finding[];
  newFindings: Finding[];
  duplicateFindings: Finding[];
  opened: OpenedCard[];
  reducedCoverage: boolean;
  errors: string[];
}

/**
 * The canvas-pixel probe injected into each avatar canvas before extraction.
 * Runs in the real browser (page.evaluate). Marks __canvasHasPixels /
 * __displayNone / bbox-track hooks the extractor reads. Serialized as a string
 * because it must run in the page context, not the runner.
 */
export const INSTRUMENT_PAGE = `(() => {
  const anyPixel = (canvas) => {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const w = canvas.width || 1, h = canvas.height || 1;
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < data.length; i += 4) { if (data[i] !== 0) return true; }
      return false;
    } catch (e) { return true; } // cross-origin taint → assume drawn, don't false-flag
  };
  document.querySelectorAll('canvas.entity-avatar-canvas').forEach((c) => {
    try { c.__canvasHasPixels = () => anyPixel(c); } catch (e) {}
  });
  document.querySelectorAll('img').forEach((im) => {
    try { im.__displayNone = getComputedStyle(im).display === 'none'; } catch (e) {}
  });
  // Track avatar rows + main columns for horizontal-overflow bbox checks.
  document.querySelectorAll('.entity-avatar-canvas, .entity-avatar-emoji, .entity-avatar-img, [class*="column"], [class*="sidebar"], main, .content')
    .forEach((el) => el.setAttribute('data-patrol-track', '1'));
})();`;

/** Whitelisted-path renderer. Returns snapshots; opening cards is separate. */
export async function runPatrol(cfg: PatrolConfig): Promise<PatrolResult> {
  const surfaces = cfg.surfaces ?? SURFACES;
  const viewports = cfg.viewports ?? [MOBILE, DESKTOP];
  const reducedCoverage = !cfg.deviceSecret;
  const errors: string[] = [];

  // Lazy-load Playwright so the tested core needs no browser.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "playwright not installed — run `bun add -d playwright && bunx playwright install chromium`. " +
        "The detection core (visual-detector/dedup/card-opener) is tested without it.",
    );
  }

  const browser = await chromium.launch({ headless: true });
  const snapshots: PageSnapshot[] = [];
  let rendered = 0;

  try {
    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      // Seed the portal session WITHOUT logging the secret.
      if (cfg.deviceSecret) {
        await context.addInitScript(
          ([sec, dev]: string[]) => {
            try {
              localStorage.setItem("eclaw_device_secret", sec);
              localStorage.setItem("eclaw_device_id", dev);
            } catch (e) {}
          },
          [cfg.deviceSecret, cfg.auth.deviceId],
        );
      }
      for (const surface of surfaces) {
        if (surface.requiresAuth && reducedCoverage) continue; // skip authed surfaces w/o secret
        const page = await context.newPage();
        try {
          await page.goto(`${cfg.portalBase}${surface.path}`, { waitUntil: "networkidle", timeout: 30000 });
          await page.waitForTimeout(1500); // let avatars paint
          await page.evaluate(INSTRUMENT_PAGE);
          const probeCfg: ProbeConfig = {
            surface: surface.name,
            url: `${cfg.portalBase}${surface.path}`,
            viewport: vp,
            activeEntityId: cfg.activeEntityId,
            boundEntityIds: cfg.boundEntityIds,
          };
          // extractSnapshot runs in-page; pass its source + cfg.
          const snap = (await page.evaluate(
            ([src, pc]) => {
              // eslint-disable-next-line no-new-func
              const fn = new Function("document", "cfg", `${src}; return extractSnapshot(document, cfg);`);
              return fn(document, pc);
            },
            [extractSnapshotSource(), probeCfg] as const,
          )) as PageSnapshot;
          snapshots.push(snap);
          rendered++;
          // Screenshot retained on the page object for the opener (taken on-demand below).
          (snap as PageSnapshot & { __screenshot?: Uint8Array }).__screenshot = await page.screenshot();
        } catch (err) {
          errors.push(`${surface.name}@${vp.width}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          await page.close();
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // Detect + dedup.
  const findings = snapshots.flatMap((s) => detectAll(s));
  const openCards = await fetchOpenCards(cfg.auth);
  const { newFindings, duplicateFindings } = dedupeFindings(findings, openCards);

  // Open a card per new finding (unless dry-run).
  const opened: OpenedCard[] = [];
  if (!cfg.dryRun) {
    for (const f of newFindings) {
      const shot = shotFor(snapshots, f);
      opened.push(await openCardForFinding(cfg.auth, f, shot ?? null, realFetch));
    }
  }

  return { rendered, findings, newFindings, duplicateFindings, opened, reducedCoverage, errors };
}

/** The extractSnapshot source, inlined so page.evaluate can run it in-page. */
function extractSnapshotSource(): string {
  // Re-declare the pure extractor body inside the page. We ship the function's
  // string form via toString so there is exactly ONE source of truth.
  return `const extractSnapshot = ${extractSnapshot.toString()};
const numAttr = ${numAttrSrc};
const describeSelector = ${describeSelectorSrc};`;
}
// These mirror the private helpers in browser-probe.ts for in-page use.
const numAttrSrc = `(el, name) => { const v = el.getAttribute(name); if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }`;
const describeSelectorSrc = `(el) => { const cls = el.getAttribute('class'); const id = el.getAttribute('id'); const tag = (el.tagName || 'el').toLowerCase(); if (id) return tag + '#' + id; if (cls) return tag + '.' + cls.trim().split(/\\s+/).slice(0,2).join('.'); return tag; }`;

function shotFor(snaps: PageSnapshot[], f: Finding): Uint8Array | undefined {
  const s = snaps.find((x) => x.surface === f.surface && x.viewport.width === f.viewport.width);
  return (s as (PageSnapshot & { __screenshot?: Uint8Array }) | undefined)?.__screenshot;
}

const realFetch: FetchLike = (url, init) => fetch(url, init as RequestInit) as ReturnType<FetchLike>;

/** Fetch currently-open kanban cards for dedup. Non-throwing. */
export async function fetchOpenCards(auth: PatrolAuth): Promise<OpenCard[]> {
  try {
    const url =
      `${auth.apiBase}/api/mission/cards?deviceId=${encodeURIComponent(auth.deviceId)}` +
      `&botSecret=${encodeURIComponent(auth.botSecret)}&entityId=${auth.entityId}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as { cards?: OpenCard[] };
    return Array.isArray(body?.cards) ? body.cards : [];
  } catch {
    return [];
  }
}
