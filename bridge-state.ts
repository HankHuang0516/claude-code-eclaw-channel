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
 * Pattern is intentionally conservative. Three layered checks:
 *   (1) `[SILENT]` marker (whole-string or embedded) — takes precedence
 *       over the @-mention guard so quoted echoes like "Received `@#6
 *       [SILENT]`. No action..." still suppress. Capped at 100 chars.
 *   (2) Verbose channel-mode chatter — opener (Acknowledged/Noted/
 *       Understood/Roger/Standing by-down) + noop continuation (no
 *       action / for your-the next / made no changes / etc). Both
 *       required, so "Standing by for #1's signoff" stays out. Capped
 *       at 100 chars.
 *   (3) Short pure-ack tokens (「了解。」/「OK」/「ACK」/Acknowledged./...)
 *       — ≤30-char trimmed text.
 *
 * Adding a new verbose opener requires picking a paired continuation
 * the bot loop reliably emits; loose openers leak real status updates.
 */
export function isNoopAck(text: string): boolean {
    if (!text) return false;
    const t = text.trim();
    if (t.length === 0) return false;

    // [SILENT] marker — whole-string OR embedded. Takes precedence over
    // the @-mention guard below because LLM bots routinely quote the
    // sender's routing token while acknowledging no action ("Received
    // `@#6 [SILENT]`. No action was requested.") — the quoted @-mention
    // is an echo, not a fresh routing directive. 100-char cap keeps a
    // status update wrapped in [SILENT] from leaking through.
    if (/\[SILENT(?:[^\]]*)?\]/i.test(t) && t.length <= 100) return true;

    if (/@(?:#?[A-Za-z0-9]+|all)/.test(t)) return false;

    // Verbose stand-by chatter — LLM channel-mode bots pad pure acks
    // with stand-by phrases ("Acknowledged. Standing by for your next
    // request.", "Standing down. No action taken.", "Noted. Standing by
    // for the next work item."). Pattern requires an ack opener AND a
    // noop-style continuation, so real status updates like "Acknowledged
    // the report — will file PR" or "Standing by for #1's signoff per
    // spec" stay out. 2026-06-01 loop incident: #2/#5/#6 cycled these
    // phrases ~10 times in 3 minutes — the original 30-char cap missed
    // all of them.
    const VERBOSE_ACK_OPENER =
        /^(?:acknowledged|noted|understood|roger|standing\s+(?:by|down))\b/i;
    const NOOP_CONTINUATION =
        /\b(?:no\s+action|stand\s+down|for\s+(?:your|the)\s+next\b|ready\s+for\s+(?:next|further|the)|await(?:ing)?\s+(?:further|your\s+next)|made\s+no\s+(?:file\s+)?changes|no\s+changes\s+made|no\s+further\s+(?:action|work))\b/i;
    if (t.length <= 100 && VERBOSE_ACK_OPENER.test(t) && NOOP_CONTINUATION.test(t)) {
        return true;
    }

    // Short pure-ack tokens — strict 30-char cap keeps the regex set
    // from accidentally swallowing a status update that happens to
    // start with 「了解。」 or "Acknowledged".
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
        /^acknowledged[.!]?$/i,
        /^noted[.!]?$/i,
        /^understood[.!]?$/i,
        /^roger[.!]?$/i,
        /^standing\s+(?:by|down)[.!]?$/i,
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
