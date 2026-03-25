/**
 * Tests for src/services/agents/tools/truncate.ts
 *
 * Output truncation for tool results:
 * - Line-count truncation at 2000 lines
 * - Byte-size truncation at 50KB
 * - Multibyte character safety
 */

import { describe, test, expect } from "bun:test";
import { truncateToolOutput } from "@/services/agents/tools/truncate.ts";

const MAX_OUTPUT_LINES = 2000;
const MAX_OUTPUT_BYTES = 50_000;

// --- Pass-through cases ---

describe("truncateToolOutput – pass-through", () => {
  test("returns empty string unchanged", () => {
    expect(truncateToolOutput("")).toBe("");
  });

  test("returns single line unchanged", () => {
    expect(truncateToolOutput("hello world")).toBe("hello world");
  });

  test("returns output below both limits unchanged", () => {
    const output = "line\n".repeat(100);
    expect(truncateToolOutput(output)).toBe(output);
  });
});

// --- Line-count truncation ---

describe("truncateToolOutput – line truncation", () => {
  test("does not truncate output at exactly 2000 lines", () => {
    const lines = Array.from({ length: MAX_OUTPUT_LINES }, (_, i) => `line ${i}`);
    const output = lines.join("\n");
    expect(truncateToolOutput(output)).toBe(output);
  });

  test("truncates output exceeding 2000 lines", () => {
    const totalLines = MAX_OUTPUT_LINES + 500;
    const lines = Array.from({ length: totalLines }, (_, i) => `line ${i}`);
    const output = lines.join("\n");

    const result = truncateToolOutput(output);

    // Should contain the truncation notice
    expect(result).toContain("[truncated: 500 lines omitted]");

    // Should keep exactly the first 2000 lines
    const resultLines = result.split("\n");
    expect(resultLines[0]).toBe("line 0");
    expect(resultLines[MAX_OUTPUT_LINES - 1]).toBe(`line ${MAX_OUTPUT_LINES - 1}`);
  });

  test("truncation notice shows correct omitted line count", () => {
    const totalLines = MAX_OUTPUT_LINES + 42;
    const lines = Array.from({ length: totalLines }, (_, i) => `L${i}`);
    const output = lines.join("\n");

    const result = truncateToolOutput(output);
    expect(result).toContain("[truncated: 42 lines omitted]");
  });
});

// --- Byte-size truncation ---

describe("truncateToolOutput – byte truncation", () => {
  test("truncates output exceeding 50KB (within line limit)", () => {
    // Create a long single line that exceeds 50KB
    const longLine = "x".repeat(MAX_OUTPUT_BYTES + 1000);
    const result = truncateToolOutput(longLine);

    expect(result).toContain(`[truncated: output exceeded ${MAX_OUTPUT_BYTES} bytes]`);
    // The kept portion should be at most MAX_OUTPUT_BYTES
    const keptPart = result.split("\n\n[truncated:")[0]!;
    const keptBytes = new TextEncoder().encode(keptPart).length;
    expect(keptBytes).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  });

  test("does not truncate output at exactly 50KB", () => {
    // Create output of exactly 50KB in ASCII (1 byte per char)
    const output = "a".repeat(MAX_OUTPUT_BYTES);
    expect(truncateToolOutput(output)).toBe(output);
  });

  test("handles multibyte UTF-8 characters without splitting them", () => {
    // Each emoji is 4 bytes in UTF-8. Fill with emoji to exceed the limit.
    const emoji = "🔥";
    const emojiBytes = new TextEncoder().encode(emoji).length; // 4 bytes
    const count = Math.ceil((MAX_OUTPUT_BYTES + 100) / emojiBytes);
    const output = emoji.repeat(count);

    const result = truncateToolOutput(output);

    expect(result).toContain(`[truncated: output exceeded ${MAX_OUTPUT_BYTES} bytes]`);

    // The kept portion must not contain broken surrogate pairs
    const keptPart = result.split("\n\n[truncated:")[0]!;
    // Every character in the kept part should be a valid emoji
    for (const char of keptPart) {
      expect(char).toBe("🔥");
    }
  });
});

// --- Line truncation takes priority over byte truncation ---

describe("truncateToolOutput – priority", () => {
  test("line truncation applies before byte truncation", () => {
    // Create 3000 lines each 50 bytes long (way over 50KB in total, but also over line limit)
    const totalLines = MAX_OUTPUT_LINES + 1000;
    const lines = Array.from({ length: totalLines }, () => "x".repeat(50));
    const output = lines.join("\n");

    const result = truncateToolOutput(output);

    // Should show line truncation message, not byte truncation
    expect(result).toContain("lines omitted]");
    expect(result).not.toContain("output exceeded");
  });
});
