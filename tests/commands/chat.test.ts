import { test, expect, describe, beforeEach, afterEach } from "bun:test";

/**
 * Tests for chat command integration.
 *
 * Feature 30 from research/feature-list.json:
 * "Integrate OpenTUI chat interface with graph workflows"
 *
 * Tests:
 * - Client factory creates correct client for agent type
 * - Theme selection works correctly
 * - Slash command parsing
 * - Workflow progress formatting
 * - Status emoji mapping
 */

// Import functions to test
import {
  createClientForAgentType,
  getAgentDisplayName,
  getTheme,
  isSlashCommand,
  parseSlashCommand,
  handleThemeCommand,
  getNodeDisplayName,
  formatStepProgress,
  getStatusEmoji,
} from "../../src/commands/chat.ts";

import { ATOMIC_NODE_IDS } from "../../src/workflows/atomic.ts";
import { darkTheme, lightTheme } from "../../src/ui/index.ts";
import type { AtomicWorkflowState } from "../../src/graph/annotation.ts";
import type { StepResult } from "../../src/graph/compiled.ts";

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
      expect(isSlashCommand("/workflow")).toBe(true);
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

  describe("Node display names", () => {
    test("maps RESEARCH node", () => {
      expect(getNodeDisplayName(ATOMIC_NODE_IDS.RESEARCH)).toBe(
        "Researching codebase"
      );
    });

    test("maps CREATE_SPEC node", () => {
      expect(getNodeDisplayName(ATOMIC_NODE_IDS.CREATE_SPEC)).toBe(
        "Creating specification"
      );
    });

    test("maps WAIT_FOR_APPROVAL node", () => {
      expect(getNodeDisplayName(ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL)).toBe(
        "Waiting for approval"
      );
    });

    test("maps CREATE_FEATURE_LIST node", () => {
      expect(getNodeDisplayName(ATOMIC_NODE_IDS.CREATE_FEATURE_LIST)).toBe(
        "Creating feature list"
      );
    });

    test("maps IMPLEMENT_FEATURE node", () => {
      expect(getNodeDisplayName(ATOMIC_NODE_IDS.IMPLEMENT_FEATURE)).toBe(
        "Implementing feature"
      );
    });

    test("maps CREATE_PR node", () => {
      expect(getNodeDisplayName(ATOMIC_NODE_IDS.CREATE_PR)).toBe(
        "Creating pull request"
      );
    });

    test("returns nodeId for unknown nodes", () => {
      expect(getNodeDisplayName("unknown-node")).toBe("unknown-node");
    });
  });

  describe("Status emoji mapping", () => {
    test("returns [Running] for running status", () => {
      expect(getStatusEmoji("running")).toBe("[Running]");
    });

    test("returns [Paused] for paused status", () => {
      expect(getStatusEmoji("paused")).toBe("[Paused]");
    });

    test("returns [Done] for completed status", () => {
      expect(getStatusEmoji("completed")).toBe("[Done]");
    });

    test("returns [Error] for failed status", () => {
      expect(getStatusEmoji("failed")).toBe("[Error]");
    });

    test("returns [Cancelled] for cancelled status", () => {
      expect(getStatusEmoji("cancelled")).toBe("[Cancelled]");
    });

    test("returns [>] for unknown status", () => {
      expect(getStatusEmoji("unknown")).toBe("[>]");
    });
  });

  describe("Step progress formatting", () => {
    test("formats step with no features", () => {
      const stepResult: StepResult<AtomicWorkflowState> = {
        nodeId: ATOMIC_NODE_IDS.RESEARCH,
        status: "running",
        state: {
          executionId: "test",
          lastUpdated: new Date().toISOString(),
          outputs: {},
          researchDoc: "",
          specDoc: "",
          specApproved: false,
          featureList: [],
          currentFeature: null,
          allFeaturesPassing: false,
          debugReports: [],
          prUrl: null,
          contextWindowUsage: null,
          iteration: 1,
        },
        result: {},
      };

      const message = formatStepProgress(stepResult);
      expect(message).toContain("[Running]");
      expect(message).toContain("Researching codebase");
      expect(message).toContain("iteration 1");
      expect(message).not.toContain("Features:");
    });

    test("formats step with features", () => {
      const stepResult: StepResult<AtomicWorkflowState> = {
        nodeId: ATOMIC_NODE_IDS.IMPLEMENT_FEATURE,
        status: "running",
        state: {
          executionId: "test",
          lastUpdated: new Date().toISOString(),
          outputs: {},
          researchDoc: "",
          specDoc: "",
          specApproved: true,
          featureList: [
            {
              category: "functional",
              description: "Feature 1",
              steps: [],
              passes: true,
            },
            {
              category: "functional",
              description: "Feature 2",
              steps: [],
              passes: false,
            },
            {
              category: "functional",
              description: "Feature 3",
              steps: [],
              passes: false,
            },
          ],
          currentFeature: null,
          allFeaturesPassing: false,
          debugReports: [],
          prUrl: null,
          contextWindowUsage: null,
          iteration: 5,
        },
        result: {},
      };

      const message = formatStepProgress(stepResult);
      expect(message).toContain("[Running]");
      expect(message).toContain("Implementing feature");
      expect(message).toContain("iteration 5");
      expect(message).toContain("1/3 passing");
    });

    test("formats completed step", () => {
      const stepResult: StepResult<AtomicWorkflowState> = {
        nodeId: ATOMIC_NODE_IDS.CREATE_PR,
        status: "completed",
        state: {
          executionId: "test",
          lastUpdated: new Date().toISOString(),
          outputs: {},
          researchDoc: "",
          specDoc: "",
          specApproved: true,
          featureList: [
            {
              category: "functional",
              description: "Feature 1",
              steps: [],
              passes: true,
            },
          ],
          currentFeature: null,
          allFeaturesPassing: true,
          debugReports: [],
          prUrl: "https://github.com/example/repo/pull/123",
          contextWindowUsage: null,
          iteration: 10,
        },
        result: {},
      };

      const message = formatStepProgress(stepResult);
      expect(message).toContain("[Done]");
      expect(message).toContain("Creating pull request");
      expect(message).toContain("iteration 10");
    });
  });
});
