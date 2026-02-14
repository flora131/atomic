import { describe, expect, test } from "bun:test";
import { CLAUDE_ALIASES, UnifiedModelOperations, type AgentType, type SetModelResult } from "./model-operations";
import type { Model } from "./model-transform";

/**
 * Mock Model data for testing
 */
function createMockModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "test-provider/test-model",
    providerID: "test-provider",
    modelID: "test-model",
    name: "Test Model",
    status: "active",
    capabilities: {
      reasoning: false,
      attachment: false,
      temperature: true,
      toolCall: true,
    },
    limits: {
      context: 100000,
      output: 4096,
    },
    options: {},
    ...overrides,
  };
}

describe("CLAUDE_ALIASES", () => {
  test("contains expected aliases", () => {
    expect(CLAUDE_ALIASES.sonnet).toBe("sonnet");
    expect(CLAUDE_ALIASES.opus).toBe("opus");
    expect(CLAUDE_ALIASES.haiku).toBe("haiku");
  });

  test("has exactly three aliases", () => {
    expect(Object.keys(CLAUDE_ALIASES)).toHaveLength(3);
  });
});

describe("UnifiedModelOperations - resolveAlias", () => {
  test("resolves Claude aliases case-insensitively", () => {
    const ops = new UnifiedModelOperations("claude");
    expect(ops.resolveAlias("sonnet")).toBe("sonnet");
    expect(ops.resolveAlias("SONNET")).toBe("sonnet");
    expect(ops.resolveAlias("Opus")).toBe("opus");
    expect(ops.resolveAlias("haiku")).toBe("haiku");
  });

  test("returns undefined for unknown Claude aliases", () => {
    const ops = new UnifiedModelOperations("claude");
    expect(ops.resolveAlias("unknown")).toBeUndefined();
    expect(ops.resolveAlias("gpt-4")).toBeUndefined();
    expect(ops.resolveAlias("")).toBeUndefined();
  });

  test("returns undefined for non-Claude agent types", () => {
    const opsOpencode = new UnifiedModelOperations("opencode");
    expect(opsOpencode.resolveAlias("sonnet")).toBeUndefined();

    const opsCopilot = new UnifiedModelOperations("copilot");
    expect(opsCopilot.resolveAlias("opus")).toBeUndefined();
  });
});

describe("UnifiedModelOperations - getCurrentModel", () => {
  test("returns undefined when no model is set", async () => {
    const ops = new UnifiedModelOperations("claude");
    expect(await ops.getCurrentModel()).toBeUndefined();
  });

  test("returns initial model when provided in constructor", async () => {
    const ops = new UnifiedModelOperations("claude", undefined, undefined, "claude-sonnet-4");
    expect(await ops.getCurrentModel()).toBe("claude-sonnet-4");
  });

  test("returns set model after setModel is called", async () => {
    const mockSetModel = async (model: string) => {
      // Mock implementation
    };
    const ops = new UnifiedModelOperations("claude", mockSetModel);
    await ops.setModel("sonnet");
    expect(await ops.getCurrentModel()).toBe("sonnet");
  });
});

describe("UnifiedModelOperations - getPendingModel", () => {
  test("returns undefined when no pending model", () => {
    const ops = new UnifiedModelOperations("copilot");
    expect(ops.getPendingModel()).toBeUndefined();
  });

  test("returns pending model for Copilot after setModel", async () => {
    // Create an instance that bypasses validation by pre-populating the cache
    const ops = new UnifiedModelOperations("copilot");
    // Directly set the cached models to avoid SDK call
    (ops as any).cachedModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
      }),
    ];
    await ops.setModel("gpt-4o");
    expect(ops.getPendingModel()).toBe("gpt-4o");
  });
});

describe("UnifiedModelOperations - setModel", () => {
  test("sets model for Claude without requiring new session", async () => {
    const mockSetModel = async (model: string) => {
      // Mock implementation
    };
    const ops = new UnifiedModelOperations("claude", mockSetModel);
    const result = await ops.setModel("sonnet");
    
    expect(result.success).toBe(true);
    expect(result.requiresNewSession).toBeUndefined();
    expect(await ops.getCurrentModel()).toBe("sonnet");
  });

  test("resolves Claude alias before setting", async () => {
    let capturedModel: string | undefined;
    const mockSetModel = async (model: string) => {
      capturedModel = model;
    };
    const ops = new UnifiedModelOperations("claude", mockSetModel);
    await ops.setModel("opus");
    
    expect(capturedModel).toBe("opus");
    expect(await ops.getCurrentModel()).toBe("opus");
  });

  test("extracts modelID from providerID/modelID format for Claude", async () => {
    let capturedModel: string | undefined;
    const mockSetModel = async (model: string) => {
      capturedModel = model;
    };
    const ops = new UnifiedModelOperations("claude", mockSetModel);
    await ops.setModel("anthropic/sonnet");
    
    expect(capturedModel).toBe("sonnet");
    expect(await ops.getCurrentModel()).toBe("sonnet");
  });

  test("throws error for invalid providerID/modelID format", async () => {
    const ops = new UnifiedModelOperations("claude");
    await expect(ops.setModel("invalid/model/format")).rejects.toThrow(
      "Invalid model format: 'invalid/model/format'"
    );
    await expect(ops.setModel("/model")).rejects.toThrow("Invalid model format");
    await expect(ops.setModel("provider/")).rejects.toThrow("Invalid model format");
  });

  test("returns requiresNewSession for Copilot", async () => {
    const ops = new UnifiedModelOperations("copilot");
    // Pre-populate cache to avoid SDK call
    (ops as any).cachedModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
      }),
    ];
    const result = await ops.setModel("gpt-4o");
    
    expect(result.success).toBe(true);
    expect(result.requiresNewSession).toBe(true);
    expect(ops.getPendingModel()).toBe("gpt-4o");
  });

  test("validates model exists for Copilot before setting", async () => {
    const ops = new UnifiedModelOperations("copilot");
    // Pre-populate cache with limited models
    (ops as any).cachedModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
      }),
    ];
    
    await expect(ops.setModel("nonexistent-model")).rejects.toThrow(
      "Model 'nonexistent-model' is not available"
    );
  });

  test("validates model exists for OpenCode before setting", async () => {
    const mockSetModel = async (model: string) => {
      // Mock implementation
    };
    const ops = new UnifiedModelOperations("opencode", mockSetModel);
    // Pre-populate cache with limited models
    (ops as any).cachedModels = [
      createMockModel({
        id: "anthropic/claude-3-opus",
        providerID: "anthropic",
        modelID: "claude-3-opus",
      }),
    ];
    
    await expect(ops.setModel("nonexistent-model")).rejects.toThrow(
      "Model 'nonexistent-model' is not available"
    );
  });

  test("accepts valid OpenCode model with full ID", async () => {
    const mockSetModel = async (model: string) => {
      // Mock implementation
    };
    const ops = new UnifiedModelOperations("opencode", mockSetModel);
    // Pre-populate cache with valid models
    (ops as any).cachedModels = [
      createMockModel({
        id: "anthropic/claude-3-opus",
        providerID: "anthropic",
        modelID: "claude-3-opus",
      }),
    ];
    const result = await ops.setModel("anthropic/claude-3-opus");
    
    expect(result.success).toBe(true);
    expect(await ops.getCurrentModel()).toBe("anthropic/claude-3-opus");
  });

  test("accepts valid OpenCode model with just modelID", async () => {
    const mockSetModel = async (model: string) => {
      // Mock implementation
    };
    const ops = new UnifiedModelOperations("opencode", mockSetModel);
    // Pre-populate cache with valid models
    (ops as any).cachedModels = [
      createMockModel({
        id: "anthropic/claude-3-opus",
        providerID: "anthropic",
        modelID: "claude-3-opus",
      }),
    ];
    const result = await ops.setModel("claude-3-opus");
    
    expect(result.success).toBe(true);
    expect(await ops.getCurrentModel()).toBe("claude-3-opus");
  });
});

describe("UnifiedModelOperations - pending reasoning effort", () => {
  test("sets and gets pending reasoning effort", () => {
    const ops = new UnifiedModelOperations("copilot");
    expect(ops.getPendingReasoningEffort()).toBeUndefined();
    
    ops.setPendingReasoningEffort("high");
    expect(ops.getPendingReasoningEffort()).toBe("high");
    
    ops.setPendingReasoningEffort(undefined);
    expect(ops.getPendingReasoningEffort()).toBeUndefined();
  });

  test("handles multiple reasoning effort changes", () => {
    const ops = new UnifiedModelOperations("copilot");
    
    ops.setPendingReasoningEffort("low");
    expect(ops.getPendingReasoningEffort()).toBe("low");
    
    ops.setPendingReasoningEffort("medium");
    expect(ops.getPendingReasoningEffort()).toBe("medium");
    
    ops.setPendingReasoningEffort("high");
    expect(ops.getPendingReasoningEffort()).toBe("high");
  });
});

describe("UnifiedModelOperations - edge cases", () => {
  test("handles empty string model alias", () => {
    const ops = new UnifiedModelOperations("claude");
    expect(ops.resolveAlias("")).toBeUndefined();
  });

  test("sets model without SDK callbacks", async () => {
    const ops = new UnifiedModelOperations("claude");
    const result = await ops.setModel("sonnet");
    
    expect(result.success).toBe(true);
    expect(await ops.getCurrentModel()).toBe("sonnet");
  });

  test("getCurrentModel returns correct value after multiple setModel calls", async () => {
    const mockSetModel = async (model: string) => {
      // Mock implementation
    };
    const ops = new UnifiedModelOperations("claude", mockSetModel);
    
    await ops.setModel("sonnet");
    expect(await ops.getCurrentModel()).toBe("sonnet");
    
    await ops.setModel("opus");
    expect(await ops.getCurrentModel()).toBe("opus");
    
    await ops.setModel("haiku");
    expect(await ops.getCurrentModel()).toBe("haiku");
  });

  test("caches models for validation on subsequent setModel calls", async () => {
    const ops = new UnifiedModelOperations("copilot");
    
    // Pre-populate the cache directly
    (ops as any).cachedModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
      }),
    ];
    
    // setModel should use the cached models without calling listAvailableModels
    const result1 = await ops.setModel("gpt-4o");
    expect(result1.success).toBe(true);
    
    const result2 = await ops.setModel("gpt-4o");
    expect(result2.success).toBe(true);
    
    // Both calls should succeed using the same cached data
    expect(ops.getPendingModel()).toBe("gpt-4o");
  });
});
