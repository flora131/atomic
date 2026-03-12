import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("stream proactively compacts when usage crosses threshold", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_proactive_threshold";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 100;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as {
        handleSdkEvent: (e: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

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
          const parts =
            ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          setTimeout(() => {
            handle({
              type: "message.updated",
              properties: {
                info: {
                  role: "assistant",
                  sessionID: sessionId,
                  tokens: { input: 30, output: 20 },
                },
              },
            });
          }, 10);

          setTimeout(() => {
            handle({
              type: "message.part.delta",
              properties: { sessionID: sessionId, delta: "threshold output" },
            });
          }, 20);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: { sessionID: sessionId, status: "idle" },
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
      (client as unknown as {
        handleSdkEvent: (e: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

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
                  tokens: { input: 20, output: 10 },
                },
              },
            });
          }, 10);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: { sessionID: sessionId, status: "idle" },
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
      ) => Promise<{ stream: (message: string) => AsyncIterable<unknown> }>;
    }).wrapSession(sessionId, {});

    for await (const _chunk of session.stream("below threshold")) {
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
      (client as unknown as {
        handleSdkEvent: (e: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

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
          const parts =
            ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
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
              properties: { sessionID: sessionId, delta: "continued output" },
            });
          }, 20);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: { sessionID: sessionId, status: "idle" },
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
      (client as unknown as {
        handleSdkEvent: (e: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

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
          const parts =
            ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          if (promptCalls.length === 1) {
            handle({
              type: "message.updated",
              properties: {
                info: {
                  role: "assistant",
                  sessionID: sessionId,
                  tokens: { input: 1_200, output: 300 },
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
              properties: { sessionID: sessionId, delta: "continued output" },
            });
          }, 10);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: { sessionID: sessionId, status: "idle" },
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
      (client as unknown as {
        handleSdkEvent: (e: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

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
          const parts =
            ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
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
            return { error: { message: "context_length_exceeded" } };
          }

          setTimeout(() => {
            handle({
              type: "message.part.delta",
              properties: { sessionID: sessionId, delta: "continued output" },
            });
          }, 5);

          setTimeout(() => {
            handle({
              type: "session.status",
              properties: { sessionID: sessionId, status: "idle" },
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
});
