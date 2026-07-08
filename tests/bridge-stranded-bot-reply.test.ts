/**
 * Regression tests for per-message delivery accounting of stranded bot-to-bot
 * replies (card_3ce0080a2223711b9d67fcef).
 *
 * Incident (2026-07-03, Hank): at 12:22 TW #6 sent 3 messages in a row —
 *   ① `#6_PERMISSION_HANDOFF`  ② status heartbeat  ③ substantive content.
 * #2's investigation proved message ③ never reached #2 (0 messages from #6 in
 * #2's chat scope) AND the backend suppression-log showed `from #6 = 0` — so it
 * was NOT dropped by the backend low-signal filter and left no trace anywhere.
 *
 * Root cause (traced end-to-end, all in-repo bridge code + out-of-repo backend):
 *   - The bridge does NOT batch/coalesce a burst — each `reply` tool call gets a
 *     distinct fakechat id (`m<ts>-1/-2/-3`) and is forwarded independently, so
 *     there is no per-batch drop. The two control messages (①②) are correctly
 *     classified as non-routable noise PER MESSAGE.
 *   - The substantive message ③, emitted WITHOUT a leading `@<#2-code>`, is
 *     routed by `chooseReplyHint`'s human-safety fail-safe to the human / null
 *     (never a bot). The backend channel/message endpoint then sees no @mention,
 *     no speakTo/broadcast, and a non-entity senderHint → `hasDelivery=false` →
 *     it self-saves the reply on #6's OWN device. The intended peer (#2) receives
 *     nothing, and because it was a self-save (not a suppression) it appears in
 *     neither #2's chat scope nor the suppression-log.
 *
 * The fix does NOT re-route (auto-injecting an @mention would re-open the
 * 2026-06-20 misroute the fail-safe exists to prevent). Instead it adds per-
 * message delivery accounting so the strand surfaces as a bridge-log WARN
 * instead of vanishing silently. `detectStrandedBotReply` is that guard.
 *
 * The proper end-to-end fix is upstream: the sending agent/runtime must carry
 * `@<peer-code>` on a substantive bot-to-bot reply — these tests lock in that a
 * mentioned reply is NOT flagged (the routed happy path) while the un-mentioned
 * substantive strand IS surfaced.
 */

import { describe, expect, test } from "bun:test";
import { detectStrandedBotReply } from "../bridge-state.ts";

// #2 is the peer that was mid-exchange with #6 (lastSenderHint after #2's inbound).
const PEER2_HINT = { kind: "entity" as const, entityId: 2, publicCode: "abc123" };
const HUMAN_HINT = { kind: "user" as const, entityId: undefined, publicCode: null };

// The exact 3-message burst shapes from the incident.
const HANDOFF = `[📢 FWD from #6] #6_PERMISSION_HANDOFF
- Blocker: Codex runtime output reported permission_or_login
- Next step: grant the required permission/login through an approved channel`;

const HEARTBEAT = `[📢 FWD from #6] Codex #6 status heartbeat
- Elapsed: 3m 30s
- Bridge cutoff: disabled
- State: codex exec is still running`;

const SUBSTANTIVE =
    "分析完成:root cause 是 device-vars POST 整批覆蓋,建議加 read-back assert。我來開卡追。";

describe("detectStrandedBotReply — the 3-message burst (card_3ce0080a)", () => {
    test("① PERMISSION_HANDOFF is noise → NOT flagged (stranding it is correct)", () => {
        // A control marker is meant to reach no one; it must not warn.
        expect(detectStrandedBotReply(HANDOFF, PEER2_HINT, HUMAN_HINT)).toBeNull();
    });

    test("② heartbeat is noise → NOT flagged (stranding it is correct)", () => {
        expect(detectStrandedBotReply(HEARTBEAT, PEER2_HINT, HUMAN_HINT)).toBeNull();
    });

    test("③ substantive, un-@mentioned, mid bot-to-bot exchange → strand SURFACED", () => {
        // THE BUG: this is the message that silently vanished. The guard must now
        // surface it with the stranded peer identified.
        const diag = detectStrandedBotReply(SUBSTANTIVE, PEER2_HINT, HUMAN_HINT);
        expect(diag).not.toBeNull();
        expect(diag!.strandedEntityId).toBe(2);
        expect(diag!.strandedPublicCode).toBe("abc123");
        expect(diag!.resolvedTo).toBe("human");
        expect(diag!.preview.length).toBeGreaterThan(0);
    });

    test("③ resolved to nobody (null hint, e.g. fresh bridge) is still surfaced as a strand", () => {
        const diag = detectStrandedBotReply(SUBSTANTIVE, PEER2_HINT, null);
        expect(diag).not.toBeNull();
        expect(diag!.strandedEntityId).toBe(2);
        expect(diag!.resolvedTo).toBe("nobody");
    });
});

describe("detectStrandedBotReply — routed replies are NOT flagged", () => {
    test("a substantive reply that leads with @<peer-code> is routed → NOT a strand (the fix path)", () => {
        // Upstream fix: the agent carries the peer's code; the server's mention
        // layer routes it, so no strand.
        const diag = detectStrandedBotReply(`@abc123 ${SUBSTANTIVE}`, PEER2_HINT, PEER2_HINT);
        expect(diag).toBeNull();
    });

    test("a reply leading with @#N is routed → NOT a strand", () => {
        expect(detectStrandedBotReply(`@#2 ${SUBSTANTIVE}`, PEER2_HINT, PEER2_HINT)).toBeNull();
    });

    test("@all broadcast is routed → NOT a strand", () => {
        expect(detectStrandedBotReply(`@all ${SUBSTANTIVE}`, PEER2_HINT, PEER2_HINT)).toBeNull();
    });

    test("resolved back onto the SAME peer entity → delivered, NOT a strand", () => {
        // If chooseReplyHint (or a caller) resolves the target onto the peer that
        // was mid-exchange, the message is delivered — no warning.
        expect(detectStrandedBotReply(SUBSTANTIVE, PEER2_HINT, PEER2_HINT)).toBeNull();
    });
});

describe("detectStrandedBotReply — no false positives", () => {
    test("no active bot-to-bot exchange (last sender was a human) → NOT a strand", () => {
        // An un-addressed reply going to the human is the normal case; never warn.
        expect(detectStrandedBotReply(SUBSTANTIVE, HUMAN_HINT, HUMAN_HINT)).toBeNull();
    });

    test("no last-sender hint at all → NOT a strand", () => {
        expect(detectStrandedBotReply(SUBSTANTIVE, null, null)).toBeNull();
    });

    test("a noop ack mid-exchange is noise → NOT flagged", () => {
        expect(detectStrandedBotReply("收到", PEER2_HINT, HUMAN_HINT)).toBeNull();
        expect(detectStrandedBotReply("[SILENT]", PEER2_HINT, HUMAN_HINT)).toBeNull();
    });

    test("empty reply text → NOT a strand", () => {
        expect(detectStrandedBotReply("", PEER2_HINT, HUMAN_HINT)).toBeNull();
    });

    test("resolved onto a DIFFERENT bot than the mid-exchange peer is still surfaced", () => {
        // The reply is going somewhere, but NOT to the peer that was waiting — the
        // peer is still stranded, so it must surface. (resolvedTo=nobody because the
        // resolved target is neither user nor broadcast.)
        const BOT9 = { kind: "entity" as const, entityId: 9, publicCode: "zzz999" };
        const diag = detectStrandedBotReply(SUBSTANTIVE, PEER2_HINT, BOT9);
        expect(diag).not.toBeNull();
        expect(diag!.strandedEntityId).toBe(2);
    });
});
