import { describe, expect, test } from "bun:test";
import {
  MAIN_CHAT_TOOL_PREVIEW_LIMITS,
  TASK_TOOL_PREVIEW_MAX_LINES,
  getMainChatToolMaxLines,
  truncateToolHeader,
  truncateToolLines,
  truncateToolText,
} from "./tool-preview-truncation.ts";

describe("truncateToolText", () => {
  test("does not modify short text", () => {
    expect(truncateToolText("short", 20)).toBe("short");
  });

  test("truncates long text with count marker", () => {
    const text = "a".repeat(200);
    const truncated = truncateToolText(text, 80);
    expect(truncated.length).toBeLessThanOrEqual(80);
    expect(truncated).toContain("chars truncated");
  });
});

describe("truncateToolHeader", () => {
  test("delegates to text truncation rules", () => {
    const header = "x".repeat(220);
    const truncated = truncateToolHeader(header, 100);
    expect(truncated.length).toBeLessThanOrEqual(100);
    expect(truncated).toContain("chars truncated");
  });
});

describe("truncateToolLines", () => {
  test("truncates lines by char length and by line count", () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      i === 2 ? "y".repeat(400) : `line ${i + 1}`
    );

    const result = truncateToolLines(lines, { maxLines: 10, maxLineChars: 120 });
    expect(result.wasTruncated).toBe(true);
    expect(result.truncatedByCharCount).toBe(1);
    expect(result.truncatedLineCount).toBe(20);
    expect(result.lines.length).toBe(11);
    expect(result.lines.at(-1)).toBe("… truncated 20 lines");
    expect(result.lines[2]).toContain("chars truncated");
  });

  test("keeps lines unchanged when under limits", () => {
    const lines = ["line 1", "line 2"];
    const result = truncateToolLines(lines, {
      maxLines: MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLines,
      maxLineChars: MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLineChars,
    });
    expect(result.wasTruncated).toBe(false);
    expect(result.lines).toEqual(lines);
  });
});

describe("getMainChatToolMaxLines", () => {
  test("uses stricter cap for Task tool", () => {
    expect(getMainChatToolMaxLines("Task")).toBe(TASK_TOOL_PREVIEW_MAX_LINES);
    expect(getMainChatToolMaxLines("task")).toBe(TASK_TOOL_PREVIEW_MAX_LINES);
  });

  test("uses default cap for non-Task tools", () => {
    expect(getMainChatToolMaxLines("Bash")).toBe(MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLines);
  });
});
