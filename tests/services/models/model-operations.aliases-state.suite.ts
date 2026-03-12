import { describe, expect, spyOn, test } from "bun:test";
import { CLAUDE_ALIASES, UnifiedModelOperations } from "@/services/models/model-operations.ts";
import { createMockModel } from "./model-operations.test-support.ts";

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
    expect(ops.resolveAlias("default")).toBeUndefined();
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
    const mockSetModel = async (_model: string) => {};
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
    await ops.setModel("gpt-4o");
    expect(ops.getPendingModel()).toBe("gpt-4o");
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

describe("UnifiedModelOperations - initialModel normalization", () => {
  test("normalizes 'default' initial model to 'opus' for Claude", async () => {
    const ops = new UnifiedModelOperations("claude", undefined, undefined, "default");
    expect(await ops.getCurrentModel()).toBe("opus");
  });

  test("normalizes 'provider/default' initial model to 'provider/opus' for Claude", async () => {
    const ops = new UnifiedModelOperations("claude", undefined, undefined, "anthropic/default");
    expect(await ops.getCurrentModel()).toBe("anthropic/opus");
  });

  test("does not normalize initial model for non-Claude agents", async () => {
    const ops = new UnifiedModelOperations("copilot", undefined, undefined, "default");
    expect(await ops.getCurrentModel()).toBe("default");
  });

  test("trims whitespace from initial model for Claude", async () => {
    const ops = new UnifiedModelOperations("claude", undefined, undefined, "  sonnet  ");
    expect(await ops.getCurrentModel()).toBe("sonnet");
  });
});
