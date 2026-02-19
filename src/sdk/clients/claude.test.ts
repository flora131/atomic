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
      "Model 'default' is not supported for Claude. Use one of: opus, sonnet, haiku."
    );
  });
});

describe("ClaudeAgentClient v2 runtime routing", () => {
  test("selects v2 runtime for default send path", () => {
    const client = new ClaudeAgentClient();
    const runtime = (
      client as unknown as {
        resolveRuntimeDecision: (
          operation: "send" | "stream" | "create" | "resume" | "summarize",
          config: Record<string, unknown>
        ) => { mode: string; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("send", {});

    expect(runtime.mode).toBe("v2");
    expect(runtime.fallbackReason).toBeNull();
  });

  test("selects v2 runtime for default stream and resume paths", () => {
    const client = new ClaudeAgentClient();
    const streamRuntime = (
      client as unknown as {
        resolveRuntimeDecision: (
          operation: "send" | "stream" | "create" | "resume" | "summarize",
          config: Record<string, unknown>
        ) => { mode: string; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("stream", {});
    const resumeRuntime = (
      client as unknown as {
        resolveRuntimeDecision: (
          operation: "send" | "stream" | "create" | "resume" | "summarize",
          config: Record<string, unknown>
        ) => { mode: string; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("resume", {});

    expect(streamRuntime.mode).toBe("v2");
    expect(streamRuntime.fallbackReason).toBeNull();
    expect(resumeRuntime.mode).toBe("v2");
    expect(resumeRuntime.fallbackReason).toBeNull();
  });

  test("keeps v2 runtime for advanced input options", () => {
    const client = new ClaudeAgentClient();
    const runtime = (
      client as unknown as {
        resolveRuntimeDecision: (
          operation: "send" | "stream" | "create" | "resume" | "summarize",
          config: Record<string, unknown>
        ) => { mode: string; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("stream", { maxTurns: 3 });

    expect(runtime.mode).toBe("v2");
    expect(runtime.fallbackReason).toBeNull();
  });

  test("keeps v2 routing when custom systemPrompt is configured", () => {
    const client = new ClaudeAgentClient();
    const runtime = (
      client as unknown as {
        resolveRuntimeDecision: (
          operation: "send" | "stream" | "create" | "resume" | "summarize",
          config: Record<string, unknown>
        ) => { mode: string; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("stream", { systemPrompt: "Custom instruction" });

    expect(runtime.mode).toBe("v2");
    expect(runtime.fallbackReason).toBeNull();
  });

});

describe("ClaudeAgentClient observability and parity", () => {
  test("emits runtime selection marker through unified usage events", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (
        client as unknown as {
          emitRuntimeSelectionFromDecision: (
            sessionId: string,
            operation: "create" | "resume" | "send" | "stream" | "summarize",
            decision: { mode: "v2" | "v1_fallback"; fallbackReason: string | null }
          ) => void;
        }
      ).emitRuntimeSelectionFromDecision("session-runtime", "send", {
        mode: "v2",
        fallbackReason: null,
      });

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.runtime.selected",
          runtimeMode: "v2",
          operation: "send",
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("emits fallback usage and reason markers through unified usage events", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (
        client as unknown as {
          emitRuntimeSelectionFromDecision: (
            sessionId: string,
            operation: "create" | "resume" | "send" | "stream" | "summarize",
            decision: { mode: "v2" | "v1_fallback"; fallbackReason: string | null }
          ) => void;
        }
      ).emitRuntimeSelectionFromDecision("session-fallback", "stream", {
        mode: "v1_fallback",
        fallbackReason: "fork_unsupported",
      });

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.runtime.selected",
          runtimeMode: "v1_fallback",
          operation: "stream",
        },
        {
          provider: "claude",
          marker: "claude.runtime.fallback_used",
          operation: "stream",
          fallbackReason: "fork_unsupported",
        },
        {
          provider: "claude",
          marker: "claude.runtime.fallback_reason",
          reason: "fork_unsupported",
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
          emitRuntimeSelectionFromDecision: (
            sessionId: string,
            operation: "create" | "resume" | "send" | "stream" | "summarize",
            decision: { mode: "v2" | "v1_fallback"; fallbackReason: string | null }
          ) => void;
        }
      ).emitRuntimeSelectionFromDecision("session-create", "create", {
        mode: "v2",
        fallbackReason: null,
      });

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.runtime.selected",
          runtimeMode: "v2",
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
        data: Record<string, unknown>
      ) => void;
    }).emitEvent("tool.complete", "session-1", { toolName: "Read", success: true });

    (client as unknown as {
      emitEvent: (
        eventType: "tool.complete" | "subagent.complete",
        sessionId: string,
        data: Record<string, unknown>
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
          data: Record<string, unknown>
        ) => void;
      }).emitEvent("tool.complete", "session-usage", {
        toolName: "Read",
        success: true,
      });

      (client as unknown as {
        emitEvent: (
          eventType: "tool.complete" | "subagent.complete" | "tool.start" | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>
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
          runtime: {
            runtimeMode: "v1_fallback";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
          }
        ) => { destroy: () => Promise<void> };
      }).wrapQuery(null, "session-start-gaps", {}, {
        runtimeMode: "v1_fallback",
        fallbackReason: null,
        capabilities: {
          supportsV2SendStream: false,
          supportsV2Resume: false,
          supportsForkSession: false,
          supportsAdvancedInput: true,
        },
      });

      (client as unknown as {
        emitEvent: (
          eventType: "tool.complete" | "subagent.complete" | "tool.start" | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>
        ) => void;
      }).emitEvent("tool.start", "session-start-gaps", { toolName: "Read" });

      (client as unknown as {
        emitEvent: (
          eventType: "tool.complete" | "subagent.complete" | "tool.start" | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>
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

  test("preserves resumed sdkSessionId in wrapped state", async () => {
    const client = new ClaudeAgentClient();

    const wrapped = (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          runtime: {
            runtimeMode: "v2";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
            sdkSessionId: string;
          }
        ) => { id: string; destroy: () => Promise<void> };
      }
    ).wrapQuery(null, "session-2", {}, {
      runtimeMode: "v2",
      fallbackReason: null,
      capabilities: {
        supportsV2SendStream: true,
        supportsV2Resume: true,
        supportsForkSession: false,
        supportsAdvancedInput: true,
      },
      sdkSessionId: "sdk-session-2",
    });

    const state = (
      client as unknown as {
        sessions: Map<string, { sdkSessionId: string | null }>;
      }
    ).sessions.get("session-2");

    expect(wrapped.id).toBe("session-2");
    expect(state?.sdkSessionId).toBe("sdk-session-2");
    await wrapped.destroy();
  });

  test("derives sdkSessionId from v2 session for fallback continuity", async () => {
    const client = new ClaudeAgentClient();

    const fakeV2Session = {
      get sessionId() {
        return "sdk-derived-session";
      },
      send: async () => {},
      stream: async function* () {},
      close: () => {},
      [Symbol.asyncDispose]: async () => {},
    };

    const wrapped = (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          runtime: {
            runtimeMode: "v2";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
            v2Session: unknown;
          }
        ) => { destroy: () => Promise<void> };
      }
    ).wrapQuery(null, "session-derived", {}, {
      runtimeMode: "v2",
      fallbackReason: null,
      capabilities: {
        supportsV2SendStream: true,
        supportsV2Resume: true,
        supportsForkSession: false,
        supportsAdvancedInput: true,
      },
      v2Session: fakeV2Session,
    });

    const state = (
      client as unknown as {
        sessions: Map<string, { sdkSessionId: string | null }>;
      }
    ).sessions.get("session-derived");

    expect(state?.sdkSessionId).toBe("sdk-derived-session");
    await wrapped.destroy();
  });

  test("keeps original sdkSessionId stable after v2 to fallback transition", async () => {
    const client = new ClaudeAgentClient();

    const wrapped = (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          runtime: {
            runtimeMode: "v2";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
            sdkSessionId: string;
          }
        ) => { destroy: () => Promise<void> };
        processMessage: (
          message: Record<string, unknown>,
          sessionId: string,
          state: {
            sdkSessionId: string | null;
            runtimeMode: "v2" | "v1_fallback";
            fallbackReason: string | null;
          }
        ) => void;
        sessions: Map<
          string,
          {
            sdkSessionId: string | null;
            runtimeMode: "v2" | "v1_fallback";
            fallbackReason: string | null;
          }
        >;
      }
    ).wrapQuery(null, "session-stable", {}, {
      runtimeMode: "v2",
      fallbackReason: null,
      capabilities: {
        supportsV2SendStream: true,
        supportsV2Resume: true,
        supportsForkSession: false,
        supportsAdvancedInput: true,
      },
      sdkSessionId: "sdk-stable",
    });

    const privateClient = client as unknown as {
      processMessage: (
        message: Record<string, unknown>,
        sessionId: string,
        state: {
          sdkSessionId: string | null;
          runtimeMode: "v2" | "v1_fallback";
          fallbackReason: string | null;
        }
      ) => void;
      sessions: Map<
        string,
        {
          sdkSessionId: string | null;
          runtimeMode: "v2" | "v1_fallback";
          fallbackReason: string | null;
        }
      >;
    };

    const state = privateClient.sessions.get("session-stable");
    if (!state) {
      throw new Error("Expected session state to exist");
    }

    state.runtimeMode = "v1_fallback";
    state.fallbackReason = "v2_execution_error";

    privateClient.processMessage(
      {
        type: "assistant",
        session_id: "sdk-changed",
        message: {
          content: [],
          usage: { input_tokens: 1, output_tokens: 1 },
          model: "sonnet",
          stop_reason: "end_turn",
        },
      },
      "session-stable",
      state
    );

    expect(state.sdkSessionId).toBe("sdk-stable");
    await wrapped.destroy();
  });

  test("normalizes AskUserQuestion permission events across v2 and fallback runtimes", async () => {
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
          sessionId?: string
        ) => {
          canUseTool?: (
            toolName: string,
            toolInput: Record<string, unknown>,
            options: { signal: AbortSignal }
          ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
        };
        buildV2SessionOptions: (
          config: Record<string, unknown>,
          sessionId: string
        ) => {
          canUseTool?: (
            toolName: string,
            toolInput: Record<string, unknown>
          ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
        };
      };

      const fallbackOptions = privateClient.buildSdkOptions({}, "session-fallback");
      const fallbackResult = await fallbackOptions.canUseTool?.(
        "AskUserQuestion",
        {
          questions: [{ question: "fallback question" }],
        },
        { signal: new AbortController().signal }
      );

      const v2Options = privateClient.buildV2SessionOptions({}, "session-v2");
      const v2Result = await v2Options.canUseTool?.("AskUserQuestion", {
        questions: [{ question: "v2 question" }],
      });

      expect(fallbackResult?.behavior).toBe("allow");
      expect(v2Result?.behavior).toBe("allow");
      expect((fallbackResult?.updatedInput.answers as Record<string, string>)["fallback question"]).toBe("yes");
      expect((v2Result?.updatedInput.answers as Record<string, string>)["v2 question"]).toBe("yes");

      expect(seenEvents).toEqual([
        {
          sessionId: "session-fallback",
          toolName: "AskUserQuestion",
          options: ["Yes", "No"],
        },
        {
          sessionId: "session-v2",
          toolName: "AskUserQuestion",
          options: ["Yes", "No"],
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("keeps tool permission and allowed-tool policy equivalent across v2 and fallback options", async () => {
    const client = new ClaudeAgentClient();

    const privateClient = client as unknown as {
      buildSdkOptions: (
        config: Record<string, unknown>,
        sessionId?: string
      ) => {
        allowedTools?: string[];
        canUseTool?: (
          toolName: string,
          toolInput: Record<string, unknown>,
          options: { signal: AbortSignal }
        ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
      };
      buildV2SessionOptions: (
        config: Record<string, unknown>,
        sessionId: string
      ) => {
        allowedTools?: string[];
        systemPrompt?: unknown;
        canUseTool?: (
          toolName: string,
          toolInput: Record<string, unknown>
        ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
      };
    };

    const fallbackOptions = privateClient.buildSdkOptions({}, "session-fallback");
    const v2Options = privateClient.buildV2SessionOptions({}, "session-v2");

    expect(fallbackOptions.allowedTools).toEqual(v2Options.allowedTools);
    expect(v2Options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });

    const v2WithPrompt = privateClient.buildV2SessionOptions(
      { systemPrompt: "Extra system guidance" },
      "session-v2",
    );
    expect(v2WithPrompt.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Extra system guidance",
    });

    const fallbackToolInput = { path: "src/index.ts" };
    const v2ToolInput = { path: "src/index.ts" };

    const fallbackResult = await fallbackOptions.canUseTool?.(
      "Read",
      fallbackToolInput,
      { signal: new AbortController().signal }
    );
    const v2Result = await v2Options.canUseTool?.("Read", v2ToolInput);

    expect(fallbackResult).toEqual({
      behavior: "allow",
      updatedInput: fallbackToolInput,
    });
    expect(v2Result).toEqual({
      behavior: "allow",
      updatedInput: v2ToolInput,
    });
  });

  test("normalizes AskUserQuestion custom options and multiselect answers equally", async () => {
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
        buildV2SessionOptions: (
          config: Record<string, unknown>,
          sessionId: string,
        ) => {
          canUseTool?: (
            toolName: string,
            toolInput: Record<string, unknown>,
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

      const fallbackResult = await privateClient
        .buildSdkOptions({}, "session-fallback")
        .canUseTool?.("AskUserQuestion", toolInput, {
          signal: new AbortController().signal,
        });
      const v2Result = await privateClient
        .buildV2SessionOptions({}, "session-v2")
        .canUseTool?.("AskUserQuestion", toolInput);

      expect((fallbackResult?.updatedInput.answers as Record<string, string>)["pick values"]).toBe(
        "alpha, beta",
      );
      expect((v2Result?.updatedInput.answers as Record<string, string>)["pick values"]).toBe(
        "alpha, beta",
      );
      expect(seenEvents).toEqual([
        { sessionId: "session-fallback", multiSelect: true },
        { sessionId: "session-v2", multiSelect: true },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("handles AskUserQuestion with empty question lists consistently", async () => {
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
      buildV2SessionOptions: (
        config: Record<string, unknown>,
        sessionId: string,
      ) => {
        canUseTool?: (
          toolName: string,
          toolInput: Record<string, unknown>,
        ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
      };
    };

    const fallbackInput = { questions: [] as Array<{ question: string }> };
    const v2Input = { questions: [] as Array<{ question: string }> };

    const fallbackResult = await privateClient
      .buildSdkOptions({}, "session-fallback")
      .canUseTool?.("AskUserQuestion", fallbackInput, {
        signal: new AbortController().signal,
      });
    const v2Result = await privateClient
      .buildV2SessionOptions({}, "session-v2")
      .canUseTool?.("AskUserQuestion", v2Input);

    expect(fallbackResult).toEqual({
      behavior: "allow",
      updatedInput: fallbackInput,
    });
    expect(v2Result).toEqual({
      behavior: "allow",
      updatedInput: v2Input,
    });
  });
});

describe("ClaudeAgentClient resume continuity semantics", () => {
  test("re-wraps active sessions without losing runtime and usage state", async () => {
    const client = new ClaudeAgentClient();
    (client as unknown as { isRunning: boolean }).isRunning = true;

    (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          runtime: {
            runtimeMode: "v2";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
            sdkSessionId: string;
            inputTokens: number;
            outputTokens: number;
            contextWindow: number;
            systemToolsBaseline: number;
          },
        ) => { destroy: () => Promise<void> };
      }
    ).wrapQuery(null, "resume-open", {}, {
      runtimeMode: "v2",
      fallbackReason: null,
      capabilities: {
        supportsV2SendStream: true,
        supportsV2Resume: true,
        supportsForkSession: false,
        supportsAdvancedInput: true,
      },
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
            runtimeMode: "v2" | "v1_fallback";
            fallbackReason: string | null;
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
      runtimeMode: "v2",
      fallbackReason: null,
      sdkSessionId: "sdk-resume-open",
      inputTokens: 123,
      outputTokens: 456,
      contextWindow: 200_000,
      systemToolsBaseline: 42,
    });

    await resumed?.destroy();
  });
});

describe("ClaudeAgentClient integration routing", () => {
  test("uses v2 session send/stream when runtime selects v2", async () => {
    const client = new ClaudeAgentClient();
    const sentMessages: string[] = [];

    const fakeV2Session = {
      get sessionId() {
        return "sdk-v2-session";
      },
      send: async (message: string) => {
        sentMessages.push(message);
      },
      stream: async function* () {
        yield {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "hello from v2" }],
            usage: { input_tokens: 3, output_tokens: 5 },
            model: "sonnet",
            stop_reason: "end_turn",
          },
          parent_tool_use_id: null,
          uuid: "u1",
          session_id: "sdk-v2-session",
        };

        yield {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          duration_api_ms: 1,
          is_error: false,
          num_turns: 1,
          result: "ok",
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: { input_tokens: 3, output_tokens: 5 },
          modelUsage: {},
          permission_denials: [],
          uuid: "u2",
          session_id: "sdk-v2-session",
        };
      },
      close: () => {},
      [Symbol.asyncDispose]: async () => {},
    };

    const session = (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          runtime: {
            runtimeMode: "v2";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
            v2Session: unknown;
            sdkSessionId: string;
          }
        ) => { send: (msg: string) => Promise<{ content: string | unknown }> };
      }
    ).wrapQuery(null, "session-v2", {}, {
      runtimeMode: "v2",
      fallbackReason: null,
      capabilities: {
        supportsV2SendStream: true,
        supportsV2Resume: true,
        supportsForkSession: false,
        supportsAdvancedInput: true,
      },
      v2Session: fakeV2Session,
      sdkSessionId: "sdk-v2-session",
    });

    const reply = await session.send("hello");
    expect(sentMessages).toEqual(["hello"]);
    expect(reply.content).toBe("hello from v2");
  });

  test("uses v2 session stream path when runtime selects v2", async () => {
    const client = new ClaudeAgentClient();
    const sentMessages: string[] = [];

    const fakeV2Session = {
      get sessionId() {
        return "sdk-v2-stream-session";
      },
      send: async (message: string) => {
        sentMessages.push(message);
      },
      stream: async function* () {
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: {
              type: "text_delta",
              text: "hello from v2 stream",
            },
          },
          session_id: "sdk-v2-stream-session",
        };

        yield {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          duration_api_ms: 1,
          is_error: false,
          num_turns: 1,
          result: "ok",
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: { input_tokens: 2, output_tokens: 4 },
          modelUsage: {},
          permission_denials: [],
          uuid: "u2",
          session_id: "sdk-v2-stream-session",
        };
      },
      close: () => {},
      [Symbol.asyncDispose]: async () => {},
    };

    const session = (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          runtime: {
            runtimeMode: "v2";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
            v2Session: unknown;
            sdkSessionId: string;
          }
        ) => {
          stream: (msg: string) => AsyncIterable<{
            type: string;
            content: string | unknown;
            role?: string;
          }>;
        };
      }
    ).wrapQuery(null, "session-v2-stream", {}, {
      runtimeMode: "v2",
      fallbackReason: null,
      capabilities: {
        supportsV2SendStream: true,
        supportsV2Resume: true,
        supportsForkSession: false,
        supportsAdvancedInput: true,
      },
      v2Session: fakeV2Session,
      sdkSessionId: "sdk-v2-stream-session",
    });

    const chunks: Array<{
      type: string;
      content: string | unknown;
      role?: string;
    }> = [];
    for await (const chunk of session.stream("hello stream")) {
      chunks.push(chunk);
    }

    expect(sentMessages).toEqual(["hello stream"]);
    expect(chunks).toEqual([
      {
        type: "text",
        content: "hello from v2 stream",
        role: "assistant",
      },
    ]);
  });

  test("keeps v2 create routing for advanced settings", () => {
    const client = new ClaudeAgentClient();

    const runtime = (
      client as unknown as {
        resolveRuntimeDecision: (
          operation: "send" | "stream" | "create" | "resume" | "summarize",
          config: Record<string, unknown>
        ) => { mode: string; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("create", { maxTurns: 2 });

    expect(runtime.mode).toBe("v2");
    expect(runtime.fallbackReason).toBeNull();
  });
});
