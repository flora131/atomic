/**
 * Tests for SDK types utility functions: stripProviderPrefix and formatModelDisplayName
 */
import { describe, expect, test } from "bun:test";
import { stripProviderPrefix, formatModelDisplayName } from "./types.ts";

describe("stripProviderPrefix", () => {
  test("removes a single provider prefix from model ID", () => {
    expect(stripProviderPrefix("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
  });

  test("removes provider prefix from copilot-style model ID", () => {
    expect(stripProviderPrefix("github-copilot/gpt-5.2")).toBe("gpt-5.2");
  });

  test("returns the original string when no slash is present", () => {
    expect(stripProviderPrefix("opus")).toBe("opus");
  });

  test("preserves content after the first slash when multiple slashes exist", () => {
    expect(stripProviderPrefix("provider/org/model-name")).toBe("org/model-name");
  });

  test("handles deeply nested slashes", () => {
    expect(stripProviderPrefix("a/b/c/d/e")).toBe("b/c/d/e");
  });

  test("returns empty string when input is a single trailing slash", () => {
    expect(stripProviderPrefix("provider/")).toBe("");
  });

  test("returns the part after the leading slash when input starts with slash", () => {
    expect(stripProviderPrefix("/model-name")).toBe("model-name");
  });

  test("handles empty string input", () => {
    expect(stripProviderPrefix("")).toBe("");
  });

  test("handles model ID with special characters after prefix", () => {
    expect(stripProviderPrefix("provider/model-v2.1-beta+rc1")).toBe("model-v2.1-beta+rc1");
  });

  test("handles prefix with special characters", () => {
    expect(stripProviderPrefix("my-provider_v2/some-model")).toBe("some-model");
  });
});

describe("formatModelDisplayName", () => {
  test("returns empty string for empty input", () => {
    expect(formatModelDisplayName("")).toBe("");
  });

  test("strips provider prefix from a prefixed model ID", () => {
    expect(formatModelDisplayName("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
  });

  test("returns model ID unchanged when no prefix exists", () => {
    expect(formatModelDisplayName("opus")).toBe("opus");
  });

  test("preserves nested path after stripping first segment", () => {
    expect(formatModelDisplayName("provider/org/model")).toBe("org/model");
  });

  test("handles model ID with only a provider and trailing slash", () => {
    expect(formatModelDisplayName("provider/")).toBe("");
  });

  test("handles realistic copilot model ID", () => {
    expect(formatModelDisplayName("github-copilot/gpt-4o-2024-05-13")).toBe("gpt-4o-2024-05-13");
  });

  test("handles model ID starting with a slash", () => {
    expect(formatModelDisplayName("/claude-opus-4")).toBe("claude-opus-4");
  });

  test("handles model ID with version numbers and dots", () => {
    expect(formatModelDisplayName("openai/gpt-4.5-turbo")).toBe("gpt-4.5-turbo");
  });
});
