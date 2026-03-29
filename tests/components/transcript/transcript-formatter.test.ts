import { test, describe, expect } from "bun:test";
import {
  transcriptLine,
  getThinkingBlocks,
} from "@/components/transcript/helpers.ts";
import {
  formatToolTitle,
  formatToolInput,
} from "@/components/transcript/tool-formatters.ts";

// =============================================================================
// transcriptLine
// =============================================================================

describe("transcriptLine", () => {
  test("creates a line with correct type, content, and indent", () => {
    const line = transcriptLine("tool-header", "Read file.ts", 2);
    expect(line).toEqual({ type: "tool-header", content: "Read file.ts", indent: 2 });
  });

  test("defaults indent to 0", () => {
    const line = transcriptLine("separator", "---");
    expect(line.indent).toBe(0);
  });

  test("respects provided indent", () => {
    const line = transcriptLine("assistant-text", "hello", 4);
    expect(line.indent).toBe(4);
  });
});

// =============================================================================
// getThinkingBlocks
// =============================================================================

describe("getThinkingBlocks", () => {
  test("returns empty array when no reasoning parts", () => {
    const msg = { parts: [], streaming: false } as any;
    expect(getThinkingBlocks(msg)).toEqual([]);
  });

  test("returns reasoning content from parts", () => {
    const msg = {
      parts: [
        { type: "reasoning", content: "step 1" },
        { type: "text", content: "answer" },
        { type: "reasoning", content: "step 2" },
      ],
      streaming: false,
    } as any;
    expect(getThinkingBlocks(msg)).toEqual(["step 1", "step 2"]);
  });

  test("filters out empty reasoning parts", () => {
    const msg = {
      parts: [
        { type: "reasoning", content: "real thinking" },
        { type: "reasoning", content: "   " },
        { type: "reasoning", content: "" },
      ],
      streaming: false,
    } as any;
    expect(getThinkingBlocks(msg)).toEqual(["real thinking"]);
  });

  test("falls back to thinkingText when no reasoning parts", () => {
    const msg = {
      parts: [{ type: "text", content: "answer" }],
      thinkingText: "fallback thinking",
      streaming: false,
    } as any;
    expect(getThinkingBlocks(msg)).toEqual(["fallback thinking"]);
  });

  test("falls back to liveThinkingText when streaming and no other source", () => {
    const msg = {
      parts: [],
      streaming: true,
    } as any;
    expect(getThinkingBlocks(msg, "live thinking")).toEqual(["live thinking"]);
  });

  test("returns empty array when no thinking content available", () => {
    const msg = {
      parts: [{ type: "text", content: "just text" }],
      streaming: false,
    } as any;
    expect(getThinkingBlocks(msg)).toEqual([]);
  });

  test("prefers reasoning parts over thinkingText fallback", () => {
    const msg = {
      parts: [{ type: "reasoning", content: "from parts" }],
      thinkingText: "from fallback",
      streaming: false,
    } as any;
    expect(getThinkingBlocks(msg)).toEqual(["from parts"]);
  });

  test("handles missing parts gracefully (undefined)", () => {
    const msg = { streaming: false } as any;
    expect(getThinkingBlocks(msg)).toEqual([]);
  });

  test("does not use liveThinkingText when not streaming", () => {
    const msg = {
      parts: [],
      streaming: false,
    } as any;
    expect(getThinkingBlocks(msg, "live thinking")).toEqual([]);
  });
});

// =============================================================================
// formatToolTitle
// =============================================================================

describe("formatToolTitle", () => {
  test("Read returns file_path", () => {
    expect(formatToolTitle("Read", { file_path: "/src/index.ts" })).toBe("/src/index.ts");
  });

  test("Edit returns file_path", () => {
    expect(formatToolTitle("Edit", { file_path: "/src/app.ts" })).toBe("/src/app.ts");
  });

  test("Write returns file_path", () => {
    expect(formatToolTitle("Write", { file_path: "/out/result.json" })).toBe("/out/result.json");
  });

  test("Read returns empty string when no file_path", () => {
    expect(formatToolTitle("Read", {})).toBe("");
  });

  test("Bash returns truncated command", () => {
    const shortCmd = "ls -la";
    expect(formatToolTitle("Bash", { command: shortCmd })).toBe(shortCmd);
  });

  test("Bash truncates long commands to 50 chars", () => {
    const longCmd = "a".repeat(60);
    const result = formatToolTitle("Bash", { command: longCmd });
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toEndWith("...");
  });

  test("Glob returns pattern", () => {
    expect(formatToolTitle("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  test("Grep returns pattern", () => {
    expect(formatToolTitle("Grep", { pattern: "TODO" })).toBe("TODO");
  });

  test("Task returns description", () => {
    expect(formatToolTitle("Task", { description: "Run tests" })).toBe("Run tests");
  });

  test("Task falls back to prompt when no description", () => {
    expect(formatToolTitle("Task", { prompt: "Build the project" })).toBe("Build the project");
  });

  test("Task truncates long descriptions to 45 chars", () => {
    const longDesc = "d".repeat(60);
    const result = formatToolTitle("Task", { description: longDesc });
    expect(result.length).toBeLessThanOrEqual(45);
    expect(result).toEndWith("...");
  });

  test("unknown tool returns empty string", () => {
    expect(formatToolTitle("UnknownTool", { foo: "bar" })).toBe("");
  });
});

// =============================================================================
// formatToolInput
// =============================================================================

describe("formatToolInput", () => {
  test("Read returns 'file: path'", () => {
    expect(formatToolInput("Read", { file_path: "/src/index.ts" })).toBe("file: /src/index.ts");
  });

  test("Edit returns 'file: path'", () => {
    expect(formatToolInput("Edit", { file_path: "/src/app.ts" })).toBe("file: /src/app.ts");
  });

  test("Write returns 'file: path'", () => {
    expect(formatToolInput("Write", { file_path: "/out/result.json" })).toBe(
      "file: /out/result.json",
    );
  });

  test("Read returns empty string when no file_path", () => {
    expect(formatToolInput("Read", {})).toBe("");
  });

  test("Bash returns '$ command'", () => {
    expect(formatToolInput("Bash", { command: "npm test" })).toBe("$ npm test");
  });

  test("Bash truncates long commands to 70 chars", () => {
    const longCmd = "x".repeat(80);
    const result = formatToolInput("Bash", { command: longCmd });
    expect(result).toStartWith("$ ");
    // The truncated command portion (after "$ ") should be at most 70 chars
    const cmdPortion = result.slice(2);
    expect(cmdPortion.length).toBeLessThanOrEqual(70);
  });

  test("Bash returns empty string when no command", () => {
    expect(formatToolInput("Bash", {})).toBe("");
  });

  test("Glob returns 'pattern: pattern'", () => {
    expect(formatToolInput("Glob", { pattern: "**/*.ts" })).toBe("pattern: **/*.ts");
  });

  test("Grep returns 'pattern: pattern'", () => {
    expect(formatToolInput("Grep", { pattern: "TODO" })).toBe("pattern: TODO");
  });

  test("Task returns 'prompt: prompt'", () => {
    expect(formatToolInput("Task", { prompt: "Build project" })).toBe("prompt: Build project");
  });

  test("Task truncates long prompts to 60 chars", () => {
    const longPrompt = "p".repeat(70);
    const result = formatToolInput("Task", { prompt: longPrompt });
    expect(result).toStartWith("prompt: ");
    const promptPortion = result.slice("prompt: ".length);
    expect(promptPortion.length).toBeLessThanOrEqual(60);
  });

  test("Task returns empty string when no prompt", () => {
    expect(formatToolInput("Task", {})).toBe("");
  });

  test("default formats first 3 keys", () => {
    const result = formatToolInput("CustomTool", {
      alpha: "one",
      beta: "two",
      gamma: "three",
      delta: "four",
    });
    expect(result).toContain("alpha: one");
    expect(result).toContain("beta: two");
    expect(result).toContain("gamma: three");
    expect(result).not.toContain("delta");
  });

  test("default truncates long values to 30 chars", () => {
    const longValue = "v".repeat(40);
    const result = formatToolInput("CustomTool", { key: longValue });
    expect(result).toContain("key: ");
    // The value portion should be truncated
    const valuePortion = result.split("key: ")[1];
    expect(valuePortion!.length).toBeLessThanOrEqual(30);
  });

  test("default returns empty string for empty input", () => {
    expect(formatToolInput("CustomTool", {})).toBe("");
  });
});
