/**
 * card_b51 regression: fakechat assistant WS envelope with no `text`
 * must still clear the reply-enforcer/watchdog state.
 *
 * Backstory (2026-06-12 11:54-12:14 TW): the reply tool's input schema
 * requires `text`, but a Claude run called it with `message=` for 24
 * consecutive messages. fakechat server.ts read only `args.text` → broadcast
 * `{type:'msg', from:'assistant', id, ts}` with no `text` field. bridge.ts
 * gated both the watchdog-clear and the EClaw forward on `data.text` being
 * truthy, so the assistant envelope was discarded entirely and the
 * reply-enforcer kept nudging every 3 minutes for hours (Hank saw nothing,
 * including a Play P0 unblock ask).
 *
 * Stopgap (12:14): switch caller to `text=` (verified forwarded).
 *
 * Root fix (this test): classifyAssistantWsMessage decouples the two
 * decisions — text-less assistant envelopes now produce a "warn_no_text"
 * action so the caller still clears state and surfaces the param mismatch.
 */

import { describe, expect, test } from "bun:test";
import { classifyAssistantWsMessage } from "../bridge-state.ts";

const BOUND = { hasDevice: true, hasEntity: true };

describe("classifyAssistantWsMessage", () => {
    test("assistant msg with text → forward", () => {
        const data = { type: "msg", from: "assistant", id: "m1", text: "hello", ts: 1 };
        expect(classifyAssistantWsMessage(data, BOUND)).toBe("forward");
    });

    test("card_b51: assistant msg with no text field → warn_no_text", () => {
        const data = { type: "msg", from: "assistant", id: "m1781259645631-131", ts: 1781259645631 };
        expect(classifyAssistantWsMessage(data, BOUND)).toBe("warn_no_text");
    });

    test("card_b51: assistant msg with empty-string text → warn_no_text", () => {
        const data = { type: "msg", from: "assistant", id: "m2", text: "", ts: 2 };
        expect(classifyAssistantWsMessage(data, BOUND)).toBe("warn_no_text");
    });

    test("card_b51: assistant msg with undefined text → warn_no_text", () => {
        const data = { type: "msg", from: "assistant", id: "m3", text: undefined, ts: 3 };
        expect(classifyAssistantWsMessage(data, BOUND)).toBe("warn_no_text");
    });

    test("user msg ignored (only assistant clears watchdog)", () => {
        const data = { type: "msg", from: "user", id: "u1", text: "hi", ts: 4 };
        expect(classifyAssistantWsMessage(data, BOUND)).toBe("ignore");
    });

    test("non-msg type ignored (e.g. edit)", () => {
        const data = { type: "edit", from: "assistant", id: "e1", text: "hi", ts: 5 };
        expect(classifyAssistantWsMessage(data, BOUND)).toBe("ignore");
    });

    test("no device binding → ignore (bridge not yet bound to a channel)", () => {
        const data = { type: "msg", from: "assistant", id: "m4", text: "hi", ts: 6 };
        expect(classifyAssistantWsMessage(data, { hasDevice: false, hasEntity: true })).toBe("ignore");
    });

    test("no entity binding → ignore", () => {
        const data = { type: "msg", from: "assistant", id: "m5", text: "hi", ts: 7 };
        expect(classifyAssistantWsMessage(data, { hasDevice: true, hasEntity: false })).toBe("ignore");
    });

    test("non-string text (number) → warn_no_text (defensive)", () => {
        const data = { type: "msg", from: "assistant", id: "m6", text: 42, ts: 8 };
        expect(classifyAssistantWsMessage(data, BOUND)).toBe("warn_no_text");
    });

    test("null payload → ignore", () => {
        expect(classifyAssistantWsMessage(null, BOUND)).toBe("ignore");
    });

    test("non-object payload → ignore", () => {
        expect(classifyAssistantWsMessage("garbled", BOUND)).toBe("ignore");
    });
});
