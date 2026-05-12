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

export interface SenderHint {
  kind: "entity" | "user" | "broadcast" | "unknown";
  entityId?: number;
  publicCode?: string | null;
}

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
  /**
   * Routing hint derived from the inbound webhook. When kind === "entity",
   * the sender supplies the original sender's publicCode so the bridge can
   * (a) auto-prepend `@publicCode` to the outbound text if Claude forgot it,
   * and (b) pass senderHint as a belt-and-suspenders fallback. Without this,
   * outbound bot-to-bot replies fan out to every entity on the device.
   */
  senderHint?: SenderHint | null;
}

/**
 * Match a leading routing token: `@#5`, `@31tlkr`, `@all` (case-insensitive
 * for `@all` only). Used to detect whether Claude already prepended the
 * routing token so we don't double-inject.
 */
const LEADING_MENTION_RE = /^@(?:#\d+|[a-z0-9]{6}|all)\b/i;

/**
 * Auto-prepend `@<publicCode> ` to text when sender is another bot entity
 * AND Claude's reply text doesn't already lead with a routing token.
 *
 * Skipped when:
 *   - hint is missing / kind !== "entity" (user / broadcast / unknown)
 *   - publicCode is missing
 *   - text already starts with @#N / @publicCode / @all
 *
 * Exported for testing.
 */
export function applyOutboundMention(text: string, hint?: SenderHint | null): string {
  if (!hint || hint.kind !== "entity") return text;
  if (!hint.publicCode) return text;
  const trimmed = text.trimStart();
  if (LEADING_MENTION_RE.test(trimmed)) return text;
  return `@${hint.publicCode} ${text}`;
}

/**
 * Build the request descriptor for the channel-key transform path.
 * Exported for testing.
 */
export function buildTransformRequest(opts: Pick<SendReplyOptions, "apiBase" | "apiKey" | "deviceId" | "entityId" | "text" | "senderHint">): {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
} {
  const text = applyOutboundMention(opts.text, opts.senderHint);
  const payload: Record<string, unknown> = {
    deviceId: opts.deviceId,
    entityId: opts.entityId,
    actAs: "channel" as const,
    message: text,
    state: "IDLE",
  };
  if (opts.senderHint && opts.senderHint.kind) {
    payload.senderHint = opts.senderHint;
  }
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
export function buildChannelMessageRequest(opts: Pick<SendReplyOptions, "apiBase" | "apiKey" | "deviceId" | "entityId" | "botSecret" | "text" | "card" | "senderHint">): {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
} {
  const text = applyOutboundMention(opts.text, opts.senderHint);
  const payload: Record<string, unknown> = {
    channel_api_key: opts.apiKey,
    deviceId: opts.deviceId,
    entityId: opts.entityId,
    botSecret: opts.botSecret,
    message: text,
    state: "IDLE",
  };
  if (opts.card !== undefined) payload.card = opts.card;
  if (opts.senderHint && opts.senderHint.kind) {
    payload.senderHint = opts.senderHint;
  }
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
