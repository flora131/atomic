import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "./opencode.ts";

describe("OpenCodeClient resilience integration", () => {
  test("reconnects and reconciles after stream completion", async () => {
    const client = new OpenCodeClient();
    const globalAbort = new AbortController();
    let subscribeCalls = 0;
    let processCalls = 0;
    let reconcileCalls = 0;

    const internal = client as unknown as {
      isRunning: boolean;
      eventSubscriptionController: AbortController | null;
      sdkClient: {
        event: {
          subscribe: (
            parameters?: { directory?: string },
            options?: { signal?: AbortSignal },
          ) => Promise<{ stream: AsyncGenerator<unknown, unknown, unknown> }>;
        };
      } | null;
      processEventStream: (
        stream: AsyncGenerator<unknown, unknown, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
      reconcileStateOnReconnect: () => Promise<void>;
      runEventLoop: () => Promise<void>;
    };

    internal.isRunning = true;
    internal.eventSubscriptionController = globalAbort;
    internal.sdkClient = {
      event: {
        subscribe: async (_parameters, options) => {
          subscribeCalls += 1;
          expect(options?.signal).toBeDefined();
          return {
            stream: (async function* () {})(),
          };
        },
      },
    };

    internal.reconcileStateOnReconnect = async () => {
      reconcileCalls += 1;
    };

    internal.processEventStream = async () => {
      processCalls += 1;
      if (processCalls >= 2) {
        globalAbort.abort();
      }
    };

    await Promise.race([
      internal.runEventLoop(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("runEventLoop did not reconnect in time")), 2_500);
      }),
    ]);

    expect(subscribeCalls).toBe(2);
    expect(processCalls).toBe(2);
    expect(reconcileCalls).toBe(1);
  });

  test("keeps concurrent session streams isolated under interleaved events", async () => {
    const client = new OpenCodeClient();
    let promptCalls = 0;

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const emitSdkEvent = (event: Record<string, unknown>) => {
      (client as unknown as { handleSdkEvent: (sdkEvent: Record<string, unknown>) => void })
        .handleSdkEvent(event);
    };

    const emitInterleavedEvents = () => {
      setTimeout(() => {
        emitSdkEvent({
          type: "message.part.delta",
          properties: {
            sessionID: "ses_A",
            delta: "A:1",
          },
        });
      }, 10);
      setTimeout(() => {
        emitSdkEvent({
          type: "message.part.delta",
          properties: {
            sessionID: "ses_B",
            delta: "B:1",
          },
        });
      }, 20);
      setTimeout(() => {
        emitSdkEvent({
          type: "message.part.delta",
          properties: {
            sessionID: "ses_A",
            delta: "A:2",
          },
        });
      }, 30);
      setTimeout(() => {
        emitSdkEvent({
          type: "message.part.delta",
          properties: {
            sessionID: "ses_B",
            delta: "B:2",
          },
        });
      }, 40);
      setTimeout(() => {
        emitSdkEvent({
          type: "session.status",
          properties: {
            sessionID: "ses_A",
            status: "idle",
          },
        });
      }, 60);
      setTimeout(() => {
        emitSdkEvent({
          type: "session.status",
          properties: {
            sessionID: "ses_B",
            status: "idle",
          },
        });
      }, 70);
    };

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => {
          promptCalls += 1;
          if (promptCalls === 2) {
            emitInterleavedEvents();
          }
          return {};
        },
      },
    };

    const sessionA = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<{ type: string; content: unknown }>;
      }>;
    }).wrapSession("ses_A", {});
    const sessionB = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<{ type: string; content: unknown }>;
      }>;
    }).wrapSession("ses_B", {});

    const collectText = async (
      stream: AsyncIterable<{ type: string; content: unknown }>,
    ): Promise<string[]> => {
      const deltas: string[] = [];
      for await (const chunk of stream) {
        if (chunk.type === "text" && typeof chunk.content === "string") {
          deltas.push(chunk.content);
        }
      }
      return deltas;
    };

    const results = await Promise.race([
      Promise.all([
        collectText(sessionA.stream("run A")),
        collectText(sessionB.stream("run B")),
      ]),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("concurrent streams did not complete in time")), 2_500);
      }),
    ]);

    expect(results[0]).toEqual(["A:1", "A:2"]);
    expect(results[1]).toEqual(["B:1", "B:2"]);
  });
});
