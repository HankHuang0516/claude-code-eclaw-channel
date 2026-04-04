#!/usr/bin/env bun
/**
 * EClaw → Fakechat Bridge
 *
 * Receives EClaw webhook pushes on port 18800,
 * forwards them to fakechat's WebSocket on localhost:8787/ws,
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

async function forwardReplyToEClaw(text: string) {
  if (!lastDeviceId || lastEntityId === null) {
    log("Cannot forward reply: no deviceId/entityId");
    return;
  }

  log(`Forwarding reply to EClaw: "${text.slice(0, 50)}..." device=${lastDeviceId} entity=${lastEntityId}`);

  const resp = await fetch(`${API_BASE}/api/channel/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel_api_key: API_KEY,
      deviceId: lastDeviceId,
      entityId: lastEntityId,
      botSecret: botSecret || "",
      message: text,
      state: "IDLE",
    }),
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

    if (req.method === "POST" && url.pathname === "/eclaw-webhook") {
      try {
        const body: any = await req.json();

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

        log(`Webhook received: "${fullText.slice(0, 80)}" → forwarding to fakechat WS`);

        // Send to fakechat via WebSocket
        if (ws && wsConnected) {
          const id = crypto.randomUUID();
          ws.send(JSON.stringify({ id, text: fullText }));
          log("Forwarded to fakechat WebSocket");
        } else {
          log("WARNING: fakechat WebSocket not connected!");
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
