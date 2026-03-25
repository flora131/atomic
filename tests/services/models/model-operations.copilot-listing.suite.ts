import { describe, expect, test } from "bun:test";
import { listCopilotModels } from "@/services/models/model-operations/copilot.ts";
import { makeCopilotModelInfo } from "./model-transform.test-support.ts";

// ---------------------------------------------------------------------------
// listCopilotModels — direct unit tests for the exported function
// These tests supplement the UnifiedModelOperations integration tests
// by testing listCopilotModels in isolation with injected model listers.
// ---------------------------------------------------------------------------

describe("listCopilotModels", () => {
  test("transforms models from injected SDK lister", async () => {
    const models = await listCopilotModels(async () => [
      makeCopilotModelInfo({ id: "gpt-4o", name: "GPT-4o" }),
      makeCopilotModelInfo({ id: "gpt-5", name: "GPT-5" }),
    ]);

    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe("github-copilot/gpt-4o");
    expect(models[0]!.providerID).toBe("github-copilot");
    expect(models[1]!.id).toBe("github-copilot/gpt-5");
  });

  test("returns empty array when SDK lister returns empty array", async () => {
    const models = await listCopilotModels(async () => []);
    expect(models).toEqual([]);
  });

  test("handles single model from SDK lister", async () => {
    const models = await listCopilotModels(async () => [
      makeCopilotModelInfo({
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        capabilities: {
          limits: { maxContextWindowTokens: 200000, maxPromptTokens: 16384 },
          supports: { reasoning: true, vision: false, tools: true },
        },
        supportedReasoningEfforts: ["low", "medium", "high"],
        defaultReasoningEffort: "medium",
      }),
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]!.modelID).toBe("claude-sonnet-4");
    expect(models[0]!.capabilities.reasoning).toBe(true);
    expect(models[0]!.supportedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(models[0]!.defaultReasoningEffort).toBe("medium");
  });

  test("propagates errors from SDK lister", async () => {
    await expect(
      listCopilotModels(async () => {
        throw new Error("Copilot SDK connection failed");
      }),
    ).rejects.toThrow("Copilot SDK connection failed");
  });

  test("preserves model capabilities from array-style supports", async () => {
    const models = await listCopilotModels(async () => [
      makeCopilotModelInfo({
        id: "test-model",
        name: "Test Model",
        capabilities: {
          limits: { maxContextWindowTokens: 128000 },
          supports: ["tools", "reasoning", "vision"],
        },
      }),
    ]);

    expect(models[0]!.capabilities.reasoning).toBe(true);
    expect(models[0]!.capabilities.attachment).toBe(true);
    expect(models[0]!.capabilities.toolCall).toBe(true);
  });

  test("preserves limits from SDK model info", async () => {
    const models = await listCopilotModels(async () => [
      makeCopilotModelInfo({
        id: "big-model",
        name: "Big Model",
        capabilities: {
          limits: { maxContextWindowTokens: 512000, maxPromptTokens: 32768 },
          supports: {},
        },
      }),
    ]);

    expect(models[0]!.limits.context).toBe(512000);
    expect(models[0]!.limits.output).toBe(32768);
  });
});
