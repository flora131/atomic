import { beforeEach, describe, expect, mock, test } from "bun:test";
import { UnifiedModelOperations } from "@/services/models/model-operations.ts";
import {
  createMockOpenCodeProviderModel,
} from "./model-operations.test-support.ts";

describe("UnifiedModelOperations - Claude model listing", () => {
  test("always includes canonical Claude aliases and omits default", async () => {
    const sdkListModels = async () => [
      { value: "default", displayName: "Default", description: "legacy" },
      { value: "sonnet", displayName: "Claude Sonnet", description: "sonnet alias" },
      { value: "claude-3-7-sonnet-20250101", displayName: "Claude 3.7 Sonnet", description: "extra model" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs.slice(0, 3)).toEqual(["opus", "sonnet", "haiku"]);
    expect(modelIDs).not.toContain("default");
    expect(modelIDs).toContain("claude-3-7-sonnet-20250101");
  });

  test("deduplicates canonical aliases from SDK results", async () => {
    const sdkListModels = async () => [
      { value: "Opus", displayName: "Claude Opus", description: "opus alias" },
      { value: "opus", displayName: "Claude Opus 2", description: "duplicate" },
      { value: "haiku", displayName: "Claude Haiku", description: "haiku alias" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);
    const opusCount = modelIDs.filter((m) => m === "opus").length;

    expect(opusCount).toBe(1);
    expect(modelIDs.slice(0, 3)).toEqual(["opus", "sonnet", "haiku"]);
  });
});

describe("UnifiedModelOperations - listAvailableModels with mocks", () => {
  let mockSdkListModels: () => Promise<Array<{ value: string; displayName: string; description: string }>>;

  beforeEach(() => {
    mockSdkListModels = async () => [];
  });

  test("throws error when sdkListModels callback is not provided for Claude", async () => {
    const ops = new UnifiedModelOperations("claude");

    await expect(ops.listAvailableModels()).rejects.toThrow(
      "Claude model listing requires an active session"
    );
  });

  test("uses the injected Copilot model lister when provided", async () => {
    let callCount = 0;
    const ops = new UnifiedModelOperations(
      "copilot",
      undefined,
      undefined,
      undefined,
      async () => {
        callCount += 1;
        return [
          {
            id: "gpt-5",
            name: "GPT-5",
            capabilities: {
              supports: { reasoningEffort: true, tools: true },
              limits: { max_context_window_tokens: 256000 },
            },
            supportedReasoningEfforts: ["low", "medium", "high"],
            defaultReasoningEffort: "medium",
          },
        ];
      }
    );

    const models = await ops.listAvailableModels();

    expect(callCount).toBe(1);
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("github-copilot/gpt-5");
    expect(models[0]?.modelID).toBe("gpt-5");
  });

  test("uses the injected OpenCode provider lister when provided", async () => {
    const ops = new UnifiedModelOperations(
      "opencode",
      undefined,
      undefined,
      undefined,
      undefined,
      async () => [
        {
          id: "openai",
          name: "OpenAI",
          api: "openai",
          models: {
            "gpt-5.4": createMockOpenCodeProviderModel({ name: "GPT-5.4" }),
          },
        },
      ],
    );

    const models = await ops.listAvailableModels();

    expect(models.map((model) => model.id)).toEqual([
      "openai/gpt-5.4",
    ]);
    expect(models[0]?.name).toBe("GPT-5.4");
  });

  test("falls back to provider.list models for OpenCode when no injected lister is provided", async () => {
    mock.module("@opencode-ai/sdk", () => ({
      createOpencodeClient: () => ({
        provider: {
          list: async () => ({
            data: {
              all: [
                {
                  id: "openai",
                  name: "OpenAI",
                  api: "openai",
                  models: {
                    "gpt-5.4": createMockOpenCodeProviderModel({ name: "GPT-5.4" }),
                  },
                },
                {
                  id: "anthropic",
                  name: "Anthropic",
                  api: "anthropic",
                  models: {
                    "claude-sonnet-4-5": createMockOpenCodeProviderModel({
                      name: "Claude Sonnet 4.5",
                    }),
                  },
                },
              ],
              connected: ["openai"],
            },
          }),
        },
      }),
    }));

    const ops = new UnifiedModelOperations("opencode");
    const models = await ops.listAvailableModels();

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("openai/gpt-5.4");
  });

  test("returns only canonical models when SDK returns empty array", async () => {
    mockSdkListModels = async () => [];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs).toEqual(["opus", "sonnet", "haiku"]);
    expect(models).toHaveLength(3);
  });

  test("filters out models with empty or whitespace-only values", async () => {
    mockSdkListModels = async () => [
      { value: "", displayName: "Empty", description: "should be filtered" },
      { value: "   ", displayName: "Whitespace", description: "should be filtered" },
      { value: "claude-custom", displayName: "Custom", description: "valid model" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs).not.toContain("");
    expect(modelIDs).not.toContain("   ");
    expect(modelIDs).toContain("claude-custom");
  });

  test("sorts extra models alphabetically by lowercase key, preserving original case", async () => {
    mockSdkListModels = async () => [
      { value: "claude-zebra", displayName: "Zebra", description: "z model" },
      { value: "Claude-Apple", displayName: "Apple", description: "a model" },
      { value: "claude-mango", displayName: "Mango", description: "m model" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs.slice(0, 3)).toEqual(["opus", "sonnet", "haiku"]);
    expect(modelIDs.slice(3)).toEqual(["Claude-Apple", "claude-mango", "claude-zebra"]);
  });

  test("uses SDK displayName for canonical models when provided", async () => {
    mockSdkListModels = async () => [
      { value: "sonnet", displayName: "Claude 3.5 Sonnet", description: "Latest Sonnet" },
      { value: "opus", displayName: "Claude 3.5 Opus", description: "Latest Opus" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const sonnetModel = models.find((m) => m.modelID === "sonnet");
    const opusModel = models.find((m) => m.modelID === "opus");

    expect(sonnetModel?.name).toBe("Claude 3.5 Sonnet");
    expect(opusModel?.name).toBe("Claude 3.5 Opus");
  });

  test("falls back to default displayName when SDK returns empty", async () => {
    mockSdkListModels = async () => [
      { value: "sonnet", displayName: "", description: "Sonnet model" },
      { value: "claude-extra", displayName: "", description: "Extra model" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const sonnetModel = models.find((m) => m.modelID === "sonnet");
    const extraModel = models.find((m) => m.modelID === "claude-extra");

    expect(sonnetModel?.name).toBe("Sonnet");
    expect(extraModel?.name).toBe("claude-extra");
  });

  test("falls back to default description when SDK returns empty", async () => {
    mockSdkListModels = async () => [
      { value: "sonnet", displayName: "Sonnet", description: "" },
      { value: "claude-extra", displayName: "Extra", description: "" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const sonnetModel = models.find((m) => m.modelID === "sonnet");
    const extraModel = models.find((m) => m.modelID === "claude-extra");

    expect(sonnetModel?.description).toBe("Claude sonnet model alias");
    expect(extraModel?.description).toBe("");
  });

  test("deduplicates extra models case-insensitively, keeping first occurrence", async () => {
    mockSdkListModels = async () => [
      { value: "Claude-Custom", displayName: "First Custom", description: "first" },
      { value: "claude-custom", displayName: "Second Custom", description: "second" },
      { value: "CLAUDE-CUSTOM", displayName: "Third Custom", description: "third" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const customModels = models.filter((m) => m.modelID.toLowerCase() === "claude-custom");

    expect(customModels).toHaveLength(1);
    expect(customModels[0]?.name).toBe("First Custom");
  });

  test("caches models after first call to listAvailableModels", async () => {
    let callCount = 0;
    mockSdkListModels = async () => {
      callCount++;
      return [
        { value: "claude-test", displayName: "Test", description: "test model" },
      ];
    };
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models1 = await ops.listAvailableModels();
    expect(callCount).toBe(1);

    const models2 = await ops.listAvailableModels();

    expect(callCount).toBe(1);
    expect(models1).toEqual(models2);
  });

  test("sets default context window of 200000 when SDK labels omit context", async () => {
    mockSdkListModels = async () => [
      { value: "sonnet", displayName: "Sonnet", description: "Sonnet" },
      { value: "claude-custom", displayName: "Custom", description: "Custom" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();

    for (const model of models) {
      expect(model.limits.context).toBe(200000);
    }
  });

  test("uses 1m context when SDK model labels include [1m]", async () => {
    mockSdkListModels = async () => [
      { value: "sonnet", displayName: "Sonnet [1m]", description: "Latest Sonnet" },
      { value: "claude-4-5-opus", displayName: "Opus", description: "Most capable [1m]" },
      { value: "haiku", displayName: "Haiku", description: "Fast model" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const sonnetModel = models.find((m) => m.modelID === "sonnet");
    const opusModel = models.find((m) => m.modelID === "claude-4-5-opus");
    const haikuModel = models.find((m) => m.modelID === "haiku");

    expect(sonnetModel?.limits.context).toBe(1000000);
    expect(opusModel?.limits.context).toBe(1000000);
    expect(haikuModel?.limits.context).toBe(200000);
  });

  test("parses explicit k/m context labels from model metadata", async () => {
    mockSdkListModels = async () => [
      { value: "opus", displayName: "Opus 200k", description: "Most capable" },
      { value: "claude-sonnet-plus", displayName: "Sonnet", description: "Context window: 1m tokens" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, mockSdkListModels);

    const models = await ops.listAvailableModels();
    const opusModel = models.find((m) => m.modelID === "opus");
    const sonnetPlus = models.find((m) => m.modelID === "claude-sonnet-plus");

    expect(opusModel?.limits.context).toBe(200000);
    expect(sonnetPlus?.limits.context).toBe(1000000);
  });
});
