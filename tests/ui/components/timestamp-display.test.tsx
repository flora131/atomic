/**
 * Tests for TimestampDisplay Component
 *
 * Tests cover:
 * - formatModelId utility function
 * - buildDisplayParts utility function
 * - TimestampDisplayProps interface
 * - Component rendering with various props
 */

import { describe, test, expect } from "bun:test";
import {
  TimestampDisplay,
  formatModelId,
  buildDisplayParts,
  type TimestampDisplayProps,
} from "../../../src/ui/components/timestamp-display.tsx";

// ============================================================================
// FORMAT MODEL ID TESTS
// ============================================================================

describe("formatModelId", () => {
  test("returns model names unchanged when short", () => {
    expect(formatModelId("claude-3-opus")).toBe("claude-3-opus");
    expect(formatModelId("gpt-4")).toBe("gpt-4");
    expect(formatModelId("llama-2")).toBe("llama-2");
    expect(formatModelId("mistral-7b")).toBe("mistral-7b");
  });

  test("truncates long model names", () => {
    const longName = "very-long-model-name-that-exceeds-limit";
    const result = formatModelId(longName);
    expect(result).toBe("very-long-model-name-t...");
    expect(result.length).toBe(25);
  });

  test("preserves model names at exactly 25 characters", () => {
    const exact25 = "1234567890123456789012345";
    expect(formatModelId(exact25)).toBe(exact25);
  });

  test("handles empty string", () => {
    expect(formatModelId("")).toBe("");
  });
});

// ============================================================================
// BUILD DISPLAY PARTS TESTS
// ============================================================================

describe("buildDisplayParts", () => {
  const testTimestamp = "2026-01-31T14:30:00.000Z";

  test("returns timestamp only when no optional params", () => {
    const parts = buildDisplayParts(testTimestamp);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
  });

  test("includes duration when durationMs is provided", () => {
    const parts = buildDisplayParts(testTimestamp, 2500);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe("2s");
  });

  test("includes model when modelId is provided", () => {
    const parts = buildDisplayParts(testTimestamp, undefined, "claude-3-opus");
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe("claude-3-opus");
  });

  test("includes all parts when all params provided", () => {
    const parts = buildDisplayParts(testTimestamp, 1500, "gpt-4");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    expect(parts[1]).toBe("1s");
    expect(parts[2]).toBe("gpt-4");
  });

  test("handles zero duration", () => {
    const parts = buildDisplayParts(testTimestamp, 0);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe("0ms");
  });

  test("handles millisecond durations", () => {
    const parts = buildDisplayParts(testTimestamp, 500);
    expect(parts[1]).toBe("500ms");
  });

  test("handles minute durations", () => {
    const parts = buildDisplayParts(testTimestamp, 90000);
    expect(parts[1]).toBe("1m 30s");
  });
});

// ============================================================================
// TIMESTAMP DISPLAY PROPS TESTS
// ============================================================================

describe("TimestampDisplayProps interface", () => {
  test("allows minimal props with only timestamp", () => {
    const props: TimestampDisplayProps = {
      timestamp: "2026-01-31T14:30:00.000Z",
    };
    expect(props.timestamp).toBeDefined();
    expect(props.durationMs).toBeUndefined();
    expect(props.modelId).toBeUndefined();
  });

  test("allows all optional props", () => {
    const props: TimestampDisplayProps = {
      timestamp: "2026-01-31T14:30:00.000Z",
      durationMs: 2500,
      modelId: "claude-3-opus",
    };
    expect(props.timestamp).toBeDefined();
    expect(props.durationMs).toBe(2500);
    expect(props.modelId).toBe("claude-3-opus");
  });

  test("allows durationMs without modelId", () => {
    const props: TimestampDisplayProps = {
      timestamp: "2026-01-31T14:30:00.000Z",
      durationMs: 1000,
    };
    expect(props.durationMs).toBe(1000);
    expect(props.modelId).toBeUndefined();
  });

  test("allows modelId without durationMs", () => {
    const props: TimestampDisplayProps = {
      timestamp: "2026-01-31T14:30:00.000Z",
      modelId: "gpt-4",
    };
    expect(props.durationMs).toBeUndefined();
    expect(props.modelId).toBe("gpt-4");
  });
});

// ============================================================================
// COMPONENT TESTS
// ============================================================================

describe("TimestampDisplay component", () => {
  test("is a function component", () => {
    expect(typeof TimestampDisplay).toBe("function");
  });

  test("component function exists and is exported", () => {
    expect(TimestampDisplay).toBeDefined();
    expect(typeof TimestampDisplay).toBe("function");
  });

  test("component name is TimestampDisplay", () => {
    expect(TimestampDisplay.name).toBe("TimestampDisplay");
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("TimestampDisplay integration", () => {
  test("works with various timestamp formats", () => {
    const timestamps = [
      "2026-01-31T00:00:00.000Z", // Midnight UTC
      "2026-01-31T12:00:00.000Z", // Noon UTC
      "2026-01-31T23:59:59.999Z", // End of day
    ];

    timestamps.forEach((ts) => {
      const parts = buildDisplayParts(ts);
      expect(parts.length).toBeGreaterThan(0);
      expect(parts[0]).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    });
  });

  test("combines all formatting utilities correctly", () => {
    const timestamp = "2026-01-31T14:30:00.000Z";
    const durationMs = 65000; // 1m 5s
    const modelId = "claude-3-sonnet";

    const parts = buildDisplayParts(timestamp, durationMs, modelId);
    const displayText = parts.join(" • ");

    expect(displayText).toContain("•");
    expect(displayText).toContain("1m 5s");
    expect(displayText).toContain("claude-3-sonnet");
  });

  test("handles edge case durations", () => {
    const timestamp = "2026-01-31T14:30:00.000Z";

    // Just under 1 second
    expect(buildDisplayParts(timestamp, 999)[1]).toBe("999ms");

    // Exactly 1 second
    expect(buildDisplayParts(timestamp, 1000)[1]).toBe("1s");

    // Just under 1 minute
    expect(buildDisplayParts(timestamp, 59999)[1]).toBe("59s");

    // Exactly 1 minute
    expect(buildDisplayParts(timestamp, 60000)[1]).toBe("1m");
  });
});
