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
        // Claude replied — clear all watchdog state
        clearAllWatchdogState();
        forwardReplyToEClaw(data.text).catch((err) => {
          log(`Reply forward error: ${err.message}`);
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

    // Check for pending hook /ask FIRST (pendingAsks Map has entries)
    if (pendingAsks.size > 0) {
      return "hook_pending";
    }

    // Stuck on a confirmation prompt
    if (
      screen.includes("Do you want to") ||
      screen.includes("Esc to cancel") ||
      screen.includes("Enter to confirm") ||
      screen.includes("Enter to select")
    ) {
      return "stuck_prompt";
    }

    // Actively busy — thinking, tool-use, or streaming
    if (
      screen.includes("thinking") ||
      screen.includes("tokens") ||
      screen.includes("· ↑") ||
      screen.includes("· ↓") ||
      /\b(Channeling|Slithering|Sautéed|Infusing|Perusing|Coalescing|Evaporating|Wibbling|Pollinating|Shipping)\b/.test(screen)
    ) {
      return "busy";
    }

    // Idle — last line is the ❯ prompt with no activity indicator
    const lines = screen.trim().split("\n").filter(Boolean);
    const lastContentLine = lines[lines.length - 1] || "";
    if (lastContentLine.includes("❯") || lastContentLine.includes("bypass permissions")) {
      return "idle";
    }

    // Screen is empty or unrecognizable
    if (screen.trim().length < 20) {
      return "crashed";
    }

    // Default: assume busy
    return "busy";
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
        log("Watchdog: auto-approving stuck prompt (Down+Enter)");
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
        log("Watchdog: Claude idle but didn't reply — re-injecting message");
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
        log("Watchdog: hook /ask pending — skipping (card already on EClaw)");
        watchdogTimer = null;
        watchdogFirstMsg = null;
        return;
      }

      case "crashed": {
        // Session appears dead. Notify user.
        log("Watchdog: session appears crashed — notifying user");
        try {
          await forwardReplyToEClaw("🔄 Claude Code session 似乎已停止回應，可能需要重啟 eclaw-bot tmux session。");
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
        log(`Watchdog: Claude busy — sending card (ask_id=${ask_id})`);
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
async function registerWithEClaw() {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const callbackToken = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

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
      log(`EClaw registration failed: ${await resp.text()}`);
      return;
    }

    const data: any = await resp.json();
    lastDeviceId = data.deviceId;
    log(`Registered with EClaw. Device: ${data.deviceId}, Entities: ${data.entities?.length}`);

    // Bind entity
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
      log(`Bound entity ${bindData.entityId}, publicCode: ${bindData.publicCode}`);
    }
  } catch (err: any) {
    log(`EClaw registration error: ${err.message}`);
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

        log(`Webhook received (${fullText.length} chars): "${fullText.slice(0, 500).replace(/\n/g, "\\n")}${fullText.length > 500 ? "…" : ""}" → forwarding to fakechat`);

        // Send to fakechat via HTTP POST /upload (triggers MCP notification)
        // WebSocket only broadcasts to browser UI, does NOT trigger deliver()
        const id = crypto.randomUUID();
        const form = new FormData();
        form.set("id", id);
        form.set("text", fullText);
        try {
          const resp = await fetch("http://localhost:8787/upload", {
            method: "POST",
            body: form,
          });
          if (resp.ok) {
            log("Forwarded to fakechat via /upload (MCP notification triggered)");
          } else {
            log(`Fakechat /upload failed (${resp.status})`);
          }
        } catch (err: any) {
          log(`Fakechat /upload error: ${err.message}`);
        }

        // ── Start watchdog timer (only for real human messages) ──
        // Skip automated sources: kanban, scheduled, system, entity:N (bot-to-bot)
        const isHumanMessage = from === "web_chat" || from === "client" || from === "user";
        if (isHumanMessage) {
          if (!watchdogFirstMsg) {
            watchdogFirstMsg = { text: userText, from, timestamp: Date.now() };
          }
          startWatchdogTimer();
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

log("Bridge started");
