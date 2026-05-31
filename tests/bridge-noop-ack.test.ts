/**
 * Unit tests for the noop-ack classifier that suppresses the bridge
 * auto-wake nudge on bot-to-bot ack-of-ack loops.
 *
 * Backstory: card_505e8c98f (2026-05-27). Two channel-mode entities
 * (#5 Hermes, #6 Codex) ended up in a mutual reply loop:
 *
 *   #5 sends 「了解。」 → #6 receives → bridge nudges #6 to reply via
 *   `auto_wake.nudge_with_msg` ("Immediately use the reply tool") →
 *   #6 sends 「了解。」 → #5 receives → bridge nudges #5 → loop.
 *
 * `isNoopBotToBotAck` is the gate at the inbound webhook seam that
 * stops the nudge for bot-to-bot acks while leaving real bot-to-bot
 * work (review reports, @-mention dispatches) alone.
 *
 * Reverting either gate (the regex set in `isNoopAck` or the
 * sender-kind check in `isNoopBotToBotAck`) flips these assertions.
 */

import { describe, expect, test } from "bun:test";
import { isNoopAck, isNoopBotToBotAck } from "../bridge-state.ts";

describe("isNoopAck", () => {
    test.each([
        "了解。",
        "了解",
        "了解!",
        "收到。",
        "收到",
        "好的",
        "好",
        "OK",
        "ok.",
        "ACK",
        "ack.",
        "received",
        "received.",
        "thanks",
        "thanks.",
        "承知しました",
        "承知",
        "かしこまりました。",
        "[SILENT]",
        "[SILENT — kanban echo of own card move]",
        // 2026-06-01 loop variants — verbose channel-mode chatter that
        // the original 30-char cap let through. #2/#5/#6 cycled these
        // ~10 times in 3 minutes before the widening landed.
        "Acknowledged.",
        "Noted.",
        "Understood.",
        "Roger.",
        "Standing by.",
        "Standing down.",
        "Acknowledged. Standing by for your next request.",
        "Noted. Standing by for the next work item.",
        "Standing down. No action taken.",
        "Understood. Standing down. No action taken.",
        // [SILENT] embedded (not whole-string) — must suppress even when
        // an @-mention is quoted alongside, because the quoted token is
        // an echo, not a fresh routing directive.
        "Received `[SILENT]`. No action was requested.",
        "Received `@#6 [SILENT]`. No action was requested, and I made no file changes.",
    ])("classifies %p as a noop ack", (text) => {
        expect(isNoopAck(text)).toBe(true);
    });

    test.each([
        // Substantive replies — even short ones — must NOT be classified
        // as acks. Anything with routing semantics or a verb is real.
        "@#6 LGTM, merging now",
        "PR #2984 reviewed + merged",
        "Bug confirmed, filing card",
        "ACK: investigating", // colon + word → not a pure ack
        "ok, but please also bump the version", // longer than 30 → not ack
        "received the report — will review next", // has actionable verb
        "了解了 — 我去 review PR #2984", // longer + actionable
        "@all heads up", // @-mention → real
        "@#5", // routing token alone → real
        "", // empty → not ack
        "   ", // whitespace → not ack
        "test failure: ENOENT", // not ack
        "了解。 (will revert in 5)", // ack-like prefix but with payload
        // Regression coverage for the 2026-06-01 widening: the verbose
        // openers (Acknowledged / Noted / Understood / Standing by/down)
        // must NOT swallow a real status update that happens to start
        // with one of those words. Pattern requires a noop continuation
        // (no action / for your-the next / made no changes / etc).
        "Acknowledged the report — will file PR by EOD",
        "Noted that the spec contradicts the API; updating clients",
        "Understood the constraint, but the legal review blocks it",
        "Standing by for #1's signoff per spec",
        "Standing down the prod deploy — rolling back to v2.13.4",
        // [SILENT] embedded but length > 100 → falls out of suppression
        // (long status updates that incidentally reference the marker
        // remain real signal).
        "Resolved the [SILENT] handshake bug between #5 and #6; root cause was the 30-char cap; PR up at #2999",
        // 2026-06-01 #1 review (PR #12) — ack chatter followed by an
        // actionable review/PR/status payload. The NOOP_DISQUALIFIER
        // (LGTM / PR #N / merged / fixed / reviewed / approved / landed /
        // shipped / ready-to-merge) catches these so the recipient still
        // wakes — these are the messages a human reviewer most needs
        // delivered.
        "Acknowledged. No action needed; PR #12 LGTM.",
        "Acknowledged. I made no file changes; reviewed PR #12 and LGTM.",
        "Fixed [SILENT] echo bug; PR #12 ready.",
        "Noted. No action — PR #2999 already merged.",
        "Standing by. Ready to merge once CI lands.",
        "Acknowledged. No further action; approved and shipped.",
    ])("does NOT classify %p as a noop ack", (text) => {
        expect(isNoopAck(text)).toBe(false);
    });

    test("trims surrounding whitespace before matching", () => {
        expect(isNoopAck("  了解。  ")).toBe(true);
        expect(isNoopAck("\n收到\n")).toBe(true);
    });

    test("length guard rejects suspiciously long text even with ack prefix", () => {
        // 31 chars — just over the cap. If a bot ever wraps a real
        // status update with a 「了解。」 prefix, we still treat it as a
        // real message; better to over-nudge than swallow real signal.
        const longish = "了解。" + "a".repeat(28);
        expect(longish.length).toBe(31);
        expect(isNoopAck(longish)).toBe(false);
    });
});

describe("isNoopBotToBotAck", () => {
    test("entity sender + ack text → suppress", () => {
        expect(isNoopBotToBotAck("了解。", "entity")).toBe(true);
        expect(isNoopBotToBotAck("收到", "entity")).toBe(true);
        expect(isNoopBotToBotAck("OK", "entity")).toBe(true);
        // 2026-06-01 verbose-ack widening — entity-to-entity stand-by
        // chatter must suppress nudge regardless of length cap.
        expect(
            isNoopBotToBotAck(
                "Acknowledged. Standing by for your next request.",
                "entity",
            ),
        ).toBe(true);
        expect(
            isNoopBotToBotAck("Standing down. No action taken.", "entity"),
        ).toBe(true);
        expect(
            isNoopBotToBotAck(
                "Received `@#6 [SILENT]`. No action was requested, and I made no file changes.",
                "entity",
            ),
        ).toBe(true);
    });

    test("entity sender + non-ack text → do not suppress", () => {
        expect(
            isNoopBotToBotAck("@#5 reviewed PR #2984, LGTM", "entity"),
        ).toBe(false);
    });

    test("user sender + ack text → do not suppress (real user pings deserve nudges)", () => {
        // A human typing 「收到。」 to confirm receipt should still wake
        // the bot — auto-wake on `user`-kind inbound is the whole point.
        expect(isNoopBotToBotAck("收到。", "user")).toBe(false);
        expect(isNoopBotToBotAck("OK", "user")).toBe(false);
    });

    test("broadcast sender + ack text → do not suppress", () => {
        // Broadcasts are rare and should always wake; if a broadcast is
        // just an ack, the upstream sender chose to broadcast it for a
        // reason and we leave nudging alone.
        expect(isNoopBotToBotAck("了解。", "broadcast")).toBe(false);
    });

    test("unknown sender kind + ack text → do not suppress (default to wake)", () => {
        expect(isNoopBotToBotAck("了解。", "unknown")).toBe(false);
    });

    test("undefined sender kind → do not suppress", () => {
        expect(isNoopBotToBotAck("了解。", undefined)).toBe(false);
    });
});
