/**
 * Phase 2 of EClaw#2285 — fetch the centrally-distributed smart-routing
 * system prompt from `/api/channel/routing-policy` and prepend it to inbound
 * channel messages so Claude Code learns the routing convention from the
 * server (single source of truth) instead of having a copy in
 * `fakechat-instructions.txt` patched into the fakechat plugin.
 *
 * The routing policy is static across messages and sessions, so we cache it
 * for the lifetime of the bridge process. A failed fetch fails open: we
 * return an empty policy and let the message deliver without it (the bridge
 * has its own fallback @-mention injection that has been operating fine,
 * and the server's [MENTIONS] hint block on each push covers the
 * authoritative-target case).
 */

export type RoutingPolicyState = {
  apiBase: string;
  channel?: string;
  lang?: string;
};

type RoutingPolicyResponse = {
  success?: boolean;
  policy?: string;
  version?: string;
  channel?: string;
  lang?: string;
};

let _cachedPolicy: string | null = null;
let _cachedKey: string | null = null;

/**
 * Fetch the routing policy once per process. Subsequent calls with the same
 * (apiBase, channel, lang) tuple reuse the cached value.
 *
 * Returns "" when the endpoint is unreachable or the server is older than
 * EClaw 1.1136 (pre-#2287). Callers should treat "" as "no policy to inject".
 */
export async function fetchRoutingPolicy(state: RoutingPolicyState): Promise<string> {
  const channel = state.channel || "claude_code";
  const lang = state.lang || "en";
  const cacheKey = `${state.apiBase}|${channel}|${lang}`;

  if (_cachedKey === cacheKey && _cachedPolicy !== null) return _cachedPolicy;

  const url = `${state.apiBase}/api/channel/routing-policy?channel=${encodeURIComponent(channel)}&lang=${encodeURIComponent(lang)}`;
  let policy = "";
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as RoutingPolicyResponse;
      if (data.success !== false && typeof data.policy === "string") {
        policy = data.policy.trim();
      }
    }
  } catch (_err) {
    /* fall through with empty policy */
  }

  _cachedKey = cacheKey;
  _cachedPolicy = policy;
  return policy;
}

/**
 * Wrap inbound message text with the routing policy block so the host LLM
 * sees the routing convention before producing a reply.
 *
 * If `policy` is empty (fetch failed / endpoint missing), returns `message`
 * unchanged so message delivery is never blocked on policy availability.
 */
export function applyRoutingPolicy(message: string, policy: string): string {
  const p = policy.trim();
  if (!p) return message;
  return [
    "[EClaw central routing policy]",
    p,
    "[End EClaw central routing policy]",
    "",
    message,
  ].join("\n");
}

/**
 * Test-only — reset cached state between unit tests.
 * @internal
 */
export function _resetRoutingPolicyCache(): void {
  _cachedPolicy = null;
  _cachedKey = null;
}
