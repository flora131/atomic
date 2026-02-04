/**
 * Integration tests for /model list command with real models.dev API
 *
 * These tests verify the /model list command works correctly with live data.
 * Tests are skipped if ATOMIC_DISABLE_MODELS_FETCH is set.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { modelCommand } from "../builtin-commands.ts";
import type { CommandContext, CommandContextState } from "../registry.ts";
import type { ModelOperations, Model } from "../../../models";
import { ModelsDev, fromModelsDevModel } from "../../../models";

// Skip all tests if ATOMIC_DISABLE_MODELS_FETCH is set
const SKIP_INTEGRATION =
  process.env.ATOMIC_DISABLE_MODELS_FETCH === "1" ||
  process.env.ATOMIC_DISABLE_MODELS_FETCH === "true";

/**
 * Create a real ModelOperations that uses ModelsDev
 */
function createRealModelOps(): ModelOperations {
  return {
    listAvailableModels: async (): Promise<Model[]> => {
      const modelsData = await ModelsDev.listModels();
      return modelsData.map(({ providerID, model }) =>
        fromModelsDevModel(providerID, model.id, model)
      );
    },
    setModel: async () => ({ success: true }),
    getCurrentModel: async () => undefined,
    resolveAlias: () => undefined,
  };
}

/**
 * Create a mock CommandContext with real ModelOperations
 */
function createRealContext(): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    agentType: undefined,
    modelOps: createRealModelOps(),
  };
}

describe.skipIf(SKIP_INTEGRATION)("/model list integration tests", () => {
  let originalData: ModelsDev.Database | null = null;

  beforeAll(async () => {
    // Reset the lazy loader to ensure fresh data
    ModelsDev.Data.reset();
    // Preload the data
    originalData = await ModelsDev.get();
  });

  afterAll(() => {
    // Reset for other tests
    ModelsDev.Data.reset();
  });

  test("returns models from models.dev", async () => {
    const context = createRealContext();
    const result = await modelCommand.execute("list", context);

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    // Should have at least some content
    expect(result.message!.length).toBeGreaterThan(50);
  });

  test("includes known providers (anthropic)", async () => {
    const context = createRealContext();
    const result = await modelCommand.execute("list", context);

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    // anthropic should be a known provider in models.dev
    expect(result.message!.toLowerCase()).toContain("anthropic");
  });

  test("includes known providers (openai)", async () => {
    const context = createRealContext();
    const result = await modelCommand.execute("list", context);

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    // openai should be a known provider in models.dev
    expect(result.message!.toLowerCase()).toContain("openai");
  });

  test("includes known models", async () => {
    const context = createRealContext();
    const result = await modelCommand.execute("list", context);

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    // At least one common model should appear (claude or gpt)
    const message = result.message!.toLowerCase();
    const hasKnownModel =
      message.includes("claude") ||
      message.includes("gpt") ||
      message.includes("sonnet") ||
      message.includes("opus");
    expect(hasKnownModel).toBe(true);
  });

  test("/model list anthropic returns only Anthropic models", async () => {
    const context = createRealContext();
    const result = await modelCommand.execute("list anthropic", context);

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    // Should contain anthropic
    expect(result.message!.toLowerCase()).toContain("anthropic");
    // Should NOT contain openai as a provider header
    expect(result.message!).not.toContain("**openai**");
  });

  test("handles provider filter with no results", async () => {
    const context = createRealContext();
    const result = await modelCommand.execute("list nonexistent-provider-xyz", context);

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    expect(result.message!).toContain("No models found for provider");
  });
});

describe.skipIf(SKIP_INTEGRATION)("/model list network error handling", () => {
  test("handles empty database gracefully", async () => {
    // This tests the edge case where models.dev returns no data
    const emptyModelOps: ModelOperations = {
      listAvailableModels: async () => [],
      setModel: async () => ({ success: true }),
      getCurrentModel: async () => undefined,
      resolveAlias: () => undefined,
    };

    const context: CommandContext = {
      session: null,
      state: {
        isStreaming: false,
        messageCount: 0,
        workflowActive: false,
        workflowType: null,
        initialPrompt: null,
        pendingApproval: false,
        specApproved: undefined,
        feedback: null,
      },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: () => {},
      spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
      agentType: undefined,
      modelOps: emptyModelOps,
    };

    const result = await modelCommand.execute("list", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("No models available");
  });
});
