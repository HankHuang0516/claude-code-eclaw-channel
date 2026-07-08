/**
 * Visual/UX patrol — CLI entrypoint.
 *
 * Dark-launched: does NOTHING unless PATROL_ENABLED=true, so merging this never
 * changes runtime behavior. When enabled (by the automation mom-card's spawned
 * child, or a manual run), it renders prod, detects regressions, dedups, and
 * opens cards.
 *
 * Env:
 *   PATROL_ENABLED         "true" to actually run (default: off / dark-launch)
 *   PATROL_PORTAL_BASE     default "https://eclawbot.com"
 *   PATROL_DEVICE_ID       device that owns the patrol bot creds (card-opener)
 *   PATROL_BOT_SECRET      botSecret for opening cards        (NEVER logged)
 *   PATROL_ENTITY_ID       entity id for opening cards        (default 2)
 *   PATROL_DEVICE_SECRET   owner deviceSecret to see real partners (NEVER logged;
 *                          absent → REDUCED COVERAGE: public surfaces only)
 *   PATROL_ACTIVE_ENTITY   active entity id for wrong-entity (C3) checks
 *   PATROL_BOUND_ENTITIES  comma list of OUR entity ids that must render avatars
 *   PATROL_DRY_RUN         "true" = detect+dedup, do NOT open cards
 *
 * Never prints a secret. Only logs counts, surfaces, and coverage.
 */

import { runPatrol, type PatrolConfig } from "./runner.ts";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function buildConfigFromEnv(): PatrolConfig {
  const deviceSecret = env("PATROL_DEVICE_SECRET") || null;
  const bound = env("PATROL_BOUND_ENTITIES")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "") // "" → Number("") is 0; drop empties so unset yields []
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
  const activeRaw = env("PATROL_ACTIVE_ENTITY");
  return {
    portalBase: env("PATROL_PORTAL_BASE", "https://eclawbot.com"),
    auth: {
      apiBase: env("PATROL_PORTAL_BASE", "https://eclawbot.com"),
      deviceId: env("PATROL_DEVICE_ID"),
      botSecret: env("PATROL_BOT_SECRET"),
      entityId: Number(env("PATROL_ENTITY_ID", "2")) || 2,
    },
    deviceSecret,
    activeEntityId: activeRaw ? Number(activeRaw) : null,
    boundEntityIds: bound,
    dryRun: env("PATROL_DRY_RUN") === "true",
  };
}

async function main(): Promise<void> {
  if (env("PATROL_ENABLED") !== "true") {
    console.log("[patrol] disabled (set PATROL_ENABLED=true to run). No-op.");
    return;
  }
  const cfg = buildConfigFromEnv();
  if (!cfg.auth.deviceId || !cfg.auth.botSecret) {
    console.error("[patrol] missing PATROL_DEVICE_ID / PATROL_BOT_SECRET — cannot open cards. Aborting.");
    process.exitCode = 1;
    return;
  }
  console.log(
    `[patrol] starting — portal=${cfg.portalBase} coverage=${cfg.deviceSecret ? "FULL (authed)" : "REDUCED (public only)"} dryRun=${cfg.dryRun ?? false}`,
  );
  const result = await runPatrol(cfg);
  console.log(
    `[patrol] done — rendered=${result.rendered} findings=${result.findings.length} ` +
      `new=${result.newFindings.length} dup=${result.duplicateFindings.length} opened=${result.opened.length} ` +
      `reducedCoverage=${result.reducedCoverage} errors=${result.errors.length}`,
  );
  for (const o of result.opened) {
    console.log(`[patrol] opened card ${o.cardId ?? "FAILED"} for ${o.signature}${o.error ? " err=" + o.error : ""}`);
  }
  if (result.errors.length) {
    for (const e of result.errors) console.warn(`[patrol] render error: ${e}`);
  }
}

// Run only when invoked directly (Bun sets import.meta.main).
if (import.meta.main) {
  main().catch((err) => {
    console.error("[patrol] fatal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
