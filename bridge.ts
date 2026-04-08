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
import { join } from "node:path";
import { homedir } from "node:os";

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

// ── WebSocket connection to fakechat ──
let ws: WebSocket | null = null;
let wsConnected = false;

function connectWs() {
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
      return Response.json({ ok: true, channel: "eclaw-bridge", wsConnected });
    }

    // ── POST /ask — long-poll PreToolUse hook integration ──
    if (req.method === "POST" && url.pathname === "/ask") {
      try {
        const body: any = await req.json();
        const { tool, command, file_path, reason } = body;
        const ask_id = crypto.randomUUID();

        const target = command || file_path || "(unknown)";
        const message = `⚠️ Claude 想執行 ${tool}: ${target}\n原因: ${reason || "N/A"}`;
        const card = {
          buttons: [
            { id: "approve", label: "✅ 同意", style: "primary" },
            { id: "approve_always", label: "✅ 全程允許", style: "secondary" },
            { id: "deny", label: "❌ 拒絕", style: "danger" },
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

    if (req.method === "POST" && url.pathname === "/eclaw-webhook") {
      try {
        const body: any = await req.json();

        // ── Card action event from EClaw ──
        if (body.event === "card_action") {
          const ask_id: string = body.ask_id || body.card?.ask_id;
          const action_id: string = body.action_id || body.action || body.button_id;
          log(`Card action received: ask_id=${ask_id} action=${action_id}`);
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
