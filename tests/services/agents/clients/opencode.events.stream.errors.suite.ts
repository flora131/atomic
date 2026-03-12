import { describe, expect, test } from "bun:test";
import {
  COMPACTION_TERMINAL_ERROR_MESSAGE,
  OpenCodeClient,
  OpenCodeCompactionError,
} from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("stream throws prompt errors instead of yielding assistant error text", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_error";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: { promptAsync: () => Promise<Record<string, unknown>> };
      };
    }).sdkClient = {
      session: {
        promptAsync: async () => ({
          error: { message: "OpenCode quota exceeded" },
        }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{ stream: (message: string) => AsyncIterable<unknown> }>;
    }).wrapSession(sessionId, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger")) {
      }
    };

    await expect(consumeStream()).rejects.toThrow("OpenCode quota exceeded");
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
          const parts =
            ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");

          return { error: { message: "context_length_exceeded" } };
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

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger overflow")) {
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
          const parts =
            ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
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
      ) => Promise<{ stream: (message: string) => AsyncIterable<unknown> }>;
    }).wrapSession(sessionId, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger overflow")) {
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
