import { describe, expect, test } from "bun:test";
import {
  createMockContext,
  modelCommand,
} from "./builtin-commands.test-support.ts";

describe("Built-in Commands modelCommand", () => {
  test("bootstraps a session when /model is first command", async () => {
    let ensureSessionCalls = 0;
    const context = createMockContext({
      session: null,
      ensureSession: async () => {
        ensureSessionCalls += 1;
      },
      modelOps: {} as never,
    });

    const result = await modelCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.showModelSelector).toBe(true);
    expect(ensureSessionCalls).toBe(1);
  });

  test("returns a clear error when session bootstrap fails", async () => {
    const context = createMockContext({
      session: null,
      ensureSession: async () => {
        throw new Error("connection refused");
      },
      modelOps: {} as never,
    });

    const result = await modelCommand.execute("list", context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to start session for /model");
    expect(result.message).toContain("connection refused");
  });

  test("shows model selector when no args provided", async () => {
    const result = await modelCommand.execute(
      "",
      createMockContext({ modelOps: {} as never }),
    );

    expect(result.success).toBe(true);
    expect(result.showModelSelector).toBe(true);
  });

  test("shows model selector with select subcommand", async () => {
    const result = await modelCommand.execute(
      "select",
      createMockContext({ modelOps: {} as never }),
    );

    expect(result.success).toBe(true);
    expect(result.showModelSelector).toBe(true);
  });

  test("lists available models", async () => {
    const mockModels = [
      {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        name: "Claude Sonnet 4",
      },
      { providerID: "openai", modelID: "gpt-4", name: "GPT-4" },
    ];

    const result = await modelCommand.execute(
      "list",
      createMockContext({
        modelOps: { listAvailableModels: async () => mockModels } as never,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.showModelSelector).toBeUndefined();
    expect(result.message).toContain("anthropic");
    expect(result.message).toContain("openai");
  });

  test("invalidates the model cache on repeated invocations in the same session", async () => {
    let invalidationCalls = 0;
    let listCalls = 0;
    const context = createMockContext({
      modelOps: {
        invalidateModelCache: () => {
          invalidationCalls += 1;
        },
        listAvailableModels: async () => {
          listCalls += 1;
          return [
            {
              providerID: "anthropic",
              modelID: "claude-sonnet-4",
              name: "Claude Sonnet 4",
            },
          ];
        },
      } as never,
    });

    const firstResult = await modelCommand.execute("list", context);
    const secondResult = await modelCommand.execute("list", context);

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(invalidationCalls).toBe(2);
    expect(listCalls).toBe(2);
  });

  test("filters models by provider", async () => {
    const mockModels = [
      {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        name: "Claude Sonnet 4",
      },
      { providerID: "openai", modelID: "gpt-4", name: "GPT-4" },
    ];

    const result = await modelCommand.execute(
      "list anthropic",
      createMockContext({
        modelOps: { listAvailableModels: async () => mockModels } as never,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.showModelSelector).toBeUndefined();
    expect(result.message).toContain("anthropic");
    expect(result.message).not.toContain("openai");
  });

  test("handles no models available", async () => {
    const result = await modelCommand.execute(
      "list",
      createMockContext({
        modelOps: { listAvailableModels: async () => [] } as never,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.showModelSelector).toBeUndefined();
    expect(result.stateUpdate).toBeUndefined();
    expect(result.message).toContain("No models available");
  });

  test("prevents model switch during streaming", async () => {
    const result = await modelCommand.execute(
      "claude-opus-4",
      createMockContext({
        state: { isStreaming: true, messageCount: 1 },
        modelOps: {} as never,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.stateUpdate).toBeUndefined();
    expect(result.showModelSelector).toBeUndefined();
    expect(result.message).toContain("Cannot switch models while");
  });

  test("switches model successfully", async () => {
    const result = await modelCommand.execute(
      "claude-sonnet-4",
      createMockContext({
        state: { isStreaming: false, messageCount: 1 },
        agentType: "claude" as never,
        modelOps: {
          resolveAlias: (model: string) => model,
          setModel: async () => ({ requiresNewSession: false }),
        } as never,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.stateUpdate).toBeDefined();
    expect(result.stateUpdate).toHaveProperty("model", "claude-sonnet-4");
  });

  test("uses effective model from modelOps for state update", async () => {
    const result = await modelCommand.execute(
      "anthropic/opus",
      createMockContext({
        state: { isStreaming: false, messageCount: 1 },
        agentType: "claude" as never,
        modelOps: {
          resolveAlias: (_model: string) => undefined,
          setModel: async () => ({ requiresNewSession: false }),
          getCurrentModel: async () => "opus",
        } as never,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.stateUpdate).toBeDefined();
    expect(result.stateUpdate).toHaveProperty("model", "opus");
  });

  test("handles model switch requiring new session", async () => {
    const result = await modelCommand.execute(
      "claude-opus-4",
      createMockContext({
        state: { isStreaming: false, messageCount: 1 },
        agentType: "claude" as never,
        modelOps: {
          resolveAlias: (model: string) => model,
          setModel: async () => ({ requiresNewSession: true }),
        } as never,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.stateUpdate).toBeDefined();
    expect(result.stateUpdate).toHaveProperty("pendingModel", "claude-opus-4");
  });

  test("handles model switch error", async () => {
    const result = await modelCommand.execute(
      "invalid-model",
      createMockContext({
        state: { isStreaming: false, messageCount: 1 },
        modelOps: {
          resolveAlias: (model: string) => model,
          setModel: async () => {
            throw new Error("Model not found");
          },
        } as never,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.stateUpdate).toBeUndefined();
    expect(result.showModelSelector).toBeUndefined();
    expect(result.message).toContain("Failed to switch model");
  });
});
