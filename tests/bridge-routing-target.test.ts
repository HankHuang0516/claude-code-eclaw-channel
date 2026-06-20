/**
 * Regression tests for the reply-routing-target guard.
 *
 * Incident (2026-06-20, Hank): Claude's user-facing status reports were being
 * delivered to entity #6 instead of the user. Root cause — the bridge keeps a
 * single module-global `lastSenderHint`, overwritten by EVERY inbound webhook,
 * and the async reply path reads it at *send* time. #6's relentless
 * status-heartbeat / FWD / bridge-error flood overwrote the global to
 * {kind:"entity", entityId:6} in the window between the user's message and
 * Claude finishing a long task, so the report meant for the user routed to #6.
 *
 * `isNonRoutableNoise` is the guard at the inbound seam: background bot noise
 * must NOT become the reply target, so the prior real sender (user / broadcast
 * / genuine bot work) survives. Reverting the guard flips these assertions and
 * the misroute returns.
 */

import { describe, expect, test } from "bun:test";
import { isNonRoutableNoise } from "../bridge-state.ts";

// The exact #6 flood shapes from the incident transcript (2026-06-20 12:16–12:22).
const HEARTBEAT = `[📢 FWD from #6] Codex #6 status heartbeat
- Task: [task in progress - preview redacted to prevent secret leak]
- Elapsed: 3m 30s
- Bridge cutoff: disabled
- Last exec output: 2026-06-20T12:16:28.123Z
- State: codex exec is still running; no bridge cutoff is active, and the watchdog only intervenes if heartbeats stop.`;

const BRIDGE_ERROR = `[📢 FWD from #6] Bridge error: Codex is still processing the previous message. Use /interrupt if you want to stop it.`;

const APPROVAL_REQ = `[📢 FWD from #6] Codex requests command approval

Reason:
Allow Jest/supertest to bind a local ephemeral server for backend route tests?`;

describe("isNonRoutableNoise — fleet noise must not hijack reply target", () => {
    test("status heartbeat from an entity is noise", () => {
        expect(isNonRoutableNoise(HEARTBEAT, "entity")).toBe(true);
    });

    test("bridge-error notice from an entity is noise", () => {
        expect(isNonRoutableNoise(BRIDGE_ERROR, "entity")).toBe(true);
    });

    test("command-approval forward from an entity is noise", () => {
        expect(isNonRoutableNoise(APPROVAL_REQ, "entity")).toBe(true);
    });

    test("noop bot-to-bot ack from an entity is noise", () => {
        expect(isNonRoutableNoise("[📢 FWD from #6] 了解。", "entity")).toBe(true);
        expect(isNonRoutableNoise("收到", "entity")).toBe(true);
        expect(isNonRoutableNoise("[SILENT]", "entity")).toBe(true);
    });
});

describe("isNonRoutableNoise — real turns must ALWAYS update the target", () => {
    test("a real user message is never suppressed, even heartbeat-shaped text", () => {
        // A user can literally type the word "heartbeat"; kind=user must win so
        // their reply is never stranded.
        expect(isNonRoutableNoise(HEARTBEAT, "user")).toBe(false);
        expect(isNonRoutableNoise("status heartbeat please explain", "user")).toBe(false);
        expect(isNonRoutableNoise("收到", "user")).toBe(false);
    });

    test("a broadcast is never suppressed", () => {
        expect(isNonRoutableNoise(HEARTBEAT, "broadcast")).toBe(false);
    });

    test("unknown-kind inbound is never suppressed (handled as status update)", () => {
        expect(isNonRoutableNoise(HEARTBEAT, "unknown")).toBe(false);
        expect(isNonRoutableNoise(undefined as never, "unknown")).toBe(false);
    });

    test("genuine bot work from an entity is NOT noise (must stay routable)", () => {
        expect(
            isNonRoutableNoise(
                "[📢 FWD from #6] PR #3587 merged to main; Arena finalize fix landed, please review.",
                "entity",
            ),
        ).toBe(false);
        expect(
            isNonRoutableNoise(
                "Review report: found a regression in auth.js line 90, needs a fix before merge.",
                "entity",
            ),
        ).toBe(false);
        // A status update that merely mentions "heartbeat" in prose, not the
        // fleet lifecycle phrasing, must remain routable.
        expect(
            isNonRoutableNoise(
                "Added a heartbeat metric to the dashboard; PR #3590 ready for review.",
                "entity",
            ),
        ).toBe(false);
    });
});
