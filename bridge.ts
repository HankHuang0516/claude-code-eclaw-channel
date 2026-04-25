#!/usr/bin/env bun
/**
 * EClaw → Fakechat Bridge
 *
 * Receives EClaw webhook pushes on port 18800,
 * forwards them to fakechat via HTTP POST /upload on localhost:8787,
 * which triggers MCP notification to Claude Code.
 *
 * EClaw reply is handled by fakechat's reply tool — we intercept
 * fakechat's outbox and forward to EClaw API.
 */

import { appendFileSync, readdirSync, readFileSync, unlinkSync, mkdirSync, existsSync, watchFile } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { t, setLocale, detectLanguage } from "./i18n.ts";
import {
  classifyTmuxScreen,
  decideAutoWakeTickAction,
  decideReplyEnforcerAction,
} from "./bridge-state.ts";

const LOG_FILE = "/tmp/eclaw-bridge.log";
function log(msg: string) {
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

const WEBHOOK_PORT = parseInt(process.env.ECLAW_WEBHOOK_PORT || "18800", 10);
const FAKECHAT_WS = process.env.FAKECHAT_WS || "ws://localhost:8787/ws";
const API_KEY = process.env.ECLAW_API_KEY || "";
const API_BASE = (process.env.ECLAW_API_BASE || "https://eclawbot.com").replace(/\/$/, "");

// Track deviceId/entityId from incoming messages for reply routing
let lastDeviceId: string | null = null;
let lastEntityId: number | null = null;
let botSecret: string | null = null;

// ── Pending /ask requests (PreToolUse hook long-poll) ──
interface PendingAsk {
  resolve: (action: string) => void;
  timestamp: number;
}
const pendingAsks: Map<string, PendingAsk> = new Map();

// ── Watchdog mechanism ──
const WATCHDOG_TIMEOUT_S = parseInt(process.env.ECLAW_WATCHDOG_TIMEOUT || "30", 10);
const WATCHDOG_ENABLED = (process.env.ECLAW_WATCHDOG_ENABLED || "true") !== "false";

// ── Kanban filter (2026-04-21 incident — opt-out only) ──
// Kanban automation messages (status changes, task reminders, scheduled
// triggers) ARE the bot's work queue — removing them destroys the
// point of having a kanban. Default: forward. Only drop when
// ECLAW_FORWARD_KANBAN=false is explicitly set (emergency mute during
// context overflow recovery).
//
// The real fix for the 2026-04-21 incident is the context pressure
// monitor + reply enforcer below, NOT filtering kanban out.
const FORWARD_KANBAN = (process.env.ECLAW_FORWARD_KANBAN || "true") !== "false";

// ── Context pressure monitor (2026-04-21 incident fix) ──
// eclaw-bot can silently hit 111k/200k context. Auto-warn at 20%, auto
// /clear at 5% remaining until auto-compact.
const CONTEXT_WATCH_ENABLED = (process.env.ECLAW_CONTEXT_WATCH_ENABLED || "true") !== "false";

// ── Reply-tool enforcer (2026-04-21 incident fix) ──
// If Claude is busy (thinking/tools) for longer than this after a human
// message and still hasn't called reply tool, inject a reminder.
const REPLY_TIMEOUT_S = parseInt(process.env.ECLAW_REPLY_TIMEOUT_S || "120", 10);

// ── Auto-wake (2026-04-21 session-idle fix) ──
// Claude Code is a "reactive" agent — every turn must be triggered by
// user input. MCP channel notifications only populate the inbox; they
// do NOT spawn a turn on their own. After `/clear` or for fresh
// sessions, forwarded messages sit idle.
//
// Solution: after forwarding a message to fakechat, POLL every
// AUTO_WAKE_POLL_S until Claude becomes truly idle (up to AUTO_WAKE_
// MAX_WAIT_S), then `tmux send-keys` a nudge prompt to trigger a turn.
// Polling fixes the previous one-shot bug where the single check fired
// during a busy→idle transition, saw "busy", and never retried.
const AUTO_WAKE_ENABLED = (process.env.ECLAW_AUTO_WAKE_ENABLED || "true") !== "false";
const AUTO_WAKE_DELAY_S = parseInt(process.env.ECLAW_AUTO_WAKE_DELAY_S || "10", 10);
const AUTO_WAKE_POLL_S = parseInt(process.env.ECLAW_AUTO_WAKE_POLL_S || "5", 10);
const AUTO_WAKE_MAX_WAIT_S = parseInt(process.env.ECLAW_AUTO_WAKE_MAX_WAIT_S || "300", 10);
const AUTO_WAKE_COOLDOWN_S = parseInt(process.env.ECLAW_AUTO_WAKE_COOLDOWN_S || "60", 10);

// Last human message timestamp for reply enforcer
let lastHumanMsgTimestamp: number | null = null;
let lastReplyEnforcerSent = 0;
let contextWarningLastSent = 0;

// Auto-wake state
let autoWakeTimer: ReturnType<typeof setTimeout> | null = null;
let lastAutoWakeSent = 0;

// ── Self-check (2026-04-23 silent-failover fix) ──
// EClaw's callback registration can become invalid silently (callback_token
// overwritten by stray re-register, or server-side callback table expired/
// reset). Bridge keeps running and all infrastructure looks healthy but
// no webhooks ever arrive. Previous incident: 9-hour silent outage.
// Fix: every ECLAW_SELF_CHECK_MIN minutes, re-POST /api/channel/register
// with the SAME persisted callback_token (idempotent — EClaw sees no
// change on the happy path, re-binds automatically if state drifted).
const SELF_CHECK_MIN = parseInt(process.env.ECLAW_SELF_CHECK_MIN || "30", 10);
const SELF_CHECK_ENABLED = (process.env.ECLAW_SELF_CHECK_ENABLED || "true") !== "false";
// Track most recent channel message text so auto-wake nudge can tell
// Claude WHICH message to reply to (not just "process pending")
let lastPendingChannelMsg: string | null = null;

interface PendingWatchdog {
  ask_id: string;
  timestamp: number;
  from: string;
  text: string;
}

let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogFirstMsg: { text: string; from: string; timestamp: number } | null = null;
const pendingWatchdogs: Map<string, PendingWatchdog> = new Map(); // keyed by ask_id

// ── Auto-approve mode (toggle via /auto_approve command) ──
let autoApproveMode = false;

// ── Current model state ──
let currentModel = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

const MODEL_OPTIONS: Record<string, { label: string; model: string }> = {
  sonnet:  { label: "⚡ Sonnet",  model: "claude-sonnet-4-20250514" },
  opus:    { label: "🧠 Opus",    model: "claude-opus-4-20250514" },
  haiku:   { label: "🪶 Haiku",   model: "claude-haiku-4-20250514" },
};

// ── WebSocket connection to fakechat ──
let ws: WebSocket | null = null;
let wsConnected = false;

// Dedup forwarded replies by fakechat message id (5s TTL) to guard
// against duplicate broadcasts from multiple WS subscriptions or
// future re-fire paths.
const forwardedMsgIds = new Map<string, number>();
const FORWARD_DEDUP_TTL_MS = 5000;
function markForwarded(id: string): boolean {
  const now = Date.now();
  for (const [k, ts] of forwardedMsgIds) {
    if (now - ts > FORWARD_DEDUP_TTL_MS) forwardedMsgIds.delete(k);
  }
  if (forwardedMsgIds.has(id)) return false;
  forwardedMsgIds.set(id, now);
  return true;
}

function connectWs() {
  // Close any existing socket before reconnecting so onmessage handlers
  // from stale sockets don't fire on the same broadcast (root cause of
  // duplicate chat_history rows per reply).
  if (ws) {
    try {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    } catch (err: any) {
      log(`Error closing stale WS: ${err.message}`);
    }
    ws = null;
  }

  log(`Connecting to fakechat WS: ${FAKECHAT_WS}`);
  ws = new WebSocket(FAKECHAT_WS);

  ws.onopen = () => {
    wsConnected = true;
    log("Connected to fakechat WebSocket");
  };

  ws.onclose = () => {
    wsConnected = false;
    log("Fakechat WebSocket closed, reconnecting in 3s...");
    setTimeout(connectWs, 3000);
  };

  ws.onerror = (err) => {
    log(`Fakechat WebSocket error: ${err}`);
  };

  ws.onmessage = (event) => {
    // fakechat sends back messages from Claude (replies)
    try {
      const data = JSON.parse(String(event.data));
      log(`Fakechat message: ${JSON.stringify(data).slice(0, 200)}`);
      // If it's an assistant reply, forward to EClaw
      if (data.from === "assistant" && data.text && lastDeviceId && lastEntityId !== null) {
        const msgId = typeof data.id === "string" ? data.id : null;
        if (msgId && !markForwarded(msgId)) {
          log(`Reply skipped (dup id=${msgId})`);
          return;
        }
        // Claude replied — clear all watchdog state + reply enforcer + auto-wake
        clearAllWatchdogState();
        lastHumanMsgTimestamp = null;
        lastPendingChannelMsg = null;
        if (autoWakeTimer) {
          clearTimeout(autoWakeTimer);
          autoWakeTimer = null;
        }
        forwardReplyToEClaw(data.text).catch(async (err) => {
          log(`Reply forward error: ${err.message}`);
          // Feed error back to Claude so it can self-diagnose and retry
          await notifyClaudeError(t("error.reply_failed", { error: err.message }));
        });
      }
    } catch {
      // ignore non-JSON messages
    }
  };
}

async function forwardReplyToEClaw(text: string, card?: any) {
  if (!lastDeviceId || lastEntityId === null) {
    log("Cannot forward reply: no deviceId/entityId");
    await notifyClaudeError(t("error.no_device"));
    return;
  }

  log(`Forwarding reply to EClaw: "${text.slice(0, 50)}..." device=${lastDeviceId} entity=${lastEntityId}${card ? " (with card)" : ""}`);

  const payload: any = {
    channel_api_key: API_KEY,
    deviceId: lastDeviceId,
    entityId: lastEntityId,
    botSecret: botSecret || "",
    message: text,
    state: "IDLE",
  };
  if (card) payload.card = card;

  const resp = await fetch(`${API_BASE}/api/channel/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (resp.ok) {
    log("Reply forwarded to EClaw successfully");
  } else {
    const errText = await resp.text();
    log(`Reply forward failed (${resp.status}): ${errText}`);
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
}

/**
 * Inject an error/system message back into fakechat so Claude Code sees it
 * as a channel message and can self-diagnose. Uses the same /upload POST
 * that inbound webhook messages use — this triggers an MCP notification
 * that Claude's channel listener picks up.
 */
async function notifyClaudeError(message: string) {
  const id = crypto.randomUUID();
  const form = new FormData();
  form.set("id", id);
  form.set("text", `[BRIDGE ERROR] ${message}`);
  try {
    const resp = await fetch("http://localhost:8787/upload", {
      method: "POST",
      body: form,
    });
    if (resp.ok) {
      log(`Error feedback injected to Claude: ${message.slice(0, 100)}`);
    } else {
      log(`Failed to inject error feedback (${resp.status})`);
    }
  } catch (err: any) {
    log(`notifyClaudeError failed: ${err.message}`);
  }
}

// ── Watchdog helpers ──
function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  watchdogFirstMsg = null;
}

function clearAllWatchdogState() {
  clearWatchdog();
  pendingWatchdogs.clear();
}

/**
 * Diagnose WHY Claude hasn't replied by reading the tmux screen.
 *
 * Returns one of:
 *   "stuck_prompt"  — waiting on "Do you want to" / "Esc to cancel" confirmation
 *   "idle"          — showing ❯ prompt, not busy, just didn't reply
 *   "hook_pending"  — a PreToolUse /ask is in flight (user already has a card)
 *   "busy"          — actively thinking / running tools
 *   "crashed"       — session appears dead or not responding
 */
async function diagnoseTmuxState(): Promise<string> {
  try {
    const { execSync } = await import("node:child_process");
    const screen = execSync("tmux capture-pane -t eclaw-bot -p 2>&1", {
      timeout: 5000,
      encoding: "utf-8",
    });
    return classifyTmuxScreen(screen, { hookPending: pendingAsks.size > 0 });
  } catch {
    // tmux not available or errored — can't diagnose
    return "busy";
  }
}

/** Helper to restart the watchdog with the same message context */
function startWatchdog(text: string, from: string) {
  watchdogFirstMsg = { text, from, timestamp: Date.now() };
  startWatchdogTimer();
}

/**
 * Auto-wake: after forwarding a message to fakechat, schedule a delayed
 * check. If Claude Code is still idle after AUTO_WAKE_DELAY_S seconds,
 * inject a short nudge via `tmux send-keys` to trigger a new turn. The
 * turn itself will cause Claude to pick up the pending channel event
 * from its MCP inbox.
 *
 * Debounced: each new forwarded message resets the timer. Cooldown:
 * once woken, won't nudge again for AUTO_WAKE_COOLDOWN_S seconds (so
 * an active session isn't spammed with wake prompts).
 */
function scheduleAutoWake() {
  if (!AUTO_WAKE_ENABLED) {
    log(`Auto-wake scheduleAutoWake() called but DISABLED`);
    return;
  }
  // Debounce: cancel any pending auto-wake check
  const wasDebounced = autoWakeTimer !== null;
  if (autoWakeTimer) clearTimeout(autoWakeTimer);

  const pollStart = Date.now();
  log(`Auto-wake scheduled (delay ${AUTO_WAKE_DELAY_S}s${wasDebounced ? ", debounced previous" : ""})`);
  const tick = async () => {
    autoWakeTimer = null;
    const now = Date.now();
    const pollAge = Math.round((now - pollStart) / 1000);

    // Cooldown check (from last successful nudge)
    if (now - lastAutoWakeSent < AUTO_WAKE_COOLDOWN_S * 1000) {
      log(`Auto-wake tick@${pollAge}s: cooldown active (last nudge ${Math.round((now - lastAutoWakeSent)/1000)}s ago < ${AUTO_WAKE_COOLDOWN_S}s)`);
      return;
    }

    // Give up after max wait — something is really stuck
    if (now - pollStart > AUTO_WAKE_MAX_WAIT_S * 1000) {
      log(`Auto-wake gave up after ${AUTO_WAKE_MAX_WAIT_S}s polling (eclaw-bot never became idle)`);
      return;
    }

    const state = await diagnoseTmuxState();
    const action = decideAutoWakeTickAction(state as any);
    log(`Auto-wake tick@${pollAge}s: state=${state} action=${action.type}`);

    if (action.type === "bail") {
      // hook_pending → user has a card to click; crashed → session
      // looks dead. Either way, don't nudge a blocked session.
      return;
    }

    if (action.type === "resolve_stuck_prompt") {
      // Claude Code's built-in "Do you want to create/proceed?"
      // confirmations that --dangerously-skip-permissions doesn't
      // bypass. Auto-resolve: send Down+Enter to pick "Yes, and
      // always allow" (2nd option, more permissive than Yes), then
      // keep polling.
      try {
        const { execSync } = await import("node:child_process");
        execSync("tmux send-keys -t eclaw-bot Down Enter", { timeout: 3000 });
      } catch (err: any) {
        log(`Auto-wake tick@${pollAge}s: stuck_prompt auto-resolve failed: ${err.message}`);
      }
      autoWakeTimer = setTimeout(tick, AUTO_WAKE_POLL_S * 1000);
      return;
    }

    if (action.type === "wait") {
      autoWakeTimer = setTimeout(tick, AUTO_WAKE_POLL_S * 1000);
      return;
    }
    // action.type === "nudge" → proceed with nudge below

    try {
      const { execSync } = await import("node:child_process");
      // Include the actual pending message content in the nudge so Claude
      // knows WHICH message to reply to. Without this, Claude queries
      // EClaw API, sees pending=0 (because messages were delivered via
      // channel), and concludes there's nothing to reply to.
      const pendingMsg = lastPendingChannelMsg || watchdogFirstMsg?.text || "";
      const msgPreview = pendingMsg.split("\n")[0].slice(0, 200);
      const nudge = msgPreview
        ? t("auto_wake.nudge_with_msg", { msg: msgPreview })
        : t("auto_wake.nudge");

      // Guard against stuck input buffer: if a previous nudge's Enter
      // didn't submit (happens during Claude state transitions), the
      // text stays in the input prompt. If we type again, it stacks.
      // Detect this and just press Enter to submit what's already there.
      const screenBefore = execSync("tmux capture-pane -t eclaw-bot -p 2>&1", {
        timeout: 3000,
        encoding: "utf-8",
      });
      if (screenBefore.includes(nudge)) {
        log(`Auto-wake: previous nudge still in buffer, just submitting Enter`);
        execSync("tmux send-keys -t eclaw-bot Enter", { timeout: 2000 });
        lastAutoWakeSent = now;
        return;
      }

      // Clear any stray chars (Ctrl+U clears to line start), slight
      // delays help avoid TTY races that swallow Enter during busy→idle
      // state transitions.
      execSync("tmux send-keys -t eclaw-bot C-u", { timeout: 2000 });
      await new Promise((r) => setTimeout(r, 150));
      execSync(`tmux send-keys -t eclaw-bot ${JSON.stringify(nudge)}`, {
        timeout: 3000,
      });
      await new Promise((r) => setTimeout(r, 400));
      execSync("tmux send-keys -t eclaw-bot Enter", { timeout: 2000 });
      lastAutoWakeSent = now;
      log(`Auto-wake nudge sent (eclaw-bot was idle, polled ${Math.round((now - pollStart) / 1000)}s)`);
    } catch (err: any) {
      log(`Auto-wake nudge failed: ${err.message}`);
    }
  };

  // First check after AUTO_WAKE_DELAY_S (e.g. 10s) to give Claude a
  // chance to respond naturally. Subsequent re-polls happen inside
  // tick() via AUTO_WAKE_POLL_S intervals.
  autoWakeTimer = setTimeout(tick, AUTO_WAKE_DELAY_S * 1000);
}

function startWatchdogTimer() {
  if (!WATCHDOG_ENABLED) return;
  // Reset existing timer (debounce)
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
  }
  watchdogTimer = setTimeout(async () => {
    if (!watchdogFirstMsg) return;

    // ── Diagnostic watchdog: read tmux screen to determine WHY Claude
    // hasn't replied, then take the appropriate action silently when
    // possible — only bother the user with a rich card when Claude is
    // genuinely busy on a long task. ──
    const diagnosis = await diagnoseTmuxState();
    log(`Watchdog fired after ${WATCHDOG_TIMEOUT_S}s — diagnosis: ${diagnosis}`);

    switch (diagnosis) {
      case "stuck_prompt": {
        // Claude is stuck on a "Do you want to create/proceed" prompt.
        // Auto-approve silently — no card needed.
        log(`Watchdog: ${t("watchdog.diag_stuck_prompt")}`);
        const { execSync } = await import("node:child_process");
        try {
          execSync('tmux send-keys -t eclaw-bot Down Enter', { timeout: 5000 });
        } catch { /* tmux not available */ }
        // Re-arm watchdog in case there are more prompts queued
        watchdogTimer = null;
        watchdogFirstMsg = watchdogFirstMsg; // keep for next round
        startWatchdog(watchdogFirstMsg!.text, watchdogFirstMsg!.from);
        return;
      }

      case "idle": {
        // Claude is idle (showing ❯ prompt) but didn't respond.
        // Re-inject the message silently.
        log(`Watchdog: ${t("watchdog.diag_idle")}`);
        const { execSync } = await import("node:child_process");
        try {
          execSync(
            `tmux send-keys -t eclaw-bot '請用 reply tool 回覆最新的 channel 訊息' Enter`,
            { timeout: 5000 },
          );
        } catch { /* tmux not available */ }
        watchdogTimer = null;
        watchdogFirstMsg = null;
        return;
      }

      case "hook_pending": {
        // A PreToolUse hook /ask is already pending — the user already
        // has a hook approval card on their screen. Don't pile on with
        // a watchdog card.
        log(`Watchdog: ${t("watchdog.diag_hook_pending")}`);
        watchdogTimer = null;
        watchdogFirstMsg = null;
        return;
      }

      case "crashed": {
        // Session appears dead. Notify user.
        log(`Watchdog: ${t("watchdog.diag_crashed")}`);
        try {
          await forwardReplyToEClaw(t("watchdog.diag_crashed"));
        } catch { /* best effort */ }
        watchdogTimer = null;
        watchdogFirstMsg = null;
        return;
      }

      case "busy":
      default: {
        // Claude is genuinely busy (thinking/tool-use). Send rich card.
        const ask_id = crypto.randomUUID();
        const card = {
          buttons: [
            { id: "watchdog_ack", label: t("watchdog.btn_ack"), style: "primary" },
            { id: "watchdog_interrupt", label: t("watchdog.btn_interrupt"), style: "danger" },
            { id: "watchdog_withdraw", label: t("watchdog.btn_withdraw"), style: "secondary" },
          ],
          ask_id,
        };
        log(`Watchdog: ${t("watchdog.diag_busy")} (ask_id=${ask_id})`);
        pendingWatchdogs.set(ask_id, {
          ask_id,
          timestamp: Date.now(),
          from: watchdogFirstMsg.from,
          text: watchdogFirstMsg.text,
        });
        try {
          await forwardReplyToEClaw(t("watchdog.busy"), card);
        } catch (err: any) {
          log(`Watchdog card send error: ${err.message}`);
        }
        watchdogTimer = null;
        watchdogFirstMsg = null;
        return;
      }
    }
  }, WATCHDOG_TIMEOUT_S * 1000);
}

// ── EClaw Registration ──
// Persist the callback token across self-checks so re-registration is
// idempotent (EClaw keeps the same Bearer token, so webhooks pushed
// between checks still authenticate correctly). Generated once on
// first registration, reused until bridge restart.
let persistedCallbackToken: string | null = null;
let lastSelfCheckAt: number | null = null;
let lastSelfCheckOk: boolean | null = null;

async function registerWithEClaw(isSelfCheck = false) {
  if (!persistedCallbackToken) {
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    persistedCallbackToken = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  const callbackToken = persistedCallbackToken;

  const webhookUrl = process.env.ECLAW_WEBHOOK_URL || `http://localhost:${WEBHOOK_PORT}`;
  const callbackUrl = `${webhookUrl}/eclaw-webhook`;

  try {
    const resp = await fetch(`${API_BASE}/api/channel/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_api_key: API_KEY,
        callback_url: callbackUrl,
        callback_token: callbackToken,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      log(`EClaw registration${isSelfCheck ? " self-check" : ""} failed: ${body}`);
      if (isSelfCheck) {
        lastSelfCheckAt = Date.now();
        lastSelfCheckOk = false;
      }
      return;
    }

    const data: any = await resp.json();
    const prevBound = lastEntityId !== null;
    const stillBoundAsEntity = (data.entities || []).find(
      (e: any) => e.boundToThisAccount === true,
    );

    // On self-check, only log if state changed or bind is missing
    if (isSelfCheck) {
      lastSelfCheckAt = Date.now();
      if (!stillBoundAsEntity) {
        lastSelfCheckOk = false;
        log(
          `⚠️ Self-check: this API key is no longer bound to any entity! Re-binding...`,
        );
      } else if (prevBound && stillBoundAsEntity.entityId !== lastEntityId) {
        lastSelfCheckOk = false;
        log(
          `⚠️ Self-check: entity slot changed ${lastEntityId} → ${stillBoundAsEntity.entityId}. Re-binding...`,
        );
      } else {
        lastSelfCheckOk = true;
        // Silent OK on happy path — no log noise every 30 min
      }
    } else {
      log(`Registered with EClaw. Device: ${data.deviceId}, Entities: ${data.entities?.length}`);
    }

    lastDeviceId = data.deviceId;

    // Bind entity (idempotent — if already bound, EClaw returns existing bot secret)
    // Only re-bind on startup OR if self-check detected a missing/changed binding
    const needBind = !isSelfCheck || !stillBoundAsEntity || stillBoundAsEntity.entityId !== lastEntityId;
    if (needBind) {
      const bindResp = await fetch(`${API_BASE}/api/channel/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_api_key: API_KEY,
          deviceId: data.deviceId,
          botName: process.env.ECLAW_BOT_NAME || "Claude Bot",
        }),
      });

      if (bindResp.ok) {
        const bindData: any = await bindResp.json();
        lastEntityId = bindData.entityId;
        botSecret = bindData.botSecret;
        if (isSelfCheck) {
          log(`Self-check: re-bound entity ${bindData.entityId}, publicCode: ${bindData.publicCode}`);
          lastSelfCheckOk = true;
        } else {
          log(`Bound entity ${bindData.entityId}, publicCode: ${bindData.publicCode}`);
        }
      }
    }
  } catch (err: any) {
    log(`EClaw registration${isSelfCheck ? " self-check" : ""} error: ${err.message}`);
    if (isSelfCheck) {
      lastSelfCheckAt = Date.now();
      lastSelfCheckOk = false;
    }
  }
}

// ── Webhook HTTP Server ──
Bun.serve({
  port: WEBHOOK_PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        channel: "eclaw-bridge",
        wsConnected,
        watchdogEnabled: WATCHDOG_ENABLED,
        watchdogTimeoutSeconds: WATCHDOG_TIMEOUT_S,
        watchdogTimerActive: watchdogTimer !== null,
        pendingWatchdogs: pendingWatchdogs.size,
        // 2026-04-21 incident fixes
        forwardKanban: FORWARD_KANBAN,
        contextWatchEnabled: CONTEXT_WATCH_ENABLED,
        replyTimeoutSeconds: REPLY_TIMEOUT_S,
        lastHumanMsgAge: lastHumanMsgTimestamp ? Math.round((Date.now() - lastHumanMsgTimestamp) / 1000) : null,
        // 2026-04-21 session-idle fix
        autoWakeEnabled: AUTO_WAKE_ENABLED,
        autoWakeDelaySeconds: AUTO_WAKE_DELAY_S,
        autoWakePollSeconds: AUTO_WAKE_POLL_S,
        autoWakeMaxWaitSeconds: AUTO_WAKE_MAX_WAIT_S,
        autoWakeTimerActive: autoWakeTimer !== null,
        // 2026-04-23 silent-failover fix
        selfCheckEnabled: SELF_CHECK_ENABLED,
        selfCheckIntervalMin: SELF_CHECK_MIN,
        lastSelfCheckAt: lastSelfCheckAt ? new Date(lastSelfCheckAt).toISOString() : null,
        lastSelfCheckOk,
        lastSelfCheckAge: lastSelfCheckAt ? Math.round((Date.now() - lastSelfCheckAt) / 1000) : null,
      });
    }

    // ── POST /ask — long-poll PreToolUse hook integration ──
    if (req.method === "POST" && url.pathname === "/ask") {
      try {
        const body: any = await req.json();
        const { tool, command, file_path, reason } = body;

        // ── Auto-approve short-circuit ──
        if (autoApproveMode) {
          log(`/ask auto-approved: tool=${tool} target=${command || file_path}`);
          return Response.json({ action: "approve" });
        }

        const ask_id = crypto.randomUUID();

        const target = command || file_path || "(unknown)";
        const message = t("ask.tool_prompt", { tool, target, reason: reason || "N/A" });
        const card = {
          buttons: [
            { id: "approve", label: t("ask.btn_approve"), style: "primary" },
            { id: "approve_always", label: t("ask.btn_approve_always"), style: "secondary" },
            { id: "deny", label: t("ask.btn_deny"), style: "danger" },
          ],
          ask_id,
        };

        log(`/ask received: tool=${tool} ask_id=${ask_id} target="${String(target).slice(0, 100)}"`);

        // Create a promise that resolves when the user clicks a button
        const actionPromise = new Promise<string>((resolve) => {
          pendingAsks.set(ask_id, { resolve, timestamp: Date.now() });
        });

        // Send the card to EClaw
        try {
          await forwardReplyToEClaw(message, card);
        } catch (err: any) {
          log(`/ask forward failed: ${err.message}`);
          pendingAsks.delete(ask_id);
          return Response.json({ ok: false, error: err.message }, { status: 500 });
        }

        // Wait indefinitely for user action (no timeout)
        const action = await actionPromise;
        log(`/ask resolved: ask_id=${ask_id} action=${action}`);
        return Response.json({ action });
      } catch (err: any) {
        log(`/ask error: ${err.message}`);
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    // ── POST /restart — External Claude channel restart ──
    if (req.method === "POST" && url.pathname === "/restart") {
      // Verify API key
      const authKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
      if (!authKey || authKey !== API_KEY) {
        log("/restart rejected: invalid API key");
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      try {
        const body: any = await req.json().catch(() => ({}));
        const mode = body.mode || "--smart"; // --smart, --force, --bridge-only
        const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "restart-channel.sh");

        log(`/restart invoked with mode=${mode}`);

        const proc = Bun.spawn(["bash", scriptPath, mode], {
          env: {
            ...process.env,
            ECLAW_API_KEY: API_KEY,
            ECLAW_WEBHOOK_URL: process.env.ECLAW_WEBHOOK_URL || "",
            ECLAW_BOT_NAME: process.env.ECLAW_BOT_NAME || "",
          },
          stdout: "pipe",
          stderr: "pipe",
        });

        // Wait with 90s timeout
        const timeout = setTimeout(() => proc.kill(), 90000);
        const exitCode = await proc.exited;
        clearTimeout(timeout);

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        log(`/restart completed: exit=${exitCode} stdout=${stdout.trim()}`);
        if (stderr) log(`/restart stderr: ${stderr.trim()}`);

        // Try to parse JSON output from script
        let result: any;
        try {
          result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
        } catch {
          result = { ok: exitCode === 0, message: stdout.trim() };
        }

        // Reconnect WebSocket after restart
        if (result.action === "restarted" || result.action === "bridge_restarted") {
          log("Reconnecting WebSocket after restart...");
          if (ws) {
            ws.close();
          }
          setTimeout(connectWs, 2000);
        }

        return Response.json(result, { status: exitCode === 0 ? 200 : 500 });
      } catch (err: any) {
        log(`/restart error: ${err.message}`);
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    if (req.method === "POST" && url.pathname === "/eclaw-webhook") {
      try {
        const body: any = await req.json();

        // ── Card action event from EClaw ──
        if (body.event === "card_action") {
          const ask_id: string = body.ask_id || body.card?.ask_id;
          const action_id: string = body.action_id || body.action || body.button_id;
          log(`Card action received: ask_id=${ask_id} action=${action_id}`);

          // ── /model card response: switch model + restart ──
          if (ask_id?.startsWith("model_select_")) {
            const chosen = MODEL_OPTIONS[action_id];
            if (!chosen) {
              log(`Unknown model action: ${action_id}`);
              return Response.json({ ok: true, resolved: false });
            }

            log(`Model switch requested: ${currentModel} → ${chosen.model}`);
            currentModel = chosen.model;

            // Reply: switching...
            forwardReplyToEClaw(t("model.switching", { label: chosen.label })).catch(() => {});

            // Restart with new model
            const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "restart-channel.sh");
            const proc = Bun.spawn(["bash", scriptPath, "--force"], {
              env: {
                ...process.env,
                CLAUDE_MODEL: chosen.model,
                ECLAW_API_KEY: API_KEY,
                ECLAW_WEBHOOK_URL: process.env.ECLAW_WEBHOOK_URL || "",
                ECLAW_BOT_NAME: process.env.ECLAW_BOT_NAME || "",
              },
              stdout: "pipe",
              stderr: "pipe",
            });

            // Fire and don't block the webhook response
            proc.exited.then(async (exitCode) => {
              const stdout = await new Response(proc.stdout).text();
              log(`Model switch restart completed: exit=${exitCode} stdout=${stdout.trim()}`);
              if (exitCode === 0) {
                await forwardReplyToEClaw(t("model.switch_ok", { label: chosen.label, model: chosen.model })).catch(() => {});
              } else {
                await forwardReplyToEClaw(t("model.switch_fail", { error: stdout.trim() })).catch(() => {});
              }
              // Reconnect WS
              if (ws) ws.close();
              setTimeout(connectWs, 2000);
            });

            return Response.json({ ok: true, resolved: true });
          }

          // ── Watchdog card response ──
          if (ask_id && pendingWatchdogs.has(ask_id)) {
            const wd = pendingWatchdogs.get(ask_id)!;
            pendingWatchdogs.delete(ask_id);

            if (action_id === "watchdog_ack") {
              log(t("watchdog.ack_log"));
              // Do nothing — Claude will reply when ready
            } else if (action_id === "watchdog_interrupt") {
              log(t("watchdog.interrupt_log"));
              // Interrupt Claude Code via tmux and re-inject
              try {
                Bun.spawnSync(["tmux", "send-keys", "-t", "eclaw-bot", "Escape"]);
                await new Promise((r) => setTimeout(r, 2000));
                Bun.spawnSync(["tmux", "send-keys", "-t", "eclaw-bot",
                  "請立刻用 reply tool 回覆最新的 channel 訊息", "Enter"]);
              } catch (err: any) {
                log(`Watchdog interrupt tmux error: ${err.message}`);
              }
            } else if (action_id === "watchdog_withdraw") {
              log(t("watchdog.withdraw_log"));
              // Do NOT re-inject, just clear
            }
            return Response.json({ ok: true, resolved: true });
          }

          if (ask_id && pendingAsks.has(ask_id)) {
            const pending = pendingAsks.get(ask_id)!;
            pending.resolve(action_id);
            pendingAsks.delete(ask_id);
            return Response.json({ ok: true, resolved: true });
          }
          return Response.json({ ok: true, resolved: false });
        }

        const deviceId = body.deviceId;
        const entityId = body.entityId;
        const text = body.text || body.message || "";
        const from = body.from || "unknown";

        if (!deviceId && entityId === undefined) {
          return Response.json({ ok: true, skipped: true });
        }

        // Update state for reply routing
        if (deviceId) lastDeviceId = deviceId;
        if (entityId !== undefined) lastEntityId = entityId;

        // ── Auto-detect language from user message ──
        setLocale(detectLanguage(text));

        // ── Bridge commands: intercept before forwarding to Claude Code ──
        // Extract the user's actual message (first line, before injected context)
        const userText = text.split("\n")[0].trim();

        if (userText === "/auto_approve" || userText === "/自動核准") {
          autoApproveMode = !autoApproveMode;
          log(`Auto-approve toggled: ${autoApproveMode}`);
          const msg = autoApproveMode
            ? t("auto_approve.enabled")
            : t("auto_approve.disabled");
          await forwardReplyToEClaw(msg);
          return Response.json({ ok: true, handled: "auto_approve" });
        }

        if (userText === "/model" || userText === "/模型") {
          log(`/model command received from ${from}`);
          const ask_id = `model_select_${Date.now()}`;
          const currentLabel = Object.values(MODEL_OPTIONS).find(m => m.model === currentModel)?.label || currentModel;
          const card = {
            buttons: Object.entries(MODEL_OPTIONS).map(([id, opt]) => ({
              id,
              label: opt.label + (opt.model === currentModel ? ` ${t("model.current_suffix")}` : ""),
              style: opt.model === currentModel ? "secondary" : "primary",
            })),
            ask_id,
          };
          await forwardReplyToEClaw(t("model.select_prompt", { current: currentLabel }), card);
          return Response.json({ ok: true, handled: "model_select" });
        }

        // Build message for fakechat
        let displayText = text;
        if (body.mediaType && body.mediaUrl) {
          displayText += `\n[${body.mediaType}] ${body.mediaUrl}`;
        }

        // Prepend sender info
        const fullText = `[EClaw from ${from}] ${displayText}`;

        // ── Kanban emergency mute (opt-out only) ──
        // Kanban IS the bot's work queue — normally we forward it. Only
        // drop when ECLAW_FORWARD_KANBAN=false is explicitly set during
        // context overflow recovery.
        if (from === "kanban" && !FORWARD_KANBAN) {
          log(`Kanban message muted (ECLAW_FORWARD_KANBAN=false): "${fullText.slice(0, 120).replace(/\n/g, "\\n")}…"`);
          return Response.json({ ok: true, muted: "kanban" });
        }

        log(`Webhook received (${fullText.length} chars): "${fullText.slice(0, 500).replace(/\n/g, "\\n")}${fullText.length > 500 ? "…" : ""}" → forwarding to fakechat`);

        // Send to fakechat via HTTP POST /upload (triggers MCP notification)
        // WebSocket only broadcasts to browser UI, does NOT trigger deliver()
        const id = crypto.randomUUID();
        const form = new FormData();
        form.set("id", id);
        form.set("text", fullText);
        let forwardOk = false;
        try {
          const resp = await fetch("http://localhost:8787/upload", {
            method: "POST",
            body: form,
          });
          if (resp.ok) {
            log("Forwarded to fakechat via /upload (MCP notification triggered)");
            forwardOk = true;
          } else {
            log(`Fakechat /upload failed (${resp.status})`);
          }
        } catch (err: any) {
          log(`Fakechat /upload error: ${err.message}`);
        }

        // Auto-wake: after forwarding, check if Claude is idle and
        // needs a nudge. MCP notifications alone don't trigger turns.
        if (forwardOk) {
          lastPendingChannelMsg = fullText;
          scheduleAutoWake();
        }

        // ── Watchdog: only trigger when a NEW human message arrives while
        // a PREVIOUS human message is still unacknowledged (no Claude reply
        // since the first message). The first message is normal — Claude
        // needs time to process. The watchdog fires when the SECOND message
        // piles up, meaning the user is waiting and Claude is still busy.
        // Kanban/entity:0 auto-messages are EXCLUDED even if forwarded,
        // because they don't represent a waiting user (2026-04-21 fix). ──
        const isHumanMessage = from === "web_chat" || from === "client" || from === "user";
        if (isHumanMessage) {
          // Reply-tool enforcer: track timestamp of latest human message
          lastHumanMsgTimestamp = Date.now();
          if (!watchdogFirstMsg) {
            // First human message — just track it, no watchdog yet.
            watchdogFirstMsg = { text: userText, from, timestamp: Date.now() };
          } else {
            // Second+ human message while first is still pending — arm watchdog.
            startWatchdogTimer();
          }
        }

        return Response.json({ ok: true });
      } catch (err: any) {
        log(`Webhook error: ${err.message}`);
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

log(`EClaw bridge webhook server listening on port ${WEBHOOK_PORT}`);

// Connect to fakechat WebSocket
connectWs();

// Register with EClaw platform
registerWithEClaw().catch((err) => log(`Registration error: ${err.message}`));

// Self-check every N minutes — verifies the callback is still registered
// on EClaw's side. Re-registers silently on the happy path (idempotent),
// logs a warning + re-binds if state drifted. Prevents the silent-failover
// incident where bridge looked healthy but EClaw had stopped pushing.
if (SELF_CHECK_ENABLED) {
  setInterval(() => {
    registerWithEClaw(true).catch((err) =>
      log(`Self-check error: ${err.message}`),
    );
  }, SELF_CHECK_MIN * 60_000);
  log(`Self-check enabled: every ${SELF_CHECK_MIN} min`);
}

// ── Context pressure monitor (2026-04-21 incident fix) ──
// Reads tmux screen every 60s, looks for "N% until auto-compact" marker.
// - ≤5%  → auto /clear (critical)
// - ≤20% → warn Claude once per 10 min
async function checkContextPressure() {
  if (!CONTEXT_WATCH_ENABLED) return;
  try {
    const { execSync } = await import("node:child_process");
    const screen = execSync("tmux capture-pane -t eclaw-bot -p 2>&1", {
      timeout: 5000,
      encoding: "utf-8",
    });
    const match = screen.match(/(\d+)%\s*until auto-compact/);
    if (!match) return;
    const pct = parseInt(match[1], 10);
    const nowMs = Date.now();

    if (pct <= 5) {
      // Critical — auto /clear if we haven't in last 5 minutes
      if (nowMs - contextWarningLastSent < 5 * 60_000) return;
      log(`Context pressure CRITICAL: ${pct}% until auto-compact → auto /clear`);
      try {
        execSync("tmux send-keys -t eclaw-bot Escape", { timeout: 3000 });
        execSync("sleep 1 && tmux send-keys -t eclaw-bot '/clear' Enter", {
          timeout: 5000,
          shell: "/bin/bash",
        });
        await notifyClaudeError(t("context.auto_clear", { pct: String(pct) }));
      } catch (err: any) {
        log(`Auto /clear failed: ${err.message}`);
      }
      contextWarningLastSent = nowMs;
    } else if (pct <= 20) {
      // Warn — once per 10 min
      if (nowMs - contextWarningLastSent < 10 * 60_000) return;
      log(`Context pressure HIGH: ${pct}% until auto-compact → warning Claude`);
      await notifyClaudeError(t("context.warning", { pct: String(pct) }));
      contextWarningLastSent = nowMs;
    }
  } catch (err: any) {
    // tmux unavailable — skip silently
  }
}

// ── Reply-tool enforcer (2026-04-21 incident fix) ──
// When a human message was received >REPLY_TIMEOUT_S ago and no reply
// has come through fakechat WebSocket, inject a reminder. Works for
// BOTH states:
//   - busy: Claude is running tools (Bash, Playwright) but forgot
//     reply tool → reminder injected into inbox, will be seen in
//     next turn boundary.
//   - idle: Claude finished its turn with only terminal output, never
//     called reply tool → reminder + scheduleAutoWake() triggers a new
//     turn so Claude reads the inbox and retries.
//
// Previously gated to "busy" only, which missed the exact failure mode
// we wanted to catch (Claude went idle WITHOUT using reply tool).
async function checkReplyEnforcer() {
  const state = (await diagnoseTmuxState()) as any;
  const now = Date.now();
  const action = decideReplyEnforcerAction(state, {
    lastHumanMsgMs: lastHumanMsgTimestamp,
    nowMs: now,
    replyTimeoutS: REPLY_TIMEOUT_S,
    lastEnforcerMs: lastReplyEnforcerSent,
    enforcerCooldownMs: 3 * 60_000,
  });

  if (action.type === "skip") {
    // fresh / cooldown / hook_pending / crashed / no_human_msg — say nothing
    return;
  }

  const ageMs = now - (lastHumanMsgTimestamp ?? now);
  const minutes = Math.round(ageMs / 60_000);

  if (action.type === "trigger_auto_wake_only") {
    // stuck_prompt → auto-wake will auto-resolve the prompt + keep polling.
    log(`Reply enforcer: Claude stuck_prompt ${minutes}m without reply → triggering auto-wake to resolve`);
    scheduleAutoWake();
    lastReplyEnforcerSent = now;
    return;
  }

  // nudge_only (busy) or nudge_and_auto_wake (idle)
  const preview = (watchdogFirstMsg?.text || "").slice(0, 80).replace(/\n/g, " ");
  log(`Reply enforcer: Claude ${state} ${minutes}m without reply → nudging (action=${action.type})`);
  await notifyClaudeError(
    t("reply_enforcer.nudge", { minutes: String(minutes), preview })
  );
  if (action.type === "nudge_and_auto_wake") {
    // idle: reminder alone sits in MCP inbox unseen — kick a turn.
    scheduleAutoWake();
  }
  lastReplyEnforcerSent = now;
}

// Combined 60s background tick — cheap, one tmux read per cycle
setInterval(() => {
  checkContextPressure().catch(() => {});
  checkReplyEnforcer().catch(() => {});
}, 60_000);

log("Bridge started");
