import { describe, expect, test } from "bun:test";
import { normalizeClaudeModelInput } from "@/services/models/model-operations/claude.ts";

// ---------------------------------------------------------------------------
// normalizeClaudeModelInput — direct unit tests
// ---------------------------------------------------------------------------

describe("normalizeClaudeModelInput", () => {
  test("returns 'opus' for 'default'", () => {
    expect(normalizeClaudeModelInput("default")).toBe("opus");
  });

  test("is case-insensitive for 'default'", () => {
    expect(normalizeClaudeModelInput("Default")).toBe("opus");
    expect(normalizeClaudeModelInput("DEFAULT")).toBe("opus");
    expect(normalizeClaudeModelInput("dEfAuLt")).toBe("opus");
  });

  test("normalizes 'provider/default' to 'provider/opus'", () => {
    expect(normalizeClaudeModelInput("anthropic/default")).toBe("anthropic/opus");
  });

  test("is case-insensitive for provider/default", () => {
    expect(normalizeClaudeModelInput("anthropic/Default")).toBe("anthropic/opus");
    expect(normalizeClaudeModelInput("anthropic/DEFAULT")).toBe("anthropic/opus");
  });

  test("trims whitespace", () => {
    expect(normalizeClaudeModelInput("  sonnet  ")).toBe("sonnet");
    expect(normalizeClaudeModelInput("  default  ")).toBe("opus");
  });

  test("passes through regular model names unchanged", () => {
    expect(normalizeClaudeModelInput("sonnet")).toBe("sonnet");
    expect(normalizeClaudeModelInput("opus")).toBe("opus");
    expect(normalizeClaudeModelInput("haiku")).toBe("haiku");
    expect(normalizeClaudeModelInput("claude-sonnet-4")).toBe("claude-sonnet-4");
  });

  test("passes through provider/model format unchanged for non-default models", () => {
    expect(normalizeClaudeModelInput("anthropic/sonnet")).toBe("anthropic/sonnet");
    expect(normalizeClaudeModelInput("anthropic/claude-opus-4")).toBe("anthropic/claude-opus-4");
  });

  test("handles empty string", () => {
    expect(normalizeClaudeModelInput("")).toBe("");
  });

  test("handles multi-slash paths by not matching default", () => {
    // With more than 2 parts, the split won't match provider/default pattern
    expect(normalizeClaudeModelInput("a/b/default")).toBe("a/b/default");
  });

  test("handles leading slash followed by default (empty provider)", () => {
    // "/default" splits into ["", "default"], length=2, parts[1]=default
    // so it becomes "/opus" (empty provider + /opus)
    expect(normalizeClaudeModelInput("/default")).toBe("/opus");
  });
});
