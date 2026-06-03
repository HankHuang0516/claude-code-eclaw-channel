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
import {
    isNoopAck,
    isNoopBotToBotAck,
    stripServerWrappers,
} from "../bridge-state.ts";

/**
 * Helper for the 2026-06-03 wrapper test cases. Wraps an inner message
 * with the exact policy + tools envelope the EClaw server now prepends
 * to every webhook delivery. Mirrors the 5716-char payload shape seen
 * in /tmp/eclaw-bridge.log on the day of the regression.
 */
function wrapWithServerEnvelope(inner: string): string {
    return [
        "[EClaw central routing policy]",
        "=== 路由（重要） ===",
        "",
        "回覆 channel 訊息時，你的回覆需要路由回原始發訊者。",
        "[End EClaw central routing policy]",
        "",
        "[EClaw managed prompt policy - claude_code]",
        "## EClaw Platform Policy",
        "Follow EClaw channel routing, auth, and safety rules.",
        "[End EClaw managed prompt policy]",
        "",
        `[EClaw from entity:3] ${inner}`,
        "",
        "[AVAILABLE TOOLS — Mission Dashboard]",
        "Read tasks/notes/rules/skills: exec: curl -s ...",
        "",
        "[AVAILABLE TOOLS — Kanban Board]",
        "Read board: exec: curl -s ...",
    ].join("\n");
}

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
        // 2026-06-02 healthcheck-ACK echo widening — bridge.ts:1014
        // sends `ACK <nonce>` for every ECLAW_HEALTHCHECK; the server
        // fan-out adds a `[📢 FWD from #N]` prefix when the ACK is
        // forwarded to sibling entities. Both shapes were leaking past
        // the 30-char short-token cap (`ACK HC3mpvisgv38q2bks` is 20
        // chars on its own but the FWD-prefixed form is ~35) and the
        // verbose-opener requirement (no opener word).
        "ACK HC3mpvisgv38q2bks",
        "ACK HC6mpvkcrgzpsl2vt",
        "[📢 FWD from #3] ACK HC3mpvisgv38q2bks",
        "[📢 FWD from #6] ACK HC6mpvkcrgzpsl2vt",
        // FWD prefix variants the server has emitted historically.
        "[FWD from #3] ACK HC3abcdef",
        "[📢 FWD from entity:5] ACK HC5xyzabc",
        "[📢 FWD from #tbwb9e] ACK HCpublicCode01",
        // Trailing punctuation tolerated.
        "ACK HC3abc.",
        // 2026-06-03 #6 FWD echo loop — the [SILENT] cap was 100 chars,
        // the verbose-opener layer was anchored at start so the FWD
        // prefix shifted "Acknowledged" / "Received" off `^`, and
        // "Codex completed with no text output." had no [SILENT] marker
        // at all. Loop ran ~150 cycles before the bridge fix landed.
        "Inbound `[SILENT]` acknowledged. No actionable operation was requested, so I made no file changes and did not use Computer Use.",
        "[📢 FWD from #6] Inbound `[SILENT]` acknowledged. No actionable operation was requested, so I made no file changes and did not use Computer Use.",
        "Acknowledged `[SILENT]`; no action required and no file changes made.",
        "[📢 FWD from #6] Acknowledged `[SILENT]`; no action required and no file changes made.",
        "Codex completed with no text output.",
        "[📢 FWD from #6] Codex completed with no text output.",
        "Agent completed with no output.",
        // 2026-06-03 monitor-modelcheck probe — sibling MODEL_HEALTH
        // replies get FWD broadcast to peers. Pure protocol noise for
        // recipients other than the probe issuer.
        "MODEL_HEALTH MH3mpxntkargvwaf8 entity=3 status=OK",
        "[📢 FWD from #3] MODEL_HEALTH MH3mpxntkargvwaf8 entity=3 status=OK",
        "MODEL_HEALTH MHabc entity=#5",
        "[📢 FWD from #5] MODEL_HEALTH MHxyz entity=5 status=DEGRADED",
        // 2026-06-03 server-wrapper rollout — the EClaw server started
        // prepending centrally-managed policy blocks and appending
        // [AVAILABLE TOOLS] / [Local Variables] / [API HINT] blocks to
        // every webhook delivery. The actual sender message is buried
        // ~3KB into a ~5.7KB payload. All ack-echo layers in isNoopAck
        // rely on either `^` anchors or length caps that the wrapped
        // form blew past — three FWD ACK echoes from #3/#5/#6 fired
        // auto-wake nudges back-to-back at 06:13:57 / 06:14:09 / 06:14:15.
        // Pre-step `stripServerWrappers` must peel the envelope before
        // the layer regexes run.
        wrapWithServerEnvelope("[📢 FWD from #3] ACK HC3mpxo7x4m02hldb"),
        wrapWithServerEnvelope("[📢 FWD from #5] ACK HC5mpxo871na9xy6j"),
        wrapWithServerEnvelope("[📢 FWD from #6] ACK HC6mpxo8bv6a3nefr"),
        wrapWithServerEnvelope(
            "[📢 FWD from #6] Acknowledged `[SILENT]`; no action required and no file changes made.",
        ),
        wrapWithServerEnvelope("[📢 FWD from #6] Codex completed with no text output."),
        wrapWithServerEnvelope("了解。"),
        wrapWithServerEnvelope(
            "[📢 FWD from #3] MODEL_HEALTH MH3mpxntkargvwaf8 entity=3 status=OK",
        ),
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
        // Healthcheck-ACK echo guardrails — the 2026-06-02 widening
        // must NOT swallow:
        //   - free-form `ACK:` with prose (colon + word, not nonce)
        //   - `ACK <nonce>` wrapped in a real status (PR/LGTM disqualifier)
        //   - a forwarded review verdict that happens to start with ACK
        //   - anything longer than 80 chars
        "ACK: investigating PR #2984",
        "ACK HC3abc — but PR #12 still red",
        "[📢 FWD from #3] ACK PR #12 reviewed, LGTM",
        "ACK " + "x".repeat(80), // 84 chars total → over the 80-char cap
        "ACK HC3abc and reviewed PR #12",
        // Bare `ACK` is the layer-(4) short-token pure ack and SHOULD be
        // suppressed by isNoopAck overall — but it's covered by the
        // existing positive list, not by the layer-(3) healthcheck echo
        // layer. The layer-(3) regex requires `ACK <nonce>` (space +
        // token), so test that the bare `ACK` doesn't accidentally match
        // the new layer's regex shape; we still expect the overall
        // function to return true for "ACK" via layer (4).
        // Server-wrapper-envelope guardrails — the 2026-06-03 pre-step
        // must NOT swallow a real bot-to-bot review/dispatch that
        // happens to ride in the same envelope shape. The disqualifier
        // (LGTM / PR #N / merged / fixed / reviewed / approved /
        // landed / shipped / ready-to-merge) and the @-mention guard
        // still apply after stripping, so a dispatch with routing
        // semantics or actionable payload stays awake.
        wrapWithServerEnvelope("@#6 LGTM, merging PR #2984 now"),
        wrapWithServerEnvelope("[📢 FWD from #3] ACK PR #12 reviewed, LGTM"),
        wrapWithServerEnvelope("Bug confirmed in chat-filter, filing card"),
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

describe("stripServerWrappers", () => {
    test("pre-rollout shape passes through unchanged", () => {
        // The classifier must remain idempotent — a bare inner message
        // (no policy envelope) is the pre-2026-06-03 shape and must not
        // be touched. Trim is the only legal mutation.
        expect(stripServerWrappers("了解。")).toBe("了解。");
        expect(stripServerWrappers("[📢 FWD from #3] ACK HC3abc")).toBe(
            "[📢 FWD from #3] ACK HC3abc",
        );
        expect(stripServerWrappers("  ACK HC3abc  ")).toBe("ACK HC3abc");
        expect(stripServerWrappers("")).toBe("");
    });

    test("peels policy + [EClaw from N] + trailing tools envelope", () => {
        const wrapped = wrapWithServerEnvelope("[📢 FWD from #3] ACK HC3xyz");
        expect(stripServerWrappers(wrapped)).toBe("[📢 FWD from #3] ACK HC3xyz");
    });

    test("chained policy blocks all peel", () => {
        const wrapped = [
            "[EClaw central routing policy]",
            "...",
            "[End EClaw central routing policy]",
            "",
            "[EClaw managed prompt policy - claude_code]",
            "...",
            "[End EClaw managed prompt policy]",
            "",
            "[EClaw experimental block]",
            "...",
            "[End EClaw experimental block policy]",
            "",
            "[EClaw from #6] 了解。",
        ].join("\n");
        // The third block opens with "experimental block" (no "policy"
        // word in opener), so it does NOT match the policy-block regex
        // and remains in the body. The peeler only strips blocks whose
        // OPENER includes the word "policy". This is intentional — we
        // peel only the known centrally-managed policy envelopes.
        const peeled = stripServerWrappers(wrapped);
        expect(peeled).toContain("[EClaw experimental block]");
        expect(peeled).toContain("了解。");
    });

    test("trailing [Local Variables] and [API HINT] cut off", () => {
        const wrapped = [
            "[EClaw from monitor-modelcheck-2] MODEL_HEALTHCHECK MH2abc",
            "",
            "[Local Variables available: SECRET1, SECRET2]",
            "[API HINT — Entities]",
            "List entities: exec: curl ...",
        ].join("\n");
        expect(stripServerWrappers(wrapped)).toBe(
            "MODEL_HEALTHCHECK MH2abc",
        );
    });

    test("[MENTIONS — IMPORTANT ROUTING HINT] block cut off", () => {
        // The server also appends a [MENTIONS — IMPORTANT ROUTING HINT]
        // block that carries the sender's entityId/publicCode for the
        // bridge's senderHint. Must not leak into ack-echo length cap.
        const wrapped = [
            "[EClaw from entity:3] [📢 FWD from #3] ACK HC3xyz",
            "",
            "[MENTIONS — IMPORTANT ROUTING HINT]",
            "Sender: entity:3 (publicCode=abc123)",
        ].join("\n");
        expect(stripServerWrappers(wrapped)).toBe(
            "[📢 FWD from #3] ACK HC3xyz",
        );
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
