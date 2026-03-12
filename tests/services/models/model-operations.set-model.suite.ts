import { describe, expect, spyOn, test } from "bun:test";
import { UnifiedModelOperations } from "@/services/models/model-operations.ts";
import { createMockModel } from "./model-operations.test-support.ts";

describe("UnifiedModelOperations - setModel", () => {
  test("sets model for Claude without requiring new session", async () => {
    const mockSetModel = async (_model: string) => {};
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

  test("rejects Claude default model", async () => {
    const ops = new UnifiedModelOperations("claude");
    await expect(ops.setModel("default")).rejects.toThrow(
      "Model 'default' is not supported for Claude"
    );
    await expect(ops.setModel("anthropic/default")).rejects.toThrow(
      "Model 'default' is not supported for Claude"
    );
  });

  test("returns requiresNewSession for Copilot", async () => {
    const ops = new UnifiedModelOperations("copilot");
    const mockModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
        capabilities: {
          reasoning: true,
          attachment: false,
          temperature: true,
          toolCall: true,
        },
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);
    const result = await ops.setModel("gpt-4o");

    expect(result.success).toBe(true);
    expect(result.requiresNewSession).toBe(true);
    expect(ops.getPendingModel()).toBe("gpt-4o");
  });

  test("switches Copilot model immediately when SDK model setter is available", async () => {
    let capturedModel: string | undefined;
    let capturedReasoningEffort: string | undefined;
    const mockSetModel = async (
      model: string,
      options?: { reasoningEffort?: string }
    ) => {
      capturedModel = model;
      capturedReasoningEffort = options?.reasoningEffort;
    };
    const ops = new UnifiedModelOperations("copilot", mockSetModel);
    const mockModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
        capabilities: {
          reasoning: true,
          attachment: false,
          temperature: true,
          toolCall: true,
        },
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);
    ops.setPendingReasoningEffort("high");

    const result = await ops.setModel("gpt-4o");

    expect(result.success).toBe(true);
    expect(result.requiresNewSession).toBeUndefined();
    expect(capturedModel).toBe("gpt-4o");
    expect(capturedReasoningEffort).toBe("high");
    expect(await ops.getCurrentModel()).toBe("gpt-4o");
    expect(ops.getPendingModel()).toBeUndefined();
  });

  test("omits Copilot reasoning effort when the selected model does not support reasoning", async () => {
    let capturedReasoningEffort = "unset";
    const mockSetModel = async (
      _model: string,
      options?: { reasoningEffort?: string }
    ) => {
      capturedReasoningEffort = options?.reasoningEffort ?? "omitted";
    };
    const ops = new UnifiedModelOperations("copilot", mockSetModel);
    const mockModels = [
      createMockModel({
        id: "github-copilot/gpt-5.4",
        providerID: "github-copilot",
        modelID: "gpt-5.4",
        capabilities: {
          reasoning: false,
          attachment: false,
          temperature: true,
          toolCall: true,
        },
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);
    ops.setPendingReasoningEffort("high");

    const result = await ops.setModel("gpt-5.4");

    expect(result.success).toBe(true);
    expect(capturedReasoningEffort).toBe("omitted");
    expect(ops.getPendingReasoningEffort()).toBeUndefined();
  });

  test("clears pending Copilot reasoning effort for models that require a new session but do not support reasoning", async () => {
    const ops = new UnifiedModelOperations("copilot");
    const mockModels = [
      createMockModel({
        id: "github-copilot/gpt-5.4",
        providerID: "github-copilot",
        modelID: "gpt-5.4",
        capabilities: {
          reasoning: false,
          attachment: false,
          temperature: true,
          toolCall: true,
        },
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);
    ops.setPendingReasoningEffort("medium");

    const result = await ops.setModel("gpt-5.4");

    expect(result).toEqual({ success: true, requiresNewSession: true });
    expect(ops.getPendingReasoningEffort()).toBeUndefined();
  });

  test("validates model exists for Copilot before setting", async () => {
    const ops = new UnifiedModelOperations("copilot");
    const mockModels = [
      createMockModel({
        id: "github-copilot/gpt-4o",
        providerID: "github-copilot",
        modelID: "gpt-4o",
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);

    await expect(ops.setModel("nonexistent-model")).rejects.toThrow(
      "Model 'nonexistent-model' is not available"
    );
  });

  test("validates model exists for OpenCode before setting", async () => {
    const mockSetModel = async (_model: string) => {};
    const ops = new UnifiedModelOperations("opencode", mockSetModel);
    const mockModels = [
      createMockModel({
        id: "anthropic/claude-3-opus",
        providerID: "anthropic",
        modelID: "claude-3-opus",
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);

    await expect(ops.setModel("nonexistent-model")).rejects.toThrow(
      "Model 'nonexistent-model' is not available"
    );
  });

  test("accepts valid OpenCode model with full ID", async () => {
    const mockSetModel = async (_model: string) => {};
    const ops = new UnifiedModelOperations("opencode", mockSetModel);
    const mockModels = [
      createMockModel({
        id: "anthropic/claude-3-opus",
        providerID: "anthropic",
        modelID: "claude-3-opus",
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);
    const result = await ops.setModel("anthropic/claude-3-opus");

    expect(result.success).toBe(true);
    expect(await ops.getCurrentModel()).toBe("anthropic/claude-3-opus");
  });

  test("accepts valid OpenCode model with just modelID", async () => {
    const mockSetModel = async (_model: string) => {};
    const ops = new UnifiedModelOperations("opencode", mockSetModel);
    const mockModels = [
      createMockModel({
        id: "anthropic/claude-3-opus",
        providerID: "anthropic",
        modelID: "claude-3-opus",
      }),
    ];
    spyOn(ops, "listAvailableModels").mockResolvedValue(mockModels);
    const result = await ops.setModel("claude-3-opus");

    expect(result.success).toBe(true);
    expect(await ops.getCurrentModel()).toBe("claude-3-opus");
  });
});
