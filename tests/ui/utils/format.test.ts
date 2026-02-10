/**
 * Tests for Format Utilities
 *
 * Tests cover:
 * - formatDuration: milliseconds, seconds, minutes formatting
 * - formatTimestamp: 12-hour format with AM/PM
 * - Edge cases and boundary conditions
 */

import { describe, test, expect } from "bun:test";
import {
  formatDuration,
  formatTimestamp,
  type FormattedDuration,
  type FormattedTimestamp,
} from "../../../src/ui/utils/format.ts";

// ============================================================================
// FORMAT DURATION TESTS
// ============================================================================

describe("formatDuration", () => {
  describe("milliseconds range (0-999ms)", () => {
    test("formats 0ms", () => {
      const result = formatDuration(0);
      expect(result.text).toBe("0ms");
      expect(result.ms).toBe(0);
    });

    test("formats 1ms", () => {
      const result = formatDuration(1);
      expect(result.text).toBe("1ms");
      expect(result.ms).toBe(1);
    });

    test("formats 500ms", () => {
      const result = formatDuration(500);
      expect(result.text).toBe("500ms");
      expect(result.ms).toBe(500);
    });

    test("formats 999ms", () => {
      const result = formatDuration(999);
      expect(result.text).toBe("999ms");
      expect(result.ms).toBe(999);
    });

    test("rounds fractional milliseconds", () => {
      const result = formatDuration(500.7);
      expect(result.text).toBe("501ms");
    });

    test("rounds down fractional milliseconds", () => {
      const result = formatDuration(500.3);
      expect(result.text).toBe("500ms");
    });
  });

  describe("seconds range (1000-59999ms)", () => {
    test("formats exactly 1000ms as 1s", () => {
      const result = formatDuration(1000);
      expect(result.text).toBe("1s");
      expect(result.ms).toBe(1000);
    });

    test("formats 1500ms as 1s (floors to whole seconds)", () => {
      const result = formatDuration(1500);
      expect(result.text).toBe("1s");
    });

    test("formats 2500ms as 2s (floors to whole seconds)", () => {
      const result = formatDuration(2500);
      expect(result.text).toBe("2s");
    });

    test("formats 5000ms as 5s", () => {
      const result = formatDuration(5000);
      expect(result.text).toBe("5s");
    });

    test("formats 9900ms as 9s (floors to whole seconds)", () => {
      const result = formatDuration(9900);
      expect(result.text).toBe("9s");
    });

    test("formats 10000ms as 10s", () => {
      const result = formatDuration(10000);
      expect(result.text).toBe("10s");
    });

    test("formats 15500ms as 15s (floors to whole seconds)", () => {
      const result = formatDuration(15500);
      expect(result.text).toBe("15s");
    });

    test("formats 30000ms as 30s", () => {
      const result = formatDuration(30000);
      expect(result.text).toBe("30s");
    });

    test("formats 59999ms as 59s (floors to whole seconds)", () => {
      const result = formatDuration(59999);
      expect(result.text).toBe("59s");
    });
  });

  describe("minutes range (60000ms+)", () => {
    test("formats exactly 60000ms as 1m", () => {
      const result = formatDuration(60000);
      expect(result.text).toBe("1m");
      expect(result.ms).toBe(60000);
    });

    test("formats 90000ms as 1m 30s", () => {
      const result = formatDuration(90000);
      expect(result.text).toBe("1m 30s");
    });

    test("formats 120000ms as 2m", () => {
      const result = formatDuration(120000);
      expect(result.text).toBe("2m");
    });

    test("formats 125000ms as 2m 5s", () => {
      const result = formatDuration(125000);
      expect(result.text).toBe("2m 5s");
    });

    test("formats 300000ms as 5m", () => {
      const result = formatDuration(300000);
      expect(result.text).toBe("5m");
    });

    test("formats 3600000ms as 60m (1 hour)", () => {
      const result = formatDuration(3600000);
      expect(result.text).toBe("60m");
    });

    test("formats 3661000ms as 61m 1s", () => {
      const result = formatDuration(3661000);
      expect(result.text).toBe("61m 1s");
    });
  });

  describe("edge cases", () => {
    test("handles negative values as 0ms", () => {
      const result = formatDuration(-100);
      expect(result.text).toBe("0ms");
      expect(result.ms).toBe(0);
    });

    test("handles very large values", () => {
      const result = formatDuration(86400000); // 24 hours
      expect(result.text).toBe("1440m");
    });

    test("preserves original ms value in result", () => {
      const ms = 12345;
      const result = formatDuration(ms);
      expect(result.ms).toBe(ms);
    });
  });

  describe("FormattedDuration interface", () => {
    test("has required text field", () => {
      const result: FormattedDuration = formatDuration(1000);
      expect(typeof result.text).toBe("string");
    });

    test("has required ms field", () => {
      const result: FormattedDuration = formatDuration(1000);
      expect(typeof result.ms).toBe("number");
    });
  });
});

// ============================================================================
// FORMAT TIMESTAMP TESTS
// ============================================================================

describe("formatTimestamp", () => {
  describe("AM times", () => {
    test("formats 12:00 AM (midnight)", () => {
      const date = new Date("2026-01-31T00:00:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("12:00 AM");
    });

    test("formats 12:30 AM", () => {
      const date = new Date("2026-01-31T00:30:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("12:30 AM");
    });

    test("formats 1:00 AM", () => {
      const date = new Date("2026-01-31T01:00:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("1:00 AM");
    });

    test("formats 9:05 AM with leading zero for minutes", () => {
      const date = new Date("2026-01-31T09:05:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("9:05 AM");
    });

    test("formats 11:59 AM", () => {
      const date = new Date("2026-01-31T11:59:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("11:59 AM");
    });
  });

  describe("PM times", () => {
    test("formats 12:00 PM (noon)", () => {
      const date = new Date("2026-01-31T12:00:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("12:00 PM");
    });

    test("formats 12:30 PM", () => {
      const date = new Date("2026-01-31T12:30:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("12:30 PM");
    });

    test("formats 1:00 PM", () => {
      const date = new Date("2026-01-31T13:00:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("1:00 PM");
    });

    test("formats 2:30 PM", () => {
      const date = new Date("2026-01-31T14:30:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("2:30 PM");
    });

    test("formats 11:59 PM", () => {
      const date = new Date("2026-01-31T23:59:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("11:59 PM");
    });
  });

  describe("string input", () => {
    test("accepts ISO timestamp string", () => {
      const result = formatTimestamp("2026-01-31T14:30:00");
      expect(result.text).toBe("2:30 PM");
    });

    test("accepts ISO timestamp with timezone", () => {
      const result = formatTimestamp("2026-01-31T14:30:00.000Z");
      expect(result.text).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    });

    test("handles invalid date string", () => {
      const result = formatTimestamp("invalid-date");
      expect(result.text).toBe("--:-- --");
    });
  });

  describe("edge cases", () => {
    test("pads single-digit minutes with zero", () => {
      const date = new Date("2026-01-31T10:05:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("10:05 AM");
    });

    test("pads :00 minutes", () => {
      const date = new Date("2026-01-31T10:00:00");
      const result = formatTimestamp(date);
      expect(result.text).toBe("10:00 AM");
    });

    test("handles invalid Date object", () => {
      const date = new Date("invalid");
      const result = formatTimestamp(date);
      expect(result.text).toBe("--:-- --");
    });

    test("preserves original Date in result", () => {
      const date = new Date("2026-01-31T14:30:00");
      const result = formatTimestamp(date);
      expect(result.date.getTime()).toBe(date.getTime());
    });

    test("converts string to Date in result", () => {
      const dateStr = "2026-01-31T14:30:00";
      const result = formatTimestamp(dateStr);
      expect(result.date instanceof Date).toBe(true);
      expect(result.date.toISOString()).toContain("2026-01-31");
    });
  });

  describe("FormattedTimestamp interface", () => {
    test("has required text field", () => {
      const result: FormattedTimestamp = formatTimestamp(new Date());
      expect(typeof result.text).toBe("string");
    });

    test("has required date field", () => {
      const result: FormattedTimestamp = formatTimestamp(new Date());
      expect(result.date instanceof Date).toBe(true);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("format utilities integration", () => {
  test("formatDuration and formatTimestamp work together", () => {
    const duration = formatDuration(5000);
    const timestamp = formatTimestamp(new Date());

    expect(duration.text).toBeDefined();
    expect(timestamp.text).toBeDefined();
  });

  test("both return structured objects", () => {
    const duration = formatDuration(1500);
    const timestamp = formatTimestamp(new Date());

    // Both have text property
    expect(typeof duration.text).toBe("string");
    expect(typeof timestamp.text).toBe("string");

    // Both have their specific metadata
    expect(typeof duration.ms).toBe("number");
    expect(timestamp.date instanceof Date).toBe(true);
  });
});
