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

/**
 * Detects the github-computer MCP permission dialog, which has a required
 * "Allow access for this session?" dropdown that must be filled before the
 * Accept button can be pressed.
 *
 * For this dialog, `resolve_stuck_prompt` must send Escape (graceful cancel)
 * rather than Down+Enter, because:
 *  1. Down+Enter navigates to "Decline" (2nd option in the horizontal menu)
 *     and tries to confirm — but the required field is unset, so the dialog
 *     shows "This field is required" and stays open.
 *  2. This causes an infinite decline-loop: bot retries upload → dialog →
 *     auto-wake declines → dialog again → repeat until 300s giveup.
 *
 * Escape lets the bot handle the cancellation gracefully and report back to
 * the user instead of spinning indefinitely.
 *
 * // 2026-05-14 fix: detected by 6h self-healthcheck auto-wake loop
 */
export function isMcpPermissionDialog(screen: string): boolean {
    return screen.includes("Allow access for this session");
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

/**
 * Detects bot-to-bot noop ack messages (「了解。」/「收到」/「OK」/...) that
 * shouldn't trigger the auto-wake nudge.
 *
 * 2026-05-27 incident, card_505e8c98f: #5 (Hermes) and #6 (Codex)
 * entered a mutual ack-of-ack reply loop after a Platform-P1 review
 * dispatch. Each received the other's 「了解。」/「收到」 via FWD; the
 * bridge auto-wake nudged the receiver with "Immediately use the reply
 * tool" → which sent another ack → which arrived as a new inbound →
 * which fired auto-wake again. ~15+ identical messages in 2 minutes
 * before commander session manually broke the loop.
 *
 * Bot-to-bot noop acks carry no "user is waiting for reply" semantics,
 * so suppressing the auto-wake breaks the loop without dropping useful
 * inbound. Real bot-to-bot work (review reports, status updates with
 * actionable verbs, @-mentions) is NOT classified as a noop ack.
 *
 * Pattern is intentionally conservative: ≤30-char trimmed text, no
 * @-mention routing token, and matches a small fixed set of pure-ack
 * tokens across the locales we use.
 */
export function isNoopAck(text: string): boolean {
    if (!text) return false;
    const t = text.trim();
    if (t.length === 0) return false;
    if (/@(?:#?[A-Za-z0-9]+|all)/.test(t)) return false;
    // Explicit `[SILENT ...]` marker — bypasses the length cap because
    // the syntax itself is unambiguous and the body often carries human
    // context ("kanban echo of own card move").
    if (/^\[SILENT[^\]]*\]$/i.test(t)) return true;
    // Everything else falls under a tight length cap: real ack-only
    // messages are always short. A 30-char trimmed-text limit keeps the
    // regex set from accidentally swallowing a status update that
    // happens to start with 「了解。」.
    if (t.length > 30) return false;
    const ACK_PATTERNS = [
        /^了解[。!.！]?$/,
        /^收到[。!.！]?$/,
        /^好的?[。!.！]?$/,
        /^OK[。!.！]?$/i,
        /^ACK\.?$/i,
        /^received\.?$/i,
        /^thanks?\.?$/i,
        /^承知(?:しました)?[。!.！]?$/,
        /^かしこまりました[。!.！]?$/,
    ];
    return ACK_PATTERNS.some((p) => p.test(t));
}

/**
 * Sender-hint kind classified by the webhook handler from
 * fromEntityId / fromPublicCode / isBroadcast on the inbound payload.
 * Matches the SenderHint["kind"] union in eclaw-sender.ts.
 */
export type SenderHintKind = "entity" | "user" | "broadcast" | "unknown";

/**
 * Combined predicate: is this inbound a noop bot-to-bot ack that
 * shouldn't fire the auto-wake nudge? The webhook handler classifies
 * the sender; this helper merges that classification with the
 * text-based ack check so the gate is one call at the seam.
 */
export function isNoopBotToBotAck(
    text: string,
    senderHintKind: SenderHintKind | undefined,
): boolean {
    if (senderHintKind !== "entity") return false;
    return isNoopAck(text);
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
