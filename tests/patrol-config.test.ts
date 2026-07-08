/**
 * Visual/UX patrol — env → config wiring test. Confirms reduced-coverage
 * detection (no PATROL_DEVICE_SECRET → deviceSecret null) and that bound
 * entity ids parse. Never asserts on secret VALUES (none are set in tests).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildConfigFromEnv } from "../patrol/index.ts";

const KEYS = [
  "PATROL_PORTAL_BASE",
  "PATROL_DEVICE_ID",
  "PATROL_BOT_SECRET",
  "PATROL_ENTITY_ID",
  "PATROL_DEVICE_SECRET",
  "PATROL_ACTIVE_ENTITY",
  "PATROL_BOUND_ENTITIES",
  "PATROL_DRY_RUN",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("buildConfigFromEnv", () => {
  test("defaults: prod base, entity 2, no deviceSecret → reduced coverage", () => {
    const cfg = buildConfigFromEnv();
    expect(cfg.portalBase).toBe("https://eclawbot.com");
    expect(cfg.auth.entityId).toBe(2);
    expect(cfg.deviceSecret).toBeNull();
    expect(cfg.boundEntityIds).toEqual([]);
  });

  test("parses bound entities and active entity", () => {
    process.env.PATROL_BOUND_ENTITIES = "1, 2 ,3, x, 6";
    process.env.PATROL_ACTIVE_ENTITY = "2";
    process.env.PATROL_DRY_RUN = "true";
    const cfg = buildConfigFromEnv();
    expect(cfg.boundEntityIds).toEqual([1, 2, 3, 6]); // "x" dropped
    expect(cfg.activeEntityId).toBe(2);
    expect(cfg.dryRun).toBe(true);
  });

  test("deviceSecret present → full coverage (value not asserted)", () => {
    process.env.PATROL_DEVICE_SECRET = "placeholder-not-real";
    expect(buildConfigFromEnv().deviceSecret).not.toBeNull();
  });
});
