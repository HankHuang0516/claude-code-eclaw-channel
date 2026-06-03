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
 * Strips server-side wrapper blocks from the inbound webhook body so the
 * noop-ack classifier sees the actual sender message.
 *
 * 2026-06-03 incident: the EClaw server started prepending centrally-
 * managed policy blocks ("[EClaw central routing policy]" + "[EClaw
 * managed prompt policy - claude_code]") and appending tool/hint blocks
 * ("[AVAILABLE TOOLS — ...]", "[Local Variables available: ...]",
 * "[API HINT — ...]") to every inbound. Webhook body.text grew from
 * ~50 chars (`[📢 FWD from #3] ACK HC3mpxo7x4m02hldb`) to ~5700 chars
 * with the actual message buried in the middle. The ack-echo layers in
 * isNoopAck below all rely on either `^` anchors or length caps (80 chars
 * for HEALTHCHECK_ACK_ECHO, 30 chars for short-token list); the wrapped
 * form blew past all of them and three FWD ACK echoes from #3/#5/#6
 * fired auto-wake nudges back-to-back at 06:13:57 / 06:14:09 / 06:14:15.
 *
 * Block layout (in delivery order):
 *   [EClaw central routing policy] ... [End EClaw central routing policy]
 *   [EClaw managed prompt policy - <channel>] ... [End EClaw managed prompt policy]
 *   [EClaw from <sender>] <actual message body>
 *   [Local Variables available: ...]    (optional, kept above [API HINT])
 *   [API HINT — ...]                    (optional)
 *   [AVAILABLE TOOLS — Mission Dashboard] ...
 *   [AVAILABLE TOOLS — Kanban Board] ...
 *
 * Strategy: peel off leading "[EClaw <something> policy]" ... "[End
 * EClaw <something> policy]" blocks (zero or more), strip a leading
 * "[EClaw from <sender>] " marker, and cut everything at the first
 * trailing meta-block opener ([AVAILABLE TOOLS / [Local Variables /
 * [API HINT). The result is the sender's literal text — same shape
 * isNoopAck saw before the policy rollout.
 *
 * Idempotent: an already-stripped string (the pre-rollout shape) passes
 * through unchanged because none of the markers match.
 */
export function stripServerWrappers(text: string): string {
    if (!text) return text;
    let t = text;
    // Peel leading policy blocks. Allow multiple in case the server
    // ever chains more than the two it ships today.
    const POLICY_BLOCK = /^\s*\[EClaw[^\]\n]*policy[^\]\n]*\][\s\S]*?\[End EClaw[^\]\n]*policy[^\]\n]*\]\s*/i;
    while (POLICY_BLOCK.test(t)) {
        t = t.replace(POLICY_BLOCK, "");
    }
    // Strip the "[EClaw from <sender>]" inbound prefix — sender token
    // is freeform (entity:N / publicCode / monitor-modelcheck-2 / etc).
    t = t.replace(/^\s*\[EClaw from [^\]\n]+\]\s+/, "");
    // Cut trailing meta blocks. Earliest marker wins so we don't
    // accidentally include "[API HINT" inside "[AVAILABLE TOOLS".
    const TRAILING_MARKERS = /\n\s*\[(?:AVAILABLE TOOLS|Local Variables available|API HINT|MENTIONS)\b[\s\S]*$/;
    t = t.replace(TRAILING_MARKERS, "");
    return t.trim();
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
 * Pattern is intentionally conservative. Four layered checks, each
 * gated by a real-payload disqualifier (LGTM / PR #N / merged / fixed /
 * reviewed / approved / landed / shipped / ready-to-merge) so that ack
 * chatter wrapping a review verdict doesn't get suppressed:
 *   (1) `[SILENT]` marker (whole-string or embedded) — takes precedence
 *       over the @-mention guard so quoted echoes like "Received `@#6
 *       [SILENT]`. No action..." still suppress. Capped at 100 chars,
 *       blocked by disqualifier ("Fixed [SILENT] echo bug; PR #12 ready"
 *       must wake the recipient).
 *   (2) Verbose channel-mode chatter — opener (Acknowledged/Noted/
 *       Understood/Roger/Standing by-down) + noop continuation (no
 *       action / for your-the next / made no changes / etc). Both
 *       required + disqualifier-blocked, so "Acknowledged. No action
 *       needed; PR #12 LGTM." stays out.
 *   (3) Healthcheck ACK echoes — `ACK <nonce>` and the server-fanned
 *       `[📢 FWD from #N] ACK <nonce>` shape. bridge.ts:1014 sends
 *       `ACK ${nonce}` after every ECLAW_HEALTHCHECK ping; when the
 *       server fans the ACK back to sibling entities (FWD), the body
 *       falls between the 30-char short-token cap and the verbose
 *       opener requirement, so neither (2) nor (4) caught it. Nonce
 *       matches the HEALTHCHECK_RE capture group `[A-Za-z0-9_-]+`.
 *   (4) Short pure-ack tokens (「了解。」/「OK」/「ACK」/Acknowledged./...)
 *       — ≤30-char trimmed text.
 *
 * Adding a new verbose opener requires picking a paired continuation
 * the bot loop reliably emits; loose openers leak real status updates.
 *
 * Pre-step: stripServerWrappers peels off the centrally-managed policy
 * blocks and trailing tool-hint blocks the EClaw server now prepends
 * to every inbound (2026-06-03 wrapper rollout). Without this the
 * ^-anchored / length-capped layers below cannot see the embedded ack.
 */
export function isNoopAck(text: string): boolean {
    if (!text) return false;
    // Strip server-side wrapper blocks first so the layers below see
    // the sender's literal message body, not the 5KB policy envelope.
    const unwrapped = stripServerWrappers(text);
    if (unwrapped.length === 0) return false;
    // Strip a leading `[📢 FWD from #N]` / `[FWD from entity:N]` prefix
    // so the opener-anchored layers below match the body. 2026-06-03
    // loop incident: #6 echoed verbose "[📢 FWD from #6] Acknowledged
    // `[SILENT]`; no action required and no file changes made." which
    // had every ingredient layer 2 needs except the `^acknowledged`
    // anchor — the FWD prefix shifted it off the start of the string.
    // Emoji optional; sender token is `#N` / `entity:N` / publicCode.
    const FWD_PREFIX =
        /^\[(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})?\s*FWD\s+from\s+(?:#?[A-Za-z0-9]+|entity[:\s]\d+)\]\s+/iu;
    const t = unwrapped.replace(FWD_PREFIX, "");
    if (t.length === 0) return false;

    // Real-payload disqualifier — even when ack chatter matches below,
    // these sentinels signal a review/PR/status payload that must NOT
    // be suppressed. 2026-06-01 #1 review found the first-cut widening
    // misclassified "Acknowledged. No action needed; PR #12 LGTM." and
    // "Fixed [SILENT] echo bug; PR #12 ready." as noop because the ack
    // phrase came BEFORE the actionable content.
    const NOOP_DISQUALIFIER =
        /\b(?:LGTM|PR\s*#?\d+|merged|fix(?:ed|es)?\b|reviewed|approved|landed|shipped|ready\s+(?:to\s+merge|for\s+(?:merge|review|deploy)))\b/i;

    // [SILENT] marker — whole-string OR embedded. Takes precedence over
    // the @-mention guard below because LLM bots routinely quote the
    // sender's routing token while acknowledging no action ("Received
    // `@#6 [SILENT]`. No action was requested.") — the quoted @-mention
    // is an echo, not a fresh routing directive. 100-char cap keeps a
    // status update wrapped in [SILENT] from leaking through; the
    // disqualifier blocks short status payloads that happen to contain
    // the marker as a reference ("Fixed [SILENT] echo bug; PR #12 ready").
    // Verbose [SILENT] echoes longer than 100 are caught by the
    // opener+continuation layer below instead.
    if (
        /\[SILENT(?:[^\]]*)?\]/i.test(t) &&
        t.length <= 100 &&
        !NOOP_DISQUALIFIER.test(t)
    ) return true;

    if (/@(?:#?[A-Za-z0-9]+|all)/.test(t)) return false;

    // Verbose stand-by chatter — LLM channel-mode bots pad pure acks
    // with stand-by phrases ("Acknowledged. Standing by for your next
    // request.", "Standing down. No action taken.", "Noted. Standing by
    // for the next work item."). Pattern requires an ack opener AND a
    // noop-style continuation AND no disqualifier, so real status
    // updates like "Acknowledged the report — will file PR by EOD",
    // "Standing by for #1's signoff per spec", or "Acknowledged. No
    // action needed; PR #12 LGTM." stay out. 2026-06-01 loop incident:
    // #2/#5/#6 cycled these phrases ~10 times in 3 minutes — the
    // original 30-char cap missed all of them.
    //
    // 2026-06-03 added "inbound" / "received" openers and "no actionable",
    // "did not use" continuations to catch Codex's verbose echo
    // "Inbound `[SILENT]` acknowledged. No actionable operation was
    // requested, so I made no file changes and did not use Computer Use."
    const VERBOSE_ACK_OPENER =
        /^(?:acknowledged|noted|understood|roger|standing\s+(?:by|down)|inbound\b|received\b)/i;
    const NOOP_CONTINUATION =
        /\b(?:no\s+action(?:able)?|stand\s+down|for\s+(?:your|the)\s+next\b|ready\s+for\s+(?:next|further|the)|await(?:ing)?\s+(?:further|your\s+next)|made\s+no\s+(?:file\s+)?changes|no\s+changes\s+made|no\s+further\s+(?:action|work)|did\s+not\s+use|no\s+(?:file\s+)?changes(?:\s+made)?)\b/i;
    if (
        t.length <= 200 &&
        VERBOSE_ACK_OPENER.test(t) &&
        NOOP_CONTINUATION.test(t) &&
        !NOOP_DISQUALIFIER.test(t)
    ) {
        return true;
    }

    // Empty-completion status — Codex/SDK harnesses sometimes emit
    // "Codex completed with no text output." / "Agent completed with no
    // output." when the LLM produced nothing usable. Pure status; never
    // a routing directive. Strict shape match + disqualifier guard.
    const EMPTY_COMPLETION =
        /^(?:codex|agent|claude|llm|bot)\s+completed\s+with\s+no\s+(?:text\s+)?output[.!]?$/i;
    if (
        t.length <= 80 &&
        EMPTY_COMPLETION.test(t) &&
        !NOOP_DISQUALIFIER.test(t)
    ) {
        return true;
    }

    // Model-healthcheck echo — monitor-modelcheck cron broadcasts
    // `MODEL_HEALTHCHECK <nonce>` probes; siblings reply with
    // `MODEL_HEALTH <nonce> entity=N status=OK`, which the server fans
    // out as `[📢 FWD from #N] MODEL_HEALTH ...`. Pure protocol noise
    // for recipients other than the probe issuer. Strict shape match
    // pins to the canonical reply format so a real status update can't
    // accidentally start with "MODEL_HEALTH".
    const MODEL_HEALTH_ECHO =
        /^MODEL_HEALTH\s+[A-Za-z0-9_-]+\s+entity=#?\d+(?:\s+status=(?:OK|FAIL|DEGRADED))?[.!]?$/i;
    if (
        t.length <= 80 &&
        MODEL_HEALTH_ECHO.test(t) &&
        !NOOP_DISQUALIFIER.test(t)
    ) {
        return true;
    }

    // Healthcheck ACK echo — bridge.ts:1014 sends `ACK <nonce>` after
    // every ECLAW_HEALTHCHECK ping. The bare form (`ACK <nonce>`) lands
    // at sibling bridges directly; the server-fanned form prefixes the
    // body with `[📢 FWD from #N]` (📢 emoji optional, sender token is
    // `#N` / `entity:N` / publicCode). Neither layer (4) (`^ACK\.?$`
    // requires bare "ACK") nor layer (2) (needs a verbose opener word)
    // catches it. 2026-06-02 incident: a FWD'd `ACK HC3mpvisgv38q2bks`
    // from #3 and `ACK HC6mpvkcrgzpsl2vt` from #6 both leaked through
    // and fired auto-wake.
    //
    // 80-char cap covers the worst-case `[📢 FWD from #publicCode] ACK
    // <long-nonce>` shape with margin; the nonce regex pins the body to
    // healthcheck format so a free-form `ACK: investigating` stays out.
    const HEALTHCHECK_ACK_ECHO =
        /^(?:\[(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})?\s*FWD\s+from\s+(?:#?[A-Za-z0-9]+|entity[:\s]\d+)\]\s+)?ACK\s+[A-Za-z0-9_-]+[.!]?$/iu;
    if (
        t.length <= 80 &&
        HEALTHCHECK_ACK_ECHO.test(t) &&
        !NOOP_DISQUALIFIER.test(t)
    ) {
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
