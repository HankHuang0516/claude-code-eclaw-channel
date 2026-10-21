/**
 * server.ts webhook authentication.
 *
 * /eclaw-webhook forwards straight into a Claude Code session started with
 * --dangerously-skip-permissions, so a push that cannot prove it knows the
 * callback token we registered must be rejected, not forwarded.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// This machine's shell profile exports ECLAW_* vars for the live bots, and they
// leak into subshells. Strip them so an inherited token, API base or entity id
// cannot make these assertions vacuous.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("ECLAW_")) delete process.env[key];
}

const CALLBACK_TOKEN = "test-callback-token-7f3a9c";
const BOT_SECRET = "test-bot-secret-b41e02";
const DEVICE_ID = "11111111-2222-4333-8444-555555555555";
const SCRATCH = mkdtempSync(join(tmpdir(), "eclaw-channel-auth-test-"));

// Stub EClaw platform: records what we send it, hands back a botSecret on bind.
const registerBodies: any[] = [];
const messageBodies: any[] = [];
const platform = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = await req.json();
    if (path === "/api/channel/register") {
      registerBodies.push(body);
      return Response.json({
        deviceId: DEVICE_ID,
        entities: [{ entityId: 14, boundToThisAccount: false }],
      });
    }
    if (path === "/api/channel/bind") {
      return Response.json({
        entityId: 14,
        publicCode: "test01",
        botSecret: BOT_SECRET,
      });
    }
    if (path === "/api/channel/message") {
      messageBodies.push(body);
      return Response.json({ success: true });
    }
    return Response.json({ error: "unexpected path" }, { status: 404 });
  },
});

// server.ts resolves the token, the log path and the API base at module load,
// so the env has to be in place before the import.
process.env.ECLAW_CALLBACK_TOKEN = CALLBACK_TOKEN;
process.env.ECLAW_CHANNEL_LOG = join(SCRATCH, "channel.log");
process.env.ECLAW_API_KEY = "eck_test";
process.env.ECLAW_API_BASE = `http://127.0.0.1:${platform.port}`;

// main() is guarded by import.meta.main, so importing starts no listener.
const channel = await import("../server.ts");

// Capture what would have gone to Claude Code over the MCP stdio channel.
const forwarded: any[] = [];
(channel.mcp as any).notification = async (note: any) => {
  forwarded.push(note);
};

function push(headers: Record<string, string>, text = "hello from eclaw") {
  return channel.handleWebhookRequest(
    new Request("http://127.0.0.1/eclaw-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        entityId: 14,
        text,
        from: "tester",
      }),
    })
  );
}

beforeAll(async () => {
  // Full register + bind against the stub, so the tests run against the same
  // state a live bot reaches after startup.
  await channel.registerWithEClaw("https://webhook.test");
});

afterAll(() => {
  platform.stop(true);
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("inbound webhook auth", () => {
  test("rejects a push with no credentials", async () => {
    forwarded.length = 0;
    const resp = await push({});
    expect(resp.status).toBe(401);
    expect(await resp.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(forwarded).toHaveLength(0);
  });

  test("rejects a push with the wrong bearer token", async () => {
    forwarded.length = 0;
    const resp = await push({ Authorization: "Bearer not-the-token" });
    expect(resp.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  test("rejects a near-miss token", async () => {
    forwarded.length = 0;
    for (const token of [
      CALLBACK_TOKEN.slice(0, -1),
      `${CALLBACK_TOKEN}x`,
      CALLBACK_TOKEN.toUpperCase(),
    ]) {
      const viaBearer = await push({ Authorization: `Bearer ${token}` });
      expect(viaBearer.status).toBe(401);
      const viaHeader = await push({ "X-Callback-Token": token });
      expect(viaHeader.status).toBe(401);
    }
    expect(forwarded).toHaveLength(0);
  });

  test("rejects an empty bearer value", async () => {
    forwarded.length = 0;
    expect((await push({ Authorization: "Bearer" })).status).toBe(401);
    expect((await push({ Authorization: "Bearer " })).status).toBe(401);
    expect((await push({ "X-Callback-Token": "" })).status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  test("forwards a push carrying the bearer token", async () => {
    forwarded.length = 0;
    const resp = await push({ Authorization: `Bearer ${CALLBACK_TOKEN}` });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].method).toBe("notifications/claude/channel");
    expect(forwarded[0].params.content).toBe("hello from eclaw");
    expect(forwarded[0].params.meta.deviceId).toBe(DEVICE_ID);
    expect(forwarded[0].params.meta.entityId).toBe("14");
  });

  test("forwards a push carrying X-Callback-Token", async () => {
    forwarded.length = 0;
    const resp = await push({ "X-Callback-Token": CALLBACK_TOKEN }, "via header");
    expect(resp.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].params.content).toBe("via header");
  });

  test("accepts a lowercase bearer scheme", async () => {
    forwarded.length = 0;
    const resp = await push({ Authorization: `bearer ${CALLBACK_TOKEN}` });
    expect(resp.status).toBe(200);
    expect(forwarded).toHaveLength(1);
  });

  test("leaves GET /health open for monitors", async () => {
    const resp = await channel.handleWebhookRequest(
      new Request("http://127.0.0.1/health")
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true, channel: "eclaw" });
  });
});

describe("callback token vs botSecret", () => {
  test("registers the same token the handler verifies", () => {
    expect(registerBodies).toHaveLength(1);
    expect(registerBodies[0].callback_token).toBe(CALLBACK_TOKEN);
    expect(registerBodies[0].callback_url).toBe(
      "https://webhook.test/eclaw-webhook"
    );
  });

  test("bind does not replace the callback token with botSecret", async () => {
    // The original bug: bind overwrote the registered token with botSecret, so
    // the value the platform sends could never match.
    forwarded.length = 0;
    expect((await push({ Authorization: `Bearer ${BOT_SECRET}` })).status).toBe(
      401
    );
    expect(forwarded).toHaveLength(0);
    expect(
      (await push({ Authorization: `Bearer ${CALLBACK_TOKEN}` })).status
    ).toBe(200);
  });

  test("outgoing replies carry botSecret, not the callback token", async () => {
    messageBodies.length = 0;
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      channel.mcp.connect(serverTransport),
    ]);

    await client.callTool({
      name: "eclaw_reply",
      arguments: { text: "pong", deviceId: DEVICE_ID, entityId: "14" },
    });
    await client.close();

    expect(messageBodies).toHaveLength(1);
    expect(messageBodies[0].botSecret).toBe(BOT_SECRET);
    expect(messageBodies[0].entityId).toBe(14);
  });
});
