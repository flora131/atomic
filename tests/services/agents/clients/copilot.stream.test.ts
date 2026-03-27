import { describe, expect, test, mock } from "bun:test";

import { CopilotClient } from "@/services/agents/clients/copilot.ts";

describe("CopilotClient stream() filters sub-agent deltas", () => {
  test("stream() skips assistant.message_delta with parentToolCallId", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-subagent-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      send: mock(async () => {
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.message_delta",
            data: { deltaContent: "main text", messageId: "msg-1" },
          });
        }
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.message_delta",
            data: { deltaContent: "sub-agent text", messageId: "msg-2", parentToolCallId: "tc-sub" },
          });
        }
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.message_delta",
            data: { deltaContent: " continues", messageId: "msg-1" },
          });
        }
        for (const listener of [...listeners]) {
          listener({ type: "session.idle", data: {} });
        }
      }),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        stream: (message: string) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});
    const streamed: Array<{ type: string; content: unknown }> = [];
    for await (const chunk of session.stream("hello")) {
      streamed.push(chunk);
    }

    const textChunks = streamed.filter((chunk) => chunk.type === "text");
    expect(textChunks).toHaveLength(2);
    expect(textChunks[0]!.content).toBe("main text");
    expect(textChunks[1]!.content).toBe(" continues");
  });
});

describe("CopilotClient error propagation", () => {
  test("maps structured session.error payloads to readable error strings", () => {
    const client = new CopilotClient({});
    const errors: Array<{ error?: unknown; code?: unknown }> = [];

    client.on("session.error", (event) => {
      const data = event.data as { error?: unknown; code?: unknown };
      errors.push({ error: data.error, code: data.code });
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("copilot-session", {
      type: "session.error",
      data: {
        error: {
          message: "Copilot rate limit exceeded",
        },
        code: "RATE_LIMIT",
      },
    });

    expect(errors).toEqual([
      {
        error: "Copilot rate limit exceeded",
        code: "RATE_LIMIT",
      },
    ]);
  });

  test("stream propagates normalized provider errors", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-error-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      send: mock(async () => {
        throw {
          error: {
            message: "Authentication failed",
          },
        };
      }),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        stream: (message: string) => AsyncIterable<unknown>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("hello")) {
        // stream should throw before yielding when send() fails
      }
    };

    await expect(consumeStream()).rejects.toThrow("Authentication failed");
  });
});

describe("CopilotClient model switch event deduplication", () => {
  function createMockSdkSession(sessionId: string) {
    const listeners = new Set<(event: { type: string; id?: string; data: Record<string, unknown> }) => void>();
    return {
      sessionId,
      listeners,
      on: mock((handler: (event: { type: string; id?: string; data: Record<string, unknown> }) => void) => {
        listeners.add(handler);
        return () => {
          listeners.delete(handler);
        };
      }),
      send: mock(async () => ({})),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
      emit(event: { type: string; id?: string; data: Record<string, unknown> }) {
        for (const fn of listeners) {
          fn(event);
        }
      },
    };
  }

  test("stale session events are ignored after setActiveSessionModel", async () => {
    const initialSdkSession = createMockSdkSession("copilot-dedup-session");
    const resumedSdkSession = createMockSdkSession("copilot-dedup-session");

    const client = new CopilotClient({});

    (client as unknown as { sdkClient: unknown }).sdkClient = {
      resumeSession: mock(async () => resumedSdkSession),
      listModels: mock(async () => []),
    };
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { registeredTools: unknown[] }).registeredTools = [];

    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => unknown;
    }).wrapSession.bind(client);

    wrapSession(initialSdkSession, { model: "gpt-4o" });

    const deltas: string[] = [];
    client.on("message.delta", (event) => {
      deltas.push((event.data as { delta: string }).delta);
    });

    await client.setActiveSessionModel("openai/gpt-4o");

    initialSdkSession.emit({
      type: "assistant.message_delta",
      id: "stale-1",
      data: { deltaContent: "stale-delta" },
    });

    resumedSdkSession.emit({
      type: "assistant.message_delta",
      id: "fresh-1",
      data: { deltaContent: "fresh-delta" },
    });

    expect(deltas).toEqual(["fresh-delta"]);
  });

  test("duplicate event IDs are suppressed within the same session", () => {
    const sdkSession = createMockSdkSession("copilot-dup-session");

    const client = new CopilotClient({});

    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => unknown;
    }).wrapSession.bind(client);

    wrapSession(sdkSession, { model: "gpt-4o" });

    const deltas: string[] = [];
    client.on("message.delta", (event) => {
      deltas.push((event.data as { delta: string }).delta);
    });

    const duplicateEvent = {
      type: "assistant.message_delta" as const,
      id: "dup-evt-1",
      data: { deltaContent: "hello" },
    };

    sdkSession.emit(duplicateEvent);
    sdkSession.emit(duplicateEvent);

    expect(deltas).toEqual(["hello"]);
  });
});

describe("CopilotClient send timeout", () => {
  test("stream() rejects with session-expired error when send hangs", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-timeout-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      // send() never resolves — simulates a hung CLI process
      send: mock(() => new Promise<void>(() => {})),
      sendAndWait: mock(() => new Promise<void>(() => {})),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        stream: (message: string) => AsyncIterable<unknown>;
      };
    }).wrapSession.bind(client);

    // Temporarily override the timeout constant via a wrapper — we use a
    // short timeout so the test doesn't wait 60 s.
    // The real withSendTimeout inside session-runtime will fire its own 60 s
    // timeout, but the stream error message should contain "session expired".
    const session = wrapSession(mockSdkSession, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("hello")) {
        // Should never yield — the send() hangs and the timeout fires
      }
    };

    // The timeout fires with a message containing "session expired"
    await expect(consumeStream()).rejects.toThrow("session expired");
  }, 120_000); // generous test timeout — the actual send timeout is 60 s

  test("send() rejects with session-expired error when sendAndWait hangs", async () => {
    const mockSdkSession = {
      sessionId: "copilot-send-timeout-session",
      on: mock(() => () => {}),
      send: mock(() => new Promise<void>(() => {})),
      sendAndWait: mock(() => new Promise<void>(() => {})),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        send: (message: string) => Promise<unknown>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});

    await expect(session.send("hello")).rejects.toThrow("session expired");
  }, 120_000);

  test("stream() throws session-expired when session is already closed", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-closed-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      send: mock(async () => {
        for (const listener of [...listeners]) {
          listener({ type: "session.idle", data: {} });
        }
      }),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        stream: (message: string) => AsyncIterable<unknown>;
        destroy: () => Promise<void>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});

    // Destroy the session first to set isClosed = true
    await session.destroy();

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("hello")) {
        // noop
      }
    };

    // Should immediately throw with a message matching "session expired"
    await expect(consumeStream()).rejects.toThrow("session expired");
  });
});
