import { describe, expect, test } from "bun:test";
import { applyCompiledPromptPolicy } from "../prompt-policy.ts";

describe("prompt policy", () => {
  test("leaves message unchanged when policy is empty", () => {
    expect(applyCompiledPromptPolicy("hello", "")).toBe("hello");
  });

  test("wraps compiled policy before the EClaw message", () => {
    const text = applyCompiledPromptPolicy("hello", "## Task Protocol\nReport progress.");
    expect(text).toContain("[EClaw managed prompt policy - claude_code]");
    expect(text).toContain("## Task Protocol\nReport progress.");
    expect(text.endsWith("\nhello")).toBe(true);
  });
});
