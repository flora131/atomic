import { describe, expect, test } from "bun:test";
import {
  COMPACTION_TERMINAL_ERROR_MESSAGE,
  isContextOverflowError,
  OpenCodeClient,
  OpenCodeCompactionError,
  transitionOpenCodeCompactionControl,
} from "./opencode.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "../../workflows/runtime-parity-observability.ts";

describe("isContextOverflowError", () => {
  test("detects overflow messages across known pattern variants", () => {
    const overflowErrors = [
      "ContextOverflowError: Input exceeds context window of this model",
      "code=context_length_exceeded",
      "prompt is too long for this model",
      "Request too large for provider",
      "Exceeded the model's maximum context length",
      "Too many tokens in request",
    ];

    for (const message of overflowErrors) {
      expect(isContextOverflowError(message)).toBe(true);
      expect(isContextOverflowError(new Error(message))).toBe(true);
    }
  });

  test("does not flag unrelated errors as overflow", () => {
    expect(isContextOverflowError("Rate limit exceeded")).toBe(false);
    expect(isContextOverflowError(new Error("Network connection reset"))).toBe(false);
    expect(isContextOverflowError("")).toBe(false);
  });
});

describe("transitionOpenCodeCompactionControl", () => {
  test("applies bounded transitions through success path", () => {
    const started = transitionOpenCodeCompactionControl(
      { state: "STREAMING", startedAt: null },
      "compaction.start",
      { now: 10 },
    );
    const completed = transitionOpenCodeCompactionControl(
      started,
      "compaction.complete.success",
      { now: 20 },
    );

    expect(started).toEqual({ state: "COMPACTING", startedAt: 10 });
    expect(completed).toEqual({ state: "STREAMING", startedAt: null });
  });

  test("rejects invalid compaction start transitions", () => {
    expect(() =>
      transitionOpenCodeCompactionControl(
        { state: "COMPACTING", startedAt: 10 },
        "compaction.start",
        { now: 20 },
      )).toThrow(OpenCodeCompactionError);
  });

  test("rejects error completion transitions outside compacting state", () => {
    expect(() =>
      transitionOpenCodeCompactionControl(
        { state: "STREAMING", startedAt: null },
        "compaction.complete.error",
        {
          now: 20,
          errorCode: "COMPACTION_TIMEOUT",
          errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
        },
      )).toThrow(OpenCodeCompactionError);
  });

  test("transitions to terminal error and ended states on failure", () => {
    const failed = transitionOpenCodeCompactionControl(
      { state: "COMPACTING", startedAt: 10 },
      "compaction.complete.error",
      {
        now: 20,
        errorCode: "COMPACTION_TIMEOUT",
        errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
      },
    );
    const ended = transitionOpenCodeCompactionControl(failed, "turn.ended");

    expect(failed).toEqual({
      state: "TERMINAL_ERROR",
      startedAt: 10,
      errorCode: "COMPACTION_TIMEOUT",
      errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
    });
    expect(ended).toEqual({
      state: "ENDED",
      startedAt: 10,
      errorCode: "COMPACTION_TIMEOUT",
      errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
    });
  });

  test("keeps terminal states unchanged on late complete events", () => {
    const terminal = {
      state: "TERMINAL_ERROR" as const,
      startedAt: 10,
      errorCode: "COMPACTION_FAILED" as const,
      errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
    };
    const ended = {
      state: "ENDED" as const,
      startedAt: 10,
      errorCode: "COMPACTION_FAILED" as const,
      errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
    };

    expect(transitionOpenCodeCompactionControl(terminal, "compaction.complete.success")).toEqual(terminal);
    expect(
      transitionOpenCodeCompactionControl(terminal, "compaction.complete.error", {
        errorCode: "COMPACTION_TIMEOUT",
        errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
      }),
    ).toEqual(terminal);
    expect(transitionOpenCodeCompactionControl(ended, "compaction.complete.success")).toEqual(ended);
    expect(
      transitionOpenCodeCompactionControl(ended, "compaction.complete.error", {
        errorCode: "COMPACTION_TIMEOUT",
        errorMessage: COMPACTION_TERMINAL_ERROR_MESSAGE,
      }),
    ).toEqual(ended);
  });
});

describe("OpenCodeClient event mapping", () => {
  test("defaults directory to process.cwd() for project-scoped agent resolution", () => {
    const client = new OpenCodeClient();
    const options = client as unknown as { clientOptions?: { directory?: string } };
    expect(options.clientOptions?.directory).toBe(process.cwd());
  });

  test("maps session.created info.id to session.start sessionId", () => {
    const client = new OpenCodeClient();
    const sessionStarts: string[] = [];

    const unsubscribe = client.on("session.start", (event) => {
      sessionStarts.push(event.sessionId);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.created",
      properties: {
        info: { id: "ses_test_created" },
      },
    });

    unsubscribe();

    expect(sessionStarts).toEqual(["ses_test_created"]);
  });

  test("maps session.status idle payloads to session.idle", () => {
    const client = new OpenCodeClient();
    const idles: string[] = [];

    const unsubscribe = client.on("session.idle", (event) => {
      idles.push(event.sessionId);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.status",
      properties: {
        sessionID: "ses_status_string",
        status: "idle",
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.status",
      properties: {
        info: { id: "ses_status_structured" },
        status: { type: "idle" },
      },
    });

    unsubscribe();

    expect(idles).toEqual(["ses_status_string", "ses_status_structured"]);
  });

  test("maps session.idle info.id payloads to session.idle", () => {
    const client = new OpenCodeClient();
    const idles: string[] = [];

    const unsubscribe = client.on("session.idle", (event) => {
      idles.push(event.sessionId);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.idle",
      properties: {
        info: { id: "ses_idle_info" },
      },
    });

    unsubscribe();

    expect(idles).toEqual(["ses_idle_info"]);
  });

  test("emitEvent dispatch remains synchronous", () => {
    const client = new OpenCodeClient();
    const order: string[] = [];

    const unsubscribe = client.on("message.delta", () => {
      order.push("handler");
    });

    order.push("before");
    (client as unknown as {
      emitEvent: (type: "message.delta", sessionId: string, data: Record<string, unknown>) => void;
    }).emitEvent("message.delta", "ses_sync_dispatch", { delta: "hello" });
    order.push("after");

    unsubscribe();

    expect(order).toEqual(["before", "handler", "after"]);
  });

  test("emitEvent isolates handler errors and continues dispatch", () => {
    const client = new OpenCodeClient();
    const order: string[] = [];
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];

    (console as unknown as { error: (...args: unknown[]) => void }).error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    const unsubscribeThrowingHandler = client.on("message.delta", () => {
      order.push("throwing-handler");
      throw new Error("handler failure");
    });
    const unsubscribeSecondHandler = client.on("message.delta", () => {
      order.push("second-handler");
    });

    try {
      (client as unknown as {
        emitEvent: (type: "message.delta", sessionId: string, data: Record<string, unknown>) => void;
      }).emitEvent("message.delta", "ses_sync_dispatch", { delta: "hello" });
    } finally {
      unsubscribeThrowingHandler();
      unsubscribeSecondHandler();
      (console as unknown as { error: (...args: unknown[]) => void }).error = originalConsoleError;
    }

    expect(order).toEqual(["throwing-handler", "second-handler"]);
    expect(consoleErrors).toHaveLength(1);
    expect(String(consoleErrors[0]?.[0] ?? "")).toContain("Error in event handler for message.delta:");
  });

  test("on() unsubscribe removes empty handler buckets", () => {
    const client = new OpenCodeClient();
    const unsubscribe = client.on("session.idle", () => {});

    unsubscribe();

    const eventHandlers = (client as unknown as {
      eventHandlers: Map<string, Set<unknown>>;
    }).eventHandlers;

    expect(eventHandlers.has("session.idle")).toBe(false);
  });

  test("processEventStream filters non-lifecycle events for inactive sessions", async () => {
    const client = new OpenCodeClient();
    const deltas: string[] = [];
    const starts: string[] = [];

    const unsubDelta = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });
    const unsubStart = client.on("session.start", (event) => {
      starts.push(event.sessionId);
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void })
      .registerActiveSession("ses_active");

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_inactive",
          delta: "inactive output",
        },
      };
      yield {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_active",
          delta: "active output",
        },
      };
      yield {
        type: "session.created",
        properties: {
          info: { id: "ses_created" },
        },
      };
      yield {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_created",
          delta: "created output",
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubDelta();
    unsubStart();

    expect(deltas).toEqual(["active output", "created output"]);
    expect(starts).toContain("ses_created");
  });

  test("processEventStream allows lifecycle events for inactive sessions", async () => {
    const client = new OpenCodeClient();
    const idles: string[] = [];
    const deltas: string[] = [];

    const unsubIdle = client.on("session.idle", (event) => {
      idles.push(event.sessionId);
    });
    const unsubDelta = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "session.status",
        properties: {
          sessionID: "ses_lifecycle_only",
          status: "idle",
        },
      };
      yield {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_filtered_only",
          delta: "should be filtered",
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubIdle();
    unsubDelta();

    expect(idles).toEqual(["ses_lifecycle_only"]);
    expect(deltas).toEqual([]);
  });

  test("processEventStream allows unknown child message.part.updated events in single-session mode", async () => {
    const client = new OpenCodeClient();
    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{ sessionId: string; toolName?: string }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      toolStarts.push({ sessionId: event.sessionId, toolName: data.toolName });
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void })
      .registerActiveSession("ses_parent");
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_parent",
            sessionID: "ses_parent",
            role: "assistant",
          },
        },
      };
      yield {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_parent",
          part: {
            id: "agent_1",
            sessionID: "ses_parent",
            messageID: "msg_parent",
            type: "agent",
            name: "worker",
          },
        },
      };
      // Child tool arrives without envelope sessionID (only part.sessionID).
      // This must be allowed through filtering so child discovery can run.
      yield {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool_child_1",
            sessionID: "ses_child",
            messageID: "msg_child_1",
            type: "tool",
            tool: "Read",
            state: {
              status: "pending",
              input: { filePath: "src/ui/chat.tsx" },
            },
          },
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubStart();
    unsubTool();

    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({ subagentId: "agent_1", subagentSessionId: undefined });
    expect(starts[1]).toEqual({ subagentId: "agent_1", subagentSessionId: "ses_child" });
    expect(toolStarts).toContainEqual({ sessionId: "ses_child", toolName: "Read" });
  });

  test("processEventStream allows unknown child message.part.updated events in parallel-session mode", async () => {
    const client = new OpenCodeClient();
    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{ sessionId: string; toolName?: string }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      toolStarts.push({ sessionId: event.sessionId, toolName: data.toolName });
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void })
      .registerActiveSession("ses_parent");
    (client as unknown as { registerActiveSession: (sessionId: string) => void })
      .registerActiveSession("ses_other_active");
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_parent_parallel",
            sessionID: "ses_parent",
            role: "assistant",
          },
        },
      };
      yield {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_parent",
          part: {
            id: "agent_parallel_1",
            sessionID: "ses_parent",
            messageID: "msg_parent_parallel",
            type: "agent",
            name: "worker",
          },
        },
      };
      // Child tool arrives without envelope sessionID while another session
      // is also active. We still need to process this for child discovery.
      yield {
        type: "message.part.updated",
        properties: {
          part: {
            id: "tool_parallel_child_1",
            sessionID: "ses_parallel_child",
            messageID: "msg_parallel_child_1",
            type: "tool",
            tool: "Glob",
            state: {
              status: "pending",
              input: { path: "src/**/*.tsx" },
            },
          },
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubStart();
    unsubTool();

    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({ subagentId: "agent_parallel_1", subagentSessionId: undefined });
    expect(starts[1]).toEqual({ subagentId: "agent_parallel_1", subagentSessionId: "ses_parallel_child" });
    expect(toolStarts).toContainEqual({ sessionId: "ses_parallel_child", toolName: "Glob" });
  });

  test("session.deleted unregisters active sessions for subsequent SSE filtering", async () => {
    const client = new OpenCodeClient();
    const deltas: string[] = [];

    const unsubDelta = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void })
      .registerActiveSession("ses_deleted");

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "session.deleted",
        properties: {
          sessionID: "ses_deleted",
        },
      };
      yield {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_deleted",
          delta: "should be dropped",
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubDelta();

    expect(deltas).toEqual([]);
  });

  test("processEventStream emits diagnostics usage marker for filtered SSE events", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_filtered_marker",
          delta: "drop me",
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubUsage();

    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.event.filtered.count",
      value: 1,
    });
  });

  test("processEventStream emits diagnostics usage marker when watchdog abort stops stream", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    const watchdogAbort = new AbortController();
    watchdogAbort.abort();

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "session.created",
        properties: {
          info: { id: "ses_abort_marker" },
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, watchdogAbort);

    unsubUsage();

    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.abort.watchdog.count",
      value: 1,
    });
  });

  test("processEventStream emits diagnostics usage marker when global abort stops stream", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];
    const globalAbort = new AbortController();
    globalAbort.abort();

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    (client as unknown as { eventSubscriptionController: AbortController | null })
      .eventSubscriptionController = globalAbort;

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield {
        type: "session.created",
        properties: {
          info: { id: "ses_global_abort_marker" },
        },
      };
    })();

    await (client as unknown as {
      processEventStream: (
        eventStream: AsyncGenerator<unknown, void, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubUsage();

    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.abort.global.count",
      value: 1,
    });
  });

  test("processEventStream emits watchdog-timeout diagnostics marker", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalDateNow = Date.now;
    let nowCall = 0;

    (Date as unknown as { now: () => number }).now = () => {
      nowCall += 1;
      return nowCall <= 2 ? 0 : 15_001;
    };
    (globalThis as unknown as { setTimeout: (...args: unknown[]) => unknown }).setTimeout = (
      callback: unknown,
    ) => {
      if (typeof callback === "function") {
        (callback as () => void)();
      }
      return 1;
    };
    (globalThis as unknown as { clearTimeout: (...args: unknown[]) => void }).clearTimeout =
      () => {};

    try {
      const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {})();
      await (client as unknown as {
        processEventStream: (
          eventStream: AsyncGenerator<unknown, void, unknown>,
          watchdogAbort: AbortController,
        ) => Promise<void>;
      }).processEventStream(stream, new AbortController());
    } finally {
      (Date as unknown as { now: () => number }).now = originalDateNow;
      (
        globalThis as unknown as { setTimeout: (...args: unknown[]) => unknown }
      ).setTimeout = originalSetTimeout as unknown as (...args: unknown[]) => unknown;
      (
        globalThis as unknown as { clearTimeout: (...args: unknown[]) => void }
      ).clearTimeout = originalClearTimeout as unknown as (...args: unknown[]) => void;
      unsubUsage();
    }

    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.watchdog.timeout.count",
      value: 1,
    });
  });

  test("summarize emits compaction start and context_compacted idle", async () => {
    const client = new OpenCodeClient();
    const compactions: Array<{ phase?: string; success?: boolean; error?: string }> = [];
    const idles: string[] = [];
    const sessionId = "ses_summarize_success";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          summarize: (params: Record<string, unknown>) => Promise<void>;
          messages: (params: Record<string, unknown>) => Promise<{
            data?: Array<{ info: { role: string } }>;
          }>;
        };
      };
    }).sdkClient = {
      session: {
        summarize: async () => {},
        messages: async () => ({ data: [] }),
      },
    };

    const unsubCompaction = client.on("session.compaction", (event) => {
      const data = event.data as { phase?: string; success?: boolean; error?: string };
      compactions.push({
        phase: data.phase,
        success: data.success,
        error: data.error,
      });
    });
    const unsubIdle = client.on("session.idle", (event) => {
      const data = event.data as { reason?: string };
      idles.push(data.reason ?? "");
    });

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        summarize: () => Promise<void>;
      }>;
    }).wrapSession(sessionId, {});

    await session.summarize();

    unsubCompaction();
    unsubIdle();

    expect(compactions).toEqual([{ phase: "start", success: undefined, error: undefined }]);
    expect(idles).toContain("context_compacted");
  });

  test("summarize emits truncation from pre/post compaction token deltas", async () => {
    const client = new OpenCodeClient();
    const truncations: Array<{ tokenLimit?: number; tokensRemoved?: number; messagesRemoved?: number }> = [];
    const sessionId = "ses_summarize_truncation";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          prompt: (params: Record<string, unknown>) => Promise<{
            data?: {
              info?: { tokens?: { input?: number; output?: number } };
              parts?: Array<Record<string, unknown>>;
            };
          }>;
          summarize: (params: Record<string, unknown>) => Promise<void>;
          messages: (params: Record<string, unknown>) => Promise<{
            data?: Array<{ info: { role: string; tokens?: { input?: number; output?: number } } }>;
          }>;
        };
      };
    }).sdkClient = {
      session: {
        prompt: async () => ({
          data: {
            info: {
              tokens: { input: 1_200, output: 300 },
            },
            parts: [{ type: "text", text: "seed" }],
          },
        }),
        summarize: async () => {},
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                tokens: { input: 400, output: 100 },
              },
            },
          ],
        }),
      },
    };

    const unsubTruncation = client.on("session.truncation", (event) => {
      const data = event.data as {
        tokenLimit?: number;
        tokensRemoved?: number;
        messagesRemoved?: number;
      };
      truncations.push({
        tokenLimit: data.tokenLimit,
        tokensRemoved: data.tokensRemoved,
        messagesRemoved: data.messagesRemoved,
      });
    });

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        send: (message: string) => Promise<{ type: string; content: unknown }>;
        summarize: () => Promise<void>;
      }>;
    }).wrapSession(sessionId, {});

    await session.send("seed usage state");
    await session.summarize();

    unsubTruncation();

    expect(truncations).toEqual([
      {
        tokenLimit: 200_000,
        tokensRemoved: 1_000,
        messagesRemoved: 0,
      },
    ]);
  });

  test("summarize emits compaction failure and rethrows summarize errors", async () => {
    resetRuntimeParityMetrics();
    const client = new OpenCodeClient();
    const compactions: Array<{ phase?: string; success?: boolean; error?: string }> = [];
    const sessionErrors: Array<{ error?: string; code?: string }> = [];
    const idles: string[] = [];
    const sessionId = "ses_summarize_failure";
    const summarizeError = new Error("summarize failed");

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          summarize: (params: Record<string, unknown>) => Promise<void>;
          messages: (params: Record<string, unknown>) => Promise<{
            data?: Array<{ info: { role: string } }>;
          }>;
        };
      };
    }).sdkClient = {
      session: {
        summarize: async () => {
          throw summarizeError;
        },
        messages: async () => ({ data: [] }),
      },
    };

    const unsubCompaction = client.on("session.compaction", (event) => {
      const data = event.data as { phase?: string; success?: boolean; error?: string };
      compactions.push({
        phase: data.phase,
        success: data.success,
        error: data.error,
      });
    });
    const unsubIdle = client.on("session.idle", (event) => {
      const data = event.data as { reason?: string };
      idles.push(data.reason ?? "");
    });
    const unsubSessionError = client.on("session.error", (event) => {
      const data = event.data as { error?: string; code?: string };
      sessionErrors.push({
        error: typeof data.error === "string" ? data.error : undefined,
        code: data.code,
      });
    });

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        summarize: () => Promise<void>;
      }>;
    }).wrapSession(sessionId, {});

    await expect(session.summarize()).rejects.toThrow(COMPACTION_TERMINAL_ERROR_MESSAGE);

    unsubCompaction();
    unsubIdle();
    unsubSessionError();

    expect(compactions).toEqual([
      { phase: "start", success: undefined, error: undefined },
      { phase: "complete", success: false, error: COMPACTION_TERMINAL_ERROR_MESSAGE },
    ]);
    expect(sessionErrors).toEqual([
      { error: COMPACTION_TERMINAL_ERROR_MESSAGE, code: "COMPACTION_FAILED" },
    ]);
    expect(idles).toEqual([]);
    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.compaction_timeout_terminated_total{code=COMPACTION_FAILED,provider=opencode}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.turn_terminated_due_to_contract_error_total{code=COMPACTION_FAILED,provider=opencode,reason=compaction_terminal_error}"]).toBe(1);
  });

  test("summarize emits terminal timeout error when compaction exceeds bounded wait", async () => {
    resetRuntimeParityMetrics();
    const client = new OpenCodeClient();
    const compactions: Array<{ phase?: string; success?: boolean; error?: string }> = [];
    const sessionErrors: Array<{ error?: string; code?: string }> = [];
    const sessionId = "ses_summarize_timeout";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          summarize: (params: Record<string, unknown>) => Promise<void>;
          messages: (params: Record<string, unknown>) => Promise<{
            data?: Array<{ info: { role: string } }>;
          }>;
        };
      };
    }).sdkClient = {
      session: {
        summarize: async () => new Promise<void>(() => {}),
        messages: async () => ({ data: [] }),
      },
    };

    const unsubCompaction = client.on("session.compaction", (event) => {
      const data = event.data as { phase?: string; success?: boolean; error?: string };
      compactions.push({
        phase: data.phase,
        success: data.success,
        error: data.error,
      });
    });
    const unsubSessionError = client.on("session.error", (event) => {
      const data = event.data as { error?: string; code?: string };
      sessionErrors.push({
        error: typeof data.error === "string" ? data.error : undefined,
        code: data.code,
      });
    });

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    (globalThis as unknown as { setTimeout: (...args: unknown[]) => unknown }).setTimeout = (
      callback: unknown,
    ) => {
      if (typeof callback === "function") {
        (callback as () => void)();
      }
      return 1;
    };
    (globalThis as unknown as { clearTimeout: (...args: unknown[]) => void }).clearTimeout = () => {};

    try {
      const session = await (client as unknown as {
        wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
          summarize: () => Promise<void>;
        }>;
      }).wrapSession(sessionId, {});

      await expect(session.summarize()).rejects.toThrow(COMPACTION_TERMINAL_ERROR_MESSAGE);
    } finally {
      (
        globalThis as unknown as { setTimeout: (...args: unknown[]) => unknown }
      ).setTimeout = originalSetTimeout as unknown as (...args: unknown[]) => unknown;
      (
        globalThis as unknown as { clearTimeout: (...args: unknown[]) => void }
      ).clearTimeout = originalClearTimeout as unknown as (...args: unknown[]) => void;
      unsubCompaction();
      unsubSessionError();
    }

    expect(compactions).toEqual([
      { phase: "start", success: undefined, error: undefined },
      { phase: "complete", success: false, error: COMPACTION_TERMINAL_ERROR_MESSAGE },
    ]);
    expect(sessionErrors).toEqual([
      { error: COMPACTION_TERMINAL_ERROR_MESSAGE, code: "COMPACTION_TIMEOUT" },
    ]);
    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.compaction_timeout_terminated_total{code=COMPACTION_TIMEOUT,provider=opencode}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.turn_terminated_due_to_contract_error_total{code=COMPACTION_TIMEOUT,provider=opencode,reason=compaction_terminal_error}"]).toBe(1);
  });

  test("dedupes duplicate compaction complete events after summarize recovery", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_compaction_dedupe";
    const compactionPhases: string[] = [];

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          summarize: (params: Record<string, unknown>) => Promise<void>;
          messages: (params: Record<string, unknown>) => Promise<{ data?: Array<{ info: { role: string } }> }>;
        };
      };
    }).sdkClient = {
      session: {
        summarize: async () => {},
        messages: async () => ({ data: [] }),
      },
    };

    const unsubscribe = client.on("session.compaction", (event) => {
      const data = event.data as { phase?: string };
      compactionPhases.push(data.phase ?? "");
    });

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        summarize: () => Promise<void>;
      }>;
    }).wrapSession(sessionId, {});

    await session.summarize();

    const handle = (client as unknown as {
      handleSdkEvent: (event: Record<string, unknown>) => void;
    }).handleSdkEvent.bind(client);
    handle({
      type: "session.compacted",
      properties: { sessionID: sessionId },
    });
    handle({
      type: "session.compacted",
      properties: { sessionID: sessionId },
    });

    unsubscribe();

    expect(compactionPhases.filter((phase) => phase === "complete")).toHaveLength(1);
  });

  test("does not leave pending compaction completion stale when compacted arrives before summarize resolves", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_compaction_pending_race";
    const compactionPhases: string[] = [];

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (client as unknown as {
      handleSdkEvent: (event: Record<string, unknown>) => void;
    }).handleSdkEvent.bind(client);

    let releaseSummarize!: () => void;
    const summarizeGate = new Promise<void>((resolve) => {
      releaseSummarize = resolve;
    });

    (client as unknown as {
      sdkClient: {
        session: {
          summarize: (params: Record<string, unknown>) => Promise<void>;
          messages: (params: Record<string, unknown>) => Promise<{ data?: Array<{ info: { role: string } }> }>;
        };
      };
    }).sdkClient = {
      session: {
        summarize: async () => {
          handle({
            type: "session.compacted",
            properties: { sessionID: sessionId },
          });
          await summarizeGate;
        },
        messages: async () => ({ data: [] }),
      },
    };

    const unsubscribe = client.on("session.compaction", (event) => {
      const data = event.data as { phase?: string };
      compactionPhases.push(data.phase ?? "");
    });

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        summarize: () => Promise<void>;
      }>;
    }).wrapSession(sessionId, {});

    const summarizePromise = session.summarize();
    releaseSummarize();
    await summarizePromise;

    handle({
      type: "session.compacted",
      properties: { sessionID: sessionId },
    });

    unsubscribe();

    expect(compactionPhases.filter((phase) => phase === "complete")).toHaveLength(1);
  });

  test("emits compaction complete when no pending compaction recovery exists", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_compaction_emit_without_pending";
    const compactionPhases: string[] = [];

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          summarize: (params: Record<string, unknown>) => Promise<void>;
          messages: (params: Record<string, unknown>) => Promise<{ data?: Array<{ info: { role: string } }> }>;
        };
      };
    }).sdkClient = {
      session: {
        summarize: async () => {},
        messages: async () => ({ data: [] }),
      },
    };

    const unsubscribe = client.on("session.compaction", (event) => {
      const data = event.data as { phase?: string };
      compactionPhases.push(data.phase ?? "");
    });

    await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        summarize: () => Promise<void>;
      }>;
    }).wrapSession(sessionId, {});

    (client as unknown as {
      handleSdkEvent: (event: Record<string, unknown>) => void;
    }).handleSdkEvent({
      type: "session.compacted",
      properties: { sessionID: sessionId },
    });

    unsubscribe();

    expect(compactionPhases.filter((phase) => phase === "complete")).toHaveLength(1);
  });

  test("stream resolves even when no terminal idle event arrives", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_no_idle";

    // Avoid provider metadata lookups in wrapSession().
    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<void>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => {
          // Fire tool event during prompt, then idle after a delay
          handle({
            type: "message.part.updated",
            properties: {
              sessionID: sessionId,
              part: {
                id: "task_tool_1",
                type: "tool",
                tool: "task",
                state: {
                  status: "running",
                  input: { description: "Investigate hang" },
                },
              },
            },
          });
          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sessionId,
                status: "idle",
              },
            });
          }, 50);
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("run worker", { agent: "worker" })) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream timed out")), 2500);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(chunks.some((chunk) => chunk.type === "tool_use")).toBe(true);
  });

  test("stream drains late tool events when idle arrives before prompt settles", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_idle_before_prompt_settle";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<void>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => {
          // promptAsync returns immediately; idle and tool events arrive via SSE
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("run task", { agent: "worker" })) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    const idleTimer = setTimeout(() => {
      handle({
        type: "session.status",
        properties: {
          sessionID: sessionId,
          status: "idle",
        },
      });
    }, 20);

    const toolTimer = setTimeout(() => {
      handle({
        type: "message.part.updated",
        properties: {
          sessionID: sessionId,
          part: {
            id: "tool_late_1",
            callID: "call_late_1",
            sessionID: sessionId,
            messageID: "msg_late_1",
            type: "tool",
            tool: "Read",
            state: {
              status: "pending",
              input: { filePath: "src/index.ts" },
            },
          },
        },
      });
    }, 10);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream did not complete")), 2000);
        }),
      ]);
    } finally {
      clearTimeout(idleTimer);
      clearTimeout(toolTimer);
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(chunks.some((chunk) => {
      if (chunk.type !== "tool_use") return false;
      const content = chunk.content as { name?: string };
      return content.name === "Read";
    })).toBe(true);
  });

  test("stream keeps child-session progress isolated when currentSessionId points to another session", async () => {
    const client = new OpenCodeClient();

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<void>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params) => {
          const sid = params.sessionID as string;
          const childSid = `${sid}_child`;

          handle({
            type: "message.part.updated",
            properties: {
              sessionID: sid,
              part: {
                id: `agent_${sid}`,
                sessionID: sid,
                messageID: `msg_${sid}_1`,
                type: "agent",
                name: "worker",
              },
            },
          });

          handle({
            type: "message.part.updated",
            properties: {
              sessionID: sid,
              part: {
                id: `tool_${sid}`,
                sessionID: childSid,
                messageID: `msg_${sid}_2`,
                type: "tool",
                tool: "Read",
                callID: `call_${sid}`,
                state: {
                  status: "pending",
                  input: { filePath: "src/index.ts" },
                },
              },
            },
          });

          // Fire the idle event after a short delay
          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sid,
                status: "idle",
              },
            });
          }, 50);
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession("ses_A", {});

    // Simulate another parallel session being marked current.
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_B";

    const chunks: Array<{ type: string; content: unknown }> = [];
    for await (const chunk of session.stream("run task", { agent: "worker" })) {
      chunks.push({ type: chunk.type, content: chunk.content });
    }

    expect(chunks.some((chunk) => {
      if (chunk.type !== "tool_use") return false;
      const content = chunk.content as { name?: string };
      return content.name === "Read";
    })).toBe(true);
  });

  test("stream completes when terminal session event arrives before prompt resolves", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_terminal_before_prompt";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<void>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => {
          // promptAsync returns immediately
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const consumePromise = (async () => {
      for await (const _chunk of session.stream("run task", { agent: "worker" })) {
        // No-op: this regression only verifies completion.
      }
    })();

    setTimeout(() => {
      (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
        type: "session.status",
        properties: {
          sessionID: sessionId,
          status: "idle",
        },
      });
    }, 20);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream did not complete")), 1000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });

  test("stream yields SSE deltas before promptAsync settles", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_delta_before_prompt_settle";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<void>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => {
          setTimeout(() => {
            handle({
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                delta: "early streamed chunk",
              },
            });
          }, 15);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sessionId,
                status: "idle",
              },
            });
          }, 30);

          // Simulate a promptAsync call that does not settle immediately.
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const chunks: Array<{ type: string; content: unknown }> = [];
    const streamStartAt = Date.now();
    let firstChunkAt: number | null = null;
    let firstChunkResolve: (() => void) | undefined;
    const firstChunkPromise = new Promise<void>((resolve) => {
      firstChunkResolve = () => resolve();
    });

    const consumePromise = (async () => {
      for await (const chunk of session.stream("plain prompt")) {
        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
          firstChunkResolve?.();
        }
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    let firstChunkTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        firstChunkPromise,
        new Promise<never>((_, reject) => {
          firstChunkTimeoutId = setTimeout(() => reject(new Error("first chunk did not arrive in time")), 150);
        }),
      ]);
    } finally {
      if (firstChunkTimeoutId) clearTimeout(firstChunkTimeoutId);
    }

    expect(firstChunkAt).not.toBeNull();
    expect((firstChunkAt ?? 0) - streamStartAt).toBeLessThan(150);

    let streamTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          streamTimeoutId = setTimeout(() => reject(new Error("stream did not complete")), 2000);
        }),
      ]);
    } finally {
      if (streamTimeoutId) clearTimeout(streamTimeoutId);
    }

    expect(chunks.some((chunk) => chunk.type === "text" && chunk.content === "early streamed chunk")).toBe(true);
  });

  test("non-subagent stream completes on idle and yields text from SSE deltas", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_non_subagent_idle";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<void>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => {
          // promptAsync returns immediately; text and idle arrive via SSE
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("plain prompt")) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    // Emit a text delta via SSE
    setTimeout(() => {
      handle({
        type: "message.part.delta",
        properties: {
          sessionID: sessionId,
          delta: "final response",
        },
      });
    }, 20);

    // Then emit idle to signal completion
    setTimeout(() => {
      handle({
        type: "session.status",
        properties: {
          sessionID: sessionId,
          status: "idle",
        },
      });
    }, 80);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream did not finish")), 1000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(
      chunks.some((chunk) => chunk.type === "text" && chunk.content === "final response")
    ).toBe(true);
  });

  test("maps tool part updates using part.sessionID when properties.sessionID is absent", () => {
    const client = new OpenCodeClient();
    const starts: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];
    const completes: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      starts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolCallId: data.toolCallId,
      });
    });
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      completes.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolCallId: data.toolCallId,
      });
    });

    const basePart = {
      id: "prt_tool_1",
      callID: "call_tool_1",
      sessionID: "ses_part_session",
      messageID: "msg_1",
      type: "tool",
      tool: "bash",
    };

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "running",
            input: { command: "pwd" },
          },
        },
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "completed",
            input: { command: "pwd" },
            output: "/tmp",
          },
        },
      },
    });

    unsubStart();
    unsubComplete();

    expect(starts).toEqual([
      {
        sessionId: "ses_part_session",
        toolName: "bash",
        toolCallId: "call_tool_1",
      },
    ]);
    expect(completes).toEqual([
      {
        sessionId: "ses_part_session",
        toolName: "bash",
        toolCallId: "call_tool_1",
      },
    ]);
  });

  test("emits task tool lifecycle for parent-session task parts", () => {
    const client = new OpenCodeClient();
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ toolName?: string; toolCallId?: string }> = [];
    const completes: Array<{ toolName?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      starts.push({ toolName: data.toolName, toolCallId: data.toolCallId });
    });

    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      completes.push({ toolName: data.toolName, toolCallId: data.toolCallId });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent",
          callID: "call_task_parent",
          sessionID: "ses_parent",
          messageID: "msg_task_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "debug stream ordering",
            },
          },
        },
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent",
          callID: "call_task_parent",
          sessionID: "ses_parent",
          messageID: "msg_task_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "debugger",
              description: "debug stream ordering",
            },
            output: "done",
          },
        },
      },
    });

    unsubStart();
    unsubComplete();

    expect(starts).toEqual([{ toolName: "task", toolCallId: "call_task_parent" }]);
    expect(completes).toEqual([{ toolName: "task", toolCallId: "call_task_parent" }]);
  });

  test("includes task tool metadata on tool.start for parent-session task parts", () => {
    const client = new OpenCodeClient();
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ toolName?: string; toolCallId?: string; toolMetadata?: Record<string, unknown> }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as {
        toolName?: string;
        toolCallId?: string;
        toolMetadata?: Record<string, unknown>;
      };
      starts.push({
        toolName: data.toolName,
        toolCallId: data.toolCallId,
        toolMetadata: data.toolMetadata,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent_meta",
          callID: "call_task_parent_meta",
          sessionID: "ses_parent",
          messageID: "msg_task_meta_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "debug stream ordering",
            },
            metadata: {
              sessionId: "ses_child_meta_1",
              model: { providerID: "openai", modelID: "gpt-5.3-codex-high" },
            },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(1);
    expect(starts[0]).toEqual({
      toolName: "task",
      toolCallId: "call_task_parent_meta",
      toolMetadata: {
        sessionId: "ses_child_meta_1",
        model: { providerID: "openai", modelID: "gpt-5.3-codex-high" },
      },
    });
  });

  test("does not synthesize subagent.start from parent-session task tool parts", () => {
    const client = new OpenCodeClient();
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const lifecycle: string[] = [];

    const unsubSubagentStart = client.on("subagent.start", (event) => {
      const data = event.data as { toolCallId?: string };
      if (data.toolCallId === "task_tool_ordering") {
        lifecycle.push("subagent.start");
      }
    });

    const unsubToolStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      if (data.toolName === "task") {
        lifecycle.push("tool.start");
      }
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_ordering",
          callID: "call_task_ordering",
          sessionID: "ses_parent",
          messageID: "msg_task_ordering",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "fix ordering",
            },
          },
        },
      },
    });

    unsubSubagentStart();
    unsubToolStart();

    expect(lifecycle).toEqual(["tool.start"]);
  });

  test("maps subtask parts to subagent.start with agent name and task", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      task?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        task?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        task: data.task,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "subtask",
          prompt: "Research Rust TUI stacks",
          description: "Research the best technology stacks in Rust for terminal games",
          agent: "codebase-online-researcher",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_parent",
        subagentId: "subtask_1",
        subagentType: "codebase-online-researcher",
        task: "Research the best technology stacks in Rust for terminal games",
      },
    ]);
  });

  test("emits thinking source identity for reasoning deltas", () => {
    const client = new OpenCodeClient();
    const deltas: Array<{
      sessionId: string;
      delta?: string;
      contentType?: string;
      thinkingSourceKey?: string;
    }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as {
        delta?: string;
        contentType?: string;
        thinkingSourceKey?: string;
      };
      deltas.push({
        sessionId: event.sessionId,
        delta: data.delta,
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
      });
    });

    // First, register the reasoning part via message.part.updated
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning_part_1",
          sessionID: "ses_reasoning",
          messageID: "msg_reasoning",
          type: "reasoning",
        },
      },
    });

    // Then, send the delta via message.part.delta (v2)
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        partID: "reasoning_part_1",
        sessionID: "ses_reasoning",
        delta: "inspect constraints",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        sessionId: "ses_reasoning",
        delta: "inspect constraints",
        contentType: "thinking",
        thinkingSourceKey: "reasoning_part_1",
      },
    ]);
  });

  test("recognizes reasoning deltas when message.part.delta uses camelCase partId", () => {
    const client = new OpenCodeClient();
    const deltas: Array<{
      sessionId: string;
      delta?: string;
      contentType?: string;
      thinkingSourceKey?: string;
    }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as {
        delta?: string;
        contentType?: string;
        thinkingSourceKey?: string;
      };
      deltas.push({
        sessionId: event.sessionId,
        delta: data.delta,
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning_part_camel",
          sessionID: "ses_reasoning_camel",
          messageID: "msg_reasoning_camel",
          type: "reasoning",
        },
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        partId: "reasoning_part_camel",
        field: "text",
        sessionID: "ses_reasoning_camel",
        delta: "camelcase part id reasoning",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        sessionId: "ses_reasoning_camel",
        delta: "camelcase part id reasoning",
        contentType: "thinking",
        thinkingSourceKey: "reasoning_part_camel",
      },
    ]);
  });

  test("ignores message.part.delta updates for non-text fields", () => {
    const client = new OpenCodeClient();
    const deltas: string[] = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        partID: "part_non_text_field",
        field: "status",
        sessionID: "ses_non_text_field",
        delta: "should not emit",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([]);
  });

  test("classifies inline reasoning message.part.delta payloads as thinking", () => {
    const client = new OpenCodeClient();
    const deltas: Array<{
      contentType?: string;
      thinkingSourceKey?: string;
      delta?: string;
    }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as {
        delta?: string;
        contentType?: string;
        thinkingSourceKey?: string;
      };
      deltas.push({
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
        delta: data.delta,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "ses_inline_reasoning",
        delta: "inline reasoning payload",
        part: {
          id: "reasoning_inline_1",
          type: "reasoning",
        },
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        contentType: "thinking",
        thinkingSourceKey: "reasoning_inline_1",
        delta: "inline reasoning payload",
      },
    ]);
  });

  test("maps agent part to subagent.start with toolCallId from callID", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent-1",
          sessionID: "ses_agent",
          messageID: "msg_1",
          type: "agent",
          name: "explorer",
          callID: "call-123",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_agent",
        subagentId: "agent-1",
        subagentType: "explorer",
        toolCallId: "call-123",
      },
    ]);
  });

  test("maps agent part to subagent.start with toolCallId fallback to id when callID is missing", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent-2",
          sessionID: "ses_agent_no_callid",
          messageID: "msg_2",
          type: "agent",
          name: "worker",
          // callID is missing/undefined
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_agent_no_callid",
        subagentId: "agent-2",
        subagentType: "worker",
        toolCallId: "agent-2", // Falls back to id
      },
    ]);
  });

  test("uses preceding task tool part id as correlation for subsequent agent part", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    // Task tool part arrives first.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_1",
          callID: "task_call_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "pending",
            input: {
              subagent_type: "debugger",
              description: "Inspect workflow stream issues",
            },
          },
        },
      },
    });

    // Agent part should carry correlation from the preceding task tool part.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_from_task",
          callID: "call_agent_1",
          sessionID: "ses_parent",
          messageID: "msg_2",
          type: "agent",
          name: "debugger",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        subagentId: "agent_from_task",
        subagentType: "debugger",
        toolCallId: "task_tool_1",
      },
    ]);
  });

  test("ignores user @mention agent parts to avoid orphan subagent rows", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    // OpenCode persists @agent mentions as USER AgentPart entries.
    // These should not become subagent.start rows.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_user_1",
          sessionID: "ses_parent",
          role: "user",
        },
      },
    });
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "user_agent_ref",
          sessionID: "ses_parent",
          messageID: "msg_user_1",
          type: "agent",
          name: "debugger",
        },
      },
    });

    // Task tool + assistant AgentPart represent the real sub-agent dispatch.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_1",
          callID: "task_call_1",
          sessionID: "ses_parent",
          messageID: "msg_asst_1",
          type: "tool",
          tool: "task",
          state: {
            status: "pending",
            input: {
              subagent_type: "debugger",
              description: "Investigate initialization hang",
            },
          },
        },
      },
    });
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_asst_1",
          sessionID: "ses_parent",
          role: "assistant",
        },
      },
    });
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_from_task",
          callID: "call_agent_1",
          sessionID: "ses_parent",
          messageID: "msg_asst_1",
          type: "agent",
          name: "debugger",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        subagentId: "agent_from_task",
        subagentType: "debugger",
        toolCallId: "task_tool_1",
      },
    ]);
  });

  test("does not leak completed task correlation into later agent parts", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      subagentId?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; toolCallId?: string };
      starts.push({
        subagentId: data.subagentId,
        toolCallId: data.toolCallId,
      });
    });

    // Task tool starts + completes without any agent/subtask part.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_stale",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "initial task",
            },
          },
        },
      },
    });
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_stale",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "debugger",
              description: "initial task",
            },
          },
        },
      },
    });

    // Later unrelated agent part should not consume stale task_tool_stale.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_after_task",
          callID: "call_after_task",
          sessionID: "ses_parent",
          messageID: "msg_2",
          type: "agent",
          name: "worker",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        subagentId: "agent_after_task",
        toolCallId: "call_after_task",
      },
    ]);
  });

  test("emits tool.complete when tool status is completed but output is undefined", () => {
    // Uses a non-Task tool to validate the generic tool.complete path.
    const client = new OpenCodeClient();
    const completes: Array<{
      sessionId: string;
      toolName?: string;
      toolResult?: unknown;
      success?: boolean;
    }> = [];

    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as {
        toolName?: string;
        toolResult?: unknown;
        success?: boolean;
      };
      completes.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolResult: data.toolResult,
        success: data.success,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_bash_1",
          callID: "call_bash_1",
          sessionID: "ses_task",
          messageID: "msg_1",
          type: "tool",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo hello" },
            // output is intentionally omitted (undefined)
          },
        },
      },
    });

    unsubComplete();

    expect(completes).toHaveLength(1);
    expect(completes[0]!.sessionId).toBe("ses_task");
    expect(completes[0]!.toolName).toBe("bash");
    expect(completes[0]!.toolResult).toBeUndefined();
    expect(completes[0]!.success).toBe(true);
  });

  test("maps step-finish part to subagent.complete for known sub-agents", () => {
    const client = new OpenCodeClient();
    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const completes: Array<{
      sessionId: string;
      subagentId?: string;
      success?: boolean;
      result?: string;
    }> = [];

    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: string;
      };
      completes.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        success: data.success,
        result: data.result,
      });
    });

    // Register the assistant message role so agent parts aren't
    // filtered as user @mentions.
    handleSdkEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_step",
          sessionID: "ses_step",
          role: "assistant",
        },
      },
    });
    handleSdkEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_step_2",
          sessionID: "ses_step",
          role: "assistant",
        },
      },
    });

    // Register sub-agents via agent parts BEFORE step-finish
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "ses_step",
          messageID: "msg_step",
          type: "agent",
          name: "explorer",
        },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-2",
          sessionID: "ses_step",
          messageID: "msg_step_2",
          type: "agent",
          name: "worker",
        },
      },
    });

    // Test successful completion
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "ses_step",
          messageID: "msg_step",
          type: "step-finish",
          reason: "success",
        },
      },
    });

    // Test error completion
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-2",
          sessionID: "ses_step",
          messageID: "msg_step_2",
          type: "step-finish",
          reason: "error",
        },
      },
    });

    unsubComplete();

    expect(completes).toEqual([
      {
        sessionId: "ses_step",
        subagentId: "step-1",
        success: true,
        result: "success",
      },
      {
        sessionId: "ses_step",
        subagentId: "step-2",
        success: false,
        result: "error",
      },
    ]);
  });

  test("ignores step-finish for main-turn completion (no prior sub-agent registration)", () => {
    const client = new OpenCodeClient();
    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const completes: Array<{ subagentId?: string }> = [];

    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string };
      completes.push({ subagentId: data.subagentId });
    });

    // step-finish without any prior agent/subtask part registration
    // (this is the main-turn completion scenario that caused MISSING_START)
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_main_turn_finish",
          sessionID: "ses_main",
          messageID: "msg_1",
          type: "step-finish",
          reason: "stop",
        },
      },
    });

    unsubComplete();

    // No subagent.complete should be emitted for main-turn step-finish
    expect(completes).toEqual([]);
  });

  test("requires a prior subagent.start before mapping step-finish to subagent.complete", () => {
    const client = new OpenCodeClient();
    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const completes: Array<{ subagentId?: string }> = [];
    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string };
      completes.push({ subagentId: data.subagentId });
    });

    // Simulate stale internal correlation artifacts without a prior subagent.start.
    (
      client as unknown as {
        subagentStateByParentSession: Map<
          string,
          {
            pendingAgentParts: Array<{ partId: string; agentName: string }>;
            childSessionToAgentPart: Map<string, string>;
            startedSubagentIds: Set<string>;
            subagentToolCounts: Map<string, number>;
            pendingTaskToolPartIds: string[];
            queuedTaskToolPartIds: Set<string>;
          }
        >;
      }
    ).subagentStateByParentSession.set("ses_main", {
      pendingAgentParts: [{ partId: "prt_ghost_agent", agentName: "worker" }],
      childSessionToAgentPart: new Map([["ses_child", "prt_ghost_agent"]]),
      startedSubagentIds: new Set(),
      subagentToolCounts: new Map([["prt_ghost_agent", 2]]),
      pendingTaskToolPartIds: [],
      queuedTaskToolPartIds: new Set(),
    });

    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_ghost_agent",
          sessionID: "ses_main",
          messageID: "msg_1",
          type: "step-finish",
          reason: "stop",
        },
      },
    });

    unsubComplete();

    expect(completes).toEqual([]);
  });

  test("omits subagentSessionId from initial agent part subagent.start (parent session != child)", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentSessionId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "agent_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "explore",
          callID: "call_1",
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(1);
    expect(starts[0]!.sessionId).toBe("ses_parent");
    expect(starts[0]!.subagentId).toBe("agent_1");
    // subagentSessionId is intentionally omitted from the initial emission
    // because AgentPart.sessionID is the parent session, not the child.
    expect(starts[0]!.subagentSessionId).toBeUndefined();
  });

  test("omits subagentSessionId from initial subtask part subagent.start", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentSessionId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask_2",
          sessionID: "ses_subtask_session",
          messageID: "msg_1",
          type: "subtask",
          prompt: "Find files",
          description: "Locate relevant source files",
          agent: "codebase-locator",
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(1);
    expect(starts[0]!.subagentId).toBe("subtask_2");
    // subagentSessionId intentionally omitted — see AgentPart comment.
    expect(starts[0]!.subagentSessionId).toBeUndefined();
  });

  test("discovers child session from tool part and re-emits subagent.start with correct subagentSessionId", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    // Set currentSessionId so the client knows the parent session.
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];
    const toolStarts: Array<{
      sessionId: string;
      toolName?: string;
      parentAgentId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; parentAgentId?: string };
      toolStarts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        parentAgentId: data.parentAgentId,
      });
    });

    // 1. Agent part arrives (parent session)
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "agent_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "explore",
        },
      },
    });

    // Initial subagent.start without subagentSessionId
    expect(starts).toHaveLength(1);
    expect(starts[0]!.subagentId).toBe("agent_1");
    expect(starts[0]!.subagentSessionId).toBeUndefined();

    // 2. First tool from child session arrives
    handle({
      type: "message.part.updated",
      properties: {
        // OpenCode can keep the parent session ID at the envelope level
        // while the part itself belongs to the child session.
        sessionID: "ses_parent",
        part: {
          id: "tool_child_1",
          sessionID: "ses_child",
          messageID: "msg_child_1",
          type: "tool",
          tool: "Read",
          callID: "call_child_1",
          state: { status: "pending", input: { file: "foo.ts" } },
        },
      },
    });

    unsubStart();
    unsubTool();

    // Re-emitted subagent.start with correct child session ID
    expect(starts).toHaveLength(2);
    expect(starts[1]!.subagentId).toBe("agent_1");
    expect(starts[1]!.subagentSessionId).toBe("ses_child");

    // Tool event emitted on the child session
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]!.sessionId).toBe("ses_child");
    expect(toolStarts[0]!.toolName).toBe("Read");
    expect(toolStarts[0]!.parentAgentId).toBe("agent_1");
  });

  test("routes child-session discovery to envelope parent session during parallel runs", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    // Simulate another session becoming "current" while session A events arrive.
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parallel_other";

    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    // Parent session A agent start
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_A",
        part: {
          id: "agent_A",
          sessionID: "ses_A",
          messageID: "msg_A_1",
          type: "agent",
          name: "worker",
        },
      },
    });

    // Child tool event for session A
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_A",
        part: {
          id: "tool_child_A",
          sessionID: "ses_child_A",
          messageID: "msg_A_2",
          type: "tool",
          tool: "Read",
          state: {
            status: "pending",
            input: { filePath: "src/a.ts" },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(2);
    expect(starts[0]!.sessionId).toBe("ses_A");
    expect(starts[0]!.subagentId).toBe("agent_A");
    expect(starts[1]!.sessionId).toBe("ses_A");
    expect(starts[1]!.subagentId).toBe("agent_A");
    expect(starts[1]!.subagentSessionId).toBe("ses_child_A");
  });

  test("maps child tool events via session.created parentID before first child tool", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent_map";

    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{ sessionId: string; toolName?: string; parentAgentId?: string }> = [];
    const updates: Array<{ subagentId?: string; currentTool?: string; toolUses?: number }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubToolStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; parentAgentId?: string };
      toolStarts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        parentAgentId: data.parentAgentId,
      });
    });
    const unsubUpdate = client.on("subagent.update", (event) => {
      const data = event.data as { subagentId?: string; currentTool?: string; toolUses?: number };
      updates.push({
        subagentId: data.subagentId,
        currentTool: data.currentTool,
        toolUses: data.toolUses,
      });
    });

    // Parent dispatches sub-agent
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_map_1",
          sessionID: "ses_parent_map",
          messageID: "msg_parent_map_1",
          type: "agent",
          name: "codebase-locator",
        },
      },
    });

    // Child session is created with explicit parentID before first child tool part.
    handle({
      type: "session.created",
      properties: {
        info: {
          id: "ses_child_map_1",
          parentID: "ses_parent_map",
        },
      },
    });

    // First child tool event arrives with child sessionID.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_child_map_1",
          sessionID: "ses_child_map_1",
          messageID: "msg_child_map_1",
          type: "tool",
          tool: "Read",
          callID: "call_child_map_1",
          state: {
            status: "running",
            input: { filePath: "src/ui/chat.tsx" },
          },
        },
      },
    });

    unsubStart();
    unsubToolStart();
    unsubUpdate();

    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({ subagentId: "agent_map_1", subagentSessionId: undefined });
    expect(starts[1]).toEqual({ subagentId: "agent_map_1", subagentSessionId: "ses_child_map_1" });
    expect(toolStarts).toContainEqual({
      sessionId: "ses_child_map_1",
      toolName: "Read",
      parentAgentId: "agent_map_1",
    });
    expect(updates).toContainEqual({
      subagentId: "agent_map_1",
      currentTool: "Read",
      toolUses: 1,
    });
  });

  test("infers parent session for active child sessions when a single pending subagent exists", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    // Mark child session active before first child tool part arrives.
    (client as unknown as { registerActiveSession: (sessionId: string) => void })
      .registerActiveSession("ses_child_active_1");

    const starts: Array<{ sessionId: string; subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{ sessionId: string; toolName?: string; parentAgentId?: string }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });
    const unsubToolStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; parentAgentId?: string };
      toolStarts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        parentAgentId: data.parentAgentId,
      });
    });

    // Parent creates a pending subagent entry.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_pending_1",
          sessionID: "ses_parent_pending_1",
          messageID: "msg_parent_pending_1",
          type: "agent",
          name: "codebase-analyzer",
        },
      },
    });

    // Child tool part arrives while child session is already active.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_child_active_1",
          sessionID: "ses_child_active_1",
          messageID: "msg_child_active_1",
          type: "tool",
          tool: "Glob",
          state: {
            status: "pending",
            input: { path: "src/**/*.ts" },
          },
        },
      },
    });

    unsubStart();
    unsubToolStart();

    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({
      sessionId: "ses_parent_pending_1",
      subagentId: "agent_pending_1",
      subagentSessionId: undefined,
    });
    expect(starts[1]).toEqual({
      sessionId: "ses_parent_pending_1",
      subagentId: "agent_pending_1",
      subagentSessionId: "ses_child_active_1",
    });
    expect(toolStarts).toContainEqual({
      sessionId: "ses_child_active_1",
      toolName: "Glob",
      parentAgentId: "agent_pending_1",
    });
  });

  test("does not re-emit subagent.start for subsequent tool events on same child session", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });

    // Agent part
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: { id: "agent_1", sessionID: "ses_parent", messageID: "msg_1", type: "agent", name: "explore" },
      },
    });

    // First child tool → triggers re-emit
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_1", sessionID: "ses_child", messageID: "msg_c1", type: "tool",
          tool: "Read", state: { status: "pending", input: {} },
        },
      },
    });

    // Second child tool → should NOT re-emit
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_2", sessionID: "ses_child", messageID: "msg_c2", type: "tool",
          tool: "Write", state: { status: "pending", input: {} },
        },
      },
    });

    unsubStart();

    // Only 2 subagent.start events: initial + one re-emit
    expect(starts).toHaveLength(2);
  });

  test("does not synthesize nested task tool events from child sessions", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ subagentId?: string; subagentType?: string; subagentSessionId?: string }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        subagentSessionId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        subagentSessionId: data.subagentSessionId,
      });
    });

    // Seed a pending agent and discover its child session.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_debugger",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "debugger",
        },
      },
    });
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_read_1",
          sessionID: "ses_child_debugger",
          messageID: "msg_child_1",
          type: "tool",
          tool: "Read",
          callID: "call_read_1",
          state: { status: "pending", input: { file: "src/index.ts" } },
        },
      },
    });

    const startsBeforeNestedTask = [...starts];
    // Nested task tool under child session should NOT synthesize a new top-level task-agent row.
    handle({
      type: "message.part.updated",
      properties: {
        // Regression guard: envelope may still report the parent session.
        sessionID: "ses_parent",
        part: {
          id: "nested_task_1",
          sessionID: "ses_child_debugger",
          messageID: "msg_child_2",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "worker",
              description: "Debug message routing",
            },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toEqual(startsBeforeNestedTask);
  });

  test("does not emit subagent.start rows from task tool status updates", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      task?: string;
      subagentSessionId?: string;
    }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        task?: string;
        subagentSessionId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        task: data.task,
        subagentSessionId: data.subagentSessionId,
      });
    });

    // First running event has type but no task text yet.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
            },
          },
        },
      },
    });

    // Second running event provides task text but omits subagent_type.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              description: "Inspect workflow stream issues",
            },
          },
        },
      },
    });

    // Completion re-emits subagent.start with child session registration.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              description: "Inspect workflow stream issues",
            },
            metadata: {
              sessionId: "ses_child_debugger",
            },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(0);
  });

  test("maps structured session.error payloads to readable error strings", () => {
    const client = new OpenCodeClient();
    const errors: Array<{ sessionId: string; error: unknown }> = [];

    const unsubscribe = client.on("session.error", (event) => {
      errors.push({
        sessionId: event.sessionId,
        error: (event.data as { error?: unknown }).error,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_structured_error",
        error: {
          message: "Rate limit exceeded",
          code: "RATE_LIMIT",
        },
      },
    });

    unsubscribe();

    expect(errors).toEqual([
      {
        sessionId: "ses_structured_error",
        error: "Rate limit exceeded",
      },
    ]);
  });

  test("maps session.error info.id payloads and extracts top-level stderr text", () => {
    const client = new OpenCodeClient();
    const errors: Array<{ sessionId: string; error: unknown }> = [];

    const unsubscribe = client.on("session.error", (event) => {
      errors.push({
        sessionId: event.sessionId,
        error: (event.data as { error?: unknown }).error,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.error",
      error: {
        stderr: "OpenCode process exited with code 1",
      },
      properties: {
        info: { id: "ses_error_info_id" },
      },
    });

    unsubscribe();

    expect(errors).toEqual([
      {
        sessionId: "ses_error_info_id",
        error: "OpenCode process exited with code 1",
      },
    ]);
  });

  test("stream throws prompt errors instead of yielding assistant error text", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_error";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: () => Promise<Record<string, unknown>>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => ({
          error: {
            message: "OpenCode quota exceeded",
          },
        }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger")) {
        // stream should throw before yielding error text chunks
      }
    };

    await expect(consumeStream()).rejects.toThrow("OpenCode quota exceeded");
  });

  test("stream proactively compacts when usage crosses threshold", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_proactive_threshold";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 100;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const promptCalls: string[] = [];
    let summarizeCalls = 0;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params) => {
          const parts = ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          setTimeout(() => {
            handle({
              type: "message.updated",
              properties: {
                info: {
                  role: "assistant",
                  sessionID: sessionId,
                  tokens: {
                    input: 30,
                    output: 20,
                  },
                },
              },
            });
          }, 10);

          setTimeout(() => {
            handle({
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                delta: "threshold output",
              },
            });
          }, 20);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sessionId,
                status: "idle",
              },
            });
          }, 40);

          return {};
        },
        summarize: async () => {
          summarizeCalls += 1;
          return {};
        },
        messages: async () => ({ data: [] }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<{ type: string; content: unknown }>;
      }>;
    }).wrapSession(sessionId, {});

    const textChunks: string[] = [];
    for await (const chunk of session.stream("trigger proactive threshold")) {
      if (chunk.type === "text") {
        textChunks.push(chunk.content as string);
      }
    }

    expect(promptCalls).toEqual(["trigger proactive threshold"]);
    expect(textChunks).toEqual(["threshold output"]);
    expect(summarizeCalls).toBe(1);
  });

  test("stream does not proactively compact below threshold", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_proactive_below_threshold";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 100;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    let summarizeCalls = 0;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => {
          setTimeout(() => {
            handle({
              type: "message.updated",
              properties: {
                info: {
                  role: "assistant",
                  sessionID: sessionId,
                  tokens: {
                    input: 20,
                    output: 10,
                  },
                },
              },
            });
          }, 10);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sessionId,
                status: "idle",
              },
            });
          }, 40);

          return {};
        },
        summarize: async () => {
          summarizeCalls += 1;
          return {};
        },
        messages: async () => ({ data: [] }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    for await (const _chunk of session.stream("below threshold")) {
      // no-op
    }

    expect(summarizeCalls).toBe(0);
  });

  test("stream auto-compacts on overflow and auto-continues", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_overflow_recovery";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const promptCalls: string[] = [];
    let summarizeCalls = 0;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params) => {
          const parts = ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          if (promptCalls.length === 1) {
            return {
              error: {
                message: "ContextOverflowError: Input exceeds context window of this model",
              },
            };
          }

          setTimeout(() => {
            handle({
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                delta: "continued output",
              },
            });
          }, 20);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sessionId,
                status: "idle",
              },
            });
          }, 80);

          return {};
        },
        summarize: async () => {
          summarizeCalls += 1;
          return {};
        },
        messages: async () => ({ data: [] }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<{ type: string; content: unknown }>;
      }>;
    }).wrapSession(sessionId, {});

    const textChunks: string[] = [];
    for await (const chunk of session.stream("trigger overflow")) {
      if (chunk.type === "text") {
        textChunks.push(chunk.content as string);
      }
    }

    expect(summarizeCalls).toBe(1);
    expect(promptCalls).toEqual(["trigger overflow", "Continue"]);
    expect(textChunks).toEqual(["continued output"]);
  });

  test("stream overflow recovery emits compaction lifecycle in deterministic order", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_overflow_recovery_ordering";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const promptCalls: string[] = [];
    const compactionPhases: string[] = [];
    const idleReasons: string[] = [];
    const lifecycle: string[] = [];
    const truncationTokensRemoved: number[] = [];
    let summarizeCalls = 0;

    const unsubCompaction = client.on("session.compaction", (event) => {
      const data = event.data as { phase?: string };
      if (data.phase) {
        compactionPhases.push(data.phase);
        lifecycle.push(`compaction:${data.phase}`);
      }
    });

    const unsubTruncation = client.on("session.truncation", (event) => {
      const data = event.data as { tokensRemoved?: number };
      truncationTokensRemoved.push(data.tokensRemoved ?? 0);
      lifecycle.push("truncation");
    });

    const unsubIdle = client.on("session.idle", (event) => {
      const data = event.data as { reason?: string };
      const reason = data.reason ?? "";
      idleReasons.push(reason);
      lifecycle.push(`idle:${reason}`);
    });

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{
            data?: Array<{ info: { role: string; tokens?: { input?: number; output?: number } } }>;
          }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params) => {
          const parts = ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          if (promptCalls.length === 1) {
            handle({
              type: "message.updated",
              properties: {
                info: {
                  role: "assistant",
                  sessionID: sessionId,
                  tokens: {
                    input: 1_200,
                    output: 300,
                  },
                },
              },
            });
            return {
              error: {
                message: "ContextOverflowError: Input exceeds context window of this model",
              },
            };
          }

          setTimeout(() => {
            handle({
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                delta: "continued output",
              },
            });
          }, 10);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sessionId,
                status: "idle",
              },
            });
          }, 30);

          return {};
        },
        summarize: async () => {
          summarizeCalls += 1;
          setTimeout(() => {
            handle({
              type: "session.compacted",
              properties: { sessionID: sessionId },
            });
          }, 0);
          setTimeout(() => {
            handle({
              type: "session.compacted",
              properties: { sessionID: sessionId },
            });
          }, 1);
          return {};
        },
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                tokens: { input: 400, output: 100 },
              },
            },
          ],
        }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<{ type: string; content: unknown }>;
      }>;
    }).wrapSession(sessionId, {});

    const textChunks: string[] = [];
    for await (const chunk of session.stream("trigger overflow")) {
      if (chunk.type === "text") {
        textChunks.push(chunk.content as string);
        lifecycle.push("text");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubCompaction();
    unsubTruncation();
    unsubIdle();

    expect(summarizeCalls).toBe(1);
    expect(promptCalls).toEqual(["trigger overflow", "Continue"]);
    expect(textChunks).toEqual(["continued output"]);
    expect(compactionPhases).toEqual(["start", "complete"]);
    expect(truncationTokensRemoved).toEqual([1_000]);
    expect(idleReasons).toEqual(["context_compacted", "idle"]);

    const startIdx = lifecycle.indexOf("compaction:start");
    const truncationIdx = lifecycle.indexOf("truncation");
    const completeIdx = lifecycle.indexOf("compaction:complete");
    const textIdx = lifecycle.indexOf("text");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(truncationIdx).toBeGreaterThan(startIdx);
    expect(completeIdx).toBeGreaterThan(truncationIdx);
    expect(textIdx).toBeGreaterThan(completeIdx);
  });

  test("stream overflow recovery drops stale pre-compaction deltas", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_overflow_recovery_stale_delta";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const promptCalls: string[] = [];
    let summarizeCalls = 0;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params) => {
          const parts = ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          if (promptCalls.length === 1) {
            setTimeout(() => {
              handle({
                type: "message.part.delta",
                properties: {
                  sessionID: sessionId,
                  delta: "stale pre-compaction output",
                },
              });
            }, 5);
            return {
              error: {
                message: "context_length_exceeded",
              },
            };
          }

          setTimeout(() => {
            handle({
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                delta: "continued output",
              },
            });
          }, 5);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sessionId,
                status: "idle",
              },
            });
          }, 20);

          return {};
        },
        summarize: async () => {
          summarizeCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {};
        },
        messages: async () => ({ data: [] }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<{ type: string; content: unknown }>;
      }>;
    }).wrapSession(sessionId, {});

    const textChunks: string[] = [];
    for await (const chunk of session.stream("trigger overflow")) {
      if (chunk.type === "text") {
        textChunks.push(chunk.content as string);
      }
    }

    expect(summarizeCalls).toBe(1);
    expect(promptCalls).toEqual(["trigger overflow", "Continue"]);
    expect(textChunks).toEqual(["continued output"]);
  });

  test("stream surfaces overflow after auto-compaction retry budget is exhausted", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_overflow_retries_exhausted";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const promptCalls: string[] = [];
    let summarizeCalls = 0;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params) => {
          const parts = ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          return {
            error: {
              message: "context_length_exceeded",
            },
          };
        },
        summarize: async () => {
          summarizeCalls += 1;
          return {};
        },
        messages: async () => ({ data: [] }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger overflow")) {
        // stream should throw after a single auto-compaction attempt
      }
    };

    await expect(consumeStream()).rejects.toThrow(/context_length_exceeded/i);
    expect(summarizeCalls).toBe(1);
    expect(promptCalls).toEqual(["trigger overflow", "Continue"]);
  });

  test("stream preserves OpenCodeCompactionError type for auto-compaction failures", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_overflow_compaction_failure";
    const promptCalls: string[] = [];
    let summarizeCalls = 0;

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params) => {
          const parts = ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");
          return { error: { message: "context_length_exceeded" } };
        },
        summarize: async () => {
          summarizeCalls += 1;
          throw new Error("summarize failed");
        },
        messages: async () => ({ data: [] }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger overflow")) {
        // stream should fail after summarize terminal error
      }
    };

    const streamError = await consumeStream()
      .then(() => null)
      .catch((error: unknown) => error);
    expect(streamError).toBeInstanceOf(OpenCodeCompactionError);
    if (!(streamError instanceof OpenCodeCompactionError)) {
      throw new Error("Expected stream to throw OpenCodeCompactionError");
    }
    expect(streamError.code).toBe("COMPACTION_FAILED");
    expect(streamError.message).toBe(COMPACTION_TERMINAL_ERROR_MESSAGE);
    expect(summarizeCalls).toBe(1);
    expect(promptCalls).toEqual(["trigger overflow"]);
  });
});
