import { describe, expect, test } from "bun:test";
import { ClaudeAgentClient } from "@/services/agents/clients/index.ts";
import { extractMessageContent } from "@/services/agents/clients/claude.ts";

describe("ClaudeAgentClient.getModelDisplayInfo", () => {
  test("falls back to opus when no model hint is provided", async () => {
    const client = new ClaudeAgentClient();
    const info = await client.getModelDisplayInfo();

    expect(info.model).toBe("opus");
  });

  test("normalizes default to opus", async () => {
    const client = new ClaudeAgentClient();
    const info = await client.getModelDisplayInfo("default");

    expect(info.model).toBe("opus");
  });

  test("normalizes claude family model IDs to canonical aliases", async () => {
    const client = new ClaudeAgentClient();

    const opus = await client.getModelDisplayInfo("anthropic/claude-3-opus-20240229");
    const sonnet = await client.getModelDisplayInfo("claude-3-5-sonnet-20241022");
    const haiku = await client.getModelDisplayInfo("claude-3-5-haiku-20241022");

    expect(opus.model).toBe("opus");
    expect(sonnet.model).toBe("sonnet");
    expect(haiku.model).toBe("haiku");
  });

  test("falls back to stripped raw ID for unknown models", async () => {
    const client = new ClaudeAgentClient();
    const info = await client.getModelDisplayInfo("anthropic/custom-model-x");

    expect(info.model).toBe("custom-model-x");
  });

  test("prefers model hint over detected model", async () => {
    const client = new ClaudeAgentClient();
    (client as unknown as { detectedModel: string }).detectedModel = "claude-3-5-sonnet-20241022";

    const info = await client.getModelDisplayInfo("claude-3-opus-20240229");
    expect(info.model).toBe("opus");
  });

  test("resolves context window using raw and canonical keys", async () => {
    const client = new ClaudeAgentClient();
    client.capturedModelContextWindows.set("claude-3-opus-20240229", 200_000);

    const rawInfo = await client.getModelDisplayInfo("claude-3-opus-20240229");
    expect(rawInfo.contextWindow).toBe(200_000);

    client.capturedModelContextWindows.clear();
    client.capturedModelContextWindows.set("opus", 300_000);

    const canonicalInfo = await client.getModelDisplayInfo("claude-3-opus-20240229");
    expect(canonicalInfo.contextWindow).toBe(300_000);
  });

  test("includes Claude reasoning metadata only when the SDK advertises it", async () => {
    const client = new ClaudeAgentClient();
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (
      client as unknown as {
        listSupportedModels: () => Promise<Array<{
          value: string;
          displayName: string;
          description: string;
          supportsEffort?: boolean;
          supportedEffortLevels?: Array<"low" | "medium" | "high" | "max">;
        }>>;
      }
    ).listSupportedModels = async () => ([
      {
        value: "sonnet",
        displayName: "Claude Sonnet",
        description: "Balanced",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      {
        value: "haiku",
        displayName: "Claude Haiku",
        description: "Fast",
      },
    ]);

    const supported = await client.getModelDisplayInfo("anthropic/sonnet");
    expect(supported.model).toBe("sonnet");
    expect(supported.supportsReasoning).toBe(true);
    expect(supported.supportedReasoningEfforts).toEqual(["low", "medium", "high", "max"]);
    expect(supported.defaultReasoningEffort).toBe("high");

    const unsupported = await client.getModelDisplayInfo("anthropic/haiku");
    expect(unsupported.model).toBe("haiku");
    expect(unsupported.supportsReasoning).toBe(false);
    expect(unsupported.supportedReasoningEfforts).toBeUndefined();
    expect(unsupported.defaultReasoningEffort).toBeUndefined();
  });

  test("maps SDK default reasoning metadata onto canonical opus display info", async () => {
    const client = new ClaudeAgentClient();
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (
      client as unknown as {
        listSupportedModels: () => Promise<Array<{
          value: string;
          displayName: string;
          description: string;
          supportsEffort?: boolean;
          supportedEffortLevels?: Array<"low" | "medium" | "high" | "max">;
        }>>;
      }
    ).listSupportedModels = async () => ([
      {
        value: "default",
        displayName: "Default",
        description: "Recommended",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
    ]);

    const info = await client.getModelDisplayInfo("anthropic/opus");

    expect(info.model).toBe("opus");
    expect(info.supportsReasoning).toBe(true);
    expect(info.supportedReasoningEfforts).toEqual(["low", "medium", "high", "max"]);
    expect(info.defaultReasoningEffort).toBe("high");
  });
});

describe("ClaudeAgentClient.setActiveSessionModel", () => {
  test("updates active session config without writing to the previous query transport", async () => {
    const client = new ClaudeAgentClient();
    const setModelCalls: string[] = [];

    const sessions = (client as unknown as { sessions: Map<string, unknown> }).sessions;
    const state = {
      query: {
        setModel: async (model: string) => {
          setModelCalls.push(model);
        },
      },
      sessionId: "test-session",
      sdkSessionId: null,
      config: {},
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      contextWindow: null,
      systemToolsBaseline: null,
    };
    sessions.set("test-session", state);

    await client.setActiveSessionModel("anthropic/sonnet", { reasoningEffort: "max" });

    expect((state.config as { model?: string }).model).toBe("sonnet");
    expect((state.config as { reasoningEffort?: string }).reasoningEffort).toBe("max");
    expect(setModelCalls).toHaveLength(0);
  });

  test("rejects default model alias", async () => {
    const client = new ClaudeAgentClient();

    await expect(client.setActiveSessionModel("default")).rejects.toThrow(
      "Model 'default' is not supported for Claude. Use one of: opus, sonnet, haiku.",
    );
  });
});

describe("ClaudeAgentClient.listSupportedModels", () => {
  test("uses the active session query once, then fetches fresh models on repeated calls", async () => {
    const client = new ClaudeAgentClient();
    (client as unknown as { isRunning: boolean }).isRunning = true;

    let activeQueryCalls = 0;
    let freshFetchCalls = 0;
    const sessions = (client as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set("test-session", {
      query: {
        supportedModels: async () => {
          activeQueryCalls += 1;
          return [{ value: "sonnet", displayName: "Sonnet", description: "cached" }];
        },
      },
      sessionId: "test-session",
      sdkSessionId: null,
      config: {},
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      contextWindow: null,
      systemToolsBaseline: null,
      hasEmittedStreamingUsage: false,
      pendingAbortPromise: null,
    });
    (
      client as unknown as {
        fetchFreshSupportedModels: () => Promise<Array<{ value: string; displayName: string; description: string }>>;
      }
    ).fetchFreshSupportedModels = async () => {
      freshFetchCalls += 1;
      return [{ value: "claude-4-2", displayName: "Claude 4.2", description: "fresh" }];
    };

    const first = await client.listSupportedModels();
    const second = await client.listSupportedModels();

    expect(first).toEqual([
      { value: "sonnet", displayName: "Sonnet", description: "cached" },
    ]);
    expect(second).toEqual([
      { value: "claude-4-2", displayName: "Claude 4.2", description: "fresh" },
    ]);
    expect(activeQueryCalls).toBe(1);
    expect(freshFetchCalls).toBe(1);
  });
});

describe("extractMessageContent thinking source identity", () => {
  test("returns thinking content with provider-native block index source key", () => {
    const message = {
      message: {
        content: [
          { type: "metadata" },
          { type: "thinking", thinking: "check invariants" },
        ],
      },
    } as unknown as Parameters<typeof extractMessageContent>[0];

    const extracted = extractMessageContent(message);

    expect(extracted.type).toBe("thinking");
    expect(extracted.content).toBe("check invariants");
    expect(extracted.thinkingSourceKey).toBe("1");
  });
});

describe("ClaudeAgentClient assistant message.complete preserves toolRequests", () => {
  test("processMessage passes child tool requests through normalized message.complete events", () => {
    const client = new ClaudeAgentClient();
    const events: Array<Record<string, unknown>> = [];

    client.on("message.complete", (event) => {
      events.push(event.data as Record<string, unknown>);
    });

    const processMessage = (client as unknown as {
      processMessage: (sdkMessage: unknown, sessionId: string, state: Record<string, unknown>) => void;
    }).processMessage.bind(client);

    processMessage({
      type: "assistant",
      uuid: "assistant-1",
      session_id: "child-session-1",
      parent_tool_use_id: "parent-task-1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "child-tool-1",
            name: "Read",
            input: { file_path: "test.ts" },
          },
        ],
        usage: {
          input_tokens: 11,
          output_tokens: 7,
        },
        model: "sonnet",
        stop_reason: "tool_use",
      },
    }, "wrapped-session", {
      query: null,
      sessionId: "wrapped-session",
      sdkSessionId: "parent-session",
      config: {},
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      contextWindow: null,
      systemToolsBaseline: null,
      hasEmittedStreamingUsage: false,
      pendingAbortPromise: null,
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.parentToolCallId).toBe("parent-task-1");
    expect(events[0]!.toolRequests).toEqual([
      {
        toolCallId: "child-tool-1",
        name: "Read",
        arguments: { file_path: "test.ts" },
      },
    ]);
    expect((events[0]!.message as Record<string, unknown>).type).toBe("tool_use");
  });
});
