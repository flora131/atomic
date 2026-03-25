import { describe, expect, test } from "bun:test";
import {
  truncateStageOutput,
  type TruncationResult,
} from "@/services/workflows/conductor/truncate.ts";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Get the UTF-8 byte length of a string. */
function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

// ---------------------------------------------------------------------------
// No-op cases (truncation disabled or not needed)
// ---------------------------------------------------------------------------

describe("truncateStageOutput", () => {
  describe("no-op cases", () => {
    test("returns original text when response fits within limit", () => {
      const response = "Hello, world!";
      const result = truncateStageOutput(response, 1000);

      expect(result.text).toBe(response);
      expect(result.truncated).toBe(false);
      expect(result.originalByteLength).toBeUndefined();
    });

    test("returns original text when response exactly equals limit", () => {
      const response = "abcde"; // 5 bytes in UTF-8
      const result = truncateStageOutput(response, 5);

      expect(result.text).toBe(response);
      expect(result.truncated).toBe(false);
    });

    test("returns original text when maxBytes is 0 (disabled)", () => {
      const response = "This should not be truncated";
      const result = truncateStageOutput(response, 0);

      expect(result.text).toBe(response);
      expect(result.truncated).toBe(false);
    });

    test("returns original text when maxBytes is negative (disabled)", () => {
      const response = "This should not be truncated";
      const result = truncateStageOutput(response, -100);

      expect(result.text).toBe(response);
      expect(result.truncated).toBe(false);
    });

    test("returns original text when maxBytes is Infinity (disabled)", () => {
      const response = "This should not be truncated";
      const result = truncateStageOutput(response, Infinity);

      expect(result.text).toBe(response);
      expect(result.truncated).toBe(false);
    });

    test("handles empty string input", () => {
      const result = truncateStageOutput("", 100);

      expect(result.text).toBe("");
      expect(result.truncated).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Basic truncation
  // ---------------------------------------------------------------------------

  describe("basic truncation", () => {
    test("truncates response exceeding byte limit", () => {
      const response = "a".repeat(1000);
      const result = truncateStageOutput(response, 200);

      expect(result.truncated).toBe(true);
      expect(result.originalByteLength).toBe(1000);
      expect(byteLength(result.text)).toBeLessThanOrEqual(200);
      expect(result.text).toContain("[truncated:");
    });

    test("truncation notice includes original and limit byte counts", () => {
      const response = "x".repeat(500);
      const result = truncateStageOutput(response, 100);

      expect(result.truncated).toBe(true);
      expect(result.text).toContain("500 bytes");
      expect(result.text).toContain("100 bytes");
    });

    test("truncated output preserves the beginning of the response", () => {
      const response = "START_MARKER " + "x".repeat(1000) + " END_MARKER";
      const result = truncateStageOutput(response, 200);

      expect(result.truncated).toBe(true);
      expect(result.text).toContain("START_MARKER");
      expect(result.text).not.toContain("END_MARKER");
    });

    test("truncated output ends with truncation notice", () => {
      const response = "a".repeat(500);
      const result = truncateStageOutput(response, 100);

      expect(result.text).toMatch(/\[truncated: output was \d+ bytes, limited to \d+ bytes\]$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-byte character handling
  // ---------------------------------------------------------------------------

  describe("multi-byte character handling", () => {
    test("handles multi-byte UTF-8 characters without splitting them", () => {
      // Each emoji is 4 bytes in UTF-8
      const response = "😀😁😂🤣😃😄😅😆😉😊";
      const originalBytes = byteLength(response);
      expect(originalBytes).toBe(40); // 10 emojis × 4 bytes

      const result = truncateStageOutput(response, 60);

      expect(result.truncated).toBe(false);
      expect(result.text).toBe(response);
    });

    test("truncates multi-byte characters at valid boundary", () => {
      // 20 emojis = 80 bytes
      const response = "😀".repeat(20);
      const result = truncateStageOutput(response, 70);

      expect(result.truncated).toBe(true);
      // The truncated text should contain valid UTF-8 (no broken surrogates)
      // Verify by re-encoding — if it were broken, encode/decode would differ
      const reEncoded = new TextDecoder().decode(new TextEncoder().encode(result.text));
      expect(reEncoded).toBe(result.text);
    });

    test("handles mixed ASCII and multi-byte characters", () => {
      const response = "Hello 世界! " + "x".repeat(1000);
      const result = truncateStageOutput(response, 100);

      expect(result.truncated).toBe(true);
      // "Hello 世界! " should be preserved (it's only ~15 bytes)
      expect(result.text).toContain("Hello 世界!");
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    test("handles very small limit where only notice fits", () => {
      const response = "a".repeat(100);
      // The truncation notice itself is ~60-70 bytes, so a limit of 80
      // should still produce a valid output
      const result = truncateStageOutput(response, 80);

      expect(result.truncated).toBe(true);
      expect(result.text).toContain("[truncated:");
      expect(byteLength(result.text)).toBeLessThanOrEqual(80);
    });

    test("handles limit of 1 byte gracefully", () => {
      const response = "Hello, world!";
      const result = truncateStageOutput(response, 1);

      expect(result.truncated).toBe(true);
      // With such a tiny limit the notice alone exceeds it, but the function
      // should still return a valid (if oversized) truncation notice
      expect(result.text).toContain("[truncated:");
    });

    test("handles NaN as disabled", () => {
      const response = "test";
      const result = truncateStageOutput(response, NaN);

      expect(result.text).toBe(response);
      expect(result.truncated).toBe(false);
    });

    test("preserves newlines in the kept portion", () => {
      const response = "Line 1\nLine 2\nLine 3\n" + "x".repeat(1000);
      const result = truncateStageOutput(response, 200);

      expect(result.truncated).toBe(true);
      expect(result.text).toContain("Line 1\nLine 2\nLine 3\n");
    });
  });

  // ---------------------------------------------------------------------------
  // TruncationResult contract
  // ---------------------------------------------------------------------------

  describe("surrogate pair handling", () => {
    test("does not split surrogate pairs when truncating", () => {
      // Create a string with surrogate pairs (emoji) followed by filler
      // Each emoji like "𝄞" (U+1D11E Musical Symbol G Clef) is a surrogate pair in UTF-16
      const surrogateChar = "\uD834\uDD1E"; // 𝄞 — 4 bytes in UTF-8
      const response = surrogateChar.repeat(10) + "x".repeat(1000);
      const result = truncateStageOutput(response, 100);

      expect(result.truncated).toBe(true);
      // Re-encode to verify no broken surrogates
      const reEncoded = new TextDecoder().decode(new TextEncoder().encode(result.text));
      expect(reEncoded).toBe(result.text);
    });

    test("handles string composed entirely of 4-byte emoji", () => {
      const response = "🎉🎊🎈🎁🎂🎃🎄🎅🎆🎇"; // 10 emoji, 40 bytes
      const result = truncateStageOutput(response, 100);

      expect(result.truncated).toBe(false);
      expect(result.text).toBe(response);
    });

    test("handles 2-byte characters (accented) at truncation boundary", () => {
      // "é" is U+00E9, 2 bytes in UTF-8
      const response = "é".repeat(100); // 200 bytes
      const result = truncateStageOutput(response, 100);

      expect(result.truncated).toBe(true);
      // Verify the result is valid UTF-8
      const reEncoded = new TextDecoder().decode(new TextEncoder().encode(result.text));
      expect(reEncoded).toBe(result.text);
    });

    test("handles 3-byte CJK characters at truncation boundary", () => {
      // "中" is U+4E2D, 3 bytes in UTF-8
      const response = "中".repeat(100); // 300 bytes
      const result = truncateStageOutput(response, 100);

      expect(result.truncated).toBe(true);
      const reEncoded = new TextDecoder().decode(new TextEncoder().encode(result.text));
      expect(reEncoded).toBe(result.text);
    });
  });

  describe("TruncationResult contract", () => {
    test("non-truncated result has text, truncated=false, no originalByteLength", () => {
      const result = truncateStageOutput("short", 1000);

      expect(result).toEqual({
        text: "short",
        truncated: false,
      });
      expect("originalByteLength" in result).toBe(false);
    });

    test("truncated result has text, truncated=true, and originalByteLength", () => {
      const response = "x".repeat(500);
      const result = truncateStageOutput(response, 100);

      expect(result.truncated).toBe(true);
      expect(result.originalByteLength).toBe(500);
      expect(typeof result.text).toBe("string");
      expect(result.text.length).toBeGreaterThan(0);
    });
  });
});
