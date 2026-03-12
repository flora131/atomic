import { describe, expect, test } from "bun:test";
import {
  COMPACTION_TERMINAL_ERROR_MESSAGE,
  OpenCodeClient,
} from "@/services/agents/clients/opencode.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";

describe("OpenCodeClient event mapping", () => {
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
});
