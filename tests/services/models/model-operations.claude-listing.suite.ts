import { describe, expect, test } from "bun:test";
import { listClaudeModels } from "@/services/models/model-operations/claude.ts";

// ---------------------------------------------------------------------------
// listClaudeModels — direct unit tests for the exported function
// These tests supplement the UnifiedModelOperations integration tests
// by testing listClaudeModels directly with injected SDK listers.
// Focus areas: context window inference, error handling, and edge cases.
// ---------------------------------------------------------------------------

describe("listClaudeModels", () => {
  test("throws when sdkListModels is not provided", async () => {
    await expect(listClaudeModels(undefined)).rejects.toThrow(
      "Claude model listing requires an active session",
    );
  });

  test("infers context window from bracketed [1M] notation in displayName", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "claude-sonnet-extended",
        displayName: "Claude Sonnet Extended [1M]",
        description: "Extended context window",
      },
    ]);

    const extended = models.find(
      (m) => m.modelID === "claude-sonnet-extended",
    );
    expect(extended?.limits.context).toBe(1000000);
  });

  test("infers context window from bracketed [200K] notation", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "claude-opus-standard",
        displayName: "Claude Opus [200K]",
        description: "Standard model",
      },
    ]);

    const opus = models.find((m) => m.modelID === "claude-opus-standard");
    expect(opus?.limits.context).toBe(200000);
  });

  test("infers context window from description text", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "claude-test",
        displayName: "Test Model",
        description: "Context window: 1m tokens",
      },
    ]);

    const test = models.find((m) => m.modelID === "claude-test");
    expect(test?.limits.context).toBe(1000000);
  });

  test("falls back to 200000 when no context window hint in metadata", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "claude-plain",
        displayName: "Plain Model",
        description: "No context window info here",
      },
    ]);

    const plain = models.find((m) => m.modelID === "claude-plain");
    expect(plain?.limits.context).toBe(200000);
  });

  test("infers context from inline k label in value field", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "128k",
        displayName: "128k Model",
        description: "A model with 128k context",
      },
    ]);

    // The value field '128k' contains a k pattern match
    const model = models.find((m) => m.modelID === "128k");
    expect(model?.limits.context).toBe(128000);
  });

  test("handles decimal context window values", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "claude-decimal",
        displayName: "Decimal [1.5M]",
        description: "Has 1.5M tokens",
      },
    ]);

    const decimal = models.find((m) => m.modelID === "claude-decimal");
    expect(decimal?.limits.context).toBe(1500000);
  });

  test("includes canonical opus/sonnet/haiku even with empty SDK results", async () => {
    const models = await listClaudeModels(async () => []);

    expect(models).toHaveLength(3);
    const ids = models.map((m) => m.modelID);
    expect(ids).toEqual(["opus", "sonnet", "haiku"]);
  });

  test("canonical models always appear first in order", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "haiku",
        displayName: "Claude Haiku",
        description: "Fast",
      },
      {
        value: "zzz-custom",
        displayName: "Custom Z",
        description: "Z model",
      },
      {
        value: "aaa-custom",
        displayName: "Custom A",
        description: "A model",
      },
      {
        value: "opus",
        displayName: "Claude Opus",
        description: "Powerful",
      },
    ]);

    const ids = models.map((m) => m.modelID);
    expect(ids[0]).toBe("opus");
    expect(ids[1]).toBe("sonnet");
    expect(ids[2]).toBe("haiku");
    // Extra models sorted alphabetically after canonicals
    expect(ids[3]).toBe("aaa-custom");
    expect(ids[4]).toBe("zzz-custom");
  });

  test("propagates errors from SDK lister", async () => {
    await expect(
      listClaudeModels(async () => {
        throw new Error("Claude SDK session expired");
      }),
    ).rejects.toThrow("Claude SDK session expired");
  });

  test("maps default entry onto opus canonical model", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Uses Opus 4",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"] as Array<
          "low" | "medium" | "high" | "max"
        >,
      },
    ]);

    const opus = models.find((m) => m.modelID === "opus");
    expect(opus).toBeDefined();
    expect(opus!.supportedReasoningEfforts).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(opus!.description).toBe("Uses Opus 4");
    // "default" should not appear as a separate model
    const defaultModel = models.find((m) => m.modelID === "default");
    expect(defaultModel).toBeUndefined();
  });

  test("deduplicates extra models case-insensitively", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "Claude-Custom",
        displayName: "First Custom",
        description: "first",
      },
      {
        value: "claude-custom",
        displayName: "Duplicate Custom",
        description: "duplicate",
      },
    ]);

    const customModels = models.filter(
      (m) => m.modelID.toLowerCase() === "claude-custom",
    );
    expect(customModels).toHaveLength(1);
    expect(customModels[0]!.name).toBe("First Custom");
  });

  test("all returned models have anthropic providerID", async () => {
    const models = await listClaudeModels(async () => [
      {
        value: "custom-model",
        displayName: "Custom",
        description: "Custom model",
      },
    ]);

    for (const model of models) {
      expect(model.providerID).toBe("anthropic");
      expect(model.id.startsWith("anthropic/")).toBe(true);
    }
  });
});
