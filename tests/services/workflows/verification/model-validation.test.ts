/**
 * Tests for model-validation verification checker.
 *
 * Mocks the SDK layer (UnifiedModelOperations) to test real validation
 * logic — extraction, model matching, alias resolution, and reasoning
 * effort checks.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { checkModelValidation } from "@/services/workflows/verification/model-validation.ts";
import type { Model } from "@/services/models/model-transform.ts";
import type { StageDefinition } from "@/services/workflows/conductor/types.ts";

// ---------------------------------------------------------------------------
// Mock: UnifiedModelOperations
// ---------------------------------------------------------------------------

const mockListAvailableModels = mock<() => Promise<Model[]>>(() =>
  Promise.resolve([]),
);

mock.module("@/services/models/model-operations.ts", () => ({
  UnifiedModelOperations: class {
    constructor(_agentType: string) {}
    listAvailableModels = mockListAvailableModels;
  },
  CLAUDE_ALIASES: {
    sonnet: "sonnet",
    opus: "opus",
    haiku: "haiku",
  } as Record<string, string>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(overrides: Partial<Model> & { id: string; modelID: string }): Model {
  return {
    providerID: "test",
    name: overrides.modelID,
    status: "active" as const,
    capabilities: { reasoning: false, attachment: false, temperature: false, toolCall: true },
    limits: { context: 200_000, output: 8_192 },
    options: {},
    ...overrides,
  };
}

function makeStage(
  id: string,
  sessionConfig?: StageDefinition["sessionConfig"],
): StageDefinition {
  return {
    id,
    indicator: `[${id}]`,
    buildPrompt: () => "prompt",
    sessionConfig,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockListAvailableModels.mockReset();
  mockListAvailableModels.mockResolvedValue([]);
});

describe("checkModelValidation", () => {
  test("returns verified when no stages reference models", async () => {
    const result = await checkModelValidation([
      makeStage("s1"),
      makeStage("s2", {}),
    ]);
    expect(result.verified).toBe(true);
    expect(mockListAvailableModels).not.toHaveBeenCalled();
  });

  test("returns verified when model exists for agent type", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({ id: "anthropic/claude-sonnet-4-5", modelID: "claude-sonnet-4-5" }),
    ]);

    const result = await checkModelValidation([
      makeStage("planner", {
        model: { claude: "claude-sonnet-4-5" },
      }),
    ]);

    expect(result.verified).toBe(true);
  });

  test("returns verified when model matches by full id", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({ id: "anthropic/claude-sonnet-4-5", modelID: "claude-sonnet-4-5" }),
    ]);

    const result = await checkModelValidation([
      makeStage("planner", {
        model: { claude: "anthropic/claude-sonnet-4-5" },
      }),
    ]);

    expect(result.verified).toBe(true);
  });

  test("returns error when model is not available", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({ id: "anthropic/claude-sonnet-4-5", modelID: "claude-sonnet-4-5" }),
    ]);

    const result = await checkModelValidation([
      makeStage("planner", {
        model: { claude: "nonexistent-model" },
      }),
    ]);

    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain("nonexistent-model");
    expect(result.counterexample).toContain("planner");
  });

  test("returns warning when SDK cannot list models", async () => {
    mockListAvailableModels.mockRejectedValue(new Error("SDK not available"));

    const result = await checkModelValidation([
      makeStage("planner", {
        model: { claude: "claude-sonnet-4-5" },
      }),
    ]);

    expect(result.verified).toBe(true);
    expect(result.details).toBeDefined();
    expect((result.details as { warnings: string[] }).warnings.length).toBeGreaterThan(0);
  });

  test("validates reasoning effort on a capable model", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({
        id: "anthropic/claude-sonnet-4-5",
        modelID: "claude-sonnet-4-5",
        capabilities: { reasoning: true, attachment: false, temperature: false, toolCall: true },
        supportedReasoningEfforts: ["low", "medium", "high"],
      }),
    ]);

    const result = await checkModelValidation([
      makeStage("planner", {
        model: { claude: "claude-sonnet-4-5" },
        reasoningEffort: { claude: "high" },
      }),
    ]);

    expect(result.verified).toBe(true);
  });

  test("returns error for reasoning effort on non-reasoning model", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({
        id: "anthropic/claude-haiku-3-5",
        modelID: "claude-haiku-3-5",
        capabilities: { reasoning: false, attachment: false, temperature: false, toolCall: true },
      }),
    ]);

    const result = await checkModelValidation([
      makeStage("fast-stage", {
        model: { claude: "claude-haiku-3-5" },
        reasoningEffort: { claude: "high" },
      }),
    ]);

    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain("does not support reasoning");
  });

  test("returns error for unsupported reasoning effort level", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({
        id: "anthropic/claude-sonnet-4-5",
        modelID: "claude-sonnet-4-5",
        capabilities: { reasoning: true, attachment: false, temperature: false, toolCall: true },
        supportedReasoningEfforts: ["low", "medium", "high"],
      }),
    ]);

    const result = await checkModelValidation([
      makeStage("planner", {
        model: { claude: "claude-sonnet-4-5" },
        reasoningEffort: { claude: "ultra" },
      }),
    ]);

    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain("ultra");
    expect(result.counterexample).toContain("not supported");
  });

  test("validates multiple agent types independently", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({ id: "test/gpt-4o", modelID: "gpt-4o" }),
    ]);

    const result = await checkModelValidation([
      makeStage("s1", { model: { copilot: "gpt-4o" } }),
      makeStage("s2", { model: { opencode: "gpt-4o" } }),
    ]);

    expect(result.verified).toBe(true);
  });

  test("extracts reasoning-only references (no model specified)", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({ id: "anthropic/claude-sonnet-4-5", modelID: "claude-sonnet-4-5" }),
    ]);

    const result = await checkModelValidation([
      makeStage("thinker", {
        reasoningEffort: { claude: "high" },
      }),
    ]);

    // Model is empty string — skipped in validation loop, so verified passes
    expect(result.verified).toBe(true);
  });

  test("reports multiple errors across stages", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({ id: "anthropic/claude-sonnet-4-5", modelID: "claude-sonnet-4-5" }),
    ]);

    const result = await checkModelValidation([
      makeStage("s1", { model: { claude: "missing-model-a" } }),
      makeStage("s2", { model: { claude: "missing-model-b" } }),
    ]);

    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain("missing-model-a");
    expect(result.counterexample).toContain("missing-model-b");
    const details = result.details as { errors: string[] };
    expect(details.errors).toHaveLength(2);
  });

  test("resolves claude alias to canonical model id", async () => {
    mockListAvailableModels.mockResolvedValue([
      makeModel({ id: "anthropic/sonnet", modelID: "sonnet" }),
    ]);

    const result = await checkModelValidation([
      makeStage("planner", {
        model: { claude: "sonnet" },
      }),
    ]);

    expect(result.verified).toBe(true);
  });
});
