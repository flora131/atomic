import { describe, expect, test } from "bun:test";
import {
  COMPACTION_TERMINAL_ERROR_MESSAGE,
  isContextOverflowError,
  OpenCodeClient,
  OpenCodeCompactionError,
  transitionOpenCodeCompactionControl,
} from "@/services/agents/clients/opencode.ts";

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

describe("OpenCode additional instruction routing", () => {
  test("injects additional instructions into non-agent prompt parts without using system override", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_prompt_additional_instructions";
    let capturedParams: Record<string, unknown> | undefined;

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
        };
      };
    }).sdkClient = {
      session: {
        prompt: async (params) => {
          capturedParams = params;
          return {
            data: {
              info: {
                tokens: { input: 1, output: 1 },
              },
              parts: [{ type: "text", text: "ok" }],
            },
          };
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        send: (message: string) => Promise<unknown>;
      }>;
    }).wrapSession(sessionId, {
      additionalInstructions: "Follow repo conventions.",
    });

    await session.send("Fix the failing tests");

    expect(capturedParams?.system).toBeUndefined();
    expect(capturedParams?.parts).toEqual([
      {
        type: "text",
        text: [
          "<additional_instructions>",
          "Follow repo conventions.",
          "</additional_instructions>",
          "",
          "Fix the failing tests",
        ].join("\n"),
      },
    ]);
  });

  test("injects additional instructions into agent-dispatch prompt parts", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_agent_prompt_no_additional_instructions";
    let capturedParams: Record<string, unknown> | undefined;

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
        promptAsync: async (params) => {
          capturedParams = params;
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        sendAsync: (
          message: string,
          options?: { agent?: string; abortSignal?: AbortSignal },
        ) => Promise<void>;
      }>;
    }).wrapSession(sessionId, {
      additionalInstructions: "Follow repo conventions.",
    });

    await session.sendAsync("Investigate the auth flow", { agent: "worker" });

    expect(capturedParams?.system).toBeUndefined();
    expect(capturedParams?.parts).toEqual([
      {
        type: "text",
        text: [
          "<additional_instructions>",
          "Follow repo conventions.",
          "</additional_instructions>",
          "",
          "Investigate the auth flow",
        ].join("\n"),
      },
      {
        type: "agent",
        name: "worker",
      },
    ]);
  });

  test("forwards selected reasoning effort as the OpenCode prompt variant", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_prompt_variant";
    let capturedParams: Record<string, unknown> | undefined;

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
        };
      };
    }).sdkClient = {
      session: {
        prompt: async (params) => {
          capturedParams = params;
          return {
            data: {
              info: {
                tokens: { input: 1, output: 1 },
              },
              parts: [{ type: "text", text: "ok" }],
            },
          };
        },
      },
    };

    await client.setActivePromptModel("openai/gpt-5", { reasoningEffort: "high" });

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        send: (message: string) => Promise<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    await session.send("Use more reasoning");

    expect(capturedParams?.variant).toBe("high");
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
  test("reports built-in OpenCode reasoning efforts in model display info", async () => {
    const client = new OpenCodeClient();
    const internal = client as unknown as {
      isRunning: boolean;
      sdkClient: Record<string, unknown> | null;
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
      lookupRawModelIdFromProviders: () => Promise<string | undefined>;
      listProviderModels: () => Promise<Array<{
        id: string;
        name: string;
        models: Record<string, Record<string, unknown>>;
      }>>;
    };

    internal.isRunning = true;
    internal.sdkClient = {};
    internal.resolveModelContextWindow = async () => 200_000;
    internal.lookupRawModelIdFromProviders = async () => undefined;
    internal.listProviderModels = async () => [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5": {
            name: "GPT-5",
            capabilities: {
              reasoning: true,
              attachment: true,
              temperature: true,
              toolcall: true,
            },
            limit: { context: 200_000, output: 16_384 },
            options: {},
            variants: {
              low: { reasoningEffort: "low" },
              high: { reasoningEffort: "high" },
              custom: { reasoningEffort: "medium" },
            },
          },
        },
      },
    ];

    const info = await client.getModelDisplayInfo("openai/gpt-5");

    expect(info.supportsReasoning).toBe(true);
    expect(info.supportedReasoningEfforts).toEqual(["low", "high"]);
  });

  test("defaults directory to process.cwd() for project-scoped agent resolution", () => {
    const client = new OpenCodeClient();
    const options = client as unknown as { clientOptions?: { directory?: string } };
    expect(options.clientOptions?.directory).toBe(process.cwd());
  });

  test("starts an isolated server before connecting by default", async () => {
    const client = new OpenCodeClient();
    const callOrder: string[] = [];
    const internal = client as unknown as {
      spawnServer: () => Promise<boolean>;
      connect: () => Promise<boolean>;
      subscribeToSdkEvents: () => Promise<void>;
      isRunning: boolean;
    };

    internal.spawnServer = async () => {
      callOrder.push("spawn");
      return true;
    };
    internal.connect = async () => {
      callOrder.push("connect");
      return true;
    };
    internal.subscribeToSdkEvents = async () => {
      callOrder.push("subscribe");
    };

    await client.start();

    expect(callOrder).toEqual(["spawn", "connect", "subscribe"]);
    expect(internal.isRunning).toBe(true);
  });

  test("uses Atomic-managed server path even when reuseExistingServer is true", async () => {
    const client = new OpenCodeClient({ reuseExistingServer: true });
    const callOrder: string[] = [];
    const internal = client as unknown as {
      spawnServer: () => Promise<boolean>;
      connect: () => Promise<boolean>;
      subscribeToSdkEvents: () => Promise<void>;
      isRunning: boolean;
    };

    internal.spawnServer = async () => {
      callOrder.push("spawn");
      return true;
    };
    internal.connect = async () => {
      callOrder.push("connect");
      return true;
    };
    internal.subscribeToSdkEvents = async () => {
      callOrder.push("subscribe");
    };

    await client.start();

    expect(callOrder).toEqual(["spawn", "connect", "subscribe"]);
    expect(internal.isRunning).toBe(true);
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

  test("preserves nativeType and native payload on provider events", () => {
    const client = new OpenCodeClient();
    const providerEvents: Array<Record<string, unknown>> = [];

    client.onProviderEvent((event) => {
      providerEvents.push(event as unknown as Record<string, unknown>);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "ses_native",
        messageID: "msg_native",
        partID: "part_native",
        delta: "hello",
      },
    });

    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.type).toBe("message.delta");
    expect(providerEvents[0]!.nativeType).toBe("message.part.delta");
    expect((providerEvents[0]!.native as { type: string }).type).toBe("message.part.delta");
    expect(providerEvents[0]!.nativeMeta).toEqual({
      nativeSessionId: "ses_native",
      nativeMessageId: "msg_native",
      nativePartId: "part_native",
    });
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
});
