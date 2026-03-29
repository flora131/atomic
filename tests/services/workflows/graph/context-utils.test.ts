import { describe, expect, test } from "bun:test";
import {
  getDefaultCompactionAction,
  toContextWindowUsage,
  isContextThresholdExceeded,
} from "@/services/workflows/graph/nodes/context.ts";
import type { ContextUsage } from "@/services/agents/types.ts";

describe("getDefaultCompactionAction", () => {
  test("returns summarize for opencode", () => {
    expect(getDefaultCompactionAction("opencode")).toBe("summarize");
  });

  test("returns recreate for claude", () => {
    expect(getDefaultCompactionAction("claude")).toBe("recreate");
  });

  test("returns warn for copilot", () => {
    expect(getDefaultCompactionAction("copilot")).toBe("warn");
  });

  test("returns warn for unknown agent type", () => {
    expect(getDefaultCompactionAction("unknown" as "opencode")).toBe("warn");
  });
});

describe("toContextWindowUsage", () => {
  test("maps ContextUsage to ContextWindowUsage", () => {
    const usage: ContextUsage = {
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 1000,
      usagePercentage: 0.15,
    };

    const result = toContextWindowUsage(usage);

    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.maxTokens).toBe(1000);
    expect(result.usagePercentage).toBe(0.15);
  });

  test("handles zero values", () => {
    const usage: ContextUsage = {
      inputTokens: 0,
      outputTokens: 0,
      maxTokens: 0,
      usagePercentage: 0,
    };

    const result = toContextWindowUsage(usage);
    expect(result.inputTokens).toBe(0);
    expect(result.usagePercentage).toBe(0);
  });
});

describe("isContextThresholdExceeded", () => {
  test("returns false for null usage", () => {
    expect(isContextThresholdExceeded(null, 45)).toBe(false);
  });

  test("returns true when usage meets threshold", () => {
    const usage: ContextUsage = {
      inputTokens: 450,
      outputTokens: 50,
      maxTokens: 1000,
      usagePercentage: 50,
    };
    expect(isContextThresholdExceeded(usage, 50)).toBe(true);
  });

  test("returns true when usage exceeds threshold", () => {
    const usage: ContextUsage = {
      inputTokens: 900,
      outputTokens: 100,
      maxTokens: 1000,
      usagePercentage: 90,
    };
    expect(isContextThresholdExceeded(usage, 45)).toBe(true);
  });

  test("returns false when usage is below threshold", () => {
    const usage: ContextUsage = {
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 1000,
      usagePercentage: 15,
    };
    expect(isContextThresholdExceeded(usage, 45)).toBe(false);
  });

  test("works with ContextWindowUsage type", () => {
    const usage = {
      inputTokens: 500,
      outputTokens: 100,
      maxTokens: 1000,
      usagePercentage: 60,
    };
    expect(isContextThresholdExceeded(usage, 45)).toBe(true);
  });
});
