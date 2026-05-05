/**
 * EClaw reply sender — two auth paths.
 *
 * Extracted from bridge.ts so the branching logic can be unit-tested
 * without spinning up the full bridge process.
 *
 * Phase 2 of proposal_channel_key_on_transform.md:
 *   - channel key path: POST /api/transform  with X-Channel-Key + actAs:"channel"
 *   - legacy path:      POST /api/channel/message  (Phase 4 fallback)
 *
 * Controlled by env flag ECLAW_PREFER_TRANSFORM_VIA_CHANNEL_KEY=true.
 * Default is false so existing deployments are unaffected.
 */

export interface SendReplyOptions {
  apiBase: string;
  apiKey: string;
  /** When true AND apiKey is non-empty, use /api/transform + X-Channel-Key */
  preferTransformViaChannelKey: boolean;
  deviceId: string;
  entityId: number;
  botSecret: string;
  text: string;
  card?: unknown;
}

/**
 * Build the request descriptor for the channel-key transform path.
 * Exported for testing.
 */
export function buildTransformRequest(opts: Pick<SendReplyOptions, "apiBase" | "apiKey" | "deviceId" | "entityId" | "text">): {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
} {
  const payload = {
    deviceId: opts.deviceId,
    entityId: opts.entityId,
    actAs: "channel" as const,
    message: opts.text,
    state: "IDLE",
  };
  return {
    url: `${opts.apiBase}/api/transform`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Channel-Key": opts.apiKey,
    },
    body: JSON.stringify(payload),
  };
}

/**
 * Build the request descriptor for the legacy channel/message path.
 * Exported for testing.
 */
export function buildChannelMessageRequest(opts: Pick<SendReplyOptions, "apiBase" | "apiKey" | "deviceId" | "entityId" | "botSecret" | "text" | "card">): {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
} {
  const payload: Record<string, unknown> = {
    channel_api_key: opts.apiKey,
    deviceId: opts.deviceId,
    entityId: opts.entityId,
    botSecret: opts.botSecret,
    message: opts.text,
    state: "IDLE",
  };
  if (opts.card !== undefined) payload.card = opts.card;
  return {
    url: `${opts.apiBase}/api/channel/message`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/**
 * Send a reply to EClaw via whichever path is configured.
 *
 * Throws on HTTP error so the caller can feed the error back to Claude.
 */
export async function sendReplyToEClaw(opts: SendReplyOptions): Promise<void> {
  const req =
    opts.preferTransformViaChannelKey && opts.apiKey
      ? buildTransformRequest(opts)
      : buildChannelMessageRequest(opts);

  const resp = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
}
