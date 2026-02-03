import { test, expect, describe, beforeEach, afterEach } from "bun:test";

/**
 * Tests for chat command integration.
 *
 * Tests:
 * - Client factory creates correct client for agent type
 * - Theme selection works correctly
 * - Slash command parsing
 */

// Import functions to test
import {
  createClientForAgentType,
  getAgentDisplayName,
  getTheme,
  isSlashCommand,
  parseSlashCommand,
  handleThemeCommand,
} from "../../src/commands/chat.ts";

import { darkTheme, lightTheme } from "../../src/ui/index.ts";

describe("Chat Command", () => {
  describe("Client factory", () => {
    test("creates ClaudeAgentClient for 'claude' type", () => {
      const client = createClientForAgentType("claude");
      expect(client.agentType).toBe("claude");
    });

    test("creates OpenCodeClient for 'opencode' type", () => {
      const client = createClientForAgentType("opencode");
      expect(client.agentType).toBe("opencode");
    });

    test("creates CopilotClient for 'copilot' type", () => {
      const client = createClientForAgentType("copilot");
      expect(client.agentType).toBe("copilot");
    });

    test("throws for unknown agent type", () => {
      expect(() => createClientForAgentType("unknown" as any)).toThrow(
        "Unknown agent type: unknown"
      );
    });
  });

  describe("Agent display names", () => {
    test("returns 'Claude' for claude", () => {
      expect(getAgentDisplayName("claude")).toBe("Claude");
    });

    test("returns 'OpenCode' for opencode", () => {
      expect(getAgentDisplayName("opencode")).toBe("OpenCode");
    });

    test("returns 'Copilot' for copilot", () => {
      expect(getAgentDisplayName("copilot")).toBe("Copilot");
    });
  });

  describe("Theme selection", () => {
    test("returns darkTheme for 'dark'", () => {
      const theme = getTheme("dark");
      expect(theme).toBe(darkTheme);
    });

    test("returns lightTheme for 'light'", () => {
      const theme = getTheme("light");
      expect(theme).toBe(lightTheme);
    });
  });

  describe("Slash command detection", () => {
    test("detects slash commands", () => {
      expect(isSlashCommand("/help")).toBe(true);
      expect(isSlashCommand("/theme dark")).toBe(true);
    });

    test("does not detect regular messages as slash commands", () => {
      expect(isSlashCommand("hello")).toBe(false);
      expect(isSlashCommand("not / a command")).toBe(false);
      expect(isSlashCommand(" /not at start")).toBe(false);
    });
  });

  describe("Slash command parsing", () => {
    test("parses command without arguments", () => {
      const result = parseSlashCommand("/help");
      expect(result.command).toBe("help");
      expect(result.args).toBe("");
    });

    test("parses command with arguments", () => {
      const result = parseSlashCommand("/theme dark");
      expect(result.command).toBe("theme");
      expect(result.args).toBe("dark");
    });

    test("parses command with multiple word arguments", () => {
      const result = parseSlashCommand("/search hello world");
      expect(result.command).toBe("search");
      expect(result.args).toBe("hello world");
    });

    test("command is lowercased", () => {
      const result = parseSlashCommand("/HELP");
      expect(result.command).toBe("help");
    });

    test("handles whitespace correctly", () => {
      const result = parseSlashCommand("/theme   light  ");
      expect(result.command).toBe("theme");
      expect(result.args).toBe("light");
    });
  });

  describe("Theme command handling", () => {
    test("handles dark theme", () => {
      const result = handleThemeCommand("dark");
      expect(result).not.toBeNull();
      expect(result!.newTheme).toBe("dark");
      expect(result!.message).toContain("dark");
    });

    test("handles light theme", () => {
      const result = handleThemeCommand("light");
      expect(result).not.toBeNull();
      expect(result!.newTheme).toBe("light");
      expect(result!.message).toContain("light");
    });

    test("handles case insensitive theme names", () => {
      const result = handleThemeCommand("DARK");
      expect(result).not.toBeNull();
      expect(result!.newTheme).toBe("dark");
    });

    test("returns null for invalid theme", () => {
      const result = handleThemeCommand("invalid");
      expect(result).toBeNull();
    });
  });
});
