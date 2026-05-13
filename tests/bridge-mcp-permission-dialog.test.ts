/**
 * Regression test for the github-computer MCP permission dialog infinite loop.
 *
 * Symptom (2026-05-14): The bot was stuck on a "Computer Use wants to control
 * these apps" dialog requesting access to Chrome. The `resolve_stuck_prompt`
 * handler was sending `Down Enter` to navigate to the 2nd option and confirm —
 * this worked for standard Claude Code prompts ("Yes / Yes, and always allow / No")
 * but on the MCP dialog it navigated to "Decline" and then failed with
 * "This field is required" (the "Allow access for this session?" dropdown was unset).
 * Result: 300s+ infinite decline loop that never unblocked the bot.
 *
 * Fix: `isMcpPermissionDialog(screen)` detects this dialog; the handler sends
 * `Escape` instead (graceful cancel — bot gets the cancellation error and reports
 * back rather than looping).
 *
 * Detected by: 6h self-healthcheck scheduled task.
 */

import { describe, expect, test } from "bun:test";
import { classifyTmuxScreen, isMcpPermissionDialog } from "../bridge-state.ts";

// ── Fixtures ──

const SCREEN_MCP_PERMISSION = `
────────────────────────────────────────────────────────────────────────────────
  MCP server "github-computer" requests your input


  Computer Use wants to control these apps:

  - Google Chrome

  Apps that are not allowed may be hidden.

  Reason:
  Upload EClaw chat-avatar-size promo video to YouTube

    ❯ ⚠ Allow access for this session?: ▸ not set
          This field is required
      Accept    Decline

  Esc to cancel · ↑↓ to navigate · Backspace to unset · → to expand
`.trim();

const SCREEN_CLAUDE_CONFIRM = `
Do you want to create this file?
❯ Yes
  Yes, and always allow
  No
Esc to cancel
`.trim();

const SCREEN_IDLE = `
History from previous turn ...
⏵⏵ bypass permissions on (shift+tab to cycle)
❯
`.trim();

// ── Tests ──

describe("isMcpPermissionDialog", () => {
    test("returns true for github-computer MCP permission dialog", () => {
        expect(isMcpPermissionDialog(SCREEN_MCP_PERMISSION)).toBe(true);
    });

    test("returns false for standard Claude Code confirmation dialog", () => {
        expect(isMcpPermissionDialog(SCREEN_CLAUDE_CONFIRM)).toBe(false);
    });

    test("returns false for idle screen", () => {
        expect(isMcpPermissionDialog(SCREEN_IDLE)).toBe(false);
    });

    test("returns false for empty screen", () => {
        expect(isMcpPermissionDialog("")).toBe(false);
    });
});

describe("classifyTmuxScreen with MCP permission dialog", () => {
    test("classifies MCP permission dialog as stuck_prompt (Esc to cancel present)", () => {
        // The dialog must still be classified as stuck_prompt so resolve_stuck_prompt fires —
        // we only change WHICH keystrokes are sent inside the handler.
        expect(classifyTmuxScreen(SCREEN_MCP_PERMISSION, { hookPending: false })).toBe("stuck_prompt");
    });
});
