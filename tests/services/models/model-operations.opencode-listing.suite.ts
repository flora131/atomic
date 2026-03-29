import { describe, expect, test } from "bun:test";
import { listOpenCodeModels } from "@/services/models/model-operations/opencode.ts";
import type { OpenCodeSdkProvider } from "@/services/models/model-operations/opencode.ts";
import { makeOpenCodeModel } from "./model-transform.test-support.ts";

// ---------------------------------------------------------------------------
// listOpenCodeModels — direct unit tests for the exported function
// These tests supplement the UnifiedModelOperations integration tests
// by testing listOpenCodeModels in isolation with injected provider listers.
// ---------------------------------------------------------------------------

describe("listOpenCodeModels", () => {
  test("returns models from all providers", async () => {
    const models = await listOpenCodeModels(async (): Promise<OpenCodeSdkProvider[]> => [
      {
        id: "anthropic",
        name: "Anthropic",
        api: "anthropic",
        models: {
          "claude-sonnet-4-5": makeOpenCodeModel({ name: "Claude Sonnet 4.5" }),
        },
      },
      {
        id: "openai",
        name: "OpenAI",
        api: "openai",
        models: {
          "gpt-5": makeOpenCodeModel({
            name: "GPT-5",
            limit: { context: 256000, output: 32768 },
          }),
        },
      },
    ]);

    expect(models).toHaveLength(2);
    expect(models.map((m) => m.id)).toContain("anthropic/claude-sonnet-4-5");
    expect(models.map((m) => m.id)).toContain("openai/gpt-5");
  });

  test("filters out deprecated models", async () => {
    const models = await listOpenCodeModels(async () => [
      {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet-4-5": makeOpenCodeModel({
            name: "Claude Sonnet 4.5",
            status: undefined,
          }),
          "claude-2-old": makeOpenCodeModel({
            name: "Claude 2 (Old)",
            status: "deprecated",
          }),
          "claude-beta": makeOpenCodeModel({
            name: "Claude Beta",
            status: "beta",
          }),
        },
      },
    ]);

    expect(models).toHaveLength(2);
    const modelIds = models.map((m) => m.modelID);
    expect(modelIds).toContain("claude-sonnet-4-5");
    expect(modelIds).toContain("claude-beta");
    expect(modelIds).not.toContain("claude-2-old");
  });

  test("skips providers with no models property", async () => {
    const models = await listOpenCodeModels(async () => [
      {
        id: "empty-provider",
        name: "Empty Provider",
      },
      {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet-4-5": makeOpenCodeModel({ name: "Claude Sonnet 4.5" }),
        },
      },
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("anthropic/claude-sonnet-4-5");
  });

  test("throws when no models are available from any provider", async () => {
    await expect(
      listOpenCodeModels(async () => [
        {
          id: "empty",
          name: "Empty",
          models: {},
        },
      ]),
    ).rejects.toThrow("No models available from connected OpenCode providers");
  });

  test("throws when all models from all providers are deprecated", async () => {
    await expect(
      listOpenCodeModels(async () => [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-old": makeOpenCodeModel({
              name: "Claude Old",
              status: "deprecated",
            }),
          },
        },
      ]),
    ).rejects.toThrow("No models available from connected OpenCode providers");
  });

  test("throws when providers list is empty", async () => {
    await expect(
      listOpenCodeModels(async () => []),
    ).rejects.toThrow("No models available from connected OpenCode providers");
  });

  test("passes provider api and name to each model", async () => {
    const models = await listOpenCodeModels(async () => [
      {
        id: "openai",
        name: "OpenAI",
        api: "openai",
        models: {
          "gpt-5": makeOpenCodeModel({ name: "GPT-5" }),
        },
      },
    ]);

    expect(models[0]!.api).toBe("openai");
    expect(models[0]!.providerName).toBe("OpenAI");
    expect(models[0]!.providerID).toBe("openai");
  });

  test("handles multiple models from a single provider", async () => {
    const models = await listOpenCodeModels(async () => [
      {
        id: "anthropic",
        name: "Anthropic",
        api: "anthropic",
        models: {
          "claude-sonnet-4-5": makeOpenCodeModel({ name: "Claude Sonnet 4.5" }),
          "claude-opus-4": makeOpenCodeModel({
            name: "Claude Opus 4",
            limit: { context: 300000, output: 32768 },
          }),
          "claude-haiku-3-5": makeOpenCodeModel({
            name: "Claude Haiku 3.5",
            limit: { context: 200000, output: 8192 },
          }),
        },
      },
    ]);

    expect(models).toHaveLength(3);
    const modelIds = models.map((m) => m.modelID);
    expect(modelIds).toContain("claude-sonnet-4-5");
    expect(modelIds).toContain("claude-opus-4");
    expect(modelIds).toContain("claude-haiku-3-5");
  });

  test("propagates errors from the provider lister", async () => {
    await expect(
      listOpenCodeModels(async () => {
        throw new Error("Provider service unavailable");
      }),
    ).rejects.toThrow("Provider service unavailable");
  });

  test("handles providers with only undefined models property", async () => {
    await expect(
      listOpenCodeModels(async () => [
        {
          id: "no-models",
          name: "No Models",
        },
      ]),
    ).rejects.toThrow("No models available from connected OpenCode providers");
  });

  test("retains alpha and beta status models", async () => {
    const models = await listOpenCodeModels(async () => [
      {
        id: "test",
        name: "Test",
        models: {
          "alpha-model": makeOpenCodeModel({ name: "Alpha Model", status: "alpha" }),
          "beta-model": makeOpenCodeModel({ name: "Beta Model", status: "beta" }),
        },
      },
    ]);

    expect(models).toHaveLength(2);
    expect(models.find((m) => m.modelID === "alpha-model")?.status).toBe("alpha");
    expect(models.find((m) => m.modelID === "beta-model")?.status).toBe("beta");
  });
});
