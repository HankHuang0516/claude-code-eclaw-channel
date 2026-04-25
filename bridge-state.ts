/**
 * Pure decision functions extracted from bridge.ts so bug-7 (long-idle
 * auto-wake / reply enforcer) regressions can be unit-tested without a
 * real tmux session or Claude Code instance.
 *
 * The bridge.ts side imports these and keeps the I/O (tmux capture,
 * setTimeout, execSync). The decisions live here so a test can feed in
 * a synthetic screen + clock and assert the next action.
 */

export type TmuxState =
    | "stuck_prompt"
    | "idle"
    | "hook_pending"
    | "busy"
    | "crashed";

/**
 * Pure classifier: given the tmux screen contents and whether a hook
 * /ask is in flight, return the diagnosis used by auto-wake and the
 * reply enforcer.
 *
 * Order matters:
 *  1. hook_pending wins (user has a card to click; nothing else to do)
 *  2. stuck_prompt (Claude Code's "Do you want to" / Esc-to-cancel
 *     confirmations that --dangerously-skip-permissions doesn't bypass
 *     — bug 7's trigger)
 *  3. busy if "esc to interrupt" footer is present (the ONLY reliable
 *     active-turn signal)
 *  4. idle if a prompt marker is on screen
 *  5. crashed for empty / unrecognizable screens
 */
export function classifyTmuxScreen(
    screen: string,
    opts: { hookPending: boolean }
): TmuxState {
    if (opts.hookPending) return "hook_pending";

    if (
        screen.includes("Do you want to") ||
        screen.includes("Esc to cancel") ||
        screen.includes("Enter to confirm") ||
        screen.includes("Enter to select")
    ) {
        return "stuck_prompt";
    }

    if (screen.includes("esc to interrupt")) return "busy";

    const lines = screen.trim().split("\n").filter(Boolean);
    const lastContentLine = lines[lines.length - 1] || "";
    if (
        lastContentLine.includes("❯") ||
        lastContentLine.includes("bypass permissions")
    ) {
        return "idle";
    }

    if (screen.trim().length < 20) return "crashed";

    return "busy";
}

export type AutoWakeAction =
    | { type: "bail"; reason: "hook_pending" | "crashed" }
    | { type: "resolve_stuck_prompt" }
    | { type: "wait" }
    | { type: "nudge" };

/**
 * Pure decision for one auto-wake tick once the diagnosed tmux state
 * is known. The bridge tick handler diagnoses, then calls this, then
 * performs the side effect (tmux send-keys / re-arm timer) based on
 * the returned action.
 *
 * Bug-7 contract: state="stuck_prompt" must return "resolve_stuck_prompt"
 * (NOT "bail") — pre-fix this was grouped with hook_pending/crashed and
 * the user's message sat forever.
 *
 * Cooldown / max-wait short-circuits live in bridge.ts so the async
 * tmux capture is skipped when a tick is moot.
 */
export function decideAutoWakeTickAction(state: TmuxState): AutoWakeAction {
    if (state === "hook_pending") return { type: "bail", reason: "hook_pending" };
    if (state === "crashed") return { type: "bail", reason: "crashed" };
    if (state === "stuck_prompt") return { type: "resolve_stuck_prompt" };
    if (state === "busy") return { type: "wait" };
    return { type: "nudge" };
}

export type EnforcerAction =
    | { type: "skip"; reason: "fresh" | "cooldown" | "no_human_msg" | "hook_pending" | "crashed" }
    | { type: "trigger_auto_wake_only" }
    | { type: "nudge_only" }
    | { type: "nudge_and_auto_wake" };

/**
 * Pure decision for the reply enforcer 60s tick.
 *
 * Bug-7 contract: when Claude has been long-idle (ageMs > replyTimeout)
 * AND state="stuck_prompt", we must trigger auto-wake (which then
 * auto-resolves the prompt) — pre-fix the enforcer treated stuck_prompt
 * the same as crashed and gave up.
 */
export function decideReplyEnforcerAction(
    state: TmuxState,
    opts: {
        lastHumanMsgMs: number | null;
        nowMs: number;
        replyTimeoutS: number;
        lastEnforcerMs: number;
        enforcerCooldownMs: number;
    }
): EnforcerAction {
    if (opts.lastHumanMsgMs === null) return { type: "skip", reason: "no_human_msg" };
    const ageMs = opts.nowMs - opts.lastHumanMsgMs;
    if (ageMs < opts.replyTimeoutS * 1000) return { type: "skip", reason: "fresh" };
    if (opts.nowMs - opts.lastEnforcerMs < opts.enforcerCooldownMs) {
        return { type: "skip", reason: "cooldown" };
    }
    if (state === "hook_pending") return { type: "skip", reason: "hook_pending" };
    if (state === "crashed") return { type: "skip", reason: "crashed" };
    if (state === "stuck_prompt") return { type: "trigger_auto_wake_only" };
    if (state === "idle") return { type: "nudge_and_auto_wake" };
    return { type: "nudge_only" };
}
