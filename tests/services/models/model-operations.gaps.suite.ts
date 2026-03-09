import { describe, expect, spyOn, test } from "bun:test";
import {
  UnifiedModelOperations,
  type AgentType,
  type SetModelResult,
} from "@/services/models/model-operations.ts";
import { createMockModel } from "./model-operations.test-support.ts";

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
    const mockSetModel = async (_model: string) => {};
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
    const mockModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
      }),
    ];
    const listSpy = spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);

    const result1 = await ops.setModel("gpt-4o");
    expect(result1.success).toBe(true);
    expect(listSpy).toHaveBeenCalledTimes(1);

    const result2 = await ops.setModel("gpt-4o");
    expect(result2.success).toBe(true);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(ops.getPendingModel()).toBe("gpt-4o");
  });

  test("refetches models after cache invalidation", async () => {
    const ops = new UnifiedModelOperations("copilot");
    const firstModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
      }),
    ];
    const secondModels = [
      createMockModel({
        id: "github-copilot/gpt-5",
        providerID: "github-copilot",
        modelID: "gpt-5",
      }),
    ];
    const listSpy = spyOn(ops, "listAvailableModels")
      .mockResolvedValueOnce(firstModels)
      .mockResolvedValueOnce(secondModels);

    await ops.setModel("gpt-4o");
    expect(listSpy).toHaveBeenCalledTimes(1);

    ops.invalidateModelCache();

    await expect(ops.setModel("gpt-5")).resolves.toEqual({
      success: true,
      requiresNewSession: true,
    } satisfies SetModelResult);
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(ops.getPendingModel()).toBe("gpt-5");
  });
});

describe("UnifiedModelOperations - listAvailableModels gap tests", () => {
  test("throws for unsupported agent type", async () => {
    const ops = new UnifiedModelOperations("unknown" as AgentType);

    await expect(ops.listAvailableModels()).rejects.toThrow(
      "Unsupported agent type: unknown"
    );
  });

  test("propagates errors from sdkListModels callback", async () => {
    const sdkListModels = async () => {
      throw new Error("SDK connection failed");
    };
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    await expect(ops.listAvailableModels()).rejects.toThrow(
      "SDK connection failed"
    );
  });

  test("returns only canonical models when SDK returns only default entries", async () => {
    const sdkListModels = async () => [
      { value: "default", displayName: "Default", description: "default model" },
      { value: "Default", displayName: "Default 2", description: "another default" },
      { value: "DEFAULT", displayName: "Default 3", description: "yet another" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs).toEqual(["opus", "sonnet", "haiku"]);
    expect(models).toHaveLength(3);
  });

  test("canonical models always appear in opus/sonnet/haiku order regardless of SDK ordering", async () => {
    const sdkListModels = async () => [
      { value: "haiku", displayName: "Haiku First", description: "haiku" },
      { value: "sonnet", displayName: "Sonnet Second", description: "sonnet" },
      { value: "opus", displayName: "Opus Third", description: "opus" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs).toEqual(["opus", "sonnet", "haiku"]);
  });

  test("handles mixed-case canonical model values from SDK", async () => {
    const sdkListModels = async () => [
      { value: "HAIKU", displayName: "Haiku Upper", description: "upper haiku" },
      { value: "Sonnet", displayName: "Sonnet Mixed", description: "mixed sonnet" },
      { value: "OPUS", displayName: "Opus Upper", description: "upper opus" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs).toEqual(["opus", "sonnet", "haiku"]);
    expect(models).toHaveLength(3);

    const opusModel = models.find((m) => m.modelID === "opus");
    expect(opusModel?.name).toBe("Opus Upper");
  });
});

describe("UnifiedModelOperations - listModelsForClaude gap tests", () => {
  test("returns correct providerID for all models", async () => {
    const sdkListModels = async () => [
      { value: "sonnet", displayName: "Sonnet", description: "sonnet" },
      { value: "claude-custom-model", displayName: "Custom", description: "custom" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();

    for (const model of models) {
      expect(model.providerID).toBe("anthropic");
      expect(model.id).toBe(`anthropic/${model.modelID}`);
    }
  });

  test("builds correct model structure with all canonical and extra fields", async () => {
    const sdkListModels = async () => [
      { value: "opus", displayName: "Claude Opus 4", description: "Most capable" },
      { value: "claude-3-5-sonnet-20240620", displayName: "Claude 3.5 Sonnet", description: "Fast and smart" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();

    const opusModel = models.find((m) => m.modelID === "opus");
    expect(opusModel).toBeDefined();
    expect(opusModel!.id).toBe("anthropic/opus");
    expect(opusModel!.name).toBe("Claude Opus 4");
    expect(opusModel!.description).toBe("Most capable");
    expect(opusModel!.status).toBe("active");
    expect(opusModel!.limits.context).toBe(200000);
    expect(opusModel!.limits.output).toBe(16384);
    expect(opusModel!.capabilities.toolCall).toBe(true);

    const extraModel = models.find((m) => m.modelID === "claude-3-5-sonnet-20240620");
    expect(extraModel).toBeDefined();
    expect(extraModel!.id).toBe("anthropic/claude-3-5-sonnet-20240620");
    expect(extraModel!.name).toBe("Claude 3.5 Sonnet");
    expect(extraModel!.description).toBe("Fast and smart");
  });

  test("handles large mixed set of canonical and extra models", async () => {
    const sdkListModels = async () => [
      { value: "haiku", displayName: "Claude Haiku", description: "fast" },
      { value: "claude-3-opus-20240229", displayName: "Claude 3 Opus", description: "old opus" },
      { value: "claude-3-5-sonnet-20240620", displayName: "3.5 Sonnet", description: "mid" },
      { value: "opus", displayName: "Claude Opus", description: "powerful" },
      { value: "claude-3-haiku-20240307", displayName: "Claude 3 Haiku", description: "old haiku" },
      { value: "sonnet", displayName: "Claude Sonnet", description: "balanced" },
      { value: "default", displayName: "Default", description: "skip me" },
      { value: "claude-3-5-haiku-20241022", displayName: "3.5 Haiku", description: "newer haiku" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const modelIDs = models.map((m) => m.modelID);

    expect(modelIDs.slice(0, 3)).toEqual(["opus", "sonnet", "haiku"]);

    const extras = modelIDs.slice(3);
    expect(extras).toEqual([
      "claude-3-5-haiku-20241022",
      "claude-3-5-sonnet-20240620",
      "claude-3-haiku-20240307",
      "claude-3-opus-20240229",
    ]);

    expect(modelIDs).not.toContain("default");
    expect(models).toHaveLength(7);
  });

  test("last SDK entry wins for canonical model displayName and description", async () => {
    const sdkListModels = async () => [
      { value: "haiku", displayName: "Old Haiku Name", description: "old haiku desc" },
      { value: "haiku", displayName: "New Haiku Name", description: "new haiku desc" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const haikuModel = models.find((m) => m.modelID === "haiku");

    expect(haikuModel?.name).toBe("New Haiku Name");
    expect(haikuModel?.description).toBe("new haiku desc");
  });

  test("SDK entry with displayName but empty description uses SDK displayName and keeps default description", async () => {
    const sdkListModels = async () => [
      { value: "opus", displayName: "Claude Opus Latest", description: "" },
    ];
    const ops = new UnifiedModelOperations("claude", undefined, sdkListModels);

    const models = await ops.listAvailableModels();
    const opusModel = models.find((m) => m.modelID === "opus");

    expect(opusModel?.name).toBe("Claude Opus Latest");
    expect(opusModel?.description).toBe("Claude opus model alias");
  });
});
