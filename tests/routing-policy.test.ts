import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  _resetRoutingPolicyCache,
  applyRoutingPolicy,
  fetchRoutingPolicy,
} from "../routing-policy.ts";

describe("applyRoutingPolicy", () => {
  test("leaves message unchanged when policy is empty", () => {
    expect(applyRoutingPolicy("hello", "")).toBe("hello");
    expect(applyRoutingPolicy("hello", "   \n  ")).toBe("hello");
  });

  test("wraps the policy block before the message body", () => {
    const wrapped = applyRoutingPolicy(
      "hello",
      "=== ROUTING (CRITICAL) ===\nPick one path",
    );
    expect(wrapped).toContain("[EClaw central routing policy]");
    expect(wrapped).toContain("=== ROUTING (CRITICAL) ===");
    expect(wrapped).toContain("[End EClaw central routing policy]");
    expect(wrapped.endsWith("\nhello")).toBe(true);
  });
});

describe("fetchRoutingPolicy", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetRoutingPolicyCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns the policy field from the server response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ success: true, policy: "ROUTING BLOCK" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    ) as any;
    const policy = await fetchRoutingPolicy({ apiBase: "https://example.test" });
    expect(policy).toBe("ROUTING BLOCK");
  });

  test("returns empty string on non-200 response (older server / missing endpoint)", async () => {
    globalThis.fetch = mock(async () => new Response("not found", { status: 404 })) as any;
    const policy = await fetchRoutingPolicy({ apiBase: "https://example.test" });
    expect(policy).toBe("");
  });

  test("returns empty string when fetch throws", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as any;
    const policy = await fetchRoutingPolicy({ apiBase: "https://example.test" });
    expect(policy).toBe("");
  });

  test("returns empty string when response has success:false", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ success: false }), { status: 200, headers: { "content-type": "application/json" } })
    ) as any;
    const policy = await fetchRoutingPolicy({ apiBase: "https://example.test" });
    expect(policy).toBe("");
  });

  test("caches the result for the same (apiBase, channel, lang) tuple", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify({ success: true, policy: "P" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;

    const a = await fetchRoutingPolicy({ apiBase: "https://example.test" });
    const b = await fetchRoutingPolicy({ apiBase: "https://example.test" });
    expect(a).toBe("P");
    expect(b).toBe("P");
    expect(callCount).toBe(1);
  });

  test("re-fetches when channel or lang changes", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify({ success: true, policy: `P${callCount}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;

    await fetchRoutingPolicy({ apiBase: "https://example.test", lang: "en" });
    await fetchRoutingPolicy({ apiBase: "https://example.test", lang: "zh-TW" });
    expect(callCount).toBe(2);
  });
});
