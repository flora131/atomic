import { describe, expect, test } from "bun:test";
import { formatDuration, formatTimestamp, normalizeMarkdownNewlines, truncateText } from "./format";

describe("formatDuration", () => {
  test("formats milliseconds under 1 second", () => {
    expect(formatDuration(0)).toEqual({ text: "0ms", ms: 0 });
    expect(formatDuration(1)).toEqual({ text: "1ms", ms: 1 });
    expect(formatDuration(500)).toEqual({ text: "500ms", ms: 500 });
    expect(formatDuration(999)).toEqual({ text: "999ms", ms: 999 });
  });

  test("formats seconds (1000ms to 59999ms)", () => {
    expect(formatDuration(1000)).toEqual({ text: "1s", ms: 1000 });
    expect(formatDuration(2500)).toEqual({ text: "2s", ms: 2500 });
    expect(formatDuration(15000)).toEqual({ text: "15s", ms: 15000 });
    expect(formatDuration(59999)).toEqual({ text: "59s", ms: 59999 });
  });

  test("formats minutes without seconds", () => {
    expect(formatDuration(60000)).toEqual({ text: "1m", ms: 60000 });
    expect(formatDuration(120000)).toEqual({ text: "2m", ms: 120000 });
    expect(formatDuration(300000)).toEqual({ text: "5m", ms: 300000 });
  });

  test("formats minutes with seconds", () => {
    expect(formatDuration(61000)).toEqual({ text: "1m 1s", ms: 61000 });
    expect(formatDuration(90000)).toEqual({ text: "1m 30s", ms: 90000 });
    expect(formatDuration(125000)).toEqual({ text: "2m 5s", ms: 125000 });
    expect(formatDuration(3599000)).toEqual({ text: "59m 59s", ms: 3599000 });
  });

  test("handles negative values as zero", () => {
    expect(formatDuration(-1)).toEqual({ text: "0ms", ms: 0 });
    expect(formatDuration(-1000)).toEqual({ text: "0ms", ms: 0 });
    expect(formatDuration(-99999)).toEqual({ text: "0ms", ms: 0 });
  });

  test("handles boundary values", () => {
    // Just under 1 second
    expect(formatDuration(999)).toEqual({ text: "999ms", ms: 999 });
    // Exactly 1 second
    expect(formatDuration(1000)).toEqual({ text: "1s", ms: 1000 });
    // Just under 1 minute
    expect(formatDuration(59999)).toEqual({ text: "59s", ms: 59999 });
    // Exactly 1 minute
    expect(formatDuration(60000)).toEqual({ text: "1m", ms: 60000 });
  });
});

describe("formatTimestamp", () => {
  test("formats midnight (12:00 AM)", () => {
    const date = new Date("2026-01-31T00:00:00");
    const result = formatTimestamp(date);
    expect(result.text).toBe("12:00 AM");
    expect(result.date).toEqual(date);
  });

  test("formats noon (12:00 PM)", () => {
    const date = new Date("2026-01-31T12:00:00");
    const result = formatTimestamp(date);
    expect(result.text).toBe("12:00 PM");
    expect(result.date).toEqual(date);
  });

  test("formats morning times", () => {
    expect(formatTimestamp(new Date("2026-01-31T01:00:00")).text).toBe("1:00 AM");
    expect(formatTimestamp(new Date("2026-01-31T09:05:00")).text).toBe("9:05 AM");
    expect(formatTimestamp(new Date("2026-01-31T11:59:00")).text).toBe("11:59 AM");
  });

  test("formats afternoon/evening times", () => {
    expect(formatTimestamp(new Date("2026-01-31T13:00:00")).text).toBe("1:00 PM");
    expect(formatTimestamp(new Date("2026-01-31T14:30:00")).text).toBe("2:30 PM");
    expect(formatTimestamp(new Date("2026-01-31T23:59:00")).text).toBe("11:59 PM");
  });

  test("pads single-digit minutes with zero", () => {
    expect(formatTimestamp(new Date("2026-01-31T09:05:00")).text).toBe("9:05 AM");
    expect(formatTimestamp(new Date("2026-01-31T14:01:00")).text).toBe("2:01 PM");
    expect(formatTimestamp(new Date("2026-01-31T00:00:00")).text).toBe("12:00 AM");
  });

  test("accepts ISO timestamp string", () => {
    const result = formatTimestamp("2026-01-31T14:30:00");
    expect(result.text).toBe("2:30 PM");
  });

  test("handles invalid dates gracefully", () => {
    const result = formatTimestamp("invalid-date");
    expect(result.text).toBe("--:-- --");
    expect(result.date).toBeInstanceOf(Date);
  });

  test("handles invalid Date objects", () => {
    const invalidDate = new Date("not a date");
    const result = formatTimestamp(invalidDate);
    expect(result.text).toBe("--:-- --");
  });
});

describe("normalizeMarkdownNewlines", () => {
  test("preserves markdown list newlines", () => {
    const content = "\n- first item\n- second item\n- third item\n";

    expect(normalizeMarkdownNewlines(content)).toBe("- first item\n- second item\n- third item");
  });

  test("preserves single newlines inside paragraphs", () => {
    const content = "Line one\nLine two\nLine three";

    expect(normalizeMarkdownNewlines(content)).toBe("Line one\nLine two\nLine three");
  });

  test("trims outer whitespace while keeping internal blank lines", () => {
    const content = "\n\nParagraph one\n\nParagraph two\n\n";

    expect(normalizeMarkdownNewlines(content)).toBe("Paragraph one\n\nParagraph two");
  });

  test("normalizes Windows-style line endings", () => {
    const content = "\r\nline one\r\nline two\r\n";

    expect(normalizeMarkdownNewlines(content)).toBe("line one\nline two");
  });
});

describe("truncateText", () => {
  test("returns original text if under max length", () => {
    expect(truncateText("Hello", 10)).toBe("Hello");
    expect(truncateText("Short", 10)).toBe("Short");
    expect(truncateText("Exact", 5)).toBe("Exact");
  });

  test("truncates text exceeding max length with ellipsis", () => {
    expect(truncateText("Hello World", 8)).toBe("Hello...");
    expect(truncateText("This is a long text", 10)).toBe("This is...");
  });

  test("uses default max length of 40", () => {
    const longText = "This is a very long text that exceeds forty characters easily";
    const result = truncateText(longText);
    expect(result.length).toBe(40);
    expect(result.endsWith("...")).toBe(true);
  });

  test("handles empty strings", () => {
    expect(truncateText("", 10)).toBe("");
    expect(truncateText("")).toBe("");
  });

  test("handles exactly max length text", () => {
    expect(truncateText("12345", 5)).toBe("12345");
    expect(truncateText("1234567890", 10)).toBe("1234567890");
  });

  test("handles very short max length", () => {
    expect(truncateText("Hello", 3)).toBe("...");
    expect(truncateText("Hi", 3)).toBe("Hi");
  });

  test("preserves meaningful content before ellipsis", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const result = truncateText(text, 20);
    expect(result).toBe("The quick brown f...");
    expect(result.length).toBe(20);
  });
});
