/**
 * Unit tests for the inbound callback auth gate on bridge.ts's
 * POST /eclaw-webhook.
 *
 * Backstory: the endpoint had no auth at all. Any POST whose body carried a
 * deviceId or entityId was forwarded to the Claude Code session, which runs
 * with --dangerously-skip-permissions — so anyone who knew the public tunnel
 * URL could drive the host. server.ts had the same hole with a dead comparison
 * (a lone `// Fall through` comment); `isCallbackAuthorized` is now the one
 * implementation both modes use.
 *
 * bridge.ts itself cannot be imported here: it calls Bun.serve, opens the
 * fakechat WebSocket and arms timers at module scope, and its watchdog shells
 * out to `tmux send-keys -t eclaw-bot`, so importing or spawning it in a test
 * would fight a live bot for port 18800 and poke its tmux pane. The decision
 * lives in bridge-state.ts and is unit-tested; the assertions at the bottom
 * pin the wiring in bridge.ts's source, which is where the original bug was —
 * the comparison existed, the rejection did not.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isCallbackAuthorized } from "../bridge-state.ts";

const TOKEN = "f3a9c17b4e5d6082a1cc93fe77b20415";

function push(headers: Record<string, string>) {
    return new Request("http://127.0.0.1:18800/eclaw-webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({ deviceId: "d", entityId: 2, text: "hi" }),
    });
}

describe("isCallbackAuthorized", () => {
    test("accepts the registered token as a bearer", () => {
        expect(
            isCallbackAuthorized(push({ Authorization: `Bearer ${TOKEN}` }), TOKEN)
        ).toBe(true);
    });

    test("accepts the registered token as X-Callback-Token", () => {
        expect(
            isCallbackAuthorized(push({ "X-Callback-Token": TOKEN }), TOKEN)
        ).toBe(true);
    });

    test("accepts a lowercase bearer scheme", () => {
        expect(
            isCallbackAuthorized(push({ Authorization: `bearer ${TOKEN}` }), TOKEN)
        ).toBe(true);
    });

    test("rejects a push with no credentials at all", () => {
        expect(isCallbackAuthorized(push({}), TOKEN)).toBe(false);
    });

    test("rejects the wrong token", () => {
        expect(
            isCallbackAuthorized(push({ Authorization: "Bearer nope" }), TOKEN)
        ).toBe(false);
        expect(
            isCallbackAuthorized(push({ "X-Callback-Token": "nope" }), TOKEN)
        ).toBe(false);
    });

    test("rejects near misses", () => {
        for (const near of [
            TOKEN.slice(0, -1),
            `${TOKEN}x`,
            TOKEN.toUpperCase(),
            TOKEN.replace("f3a9", "f3a8"),
        ]) {
            expect(
                isCallbackAuthorized(push({ Authorization: `Bearer ${near}` }), TOKEN)
            ).toBe(false);
            expect(
                isCallbackAuthorized(push({ "X-Callback-Token": near }), TOKEN)
            ).toBe(false);
        }
    });

    test("tolerates the whitespace HTTP itself allows", () => {
        // `credentials = auth-scheme [ 1*SP token68 ]` (RFC 7235), and the
        // Headers layer trims field values before we ever see them — so these
        // carry the exact token, not a near miss.
        expect(
            isCallbackAuthorized(push({ Authorization: `Bearer  ${TOKEN}` }), TOKEN)
        ).toBe(true);
        expect(
            isCallbackAuthorized(push({ "X-Callback-Token": ` ${TOKEN} ` }), TOKEN)
        ).toBe(true);
    });

    test("rejects an empty or scheme-only Authorization header", () => {
        for (const value of ["", "Bearer", "Bearer ", "Basic abc", TOKEN]) {
            expect(
                isCallbackAuthorized(push({ Authorization: value }), TOKEN)
            ).toBe(false);
        }
        expect(isCallbackAuthorized(push({ "X-Callback-Token": "" }), TOKEN)).toBe(
            false
        );
    });

    test("authorizes nothing before a token exists", () => {
        // Registration has not happened yet (or failed): there is nothing to
        // compare against, so every push is rejected — including one that
        // presents an empty token.
        for (const expected of [null, undefined, ""]) {
            expect(
                isCallbackAuthorized(push({ Authorization: `Bearer ${TOKEN}` }), expected)
            ).toBe(false);
            expect(isCallbackAuthorized(push({ Authorization: "Bearer " }), expected)).toBe(
                false
            );
            expect(isCallbackAuthorized(push({ "X-Callback-Token": "" }), expected)).toBe(
                false
            );
        }
    });

    test("ignores the token in the body", () => {
        // EClaw sends the token in a header; a body field is attacker-controlled.
        const req = new Request("http://127.0.0.1:18800/eclaw-webhook", {
            method: "POST",
            body: JSON.stringify({ deviceId: "d", entityId: 2, callback_token: TOKEN }),
        });
        expect(isCallbackAuthorized(req, TOKEN)).toBe(false);
    });
});

describe("bridge.ts wiring", () => {
    const source = readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");
    const webhookRoute = source.slice(
        source.indexOf('url.pathname === "/eclaw-webhook"')
    );

    test("the route rejects with 401 before it reads the body", () => {
        const gate = webhookRoute.indexOf("isCallbackAuthorized(req, CALLBACK_TOKEN)");
        const bodyRead = webhookRoute.indexOf("await req.json()");
        expect(gate).toBeGreaterThan(-1);
        expect(bodyRead).toBeGreaterThan(-1);
        expect(gate).toBeLessThan(bodyRead);
        // The original bug was a mismatch branch that did nothing. Whatever sits
        // between the check and the body read has to return a 401.
        expect(webhookRoute.slice(gate, bodyRead)).toContain("status: 401");
    });

    test("the token registered with EClaw is the one the gate compares", () => {
        expect(source).toContain("callback_token: CALLBACK_TOKEN,");
        // server.ts's bug: bind overwrote the registered token with botSecret.
        // The const declaration must stay the only assignment.
        expect(source.match(/\bCALLBACK_TOKEN\s*=[^=]/g) ?? []).toHaveLength(1);
    });

    test("the webhook server binds loopback by default", () => {
        expect(source).toContain(
            'const WEBHOOK_HOST = process.env.ECLAW_WEBHOOK_HOST || "127.0.0.1";'
        );
        expect(source.slice(source.indexOf("Bun.serve({"), 200 + source.indexOf("Bun.serve({"))).toContain(
            "hostname: WEBHOOK_HOST"
        );
    });
});
