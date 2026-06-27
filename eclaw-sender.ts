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
  retryAttempts?: number;
  retryDelayMs?: number;
  /**
   * Routing hint derived from the inbound webhook. When kind === "entity",
   * the sender supplies the original sender's publicCode so the bridge can
   * (a) auto-prepend `@publicCode` to the outbound text if Claude forgot it,
   * and (b) pass senderHint as a belt-and-suspenders fallback. Without this,
   * outbound bot-to-bot replies fan out to every entity on the device.
   */
  senderHint?: SenderHint | null;
}

const TRANSIENT_REPLY_ERROR_RE = /(server starting up|too many requests|rate.?limit|HTTP 429|HTTP 5\d\d)/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryReply(status: number, body: string): boolean {
  return status === 429 || status >= 500 || TRANSIENT_REPLY_ERROR_RE.test(body);
}

/**
 * Match a leading routing token: `@#5`, `@31tlkr`, `@all` (case-insensitive
 * for `@all` only). Used to detect whether Claude already prepended the
 * routing token so we don't double-inject.
 *
 * Case-sensitivity matters for routing correctness: server publicCodes are
 * generated from `abcdefghijklmnopqrstuvwxyz0123456789` (strictly lowercase
 * a-z0-9, see backend/index.js generatePublicCode + mention-parser.js's
 * non-`/i` `[a-z0-9]{6}` token regexes), so an uppercase token like `@ABCDEF`
 * is NOT a real publicCode. A blanket `/i` flag made the 6-char alt match
 * uppercase too, so `@ABCDEF reply` was wrongly treated as already-routed and
 * the real `@publicCode` was never prepended. Match `#\d+` and the 6-char code
 * in their real lowercase form; keep ONLY `@all` case-insensitive.
 */
const LEADING_MENTION_RE = /^@(?:#\d+|[a-z0-9]{6}|[Aa][Ll][Ll])\b/;

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

  const attempts = Math.max(1, opts.retryAttempts ?? 5);
  const retryDelayMs = Math.max(0, opts.retryDelayMs ?? 2_000);
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });

    const errText = await resp.text();
    if (resp.ok) return;

    lastError = `HTTP ${resp.status}: ${errText.slice(0, 200)}`;
    if (attempt < attempts && shouldRetryReply(resp.status, errText)) {
      await sleep(Math.min(30_000, retryDelayMs * attempt));
      continue;
    }
    throw new Error(lastError);
  }

  throw new Error(lastError || "Reply send failed");
}
