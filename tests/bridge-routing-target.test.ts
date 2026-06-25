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
import { isNonRoutableNoise, chooseReplyHint } from "../bridge-state.ts";

const USER_HINT = { kind: "user" as const, entityId: undefined, publicCode: null };
const BOT6_HINT = { kind: "entity" as const, entityId: 6, publicCode: "yrt82n" };

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

    test("a #N_PERMISSION_HANDOFF forward is noise (card_c761be88)", () => {
        // #6's openclaw/codex runtime auto-emits #N_PERMISSION_HANDOFF when a
        // benign post-exec cleanup WARN ("Failed to terminate MCP process group
        // N: Operation not permitted") is misread as a real exec blocker. The
        // emitter is REMOTE (not this repo); this guard is routing-target hygiene
        // so the flood can't hijack the reply target. NOTE: this fixture
        // deliberately OMITS the "Bridge cutoff" line, so it is only classified
        // by the new #N_PERMISSION_HANDOFF token — proving the hardening adds
        // coverage the heartbeat alternatives don't.
        const HANDOFF = `[📢 FWD from #6] #6_PERMISSION_HANDOFF
- Blocker: Codex runtime output reported permission_or_login: WARN codex_rmcp_client::stdio_server_launcher: Failed to terminate MCP process group 91381: Operation not permitted (os error 1)
- Next step: grant the required permission/login through an approved channel`;
        expect(isNonRoutableNoise(HANDOFF, "entity")).toBe(true);
        // a human who literally pastes the token is still never suppressed
        expect(isNonRoutableNoise(HANDOFF, "user")).toBe(false);
        // generalizes across entity numbers
        expect(isNonRoutableNoise("[📢 FWD from #1] #1_PERMISSION_HANDOFF\n- Next step: grant", "entity")).toBe(true);
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

describe("chooseReplyHint — un-addressed reply goes to the human principal", () => {
    test("THE INCIDENT: a genuine #6 message set the bot target, but Claude's un-@mentioned status reply still routes to the human", () => {
        // Sequence: Hank asks (USER_HINT) → #6 sends genuine PR-review work
        // (BOT6_HINT becomes lastSenderHint) → Claude replies to Hank with no
        // @mention. Must route to the human, NOT #6.
        const hint = chooseReplyHint("修復完成，已 merge PR #20，bridge 重啟生效。", USER_HINT, BOT6_HINT);
        expect(hint).toBe(USER_HINT);
    });

    test("a reply that explicitly @mentions a bot keeps the bot hint (mention layer routes it)", () => {
        expect(chooseReplyHint("@#6 收到你的 PR review，我來 merge。", USER_HINT, BOT6_HINT)).toBe(BOT6_HINT);
        expect(chooseReplyHint("@yrt82n stand down，這張我接手。", USER_HINT, BOT6_HINT)).toBe(BOT6_HINT);
        expect(chooseReplyHint("@all 廣播測試", USER_HINT, BOT6_HINT)).toBe(BOT6_HINT);
    });

    test("un-@mentioned reply NEVER falls back to a bot — even with no human turn yet (post-restart guard)", () => {
        // Regression for the 2026-06-20 live catch: right after a bridge restart
        // lastUserHint is null while a genuine bot holds lastSenderHint; an
        // un-addressed reply to Hank must NOT route to that bot. Resolve to null
        // (normal reply, human reads via history poll), never entity:6.
        expect(chooseReplyHint("plain reply, no human seen yet", null, BOT6_HINT)).toBeNull();
    });

    test("returns null when there is no target at all", () => {
        expect(chooseReplyHint("hello", null, null)).toBeNull();
    });

    test("a non-@mention that merely contains an @ mid-text still goes to the human", () => {
        // Only a LEADING mention triggers bot routing; an email-like @ mid-text must not.
        const hint = chooseReplyHint("done — see report@card for details", USER_HINT, BOT6_HINT);
        expect(hint).toBe(USER_HINT);
    });
});
