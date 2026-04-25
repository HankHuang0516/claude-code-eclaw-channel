/**
 * Long-idle E2E regression test for bug 7 (README §"七大 bug 修復過程").
 *
 * Bug 7 only surfaced under real-world ≥ 6-min idle gaps:
 *   user sends msg → Claude hits internal confirmation prompt → bridge
 *   diagnoses `stuck_prompt` → pre-fix scheduleAutoWake bailed out and
 *   the message sat forever; reply enforcer also bailed because it
 *   only handled busy/idle, not stuck_prompt.
 *
 * Fix lives in commits:
 *   067fc5b — 5 auto-wake / reply enforcer bugs
 *   7642016 — auto-wake auto-resolves stuck_prompt
 *
 * The bug is invisible to fast iteration tests (Claude stays busy,
 * never enters stuck_prompt). This test simulates a long-idle gap by
 * feeding synthetic tmux screens + clock to the pure decision helpers
 * extracted from bridge.ts. Reverting either fix flips the assertions.
 */

import { describe, expect, test } from "bun:test";
import {
    classifyTmuxScreen,
    decideAutoWakeTickAction,
    decideReplyEnforcerAction,
    type TmuxState,
} from "../bridge-state.ts";

// ── Synthetic tmux screen fixtures ──

const SCREEN_BUSY = `
Sautéed for 39s · 1.2k tokens · esc to interrupt
> Reading file foo.ts
`.trim();

const SCREEN_IDLE = `
History from previous turn ...
Sautéed for 39s · 1.2k tokens
⏵⏵ bypass permissions on (shift+tab to cycle)
`.trim();

const SCREEN_IDLE_PROMPT = `
> last reply text from Claude
❯
`.trim();

const SCREEN_STUCK_DO_YOU = `
Tool call wants to write file /tmp/foo
Do you want to proceed?
1. Yes
2. Yes, and always allow
`.trim();

const SCREEN_STUCK_ESC = `
Some prompt
Esc to cancel
`.trim();

const SCREEN_STUCK_ENTER_CONFIRM = `
Confirm action
Press Enter to confirm
`.trim();

const SCREEN_STUCK_ENTER_SELECT = `
Pick option:
> Option A
  Option B
Enter to select
`.trim();

const SCREEN_CRASHED = "";

const SCREEN_BUSY_WITH_HISTORICAL_KEYWORDS = `
Sautéed for 2m · 12k tokens · thinking
(this used to false-positive as busy because of "thinking" / "tokens")
> Reading auto.ts
⏵⏵ bypass permissions on (shift+tab to cycle)
`.trim();

// ── 1. classifier — every screen → expected state ──

describe("classifyTmuxScreen", () => {
    test("hook_pending overrides every other signal", () => {
        // Even an obviously busy screen returns hook_pending when the
        // /ask map has entries (user has a card to click on EClaw).
        expect(classifyTmuxScreen(SCREEN_BUSY, { hookPending: true })).toBe(
            "hook_pending"
        );
        expect(classifyTmuxScreen(SCREEN_STUCK_DO_YOU, { hookPending: true })).toBe(
            "hook_pending"
        );
    });

    test("stuck_prompt: all four trigger strings (bug 7 entry condition)", () => {
        expect(classifyTmuxScreen(SCREEN_STUCK_DO_YOU, { hookPending: false })).toBe(
            "stuck_prompt"
        );
        expect(classifyTmuxScreen(SCREEN_STUCK_ESC, { hookPending: false })).toBe(
            "stuck_prompt"
        );
        expect(
            classifyTmuxScreen(SCREEN_STUCK_ENTER_CONFIRM, { hookPending: false })
        ).toBe("stuck_prompt");
        expect(
            classifyTmuxScreen(SCREEN_STUCK_ENTER_SELECT, { hookPending: false })
        ).toBe("stuck_prompt");
    });

    test("busy: 'esc to interrupt' footer is the only reliable busy signal", () => {
        expect(classifyTmuxScreen(SCREEN_BUSY, { hookPending: false })).toBe("busy");
    });

    test("idle: footer without 'esc to interrupt' (commit 067fc5b regression guard)", () => {
        // Pre-067fc5b this matched 'thinking'/'tokens' anywhere on screen
        // and returned busy → reply enforcer never fired during idle.
        expect(classifyTmuxScreen(SCREEN_IDLE, { hookPending: false })).toBe("idle");
        expect(
            classifyTmuxScreen(SCREEN_BUSY_WITH_HISTORICAL_KEYWORDS, {
                hookPending: false,
            })
        ).toBe("idle");
    });

    test("idle: prompt-only screen", () => {
        expect(
            classifyTmuxScreen(SCREEN_IDLE_PROMPT, { hookPending: false })
        ).toBe("idle");
    });

    test("crashed: empty / unrecognizable screen", () => {
        expect(classifyTmuxScreen(SCREEN_CRASHED, { hookPending: false })).toBe(
            "crashed"
        );
        expect(classifyTmuxScreen("garb", { hookPending: false })).toBe("crashed");
    });
});

// ── 2. auto-wake decision — bug 7's core regression catcher ──

describe("decideAutoWakeTickAction", () => {
    test("stuck_prompt → resolve_stuck_prompt (bug 7 fix; commit 7642016)", () => {
        // PRE-FIX behavior was bail. If anyone reverts 7642016 grouping
        // stuck_prompt back with hook_pending/crashed, this assertion
        // flips and we catch the regression.
        expect(decideAutoWakeTickAction("stuck_prompt")).toEqual({
            type: "resolve_stuck_prompt",
        });
    });

    test("hook_pending / crashed → bail", () => {
        expect(decideAutoWakeTickAction("hook_pending")).toEqual({
            type: "bail",
            reason: "hook_pending",
        });
        expect(decideAutoWakeTickAction("crashed")).toEqual({
            type: "bail",
            reason: "crashed",
        });
    });

    test("busy → wait (re-poll, don't double-nudge)", () => {
        expect(decideAutoWakeTickAction("busy")).toEqual({ type: "wait" });
    });

    test("idle → nudge", () => {
        expect(decideAutoWakeTickAction("idle")).toEqual({ type: "nudge" });
    });
});

// ── 3. reply enforcer — long-idle simulation (the actual ≥6-min gap) ──

describe("decideReplyEnforcerAction (long-idle simulation)", () => {
    const baseOpts = {
        replyTimeoutS: 120, // bridge default
        enforcerCooldownMs: 3 * 60_000,
        lastEnforcerMs: 0,
    };

    function atIdleAge(ageMs: number, lastEnforcerMs = 0) {
        const nowMs = 1_000_000_000_000;
        return {
            ...baseOpts,
            lastHumanMsgMs: nowMs - ageMs,
            nowMs,
            lastEnforcerMs,
        };
    }

    test("no human message yet → skip", () => {
        expect(
            decideReplyEnforcerAction("idle", { ...baseOpts, lastHumanMsgMs: null, nowMs: 0 })
        ).toEqual({ type: "skip", reason: "no_human_msg" });
    });

    test("fresh message (<replyTimeout) → skip", () => {
        // 30s old, threshold is 120s
        expect(
            decideReplyEnforcerAction("idle", atIdleAge(30_000))
        ).toEqual({ type: "skip", reason: "fresh" });
    });

    test("cooldown active → skip even if long-idle", () => {
        // 7 min old AND last enforcer fired 1 min ago → still cooldown
        const opts = atIdleAge(7 * 60_000);
        opts.lastEnforcerMs = opts.nowMs - 60_000;
        expect(decideReplyEnforcerAction("idle", opts)).toEqual({
            type: "skip",
            reason: "cooldown",
        });
    });

    test("LONG-IDLE 7-min + stuck_prompt → trigger_auto_wake_only (BUG 7 PATH)", () => {
        // This is the exact failure mode bug 7 caught:
        //   human message > 6 min old, Claude blocked on internal
        //   confirmation prompt (--dangerously-skip-permissions doesn't
        //   bypass file-creation confirms). Pre-fix returned "skip".
        expect(
            decideReplyEnforcerAction("stuck_prompt", atIdleAge(7 * 60_000))
        ).toEqual({ type: "trigger_auto_wake_only" });
    });

    test("long-idle + idle → nudge_and_auto_wake (commit 067fc5b — was busy-only pre-fix)", () => {
        expect(
            decideReplyEnforcerAction("idle", atIdleAge(7 * 60_000))
        ).toEqual({ type: "nudge_and_auto_wake" });
    });

    test("long-idle + busy → nudge_only (busy nudge → reply tool reminder in inbox)", () => {
        expect(
            decideReplyEnforcerAction("busy", atIdleAge(7 * 60_000))
        ).toEqual({ type: "nudge_only" });
    });

    test("long-idle + hook_pending → skip (user already has a card)", () => {
        expect(
            decideReplyEnforcerAction("hook_pending", atIdleAge(7 * 60_000))
        ).toEqual({ type: "skip", reason: "hook_pending" });
    });

    test("long-idle + crashed → skip", () => {
        expect(
            decideReplyEnforcerAction("crashed", atIdleAge(7 * 60_000))
        ).toEqual({ type: "skip", reason: "crashed" });
    });
});

// ── 4. Long-idle integration — driving an end-to-end stuck_prompt
//    recovery through both helpers in sequence (the chain that bug 7
//    actually broke).

describe("long-idle stuck_prompt recovery chain (bug 7 end-to-end)", () => {
    test("classifier → enforcer → auto-wake all funnel toward resolve_stuck_prompt", () => {
        // Step 1: 7-min-old message; tmux shows the dreaded "Do you
        // want to" confirmation; no hook /ask is in flight.
        const screen = SCREEN_STUCK_DO_YOU;
        const state = classifyTmuxScreen(screen, { hookPending: false });
        expect(state).toBe("stuck_prompt");

        // Step 2: 60s background tick fires the reply enforcer.
        const nowMs = 1_700_000_000_000;
        const enforcerAction = decideReplyEnforcerAction(state, {
            lastHumanMsgMs: nowMs - 7 * 60_000,
            nowMs,
            replyTimeoutS: 120,
            lastEnforcerMs: 0,
            enforcerCooldownMs: 3 * 60_000,
        });
        // Pre-fix: this was a bail. Post-fix: triggers auto-wake.
        expect(enforcerAction.type).toBe("trigger_auto_wake_only");

        // Step 3: enforcer schedules auto-wake; first tick re-diagnoses
        // (still stuck_prompt) and decides to send Down+Enter.
        const wakeAction = decideAutoWakeTickAction(state);
        // Pre-fix this was bail; post-fix it resolves the prompt and
        // keeps polling until idle, at which point it nudges.
        expect(wakeAction.type).toBe("resolve_stuck_prompt");
    });

    test("after stuck_prompt resolves, auto-wake tick polling reaches idle → nudge", () => {
        // The state machine after Down+Enter unblocks Claude:
        //   stuck_prompt → resolve_stuck_prompt → poll
        //   busy         → wait                  → poll
        //   idle         → nudge                 → done
        const states: TmuxState[] = ["stuck_prompt", "busy", "busy", "idle"];
        const actions = states.map(decideAutoWakeTickAction);
        expect(actions.map(a => a.type)).toEqual([
            "resolve_stuck_prompt",
            "wait",
            "wait",
            "nudge",
        ]);
    });
});
