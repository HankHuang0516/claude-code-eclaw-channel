#!/usr/bin/env bun
/**
 * EClaw Channel Plugin for Claude Code
 *
 * MCP Server that:
 * 1. Listens for webhook pushes from EClaw platform
 * 2. Forwards messages to Claude Code via MCP notifications
 * 3. Provides a `reply` tool for Claude to send responses back via EClaw API
 *
 * Environment variables:
 *   ECLAW_API_KEY       - Channel API key (eck_...)
 *   ECLAW_API_BASE      - EClaw API base URL (default: https://eclawbot.com)
 *   ECLAW_WEBHOOK_PORT  - Webhook listener port (default: 18800)
 *   ECLAW_WEBHOOK_HOST  - Webhook bind address (default: 127.0.0.1, loopback only)
 *   ECLAW_BOT_NAME      - Bot display name (optional)
 *   ECLAW_CALLBACK_TOKEN - Token EClaw must send back on every webhook push.
 *                         Default: random, regenerated on each start. Set it to
 *                         keep the same token across restarts.
 *   ECLAW_CHANNEL_LOG   - Log file path (default: /tmp/eclaw-channel.log)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { appendFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

const LOG_FILE = process.env.ECLAW_CHANNEL_LOG || "/tmp/eclaw-channel.log";
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(LOG_FILE, line);
}

// ── Config ──
const API_KEY = process.env.ECLAW_API_KEY || "";
const API_BASE = (process.env.ECLAW_API_BASE || "https://eclawbot.com").replace(
  /\/$/,
  ""
);
const WEBHOOK_PORT = parseInt(process.env.ECLAW_WEBHOOK_PORT || "18800", 10);
// Loopback only. This port feeds a Claude Code session started with
// --dangerously-skip-permissions, so it must not be reachable from the LAN.
// cloudflared dials the origin over localhost, so the tunnel is unaffected.
const WEBHOOK_HOST = process.env.ECLAW_WEBHOOK_HOST || "127.0.0.1";
const BOT_NAME = process.env.ECLAW_BOT_NAME || "Claude Bot";
const TARGET_ENTITY_ID = (() => {
  const raw = process.env.ECLAW_ENTITY_ID;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
})();

// ── State ──
// Store credentials from EClaw registration / bind
let registeredDeviceId: string | null = null;
let registeredEntityId: number | null = null;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Two different secrets, deliberately kept apart:
//   CALLBACK_TOKEN - handed to EClaw at /api/channel/register, and required
//                    back on every inbound webhook push.
//   botSecret      - returned by /api/channel/bind, sent in our outgoing
//                    /api/channel/message bodies.
// They used to share one variable and bind overwrote the registered token with
// botSecret, so an inbound push could never match what we gave the platform.
const CALLBACK_TOKEN = process.env.ECLAW_CALLBACK_TOKEN || randomToken();
let botSecret: string | null = null;

// ── MCP Server ──
export const mcp = new Server(
  { name: "eclaw-channel", version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
      },
      tools: {},
    },
    instructions: `You are connected to the EClaw chat platform via a webhook channel.

Messages arrive as <channel source="eclaw-channel" chat_id="DEVICE:ENTITY" deviceId="..." entityId="...">.
Reply with the eclaw_reply tool, passing deviceId and entityId from the meta attributes.
Keep replies concise and helpful. Never ignore incoming messages.
If the message mentions a file or media attachment, acknowledge it in your reply.`,
  }
);

// ── Tools ──
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "eclaw_reply",
      description:
        "Send a reply message back to the EClaw user. Must be called for every incoming message.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The reply message text",
          },
          deviceId: {
            type: "string",
            description: "The deviceId from the incoming message",
          },
          entityId: {
            type: "number",
            description: "The entityId from the incoming message",
          },
          state: {
            type: "string",
            description:
              'Bot state after reply (default: "IDLE")',
            enum: ["IDLE", "BUSY", "THINKING"],
          },
        },
        required: ["text", "deviceId", "entityId"],
      },
    },
    {
      name: "eclaw_send_message",
      description:
        "Update the bot's wallpaper message on EClaw (without targeting a specific user).",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The message to display",
          },
          state: {
            type: "string",
            enum: ["IDLE", "BUSY", "THINKING"],
          },
        },
        required: ["text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "eclaw_reply") {
    const { text, deviceId, entityId, state = "IDLE" } = args as {
      text: string;
      deviceId: string;
      entityId: number | string;
      state?: string;
    };
    // Channel meta delivers entityId as a string; EClaw API expects a number.
    const entityIdNum =
      typeof entityId === "string" ? Number(entityId) : entityId;

    try {
      const resp = await fetch(`${API_BASE}/api/channel/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_api_key: API_KEY,
          deviceId,
          entityId: entityIdNum,
          botSecret: botSecret || "",
          message: text,
          state,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Reply failed (${resp.status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Reply sent: "${text.slice(0, 50)}..."` }],
      };
    } catch (err: any) {
      return {
        content: [
          { type: "text", text: `Reply error: ${err.message}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "eclaw_send_message") {
    const { text, state = "IDLE" } = args as {
      text: string;
      state?: string;
    };

    if (!registeredDeviceId || registeredEntityId === null) {
      return {
        content: [
          {
            type: "text",
            text: "Not registered with EClaw yet. Wait for first incoming message.",
          },
        ],
        isError: true,
      };
    }

    try {
      const resp = await fetch(`${API_BASE}/api/channel/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_api_key: API_KEY,
          deviceId: registeredDeviceId,
          entityId: registeredEntityId,
          botSecret: botSecret || "",
          message: text,
          state,
        }),
      });

      const data = await resp.json();
      return {
        content: [
          {
            type: "text",
            text: resp.ok
              ? `Message sent: "${text.slice(0, 50)}..."`
              : `Send failed: ${JSON.stringify(data)}`,
          },
        ],
        isError: !resp.ok,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Send error: ${err.message}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ── EClaw Registration ──
export async function registerWithEClaw(webhookUrl: string): Promise<void> {
  const callbackUrl = `${webhookUrl}/eclaw-webhook`;

  try {
    // Register callback
    const resp = await fetch(`${API_BASE}/api/channel/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_api_key: API_KEY,
        callback_url: callbackUrl,
        callback_token: CALLBACK_TOKEN,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[EClaw] Registration failed (${resp.status}): ${errText}`);
      console.error(
        "[EClaw] Inbound pushes will be rejected with 401 until registration succeeds — EClaw still holds the previous callback token"
      );
      return;
    }

    const data: any = await resp.json();
    registeredDeviceId = data.deviceId;
    console.error(
      `[EClaw] Registered. Device: ${data.deviceId}, Entities: ${data.entities?.length || 0}`
    );

    const boundEntities = (data.entities || []).filter(
      (e: any) => e.boundToThisAccount === true
    );
    const boundAtTarget =
      TARGET_ENTITY_ID !== null
        ? boundEntities.find((e: any) => e.entityId === TARGET_ENTITY_ID)
        : null;
    const boundElsewhere =
      TARGET_ENTITY_ID !== null
        ? boundEntities.find((e: any) => e.entityId !== TARGET_ENTITY_ID)
        : null;

    if (TARGET_ENTITY_ID !== null && !boundAtTarget && boundElsewhere) {
      console.error(
        `[EClaw] API key is bound to entity ${boundElsewhere.entityId}, expected ${TARGET_ENTITY_ID}; refusing automatic bind to avoid duplicate callbacks`
      );
      return;
    }

    // Bind entity
    const bindResp = await fetch(`${API_BASE}/api/channel/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_api_key: API_KEY,
        deviceId: data.deviceId,
        name: BOT_NAME,
        botName: BOT_NAME,
        ...(TARGET_ENTITY_ID !== null ? { entityId: TARGET_ENTITY_ID } : {}),
      }),
    });

    if (bindResp.ok) {
      const bindData: any = await bindResp.json();
      if (TARGET_ENTITY_ID !== null && bindData.entityId !== TARGET_ENTITY_ID) {
        console.error(
          `[EClaw] Bind returned entity ${bindData.entityId}, expected ${TARGET_ENTITY_ID}; refusing local registration`
        );
        return;
      }
      registeredEntityId = bindData.entityId;
      if (bindData.botSecret) botSecret = bindData.botSecret;
      console.error(
        `[EClaw] Bound entity ${bindData.entityId}, publicCode: ${bindData.publicCode}`
      );
    } else {
      console.error(`[EClaw] Bind failed: ${await bindResp.text()}`);
    }
  } catch (err: any) {
    console.error(`[EClaw] Registration error: ${err.message}`);
  }
}

// ── Webhook auth ──
function timingSafeEqualStr(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Every EClaw push must prove it knows the callback token we registered,
 * either as `Authorization: Bearer <token>` or as `X-Callback-Token: <token>`
 * (the two forms codex-eclaw-bridge accepts). Anything else is rejected with
 * 401: this endpoint forwards straight into a Claude Code session started with
 * --dangerously-skip-permissions, so accepting an unauthenticated POST is
 * remote command execution for anyone who knows the URL.
 */
export function verifyCallbackAuth(req: Request): boolean {
  const tokenHeader = req.headers.get("x-callback-token") ?? "";
  if (tokenHeader && timingSafeEqualStr(tokenHeader, CALLBACK_TOKEN)) return true;

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (bearer && timingSafeEqualStr(bearer[1], CALLBACK_TOKEN)) return true;

  return false;
}

// ── Webhook HTTP Server ──
export async function handleWebhookRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true, channel: "eclaw" });
  }

  // Webhook endpoint
  if (req.method === "POST" && url.pathname === "/eclaw-webhook") {
    if (!verifyCallbackAuth(req)) {
      console.error("[EClaw] Rejected webhook: missing or invalid callback token");
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    try {
      const body: any = await req.json();

      // Extract message fields
      const deviceId = body.deviceId;
      const entityId = body.entityId;
      const text = body.text || body.message || "";
      const from = body.from || "unknown";
      const event = body.event || "message";
      const mediaType = body.mediaType;
      const mediaUrl = body.mediaUrl;

      // Reject if missing critical fields
      if (!deviceId && entityId === undefined) {
        console.error("[EClaw] Rejected webhook: missing deviceId/entityId");
        return Response.json({ ok: true, skipped: true });
      }

      // Update state
      if (deviceId) registeredDeviceId = deviceId;
      if (entityId !== undefined) registeredEntityId = entityId;

      // Build notification text
      let notificationText = text;
      if (mediaType && mediaUrl) {
        const mediaLabel =
          mediaType === "photo"
            ? "Photo"
            : mediaType === "voice"
            ? "Voice"
            : mediaType === "video"
            ? "Video"
            : "File";
        notificationText += `\n[${mediaLabel}] ${mediaUrl}`;
      }

      // Forward to Claude Code via MCP notification
      // Must use { content, meta } format per Claude Code channel spec
      const effectiveDeviceId = deviceId || registeredDeviceId;
      const effectiveEntityId = entityId ?? registeredEntityId;
      try {
        log(`Sending MCP notification: "${notificationText.slice(0,50)}" from=${from}`);
        const msgId = `eclaw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await mcp.notification({
          method: "notifications/claude/channel",
          params: {
            content: notificationText || "(empty message)",
            meta: {
              chat_id: `${effectiveDeviceId}:${effectiveEntityId}`,
              message_id: msgId,
              user: from,
              ts: new Date().toISOString(),
              deviceId: effectiveDeviceId,
              entityId: String(effectiveEntityId),
            },
          },
        });
        log("MCP notification sent successfully");
      } catch (notifErr: any) {
        log(`MCP notification FAILED: ${notifErr.message}\n${notifErr.stack}`);
      }

      return Response.json({ ok: true });
    } catch (err: any) {
      console.error(`[EClaw] Webhook error: ${err.message}`);
      return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

function startWebhookServer(): void {
  Bun.serve({
    hostname: WEBHOOK_HOST,
    port: WEBHOOK_PORT,
    fetch: handleWebhookRequest,
  });

  console.error(
    `[EClaw] Webhook server listening on ${WEBHOOK_HOST}:${WEBHOOK_PORT}`
  );
}

// ── Main ──
async function main(): Promise<void> {
  // 1. Connect MCP transport FIRST (Claude Code expects immediate stdio handshake)
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log("MCP channel connected to Claude Code");
  console.error("[EClaw] MCP channel connected to Claude Code");

  // 2. Start webhook HTTP server
  startWebhookServer();

  // 3. Register with EClaw platform (async, don't block)
  const webhookUrl =
    process.env.ECLAW_WEBHOOK_URL || `http://localhost:${WEBHOOK_PORT}`;
  registerWithEClaw(webhookUrl).catch((err) => {
    console.error(`[EClaw] Registration failed: ${err.message}`);
  });
}

// Guarded so tests can import the webhook handler without opening stdio,
// binding the port or registering a callback with the live platform.
if (import.meta.main) {
  main().catch((err) => {
    console.error(`[EClaw] Fatal: ${err.message}`);
    process.exit(1);
  });
}
