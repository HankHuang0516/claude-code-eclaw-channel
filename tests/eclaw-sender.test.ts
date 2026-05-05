/**
 * Phase 2 — eclaw-sender.ts unit tests.
 *
 * Verifies that sendReplyToEClaw selects the correct auth path and
 * constructs the expected HTTP request for each path.
 */

import { describe, expect, mock, test } from "bun:test";
import {
  buildChannelMessageRequest,
  buildTransformRequest,
  sendReplyToEClaw,
} from "../eclaw-sender.ts";

const BASE_OPTS = {
  apiBase: "https://eclawbot.test",
  apiKey: "eck_testkey",
  deviceId: "dev-uuid",
  entityId: 1,
  botSecret: "botsecret",
  text: "hello from bridge",
};

// ── buildTransformRequest ────────────────────────────────────────────────────

describe("buildTransformRequest", () => {
  test("targets /api/transform with X-Channel-Key header", () => {
    const req = buildTransformRequest(BASE_OPTS);
    expect(req.url).toBe("https://eclawbot.test/api/transform");
    expect(req.headers["X-Channel-Key"]).toBe("eck_testkey");
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  test("body contains actAs:channel, deviceId, entityId, message, state", () => {
    const req = buildTransformRequest(BASE_OPTS);
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({
      deviceId: "dev-uuid",
      entityId: 1,
      actAs: "channel",
      message: "hello from bridge",
      state: "IDLE",
    });
    expect(body.botSecret).toBeUndefined();
    expect(body.channel_api_key).toBeUndefined();
  });
});

// ── buildChannelMessageRequest ───────────────────────────────────────────────

describe("buildChannelMessageRequest", () => {
  test("targets /api/channel/message without X-Channel-Key header", () => {
    const req = buildChannelMessageRequest(BASE_OPTS);
    expect(req.url).toBe("https://eclawbot.test/api/channel/message");
    expect(req.headers["X-Channel-Key"]).toBeUndefined();
  });

  test("body contains channel_api_key, botSecret, deviceId, entityId, message, state", () => {
    const req = buildChannelMessageRequest(BASE_OPTS);
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({
      channel_api_key: "eck_testkey",
      deviceId: "dev-uuid",
      entityId: 1,
      botSecret: "botsecret",
      message: "hello from bridge",
      state: "IDLE",
    });
    expect(body.actAs).toBeUndefined();
  });

  test("includes card in body when provided", () => {
    const card = { ask_id: "a1", title: "T", body: "B", buttons: [] };
    const req = buildChannelMessageRequest({ ...BASE_OPTS, card });
    const body = JSON.parse(req.body);
    expect(body.card).toEqual(card);
  });

  test("omits card key when card is undefined", () => {
    const req = buildChannelMessageRequest({ ...BASE_OPTS, card: undefined });
    const body = JSON.parse(req.body);
    expect("card" in body).toBe(false);
  });
});

// ── sendReplyToEClaw — path selection ────────────────────────────────────────

describe("sendReplyToEClaw — channel-key path", () => {
  test("calls /api/transform when preferTransformViaChannelKey=true and apiKey is set", async () => {
    const fetchMock = mock(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as any;

    await sendReplyToEClaw({ ...BASE_OPTS, preferTransformViaChannelKey: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eclawbot.test/api/transform");
    expect((init.headers as Record<string, string>)["X-Channel-Key"]).toBe("eck_testkey");
    const body = JSON.parse(init.body as string);
    expect(body.actAs).toBe("channel");
  });

  test("falls back to /api/channel/message when apiKey is empty (even if flag=true)", async () => {
    const fetchMock = mock(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as any;

    await sendReplyToEClaw({ ...BASE_OPTS, apiKey: "", preferTransformViaChannelKey: true });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eclawbot.test/api/channel/message");
  });
});

describe("sendReplyToEClaw — legacy channel/message path", () => {
  test("calls /api/channel/message when preferTransformViaChannelKey=false", async () => {
    const fetchMock = mock(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as any;

    await sendReplyToEClaw({ ...BASE_OPTS, preferTransformViaChannelKey: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eclawbot.test/api/channel/message");
    const body = JSON.parse(init.body as string);
    expect(body.channel_api_key).toBe("eck_testkey");
    expect(body.botSecret).toBe("botsecret");
  });
});

describe("sendReplyToEClaw — error handling", () => {
  test("throws on non-2xx response", async () => {
    globalThis.fetch = mock(async () => new Response("bad request", { status: 400 })) as any;
    await expect(
      sendReplyToEClaw({ ...BASE_OPTS, preferTransformViaChannelKey: false }),
    ).rejects.toThrow("HTTP 400");
  });
});
