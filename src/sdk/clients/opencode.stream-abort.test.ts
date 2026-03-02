import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "./opencode.ts";

describe("OpenCodeClient stream abort handling", () => {
  test("terminates in-flight prompt dispatch when abortSignal fires", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_abort";
    let promptSignal: AbortSignal | undefined;

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (
            params: Record<string, unknown>,
            options?: { signal?: AbortSignal },
          ) => Promise<Record<string, unknown>>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (_params, options) => {
          promptSignal = options?.signal;
          await new Promise<never>((_resolve, reject) => {
            if (options?.signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
          return {};
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (
          message: string,
          options?: { agent?: string; abortSignal?: AbortSignal },
        ) => AsyncIterable<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    const abortController = new AbortController();
    const streamTask = (async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger", { abortSignal: abortController.signal })) {
        // No-op
      }
    })();

    const abortTimer = setTimeout(() => abortController.abort(), 10);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        streamTask,
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream did not stop after abort")), 200);
        }),
      ]);
    } finally {
      clearTimeout(abortTimer);
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(promptSignal).toBe(abortController.signal);
  });

  test("skips post-compaction continue dispatch when stream is aborted", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_abort_before_continue_dispatch";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const promptCalls: string[] = [];
    const abortController = new AbortController();

    (client as unknown as {
      sdkClient: {
        session: {
          promptAsync: (
            params: Record<string, unknown>,
            options?: { signal?: AbortSignal },
          ) => Promise<Record<string, unknown>>;
          summarize: (params: Record<string, unknown>) => Promise<Record<string, never>>;
          messages: (params: Record<string, unknown>) => Promise<{ data: unknown[] }>;
        };
      };
    }).sdkClient = {
      session: {
        promptAsync: async (params, options) => {
          const parts = ((params.parts as Array<{ type?: string; text?: string }> | undefined) ?? []);
          const textPart = parts.find((part) => part.type === "text");
          promptCalls.push(textPart?.text ?? "");
          expect(options?.signal).toBe(abortController.signal);
          return {
            error: {
              message: "context_length_exceeded",
            },
          };
        },
        summarize: async () => {
          abortController.abort();
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
        stream: (
          message: string,
          options?: { agent?: string; abortSignal?: AbortSignal },
        ) => AsyncIterable<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    await Promise.race([
      (async () => {
        for await (const _chunk of session.stream("trigger overflow", { abortSignal: abortController.signal })) {
          // No-op
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("stream did not stop after compaction abort")), 300);
      }),
    ]);

    expect(promptCalls).toEqual(["trigger overflow"]);
  });
});
