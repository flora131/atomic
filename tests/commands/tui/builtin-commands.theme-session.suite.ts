import { describe, expect, test } from "bun:test";
import {
  clearCommand,
  compactCommand,
  createMockContext,
  exitCommand,
  themeCommand,
} from "./builtin-commands.test-support.ts";

describe("Built-in Commands theme and session actions", () => {
  describe("themeCommand", () => {
    test("switches to dark theme when specified", async () => {
      const result = await themeCommand.execute("dark", createMockContext());
      expect(result.success).toBe(true);
      expect(result.themeChange).toBe("dark");
    });

    test("switches to light theme when specified", async () => {
      const result = await themeCommand.execute("light", createMockContext());
      expect(result.success).toBe(true);
      expect(result.themeChange).toBe("light");
    });

    test("toggles theme when no argument provided", async () => {
      const result = await themeCommand.execute("", createMockContext());
      expect(result.success).toBe(true);
      expect(result.themeChange).toBe("toggle");
    });

    test("returns error for invalid theme", async () => {
      const result = await themeCommand.execute("invalid", createMockContext());
      expect(result.success).toBe(false);
      expect(result.themeChange).toBeUndefined();
      expect(result.message).toContain("Unknown theme");
    });

    test("handles case-insensitive theme names", async () => {
      const darkResult = await themeCommand.execute("DARK", createMockContext());
      const lightResult = await themeCommand.execute("Light", createMockContext());

      expect(darkResult.themeChange).toBe("dark");
      expect(lightResult.themeChange).toBe("light");
    });

    test("trims whitespace from arguments", async () => {
      const result = await themeCommand.execute("  dark  ", createMockContext());
      expect(result.themeChange).toBe("dark");
    });
  });

  describe("clearCommand", () => {
    test("clears messages and destroys session", async () => {
      const result = await clearCommand.execute("", createMockContext());
      expect(result.success).toBe(true);
      expect(result.clearMessages).toBe(true);
      expect(result.destroySession).toBe(true);
    });
  });

  describe("exitCommand", () => {
    test("signals exit with goodbye message", async () => {
      const result = await exitCommand.execute("", createMockContext());
      expect(result.success).toBe(true);
      expect(result.shouldExit).toBe(true);
    });
  });

  describe("compactCommand", () => {
    test("returns error when no active session", async () => {
      const result = await compactCommand.execute(
        "",
        createMockContext({ session: null }),
      );

      expect(result.success).toBe(false);
      expect(result.clearMessages).toBeUndefined();
      expect(result.compactionSummary).toBeUndefined();
      expect(result.message).toContain("No active session");
    });

    test("compacts context with active session", async () => {
      const mockSession = {
        summarize: async () => {},
        getContextUsage: async () => ({
          maxTokens: 200000,
          inputTokens: 5000,
          outputTokens: 3000,
        }),
        getSystemToolsTokens: () => 1000,
      };

      const result = await compactCommand.execute(
        "",
        createMockContext({ session: mockSession as never }),
      );

      expect(result.success).toBe(true);
      expect(result.clearMessages).toBe(true);
      expect(result.compactionSummary).toBeDefined();
    });

    test("handles summarize error gracefully", async () => {
      const mockSession = {
        summarize: async () => {
          throw new Error("Summarization failed");
        },
      };

      const result = await compactCommand.execute(
        "",
        createMockContext({ session: mockSession as never }),
      );

      expect(result.success).toBe(false);
      expect(result.clearMessages).toBeUndefined();
      expect(result.compactionSummary).toBeUndefined();
      expect(result.message).toContain("Failed to compact");
      expect(result.message).toContain("Summarization failed");
    });
  });
});
