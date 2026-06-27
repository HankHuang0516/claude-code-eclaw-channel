/**
 * card_35cb55fc — wallpaper activity-state redesign (bridge side).
 *
 * The bridge forwards the agent's REAL runtime activity to EClaw's
 * POST /api/entity/heartbeat `runtimeState` field so the live wallpaper
 * reflects what the agent is actually doing. diagnoseTmuxState() classifies
 * the tmux pane; mapTmuxStateToRuntimeState() translates that internal state
 * to the 4-value contract the EClaw backend receiver consumes.
 *
 * Contract (must match the EClaw-backend receiver EXACTLY):
 *   busy → "busy" | stuck → "stuck" | crashed → "crashed" | idle → "idle"
 *
 * These assertions pin the mapping so a future rename of the internal
 * TmuxState union can't silently break the wallpaper contract.
 */

import { describe, expect, test } from "bun:test";
import {
    classifyTmuxScreen,
    mapTmuxStateToRuntimeState,
    type RuntimeState,
    type TmuxState,
} from "../bridge-state.ts";

describe("mapTmuxStateToRuntimeState — classifier → runtimeState contract", () => {
    test("busy (active turn) maps to busy", () => {
        expect(mapTmuxStateToRuntimeState("busy")).toBe("busy");
    });

    test("stuck_prompt (confirm box blocking) maps to stuck", () => {
        expect(mapTmuxStateToRuntimeState("stuck_prompt")).toBe("stuck");
    });

    test("crashed maps to crashed", () => {
        expect(mapTmuxStateToRuntimeState("crashed")).toBe("crashed");
    });

    test("idle maps to idle", () => {
        expect(mapTmuxStateToRuntimeState("idle")).toBe("idle");
    });

    test("hook_pending (agent blocked on a human /ask) maps to stuck", () => {
        // hook_pending has no dedicated contract value; the agent is blocked
        // awaiting a human decision, so "stuck" (needs attention) is correct.
        expect(mapTmuxStateToRuntimeState("hook_pending")).toBe("stuck");
    });

    test("only emits the four contract values", () => {
        const allowed: RuntimeState[] = ["busy", "stuck", "crashed", "idle"];
        const states: TmuxState[] = [
            "busy",
            "stuck_prompt",
            "crashed",
            "idle",
            "hook_pending",
        ];
        for (const s of states) {
            expect(allowed).toContain(mapTmuxStateToRuntimeState(s));
        }
    });

    test("unknown / tmux-read-error value fails safe to busy (never wrongly idle)", () => {
        // diagnoseTmuxState() is typed Promise<string> and returns "busy" on a
        // tmux read error; an unexpected value must not surface as idle/crashed
        // on the wallpaper.
        expect(mapTmuxStateToRuntimeState("")).toBe("busy");
        expect(mapTmuxStateToRuntimeState("something-else")).toBe("busy");
    });
});

describe("classifyTmuxScreen → mapTmuxStateToRuntimeState end-to-end", () => {
    test('"esc to interrupt" footer → busy runtimeState', () => {
        const screen = "Running tool...\n  ⎿  esc to interrupt";
        const state = classifyTmuxScreen(screen, { hookPending: false });
        expect(mapTmuxStateToRuntimeState(state)).toBe("busy");
    });

    test('"Do you want to" confirm box → stuck runtimeState', () => {
        const screen = "Do you want to proceed?\n  Esc to cancel";
        const state = classifyTmuxScreen(screen, { hookPending: false });
        expect(mapTmuxStateToRuntimeState(state)).toBe("stuck");
    });

    test("idle ❯ prompt → idle runtimeState", () => {
        const screen = "Some output\n❯ ";
        const state = classifyTmuxScreen(screen, { hookPending: false });
        expect(mapTmuxStateToRuntimeState(state)).toBe("idle");
    });

    test("empty screen → crashed runtimeState", () => {
        const state = classifyTmuxScreen("", { hookPending: false });
        expect(mapTmuxStateToRuntimeState(state)).toBe("crashed");
    });

    test("pending /ask hook → stuck runtimeState", () => {
        const screen = "❯ ";
        const state = classifyTmuxScreen(screen, { hookPending: true });
        expect(mapTmuxStateToRuntimeState(state)).toBe("stuck");
    });
});
