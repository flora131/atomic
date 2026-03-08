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

    await client.setActiveSessionModel("anthropic/sonnet");

    expect((state.config as { model?: string }).model).toBe("sonnet");
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

describe("ClaudeAgentClient observability and parity", () => {
  test("preserves nativeType and native payload on bridged provider events", () => {
    const client = new ClaudeAgentClient();
    const providerEvents: Array<Record<string, unknown>> = [];

    client.onProviderEvent((event) => {
      providerEvents.push(event as unknown as Record<string, unknown>);
    });

    (
      client as unknown as {
        emitEvent: (
          eventType: "session.error",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }
    ).emitEvent("session.error", "session-provider", {
      error: "boom",
      code: "TEST",
    });

    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.type).toBe("session.error");
    expect(providerEvents[0]!.nativeType).toBe("session.error");
    expect((providerEvents[0]!.native as { type: string }).type).toBe("session.error");
  });

  test("captures Claude native subtype and metadata on provider events", () => {
    const client = new ClaudeAgentClient();
    const providerEvents: Array<Record<string, unknown>> = [];

    client.onProviderEvent((event) => {
      providerEvents.push(event as unknown as Record<string, unknown>);
    });

    (
      client as unknown as {
        emitProviderEvent: (
          eventType: "session.compaction",
          sessionId: string,
          data: Record<string, unknown>,
          options: { native: Record<string, unknown>; nativeSessionId: string; nativeEventId: string },
        ) => void;
      }
    ).emitProviderEvent("session.compaction", "session-native", {
      phase: "start",
    }, {
      native: {
        type: "system",
        subtype: "status",
        session_id: "sdk-session",
        uuid: "uuid-123",
        status: "compacting",
      },
      nativeSessionId: "sdk-session",
      nativeEventId: "uuid-123",
    });

    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.nativeSubtype).toBe("status");
    expect(providerEvents[0]!.nativeMeta).toEqual({
      nativeSessionId: "sdk-session",
      nativeMessageId: "uuid-123",
    });
  });

  test("emits v1 runtime selection marker through unified usage events", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (
        client as unknown as {
          emitRuntimeSelection: (
            sessionId: string,
            operation: "create" | "resume" | "send" | "stream" | "summarize",
          ) => void;
        }
      ).emitRuntimeSelection("session-runtime", "send");

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.runtime.selected",
          runtimeMode: "v1",
          operation: "send",
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("emits create runtime marker through unified usage event pipeline", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (
        client as unknown as {
          emitRuntimeSelection: (
            sessionId: string,
            operation: "create" | "resume" | "send" | "stream" | "summarize",
          ) => void;
        }
      ).emitRuntimeSelection("session-create", "create");

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.runtime.selected",
          runtimeMode: "v1",
          operation: "create",
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("tracks unmatched tool and subagent completion parity", () => {
    const client = new ClaudeAgentClient();

    (client as unknown as {
      emitEvent: (
        eventType: "tool.complete" | "subagent.complete",
        sessionId: string,
        data: Record<string, unknown>,
      ) => void;
    }).emitEvent("tool.complete", "session-1", { toolName: "Read", success: true });

    (client as unknown as {
      emitEvent: (
        eventType: "tool.complete" | "subagent.complete",
        sessionId: string,
        data: Record<string, unknown>,
      ) => void;
    }).emitEvent("subagent.complete", "session-1", {
      subagentId: "agent-1",
      success: true,
    });

    const integrity = (
      client as unknown as {
        streamIntegrity: {
          unmatchedToolCompletes: number;
          unmatchedSubagentCompletes: number;
        };
      }
    ).streamIntegrity;

    expect(integrity.unmatchedToolCompletes).toBe(1);
    expect(integrity.unmatchedSubagentCompletes).toBe(1);
  });

  test("does not bind session.error handlers to Stop hooks", () => {
    const client = new ClaudeAgentClient();
    const seenErrors: string[] = [];

    const unsubscribe = client.on("session.error", (event) => {
      const data = event.data as { error?: Error | string };
      const errorValue = data.error;
      seenErrors.push(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    });

    try {
      const privateClient = client as unknown as {
        registeredHooks: Record<string, Array<unknown> | undefined>;
        emitEvent: (
          eventType: "session.error",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      };

      expect(privateClient.registeredHooks.Stop).toBeUndefined();

      privateClient.emitEvent("session.error", "session-1", {
        error: "Maximum turns exceeded",
        code: "MAX_TURNS",
      });

      expect(seenErrors).toEqual(["Maximum turns exceeded"]);
    } finally {
      unsubscribe();
    }
  });

  test("maps hook sdk session IDs to wrapped session IDs for tool and subagent events", async () => {
    const client = new ClaudeAgentClient();
    const seenToolSessionIds: string[] = [];
    const seenSubagentSessionIds: string[] = [];

    const unsubTool = client.on("tool.start", (event) => {
      seenToolSessionIds.push(event.sessionId);
    });
    const unsubSubagent = client.on("subagent.start", (event) => {
      seenSubagentSessionIds.push(event.sessionId);
    });

    try {
      const privateClient = client as unknown as {
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          persisted?: {
            sdkSessionId?: string | null;
            inputTokens?: number;
            outputTokens?: number;
            contextWindow?: number | null;
            systemToolsBaseline?: number | null;
          },
        ) => { destroy: () => Promise<void> };
        sessions: Map<
          string,
          {
            sdkSessionId: string | null;
            isClosed: boolean;
          }
        >;
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});

      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      expect(preToolUseHook).toBeDefined();
      expect(subagentStartHook).toBeDefined();

      const hookSessionId = "sdk-hook-session-id";

      await preToolUseHook?.(
        {
          session_id: hookSessionId,
          tool_name: "Read",
          tool_input: { file: "src/main.rs" },
        },
        "tool_use_1",
        { signal: new AbortController().signal },
      );

      await subagentStartHook?.(
        {
          session_id: hookSessionId,
          agent_id: "agent-1",
          agent_type: "debugger",
        },
        "tool_use_2",
        { signal: new AbortController().signal },
      );

      expect(seenToolSessionIds).toEqual(["wrapped-session-id"]);
      expect(seenSubagentSessionIds).toEqual(["wrapped-session-id"]);
      expect(privateClient.sessions.get("wrapped-session-id")?.sdkSessionId).toBe(hookSessionId);

      await wrappedSession.destroy();
    } finally {
      unsubTool();
      unsubSubagent();
    }
  });

  test("maps parent_tool_call_id to parentAgentId for tool hooks", async () => {
    const client = new ClaudeAgentClient();
    const seenParentAgentIds: Array<string | undefined> = [];
    const seenParentToolIds: Array<string | undefined> = [];

    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as {
        parentAgentId?: string;
        parentToolUseId?: string;
      };
      seenParentAgentIds.push(data.parentAgentId);
      seenParentToolIds.push(data.parentToolUseId);
    });
    const unsubSubagent = client.on("subagent.start", () => {});

    try {
      const privateClient = client as unknown as {
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(preToolUseHook).toBeDefined();

      await subagentStartHook?.(
        {
          session_id: "sdk-main-session",
          agent_id: "agent-hook-1",
          tool_use_id: "subagent-hook-correlation-1",
          parent_tool_call_id: "parent-dispatch-call-1",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await preToolUseHook?.(
        {
          session_id: "sdk-main-session",
          tool_name: "WebSearch",
          tool_input: { query: "parallel tool routing" },
          parent_tool_call_id: "parent-dispatch-call-1",
        },
        "inner-tool-call-1",
        { signal: new AbortController().signal },
      );

      expect(seenParentToolIds).toContain("parent-dispatch-call-1");
      expect(seenParentAgentIds).toContain("agent-hook-1");

      await wrappedSession.destroy();
    } finally {
      unsubTool();
      unsubSubagent();
    }
  });

  test("prefers recorded task_started description over agent-type SubagentStart labels", async () => {
    const client = new ClaudeAgentClient();
    const seenTasks: string[] = [];

    const unsubscribe = client.on("subagent.start", (event) => {
      const data = event.data as { task?: string };
      if (typeof data.task === "string") {
        seenTasks.push(data.task);
      }
    });

    try {
      const privateClient = client as unknown as {
        processMessage: (
          sdkMessage: Record<string, unknown>,
          sessionId: string,
          state: {
            sdkSessionId: string | null;
            inputTokens: number;
            outputTokens: number;
            hasEmittedStreamingUsage: boolean;
          },
        ) => void;
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(
        null,
        "wrapped-session-id",
        {},
      );
      const state = {
        sdkSessionId: null,
        inputTokens: 0,
        outputTokens: 0,
        hasEmittedStreamingUsage: false,
      };

      privateClient.processMessage(
        {
          type: "system",
          subtype: "task_started",
          tool_use_id: "parent-task-use-id",
          description: "Investigate why sub-agent root labels regress",
        },
        "wrapped-session-id",
        state,
      );

      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      expect(subagentStartHook).toBeDefined();

      await subagentStartHook?.(
        {
          session_id: "sdk-main-session",
          agent_id: "agent-1",
          agent_type: "debugger",
          description: "debugger",
          tool_use_id: "subagent-start-use-id",
          parent_tool_use_id: "parent-task-use-id",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenTasks).toEqual([
        "Investigate why sub-agent root labels regress",
      ]);

      await wrappedSession.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("emits skill.invoked from PreToolUse when Claude Skill tool runs", async () => {
    const client = new ClaudeAgentClient();
    const invocations: Array<{
      sessionId: string;
      skillName?: string;
      skillPath?: string;
    }> = [];

    const unsubscribe = client.on("skill.invoked", (event) => {
      const data = event.data as {
        skillName?: string;
        skillPath?: string;
      };
      invocations.push({
        sessionId: event.sessionId,
        skillName: data.skillName,
        skillPath: data.skillPath,
      });
    });

    try {
      const privateClient = client as unknown as {
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(
        null,
        "wrapped-session-id",
        {},
      );
      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      expect(preToolUseHook).toBeDefined();

      await preToolUseHook?.(
        {
          session_id: "sdk-skill-session",
          tool_name: "Skill",
          tool_input: {
            name: "explain-code",
            path: "/tmp/skills/explain-code/SKILL.md",
          },
        },
        "skill_tool_use_1",
        { signal: new AbortController().signal },
      );

      await preToolUseHook?.(
        {
          session_id: "sdk-skill-session",
          tool_name: "Read",
          tool_input: { file_path: "README.md" },
        },
        "read_tool_use_1",
        { signal: new AbortController().signal },
      );

      expect(invocations).toEqual([
        {
          sessionId: "wrapped-session-id",
          skillName: "explain-code",
          skillPath: "/tmp/skills/explain-code/SKILL.md",
        },
      ]);

      await wrappedSession.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("maps child-session tool hooks to subagents when SubagentStart omits tool use IDs", async () => {
    const client = new ClaudeAgentClient();
    const seenParentAgentIds: Array<string | undefined> = [];

    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { parentAgentId?: string };
      seenParentAgentIds.push(data.parentAgentId);
    });
    const unsubSubagent = client.on("subagent.start", () => {});

    try {
      const privateClient = client as unknown as {
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(preToolUseHook).toBeDefined();

      // SubagentStart payload has no tool_use_id. We still need to queue this
      // subagent for later child-session correlation.
      await subagentStartHook?.(
        {
          session_id: "sdk-main-session",
          agent_id: "agent-child-1",
          agent_type: "researcher",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await preToolUseHook?.(
        {
          session_id: "sdk-child-session-1",
          tool_name: "WebSearch",
          tool_input: { query: "bm25 fundamentals" },
          tool_use_id: "child-tool-1",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenParentAgentIds).toContain("agent-child-1");

      await wrappedSession.destroy();
    } finally {
      unsubTool();
      unsubSubagent();
    }
  });

  test("binds concurrent hook session IDs deterministically via pending queue", async () => {
    const client = new ClaudeAgentClient();

    const privateClient = client as unknown as {
      wrapQuery: (
        queryInstance: null,
        sessionId: string,
        config: Record<string, unknown>,
      ) => { destroy: () => Promise<void> };
      pendingHookSessionBindings: string[];
      resolveHookSessionId: (sdkSessionId: string) => string;
      sessions: Map<string, { sdkSessionId: string | null }>;
    };

    const sessionA = privateClient.wrapQuery(null, "wrapped-a", {});
    const sessionB = privateClient.wrapQuery(null, "wrapped-b", {});
    const stateA = privateClient.sessions.get("wrapped-a") as { query?: { close?: () => void } } | undefined;
    const stateB = privateClient.sessions.get("wrapped-b") as { query?: { close?: () => void } } | undefined;
    if (stateA) stateA.query = { close: () => {} };
    if (stateB) stateB.query = { close: () => {} };
    privateClient.pendingHookSessionBindings.push("wrapped-a", "wrapped-b");

    try {
      const mappedA = privateClient.resolveHookSessionId("sdk-a");
      const mappedB = privateClient.resolveHookSessionId("sdk-b");

      expect(mappedA).toBe("wrapped-a");
      expect(mappedB).toBe("wrapped-b");
      expect(privateClient.sessions.get("wrapped-a")?.sdkSessionId).toBe("sdk-a");
      expect(privateClient.sessions.get("wrapped-b")?.sdkSessionId).toBe("sdk-b");
    } finally {
      await sessionA.destroy();
      await sessionB.destroy();
    }
  });

  test("uses hook payload fallback for subagent terminal signals when session_id/toolUseID arg are missing", async () => {
    const client = new ClaudeAgentClient();
    const seenSessionIds: string[] = [];
    const seenSubagentIds: string[] = [];
    const seenToolUseIds: Array<string | undefined> = [];

    const unsubStart = client.on("subagent.start", () => {});
    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string; toolUseID?: string };
      seenSessionIds.push(event.sessionId);
      seenSubagentIds.push(data.subagentId ?? "");
      seenToolUseIds.push(data.toolUseID);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        sessions: Map<string, { query?: { close?: () => void } }>;
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const wrappedState = privateClient.sessions.get("wrapped-session-id");
      if (wrappedState) {
        wrappedState.query = { close: () => {} };
      }

      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const subagentStopHook = privateClient.registeredHooks.SubagentStop?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(subagentStopHook).toBeDefined();

      await subagentStartHook?.(
        {
          agent_id: "agent-42",
          tool_use_id: "tool-use-42",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await subagentStopHook?.(
        {
          tool_use_id: "tool-use-42",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenSessionIds).toEqual(["wrapped-session-id"]);
      expect(seenSubagentIds).toEqual(["agent-42"]);
      expect(seenToolUseIds).toEqual(["tool-use-42"]);

      await wrappedSession.destroy();
    } finally {
      unsubStart();
      unsubComplete();
    }
  });

  test("routes subagent terminal signals by tool_use_id when session_id is omitted across multiple sessions", async () => {
    const client = new ClaudeAgentClient();
    const seenSessionIds: string[] = [];
    const seenSubagentIds: string[] = [];

    const unsubStart = client.on("subagent.start", () => {});
    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string };
      seenSessionIds.push(event.sessionId);
      seenSubagentIds.push(data.subagentId ?? "");
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        sessions: Map<
          string,
          {
            query?: { close?: () => void };
            sdkSessionId?: string | null;
          }
        >;
      };

      const wrappedMain = privateClient.wrapQuery(null, "wrapped-main", {});
      const wrappedWorker = privateClient.wrapQuery(null, "wrapped-worker", {});
      const mainState = privateClient.sessions.get("wrapped-main");
      const workerState = privateClient.sessions.get("wrapped-worker");
      if (mainState) {
        mainState.query = { close: () => {} };
        mainState.sdkSessionId = "sdk-main";
      }
      if (workerState) {
        workerState.query = { close: () => {} };
        workerState.sdkSessionId = "sdk-worker";
      }

      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const subagentStopHook = privateClient.registeredHooks.SubagentStop?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(subagentStopHook).toBeDefined();

      await subagentStartHook?.(
        {
          session_id: "sdk-worker",
          agent_id: "agent-77",
          tool_use_id: "tool-use-77",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await subagentStopHook?.(
        {
          tool_use_id: "tool-use-77",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenSessionIds).toEqual(["wrapped-worker"]);
      expect(seenSubagentIds).toEqual(["agent-77"]);

      await wrappedMain.destroy();
      await wrappedWorker.destroy();
    } finally {
      unsubStart();
      unsubComplete();
    }
  });

  test("maps task_notification terminal statuses to subagent.complete outcomes", () => {
    const client = new ClaudeAgentClient();
    const seenCompletions: Array<{
      sessionId: string;
      subagentId?: string;
      success?: boolean;
      result?: string;
    }> = [];

    const unsubscribe = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: string;
      };
      seenCompletions.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        success: data.success,
        result: data.result,
      });
    });

    try {
      const privateClient = client as unknown as {
        processMessage: (
          sdkMessage: Record<string, unknown>,
          sessionId: string,
          state: {
            sdkSessionId: string | null;
            inputTokens: number;
            outputTokens: number;
            hasEmittedStreamingUsage: boolean;
          },
        ) => void;
        toolUseIdToAgentId: Map<string, string>;
        toolUseIdToSessionId: Map<string, string>;
      };

      const state = {
        sdkSessionId: "sdk-session",
        inputTokens: 0,
        outputTokens: 0,
        hasEmittedStreamingUsage: false,
      };

      privateClient.toolUseIdToAgentId.set("tool-use-success", "agent-success");
      privateClient.toolUseIdToSessionId.set("tool-use-success", "wrapped-session");
      privateClient.processMessage(
        {
          type: "system",
          subtype: "task_notification",
          tool_use_id: "tool-use-success",
          status: "completed",
          summary: "done",
        },
        "wrapped-session",
        state,
      );

      privateClient.toolUseIdToAgentId.set("tool-use-error", "agent-error");
      privateClient.toolUseIdToSessionId.set("tool-use-error", "wrapped-session");
      privateClient.processMessage(
        {
          type: "system",
          subtype: "task_notification",
          tool_use_id: "tool-use-error",
          status: "failed",
          summary: "failed",
        },
        "wrapped-session",
        state,
      );

      expect(seenCompletions).toEqual([
        {
          sessionId: "wrapped-session",
          subagentId: "agent-success",
          success: true,
          result: "done",
        },
        {
          sessionId: "wrapped-session",
          subagentId: "agent-error",
          success: false,
          result: "failed",
        },
      ]);
      expect(privateClient.toolUseIdToAgentId.has("tool-use-success")).toBe(false);
      expect(privateClient.toolUseIdToSessionId.has("tool-use-success")).toBe(false);
      expect(privateClient.toolUseIdToAgentId.has("tool-use-error")).toBe(false);
      expect(privateClient.toolUseIdToSessionId.has("tool-use-error")).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  test("emits stream integrity counters through usage without payload leakage", async () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (client as unknown as {
        emitEvent: (
          eventType: "tool.complete" | "subagent.complete" | "tool.start" | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("tool.complete", "session-usage", {
        toolName: "Read",
        success: true,
      });

      (client as unknown as {
        emitEvent: (
          eventType: "tool.complete" | "subagent.complete" | "tool.start" | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("subagent.complete", "session-usage", {
        subagentId: "agent-1",
        success: true,
      });

      const session = (client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          persisted?: {
            sdkSessionId?: string | null;
            inputTokens?: number;
            outputTokens?: number;
            contextWindow?: number | null;
            systemToolsBaseline?: number | null;
          },
        ) => { destroy: () => Promise<void> };
      }).wrapQuery(null, "session-start-gaps", {});

      (client as unknown as {
        emitEvent: (
          eventType: "tool.complete" | "subagent.complete" | "tool.start" | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("tool.start", "session-start-gaps", { toolName: "Read" });

      (client as unknown as {
        emitEvent: (
          eventType: "tool.complete" | "subagent.complete" | "tool.start" | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("subagent.start", "session-start-gaps", {
        subagentType: "background",
      });

      await session.destroy();

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedToolCompletes: 1,
        },
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedSubagentCompletes: 1,
        },
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedToolStarts: 1,
        },
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedSubagentStarts: 1,
        },
      ]);

      for (const event of usageEvents) {
        expect("toolName" in event).toBe(false);
        expect("subagentId" in event).toBe(false);
        expect("subagentType" in event).toBe(false);
      }
    } finally {
      unsubscribe();
    }
  });
});

describe("ClaudeAgentClient permissions and options", () => {
  test("normalizes AskUserQuestion permission events via v1 canUseTool", async () => {
    const client = new ClaudeAgentClient();
    const seenEvents: Array<{
      sessionId: string;
      toolName: string;
      options: string[];
    }> = [];

    const unsubscribe = client.on("permission.requested", (event) => {
      const data = event.data as {
        toolName?: string;
        options?: Array<{ label: string }>;
        respond?: (answer: string | string[]) => void;
      };

      seenEvents.push({
        sessionId: event.sessionId,
        toolName: data.toolName ?? "",
        options: (data.options ?? []).map((option) => option.label),
      });
      data.respond?.("yes");
    });

    try {
      const privateClient = client as unknown as {
        buildSdkOptions: (
          config: Record<string, unknown>,
          sessionId?: string,
        ) => {
          canUseTool?: (
            toolName: string,
            toolInput: Record<string, unknown>,
            options: { signal: AbortSignal },
          ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
        };
      };

      const result = await privateClient
        .buildSdkOptions({}, "session-v1")
        .canUseTool?.(
          "AskUserQuestion",
          {
            questions: [{ question: "v1 question" }],
          },
          { signal: new AbortController().signal },
        );

      expect(result?.behavior).toBe("allow");
      expect((result?.updatedInput.answers as Record<string, string>)["v1 question"]).toBe("yes");
      expect(seenEvents).toEqual([
        {
          sessionId: "session-v1",
          toolName: "AskUserQuestion",
          options: ["Yes", "No"],
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("normalizes AskUserQuestion custom options and multiselect answers", async () => {
    const client = new ClaudeAgentClient();
    const seenEvents: Array<{ sessionId: string; multiSelect: boolean }> = [];

    const unsubscribe = client.on("permission.requested", (event) => {
      const data = event.data as {
        multiSelect?: boolean;
        respond?: (answer: string | string[]) => void;
      };

      seenEvents.push({
        sessionId: event.sessionId,
        multiSelect: data.multiSelect ?? false,
      });
      data.respond?.(["alpha", "beta"]);
    });

    try {
      const privateClient = client as unknown as {
        buildSdkOptions: (
          config: Record<string, unknown>,
          sessionId?: string,
        ) => {
          canUseTool?: (
            toolName: string,
            toolInput: Record<string, unknown>,
            options: { signal: AbortSignal },
          ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
        };
      };

      const toolInput = {
        questions: [
          {
            question: "pick values",
            multiSelect: true,
            options: [{ label: "alpha" }, { label: "beta" }],
          },
        ],
      };

      const result = await privateClient
        .buildSdkOptions({}, "session-v1")
        .canUseTool?.("AskUserQuestion", toolInput, {
          signal: new AbortController().signal,
        });

      expect((result?.updatedInput.answers as Record<string, string>)["pick values"]).toBe(
        "alpha, beta",
      );
      expect(seenEvents).toEqual([{ sessionId: "session-v1", multiSelect: true }]);
    } finally {
      unsubscribe();
    }
  });

  test("handles AskUserQuestion with empty question lists", async () => {
    const client = new ClaudeAgentClient();

    const privateClient = client as unknown as {
      buildSdkOptions: (
        config: Record<string, unknown>,
        sessionId?: string,
      ) => {
        canUseTool?: (
          toolName: string,
          toolInput: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
      };
    };

    const input = { questions: [] as Array<{ question: string }> };

    const result = await privateClient
      .buildSdkOptions({}, "session-v1")
      .canUseTool?.("AskUserQuestion", input, {
        signal: new AbortController().signal,
      });

    expect(result).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
  });

  test("builds v1 SDK options with allowed tools and claude_code system prompt", () => {
    const client = new ClaudeAgentClient();

    const privateClient = client as unknown as {
      buildSdkOptions: (
        config: Record<string, unknown>,
        sessionId?: string,
      ) => {
        allowedTools?: string[];
        systemPrompt?: unknown;
      };
    };

    const options = privateClient.buildSdkOptions({}, "session-v1");
    expect(options.allowedTools?.length).toBeGreaterThan(0);
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });

    const withPrompt = privateClient.buildSdkOptions(
      { additionalInstructions: "Extra system guidance" },
      "session-v1",
    );
    expect(withPrompt.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Extra system guidance",
    });
  });
});

describe("ClaudeAgentClient resume continuity semantics", () => {
  test("re-wraps active sessions without losing usage state and preserves hasEmittedStreamingUsage default", async () => {
    const client = new ClaudeAgentClient();
    (client as unknown as { isRunning: boolean }).isRunning = true;

    (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          persisted?: {
            sdkSessionId?: string | null;
            inputTokens?: number;
            outputTokens?: number;
            contextWindow?: number | null;
            systemToolsBaseline?: number | null;
          },
        ) => { destroy: () => Promise<void> };
      }
    ).wrapQuery(null, "resume-open", {}, {
      sdkSessionId: "sdk-resume-open",
      inputTokens: 123,
      outputTokens: 456,
      contextWindow: 200_000,
      systemToolsBaseline: 42,
    });

    const resumed = await client.resumeSession("resume-open");
    const resumedState = (
      client as unknown as {
        sessions: Map<
          string,
          {
            sdkSessionId: string | null;
            inputTokens: number;
            outputTokens: number;
            contextWindow: number | null;
            systemToolsBaseline: number | null;
          }
        >;
      }
    ).sessions.get("resume-open");

    expect(resumed).not.toBeNull();
    expect(resumedState).toMatchObject({
      sdkSessionId: "sdk-resume-open",
      inputTokens: 123,
      outputTokens: 456,
      contextWindow: 200_000,
      systemToolsBaseline: 42,
    });

    await resumed?.destroy();
  });
});

describe("ClaudeAgentClient streaming usage events", () => {
  test("message_delta with usage data triggers a usage client event during streaming", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        sessions: Map<string, { hasEmittedStreamingUsage: boolean }>;
        emitEvent: (
          eventType: string,
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
        detectedModel: string | null;
      };

      const session = privateClient.wrapQuery(null, "stream-usage-test", {});
      const state = privateClient.sessions.get("stream-usage-test");

      // Simulate what emitStreamingUsage does (arrow fn inside stream())
      // We test the state flag and emitEvent directly since the closure is internal
      expect(state?.hasEmittedStreamingUsage).toBe(false);

      state!.hasEmittedStreamingUsage = true;
      privateClient.emitEvent("usage", "stream-usage-test", {
        inputTokens: 0,
        outputTokens: 150,
        model: privateClient.detectedModel,
      });

      const streamingUsage = usageEvents.filter(
        (e) => typeof e.outputTokens === "number" && e.outputTokens > 0,
      );
      expect(streamingUsage).toHaveLength(1);
      expect(streamingUsage[0]).toMatchObject({
        inputTokens: 0,
        outputTokens: 150,
      });
      expect(state?.hasEmittedStreamingUsage).toBe(true);

      session.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("result handler emits inputTokens-only correction when hasEmittedStreamingUsage is true", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        sessions: Map<string, { hasEmittedStreamingUsage: boolean }>;
        processMessage: (
          msg: Record<string, unknown>,
          sessionId: string,
          state: Record<string, unknown>,
        ) => Record<string, unknown> | null;
      };

      const session = privateClient.wrapQuery(null, "result-guard-test", {});
      const state = privateClient.sessions.get("result-guard-test")!;

      // Simulate streaming path: flag is true
      state.hasEmittedStreamingUsage = true;

      // Process a result message with usage
      const resultMsg = {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 500, output_tokens: 200 },
      };
      privateClient.processMessage(
        resultMsg,
        "result-guard-test",
        state as unknown as Record<string, unknown>,
      );

      // Filter to non-marker usage events (exclude runtime selection, integrity, etc.)
      const tokenUsage = usageEvents.filter(
        (e) => typeof e.inputTokens === "number",
      );
      expect(tokenUsage).toHaveLength(1);
      // Should emit inputTokens but outputTokens: 0 (not double-counting)
      expect(tokenUsage[0]).toMatchObject({
        inputTokens: 500,
        outputTokens: 0,
      });
      // Flag should be reset after processing
      expect(state.hasEmittedStreamingUsage).toBe(false);

      session.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("send path (no message_delta) still emits full usage from result", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        sessions: Map<string, { hasEmittedStreamingUsage: boolean }>;
        processMessage: (
          msg: Record<string, unknown>,
          sessionId: string,
          state: Record<string, unknown>,
        ) => Record<string, unknown> | null;
      };

      const session = privateClient.wrapQuery(null, "send-usage-test", {});
      const state = privateClient.sessions.get("send-usage-test")!;

      // Send path: flag remains false (no streaming deltas)
      expect(state.hasEmittedStreamingUsage).toBe(false);

      const resultMsg = {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1000, output_tokens: 300 },
      };
      privateClient.processMessage(
        resultMsg,
        "send-usage-test",
        state as unknown as Record<string, unknown>,
      );

      const tokenUsage = usageEvents.filter(
        (e) => typeof e.inputTokens === "number",
      );
      expect(tokenUsage).toHaveLength(1);
      // Full usage emitted since no streaming usage was sent
      expect(tokenUsage[0]).toMatchObject({
        inputTokens: 1000,
        outputTokens: 300,
      });

      session.destroy();
    } finally {
      unsubscribe();
    }
  });
});
