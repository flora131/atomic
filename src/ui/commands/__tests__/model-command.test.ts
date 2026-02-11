/**
 * Tests for /model command
 *
 * Verifies the behavior of the /model command for viewing, listing,
 * refreshing, and switching models.
 */

import { test, expect, describe, mock } from "bun:test";
import { modelCommand, groupByProvider, formatGroupedModels } from "../builtin-commands.ts";
import type { CommandContext, CommandContextState } from "../registry.ts";
import type { ModelOperations } from "../../../models";
import type { Model } from "../../../models/model-transform";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock Model for testing.
 */
function createMockModel(providerID: string, modelID: string, name: string): Model {
  return {
    id: `${providerID}/${modelID}`,
    providerID,
    modelID,
    name,
    status: "active",
    capabilities: {
      reasoning: false,
      attachment: true,
      temperature: true,
      toolCall: true,
    },
    limits: {
      context: 200000,
      input: 100000,
      output: 100000,
    },
    options: {},
  };
}

/**
 * Create a mock ModelOperations for testing.
 */
function createMockModelOps(overrides: Partial<ModelOperations> = {}): ModelOperations {
  return {
    listAvailableModels: mock(() => Promise.resolve([])),
    setModel: mock(() => Promise.resolve({ success: true })),
    getCurrentModel: mock(() => Promise.resolve(undefined)),
    resolveAlias: mock(() => undefined),
    ...overrides,
  };
}

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  stateOverrides: Partial<CommandContextState> = {},
  contextOverrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 5,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
      ...stateOverrides,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    updateWorkflowState: () => {},
    agentType: undefined,
    modelOps: undefined,
    ...contextOverrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("modelCommand", () => {
  test("has correct metadata", () => {
    expect(modelCommand.name).toBe("model");
    expect(modelCommand.category).toBe("builtin");
    expect(modelCommand.aliases).toContain("m");
  });

  describe("/model with no args", () => {
    test("shows model selector when model is set", async () => {
      const mockModelOps = createMockModelOps({
        getCurrentModel: mock(() => Promise.resolve("anthropic/claude-sonnet-4-5")),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("", context);

      expect(result.success).toBe(true);
      // With no args, the command shows the interactive model selector
      expect(result.showModelSelector).toBe(true);
    });

    test("shows model selector when no model is set", async () => {
      const mockModelOps = createMockModelOps({
        getCurrentModel: mock(() => Promise.resolve(undefined)),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("", context);

      expect(result.success).toBe(true);
      // With no args, the command shows the interactive model selector
      expect(result.showModelSelector).toBe(true);
    });
  });

  describe("/model list", () => {
    test("shows all models grouped by provider", async () => {
      const mockModelOps = createMockModelOps({
        listAvailableModels: mock(() =>
          Promise.resolve([
            createMockModel("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5"),
            createMockModel("anthropic", "claude-opus-4", "Claude Opus 4"),
            createMockModel("openai", "gpt-4o", "GPT-4o"),
          ])
        ),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("list", context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("**anthropic**");
      expect(result.message).toContain("claude-sonnet-4-5");
      expect(result.message).toContain("claude-opus-4");
      expect(result.message).toContain("**openai**");
      expect(result.message).toContain("gpt-4o");
    });

    test("filters by provider when provider name given", async () => {
      const mockModelOps = createMockModelOps({
        listAvailableModels: mock(() =>
          Promise.resolve([
            createMockModel("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5"),
            createMockModel("anthropic", "claude-opus-4", "Claude Opus 4"),
            createMockModel("openai", "gpt-4o", "GPT-4o"),
          ])
        ),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("list anthropic", context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("**anthropic**");
      expect(result.message).toContain("claude-sonnet-4-5");
      expect(result.message).not.toContain("**openai**");
      expect(result.message).not.toContain("gpt-4o");
    });

    test("shows appropriate message when no results for provider filter", async () => {
      const mockModelOps = createMockModelOps({
        listAvailableModels: mock(() =>
          Promise.resolve([
            createMockModel("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5"),
          ])
        ),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("list nonexistent", context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("No models found for provider: nonexistent");
    });

    test("shows 'No models available' when no models exist", async () => {
      const mockModelOps = createMockModelOps({
        listAvailableModels: mock(() => Promise.resolve([])),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("list", context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("No models available");
    });
  });

  describe("/model <alias>", () => {
    test("resolves Claude alias and switches model", async () => {
      const setModelMock = mock(() => Promise.resolve({ success: true }));
      const mockModelOps = createMockModelOps({
        resolveAlias: mock((alias: string) => (alias === "sonnet" ? "sonnet" : undefined)),
        setModel: setModelMock,
      });
      const context = createMockContext({}, { modelOps: mockModelOps, agentType: "claude" });

      const result = await modelCommand.execute("sonnet", context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Model switched to **sonnet**");
      expect(setModelMock).toHaveBeenCalledWith("sonnet");
    });

    test("switches to full model ID", async () => {
      const setModelMock = mock(() => Promise.resolve({ success: true }));
      const mockModelOps = createMockModelOps({
        resolveAlias: mock(() => undefined),
        setModel: setModelMock,
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("anthropic/claude-sonnet-4-5", context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Model switched to **anthropic/claude-sonnet-4-5**");
      expect(setModelMock).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5");
    });
  });

  describe("/model for Copilot", () => {
    test("returns requiresNewSession message", async () => {
      const setModelMock = mock(() =>
        Promise.resolve({ success: true, requiresNewSession: true })
      );
      const mockModelOps = createMockModelOps({
        resolveAlias: mock(() => undefined),
        setModel: setModelMock,
      });
      const context = createMockContext({}, { modelOps: mockModelOps, agentType: "copilot" });

      const result = await modelCommand.execute("gpt-4o", context);

      expect(result.success).toBe(true);
      expect(result.message).toContain("will be used for the next session");
      expect(result.message).toContain("requires a new session");
    });
  });

  describe("/model error handling", () => {
    test("handles error gracefully when setModel fails", async () => {
      const mockModelOps = createMockModelOps({
        resolveAlias: mock(() => undefined),
        setModel: mock(() => Promise.reject(new Error("Model not found"))),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("invalid-model", context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to switch model");
      expect(result.message).toContain("Model not found");
    });

    test("handles unknown error gracefully", async () => {
      const mockModelOps = createMockModelOps({
        resolveAlias: mock(() => undefined),
        setModel: mock(() => Promise.reject("string error")),
      });
      const context = createMockContext({}, { modelOps: mockModelOps });

      const result = await modelCommand.execute("invalid-model", context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to switch model");
      expect(result.message).toContain("Unknown error");
    });
  });
});

// ============================================================================
// groupByProvider TESTS
// ============================================================================

describe("groupByProvider", () => {
  test("groups models correctly by provider", () => {
    const models = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { providerID: "anthropic", modelID: "claude-opus-4", name: "Claude Opus 4" },
      { providerID: "openai", modelID: "gpt-4o", name: "GPT-4o" },
    ];

    const result = groupByProvider(models);

    expect(result.size).toBe(2);
    expect(result.get("anthropic")?.length).toBe(2);
    expect(result.get("openai")?.length).toBe(1);
  });

  test("handles empty array", () => {
    const result = groupByProvider([]);
    expect(result.size).toBe(0);
  });

  test("handles single provider", () => {
    const models = [
      { providerID: "anthropic", modelID: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { providerID: "anthropic", modelID: "claude-opus-4", name: "Claude Opus 4" },
    ];

    const result = groupByProvider(models);

    expect(result.size).toBe(1);
    expect(result.get("anthropic")?.length).toBe(2);
  });
});

// ============================================================================
// formatGroupedModels TESTS
// ============================================================================

describe("formatGroupedModels", () => {
  test("formats output correctly", () => {
    const grouped = new Map([
      ["anthropic", [{ providerID: "anthropic", modelID: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }]],
      ["openai", [{ providerID: "openai", modelID: "gpt-4o", name: "GPT-4o" }]],
    ]);

    const result = formatGroupedModels(grouped);

    expect(result).toContain("**anthropic**");
    expect(result).toContain("  - claude-sonnet-4-5");
    expect(result).toContain("**openai**");
    expect(result).toContain("  - gpt-4o");
  });

  test("includes status when not 'active'", () => {
    const grouped = new Map([
      ["anthropic", [{ providerID: "anthropic", modelID: "claude-test", name: "Claude Test", status: "beta" }]],
    ]);

    const result = formatGroupedModels(grouped);

    expect(result.some(line => line.includes("beta"))).toBe(true);
  });

  test("does not include status when 'active'", () => {
    const grouped = new Map([
      ["anthropic", [{ providerID: "anthropic", modelID: "claude-sonnet", name: "Claude Sonnet", status: "active" }]],
    ]);

    const result = formatGroupedModels(grouped);

    expect(result.some(line => line.includes("active"))).toBe(false);
  });

  test("includes context size", () => {
    const grouped = new Map([
      ["anthropic", [{ providerID: "anthropic", modelID: "claude-sonnet", name: "Claude Sonnet", limits: { context: 200000 } }]],
    ]);

    const result = formatGroupedModels(grouped);

    expect(result.some(line => line.includes("200k ctx"))).toBe(true);
  });

  test("formats status and context together", () => {
    const grouped = new Map([
      ["anthropic", [{ providerID: "anthropic", modelID: "claude-beta", name: "Claude Beta", status: "beta", limits: { context: 100000 } }]],
    ]);

    const result = formatGroupedModels(grouped);

    expect(result.some(line => line.includes("beta, 100k ctx"))).toBe(true);
  });
});
