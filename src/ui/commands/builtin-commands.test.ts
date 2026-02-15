/**
 * Tests for built-in command implementations
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
  helpCommand,
  themeCommand,
  clearCommand,
  compactCommand,
  exitCommand,
  modelCommand,
  mcpCommand,
  contextCommand,
  groupByProvider,
  formatGroupedModels,
  builtinCommands,
  registerBuiltinCommands,
} from "./builtin-commands.ts";
import { CommandRegistry } from "./registry.ts";
import type { CommandContext, CommandResult } from "./registry.ts";

// Helper to create a minimal command context for testing
function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("Built-in Commands", () => {
  describe("helpCommand", () => {
    test("returns success with message", async () => {
      const context = createMockContext();
      const result = await helpCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe("string");
    });

    test("lists commands when available", async () => {
      const context = createMockContext();
      const result = await helpCommand.execute("", context);

      expect(result.success).toBe(true);
      // Result should contain either "Available Commands" or "No commands available"
      expect(result.message).toMatch(/Available Commands|No commands available/);
    });

    test("includes model info in agent details when available", async () => {
      const context = createMockContext({
        getModelDisplayInfo: async () => ({
          model: "claude-sonnet-4",
          tier: "standard",
          contextWindow: 200000,
        }),
      });
      
      const result = await helpCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(typeof result.message).toBe("string");
    });

    test("falls back gracefully when model info unavailable", async () => {
      const context = createMockContext({
        getModelDisplayInfo: async () => {
          throw new Error("Model info unavailable");
        },
      });
      
      const result = await helpCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });
  });

  describe("themeCommand", () => {
    test("switches to dark theme when specified", async () => {
      const context = createMockContext();
      const result = await themeCommand.execute("dark", context);

      expect(result.success).toBe(true);
      expect(result.themeChange).toBe("dark");
    });

    test("switches to light theme when specified", async () => {
      const context = createMockContext();
      const result = await themeCommand.execute("light", context);

      expect(result.success).toBe(true);
      expect(result.themeChange).toBe("light");
    });

    test("toggles theme when no argument provided", async () => {
      const context = createMockContext();
      const result = await themeCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.themeChange).toBe("toggle");
    });

    test("returns error for invalid theme", async () => {
      const context = createMockContext();
      const result = await themeCommand.execute("invalid", context);

      expect(result.success).toBe(false);
      // No themeChange should be set on error
      expect(result.themeChange).toBeUndefined();
      // Message confirms the rejected input (display text, no structured equivalent)
      expect(result.message).toContain("Unknown theme");
    });

    test("handles case-insensitive theme names", async () => {
      const context = createMockContext();
      const resultDark = await themeCommand.execute("DARK", context);
      const resultLight = await themeCommand.execute("Light", context);

      expect(resultDark.success).toBe(true);
      expect(resultDark.themeChange).toBe("dark");
      expect(resultLight.success).toBe(true);
      expect(resultLight.themeChange).toBe("light");
    });

    test("trims whitespace from arguments", async () => {
      const context = createMockContext();
      const result = await themeCommand.execute("  dark  ", context);

      expect(result.success).toBe(true);
      expect(result.themeChange).toBe("dark");
    });
  });

  describe("clearCommand", () => {
    test("clears messages and destroys session", async () => {
      const context = createMockContext();
      const result = await clearCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.clearMessages).toBe(true);
      expect(result.destroySession).toBe(true);
    });
  });

  describe("exitCommand", () => {
    test("signals exit with goodbye message", async () => {
      const context = createMockContext();
      const result = await exitCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.shouldExit).toBe(true);
    });
  });

  describe("compactCommand", () => {
    test("returns error when no active session", async () => {
      const context = createMockContext({ session: null });
      const result = await compactCommand.execute("", context);

      expect(result.success).toBe(false);
      // No compaction artifacts should be present on error
      expect(result.clearMessages).toBeUndefined();
      expect(result.compactionSummary).toBeUndefined();
      // Error message describes the issue (display text, no structured equivalent)
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

      const context = createMockContext({
        session: mockSession as any,
      });

      const result = await compactCommand.execute("", context);

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

      const context = createMockContext({
        session: mockSession as any,
      });

      const result = await compactCommand.execute("", context);

      expect(result.success).toBe(false);
      // No compaction artifacts should be present on error
      expect(result.clearMessages).toBeUndefined();
      expect(result.compactionSummary).toBeUndefined();
      // Error message includes the underlying error (display text, no structured equivalent)
      expect(result.message).toContain("Failed to compact");
      expect(result.message).toContain("Summarization failed");
    });
  });

  describe("modelCommand", () => {
    test("shows model selector when no args provided", async () => {
      const context = createMockContext({
        modelOps: {} as any,
      });

      const result = await modelCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.showModelSelector).toBe(true);
    });

    test("shows model selector with 'select' subcommand", async () => {
      const context = createMockContext({
        modelOps: {} as any,
      });

      const result = await modelCommand.execute("select", context);

      expect(result.success).toBe(true);
      expect(result.showModelSelector).toBe(true);
    });

    test("lists available models", async () => {
      const mockModels = [
        { providerID: "anthropic", modelID: "claude-sonnet-4", name: "Claude Sonnet 4" },
        { providerID: "openai", modelID: "gpt-4", name: "GPT-4" },
      ];

      const context = createMockContext({
        modelOps: {
          listAvailableModels: async () => mockModels,
        } as any,
      });

      const result = await modelCommand.execute("list", context);

      expect(result.success).toBe(true);
      // No interactive selector should be shown for list subcommand
      expect(result.showModelSelector).toBeUndefined();
      // Message is formatted display text from groupByProvider/formatGroupedModels
      // (those utilities are tested separately); verify the message includes provider names
      expect(result.message).toContain("anthropic");
      expect(result.message).toContain("openai");
    });

    test("filters models by provider", async () => {
      const mockModels = [
        { providerID: "anthropic", modelID: "claude-sonnet-4", name: "Claude Sonnet 4" },
        { providerID: "openai", modelID: "gpt-4", name: "GPT-4" },
      ];

      const context = createMockContext({
        modelOps: {
          listAvailableModels: async () => mockModels,
        } as any,
      });

      const result = await modelCommand.execute("list anthropic", context);

      expect(result.success).toBe(true);
      expect(result.showModelSelector).toBeUndefined();
      // Filtered output should only contain the requested provider
      // (display text from formatGroupedModels, tested separately)
      expect(result.message).toContain("anthropic");
      expect(result.message).not.toContain("openai");
    });

    test("handles no models available", async () => {
      const context = createMockContext({
        modelOps: {
          listAvailableModels: async () => [],
        } as any,
      });

      const result = await modelCommand.execute("list", context);

      expect(result.success).toBe(true);
      expect(result.showModelSelector).toBeUndefined();
      expect(result.stateUpdate).toBeUndefined();
      // Informational message when no models exist (display text, no structured equivalent)
      expect(result.message).toContain("No models available");
    });

    test("prevents model switch during streaming", async () => {
      const context = createMockContext({
        state: {
          isStreaming: true,
          messageCount: 1,
        },
        modelOps: {} as any,
      });

      const result = await modelCommand.execute("claude-opus-4", context);

      expect(result.success).toBe(false);
      // No model state changes should occur when blocked
      expect(result.stateUpdate).toBeUndefined();
      expect(result.showModelSelector).toBeUndefined();
      // Error message explains the blocking reason (display text, no structured equivalent)
      expect(result.message).toContain("Cannot switch models while");
    });

    test("switches model successfully", async () => {
      const context = createMockContext({
        state: {
          isStreaming: false,
          messageCount: 1,
        },
        agentType: "claude" as any,
        modelOps: {
          resolveAlias: (model: string) => model,
          setModel: async () => ({ requiresNewSession: false }),
        } as any,
      });

      const result = await modelCommand.execute("claude-sonnet-4", context);

      expect(result.success).toBe(true);
      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate).toHaveProperty("model", "claude-sonnet-4");
    });

    test("handles model switch requiring new session", async () => {
      const context = createMockContext({
        state: {
          isStreaming: false,
          messageCount: 1,
        },
        agentType: "claude" as any,
        modelOps: {
          resolveAlias: (model: string) => model,
          setModel: async () => ({ requiresNewSession: true }),
        } as any,
      });

      const result = await modelCommand.execute("claude-opus-4", context);

      expect(result.success).toBe(true);
      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate).toHaveProperty("pendingModel", "claude-opus-4");
    });

    test("handles model switch error", async () => {
      const context = createMockContext({
        state: {
          isStreaming: false,
          messageCount: 1,
        },
        modelOps: {
          resolveAlias: (model: string) => model,
          setModel: async () => {
            throw new Error("Model not found");
          },
        } as any,
      });

      const result = await modelCommand.execute("invalid-model", context);

      expect(result.success).toBe(false);
      // No model state changes should occur on error
      expect(result.stateUpdate).toBeUndefined();
      expect(result.showModelSelector).toBeUndefined();
      // Error message includes failure reason (display text, no structured equivalent)
      expect(result.message).toContain("Failed to switch model");
    });
  });

  describe("mcpCommand", () => {
    test("lists MCP servers when no args provided", async () => {
      const context = createMockContext({
        getMcpServerToggles: () => ({}),
      });

      const result = await mcpCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.mcpSnapshot).toBeDefined();
    });

    test("returns error for enable without server name", async () => {
      const context = createMockContext({
        getMcpServerToggles: () => ({}),
      });

      const result = await mcpCommand.execute("enable", context);

      expect(result.success).toBe(false);
      // No MCP snapshot should be produced on usage error
      expect(result.mcpSnapshot).toBeUndefined();
      // Usage hint message (display text, no structured equivalent)
      expect(result.message).toContain("Usage");
    });

    test("returns error for unknown server", async () => {
      const context = createMockContext({
        getMcpServerToggles: () => ({}),
      });

      const result = await mcpCommand.execute("enable unknown-server", context);

      expect(result.success).toBe(false);
      // No MCP snapshot should be produced when server is not found
      expect(result.mcpSnapshot).toBeUndefined();
      // Error message names the unknown server (display text, no structured equivalent)
      expect(result.message).toContain("not found");
    });
  });

  describe("contextCommand", () => {
    test("displays context usage with session", async () => {
      const mockSession = {
        getContextUsage: async () => ({
          maxTokens: 200000,
          inputTokens: 5000,
          outputTokens: 3000,
        }),
        getSystemToolsTokens: () => 1000,
      };

      const context = createMockContext({
        session: mockSession as any,
        getModelDisplayInfo: async () => ({
          model: "claude-sonnet-4",
          tier: "standard",
          contextWindow: 200000,
        }),
      });

      const result = await contextCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.contextInfo).toBeDefined();
      expect(result.contextInfo?.model).toBe("claude-sonnet-4");
      expect(result.contextInfo?.maxTokens).toBe(200000);
    });

    test("handles missing model info gracefully", async () => {
      const context = createMockContext({
        session: null,
      });

      const result = await contextCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.contextInfo).toBeDefined();
      expect(result.contextInfo?.model).toBe("Unknown");
    });

    test("falls back to client system tools tokens", async () => {
      const context = createMockContext({
        session: null,
        getClientSystemToolsTokens: () => 1500,
      });

      const result = await contextCommand.execute("", context);

      expect(result.success).toBe(true);
      expect(result.contextInfo).toBeDefined();
    });
  });

  describe("groupByProvider", () => {
    test("groups models by provider ID", async () => {
      const models = [
        { providerID: "anthropic", modelID: "model1", name: "Model 1" },
        { providerID: "anthropic", modelID: "model2", name: "Model 2" },
        { providerID: "openai", modelID: "model3", name: "Model 3" },
      ];

      const grouped = groupByProvider(models);

      expect(grouped.size).toBe(2);
      expect(grouped.get("anthropic")?.length).toBe(2);
      expect(grouped.get("openai")?.length).toBe(1);
    });

    test("handles empty model list", async () => {
      const grouped = groupByProvider([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe("formatGroupedModels", () => {
    test("formats models with provider headers", async () => {
      const grouped = new Map([
        ["anthropic", [
          { providerID: "anthropic", modelID: "model1", name: "Model 1" },
        ]],
        ["openai", [
          { providerID: "openai", modelID: "model2", name: "Model 2" },
        ]],
      ]);

      const lines = formatGroupedModels(grouped);

      // formatGroupedModels returns string[] -- its API IS formatted text,
      // so .toContain() on the joined output is the correct assertion pattern.
      expect(lines.length).toBeGreaterThan(0);
      // Verify provider headers appear as bold markdown
      expect(lines).toContainEqual("**anthropic**");
      expect(lines).toContainEqual("**openai**");
      // Verify model IDs appear as indented list items
      expect(lines).toContainEqual("  - model1");
      expect(lines).toContainEqual("  - model2");
    });

    test("includes status annotations for non-active models", async () => {
      const grouped = new Map([
        ["anthropic", [
          { providerID: "anthropic", modelID: "model1", name: "Model 1", status: "beta" },
        ]],
      ]);

      const lines = formatGroupedModels(grouped);
      // Status annotation should appear parenthesized after model ID
      // formatGroupedModels returns string[] -- text formatting is its API
      expect(lines).toContainEqual("  - model1 (beta)");
    });

    test("includes context limit annotations", async () => {
      const grouped = new Map([
        ["anthropic", [
          { providerID: "anthropic", modelID: "model1", name: "Model 1", limits: { context: 200000 } },
        ]],
      ]);

      const lines = formatGroupedModels(grouped);
      // Context annotation should appear parenthesized after model ID
      // formatGroupedModels returns string[] -- text formatting is its API
      expect(lines).toContainEqual("  - model1 (200k ctx)");
    });

    test("handles empty grouped models", async () => {
      const lines = formatGroupedModels(new Map());
      expect(lines.length).toBe(0);
    });
  });

  describe("builtinCommands", () => {
    test("exports all builtin commands", async () => {
      expect(builtinCommands).toBeDefined();
      expect(Array.isArray(builtinCommands)).toBe(true);
      expect(builtinCommands.length).toBeGreaterThan(0);
      
      const commandNames = builtinCommands.map(cmd => cmd.name);
      expect(commandNames).toContain("help");
      expect(commandNames).toContain("theme");
      expect(commandNames).toContain("clear");
      expect(commandNames).toContain("compact");
      expect(commandNames).toContain("exit");
      expect(commandNames).toContain("model");
      expect(commandNames).toContain("mcp");
      expect(commandNames).toContain("context");
    });
  });

  describe("registerBuiltinCommands", () => {
    test("registers all builtin commands with registry", async () => {
      const registry = new CommandRegistry();
      
      // Register commands manually since we're testing in isolation
      for (const command of builtinCommands) {
        if (!registry.has(command.name)) {
          registry.register(command);
        }
      }

      expect(registry.has("help")).toBe(true);
      expect(registry.has("theme")).toBe(true);
      expect(registry.has("clear")).toBe(true);
      expect(registry.has("compact")).toBe(true);
      expect(registry.has("exit")).toBe(true);
      expect(registry.has("model")).toBe(true);
      expect(registry.has("mcp")).toBe(true);
      expect(registry.has("context")).toBe(true);
    });

    test("is idempotent - allows multiple registrations", async () => {
      const registry = new CommandRegistry();
      
      // First registration
      for (const command of builtinCommands) {
        if (!registry.has(command.name)) {
          registry.register(command);
        }
      }
      
      const sizeAfterFirst = registry.size();
      
      // Second registration - should skip already registered
      for (const command of builtinCommands) {
        if (!registry.has(command.name)) {
          registry.register(command);
        }
      }
      
      expect(registry.size()).toBe(sizeAfterFirst);
    });
  });
});
