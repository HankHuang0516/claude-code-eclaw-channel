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
