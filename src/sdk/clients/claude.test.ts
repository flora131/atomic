import { describe, expect, test } from "bun:test";
import { ClaudeAgentClient } from "./index.ts";

describe("ClaudeAgentClient.getModelDisplayInfo", () => {
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

describe("ClaudeAgentClient observability and parity", () => {
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
      { systemPrompt: "Extra system guidance" },
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
  test("re-wraps active sessions without losing usage state", async () => {
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
