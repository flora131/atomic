import { describe, expect, test } from "bun:test";
import { formatDuration, formatTimestamp, joinThinkingBlocks, normalizeMarkdownNewlines, truncateText, truncateDescription, collapseNewlines } from "@/lib/ui/format.ts";

describe("formatDuration", () => {
  test("formats sub-second values as seconds", () => {
    expect(formatDuration(0)).toEqual({ text: "0s", ms: 0 });
    expect(formatDuration(1)).toEqual({ text: "1s", ms: 1 });
    expect(formatDuration(500)).toEqual({ text: "1s", ms: 500 });
    expect(formatDuration(999)).toEqual({ text: "1s", ms: 999 });
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
    expect(formatDuration(-1)).toEqual({ text: "0s", ms: 0 });
    expect(formatDuration(-1000)).toEqual({ text: "0s", ms: 0 });
    expect(formatDuration(-99999)).toEqual({ text: "0s", ms: 0 });
  });

  test("handles boundary values", () => {
    // Just under 1 second
    expect(formatDuration(999)).toEqual({ text: "1s", ms: 999 });
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

  test("converts markdown task checkboxes to unicode bullets", () => {
    const content = "- [ ] pending task\n- [x] done task\n- [X] also done";

    expect(normalizeMarkdownNewlines(content)).toBe("- ☐ pending task\n- ☑ done task\n- ☑ also done");
  });

  test("converts ordered list task checkboxes to unicode bullets", () => {
    const content = "1. [ ] first\n2. [x] second";

    expect(normalizeMarkdownNewlines(content)).toBe("1. ☐ first\n2. ☑ second");
  });
});

describe("joinThinkingBlocks", () => {
  test("inserts a blank line between distinct thinking blocks", () => {
    expect(joinThinkingBlocks([
      "**Exploring code review options**\nAlright, first pass.",
      "**Choosing the code-review agent**\nSecond pass.",
    ])).toBe(
      "**Exploring code review options**\nAlright, first pass.\n\n**Choosing the code-review agent**\nSecond pass.",
    );
  });

  test("preserves existing blank-line separation", () => {
    expect(joinThinkingBlocks([
      "First block\n\n",
      "Second block",
    ])).toBe("First block\n\nSecond block");
  });

  test("skips empty thinking blocks", () => {
    expect(joinThinkingBlocks([
      "",
      "  ",
      "Useful block",
    ])).toBe("Useful block");
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

describe("truncateDescription", () => {
  test("returns full name and truncated description when space is available", () => {
    const result = truncateDescription("myAgent", "A description that is fairly long for truncation", 40);
    expect(result.name).toBe("myAgent");
    expect(result.description.length).toBeLessThanOrEqual(29);
    expect(result.description.endsWith("...")).toBe(true);
  });

  test("returns full name and full description when both fit", () => {
    const result = truncateDescription("ag", "Hi", 40);
    expect(result.name).toBe("ag");
    expect(result.description).toBe("Hi");
  });

  test("truncates name when it exceeds available space", () => {
    const longName = "a".repeat(100);
    const result = truncateDescription(longName, "desc", 40);
    // Name should be truncated to cols - DESCRIPTION_PREFIX_PADDING = 36
    expect(result.name.length).toBe(36);
    expect(result.name.endsWith("...")).toBe(true);
    expect(result.description).toBe("");
  });

  test("returns description when name leaves zero remaining space", () => {
    // cols=20, padding=4, so maxNameLength=16; name of length 16 fits but available=0
    const result = truncateDescription("a".repeat(16), "desc", 20);
    expect(result.name).toBe("a".repeat(16));
  });

  test("truncates name when name exceeds terminal width minus padding", () => {
    // cols=20, padding=4, so maxNameLength=16; name of length 17 should be truncated
    const result = truncateDescription("a".repeat(17), "desc", 20);
    expect(result.name.length).toBe(16);
    expect(result.name.endsWith("...")).toBe(true);
    expect(result.description).toBe("");
  });

  test("returns empty name for extremely narrow terminals", () => {
    // cols=3, padding=4, maxNameLength=-1 which is < 3
    const result = truncateDescription("agent", "desc", 3);
    expect(result.name).toBe("");
    expect(result.description).toBe("");
  });

  test("normalizes newlines in description", () => {
    const result = truncateDescription("ag", "line1\nline2\nline3", 80);
    expect(result.description).toBe("line1 line2 line3");
  });
});

describe("collapseNewlines", () => {
  test("returns text unchanged when no newlines present", () => {
    expect(collapseNewlines("hello world")).toBe("hello world");
  });

  test("replaces single newlines with spaces", () => {
    expect(collapseNewlines("hello\nworld")).toBe("hello world");
    expect(collapseNewlines("a\nb\nc")).toBe("a b c");
  });

  test("truncates at double newline with ellipsis", () => {
    expect(collapseNewlines("first paragraph\n\nsecond paragraph")).toBe("first paragraph...");
  });

  test("truncates at double newline before replacing remaining single newlines", () => {
    expect(collapseNewlines("line one\nline two\n\nline three\nline four")).toBe("line one line two...");
  });

  test("handles text starting with double newline", () => {
    expect(collapseNewlines("\n\nafter")).toBe("...");
  });

  test("handles empty string", () => {
    expect(collapseNewlines("")).toBe("");
  });

  test("handles triple+ newlines as double newline truncation", () => {
    expect(collapseNewlines("before\n\n\nafter")).toBe("before...");
  });
});
