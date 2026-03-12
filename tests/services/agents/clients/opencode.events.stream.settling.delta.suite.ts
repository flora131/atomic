import { describe, expect, test } from "bun:test";
import {
  createSettlingClient,
  emitSdkEvent,
  wrapSettlingSession,
} from "./opencode.events.stream.settling.test-support.ts";

describe("OpenCodeClient event mapping delta settling", () => {
  test("stream yields SSE deltas before promptAsync settles", async () => {
    const client = createSettlingClient();
    const sessionId = "ses_delta_before_prompt_settle";

    client.sdkClient = {
      session: {
        promptAsync: async () => {
          setTimeout(() => {
            emitSdkEvent(client, {
              type: "message.part.delta",
              properties: { sessionID: sessionId, delta: "early streamed chunk" },
            });
          }, 15);
          setTimeout(() => {
            emitSdkEvent(client, {
              type: "session.status",
              properties: { sessionID: sessionId, status: "idle" },
            });
          }, 30);

          await new Promise<void>((resolve) => setTimeout(resolve, 300));
        },
      },
    };

    const session = await wrapSettlingSession(client, sessionId);
    const chunks: Array<{ type: string; content: unknown }> = [];
    const streamStartAt = Date.now();
    let firstChunkAt: number | null = null;
    let resolveFirstChunk: (() => void) | undefined;
    const firstChunkPromise = new Promise<void>((resolve) => {
      resolveFirstChunk = resolve;
    });

    const consumePromise = (async () => {
      for await (const chunk of session.stream("plain prompt")) {
        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
          resolveFirstChunk?.();
        }
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    let firstChunkTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        firstChunkPromise,
        new Promise<never>((_, reject) => {
          firstChunkTimeoutId = setTimeout(
            () => reject(new Error("first chunk did not arrive in time")),
            150,
          );
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
          streamTimeoutId = setTimeout(
            () => reject(new Error("stream did not complete")),
            2000,
          );
        }),
      ]);
    } finally {
      if (streamTimeoutId) clearTimeout(streamTimeoutId);
    }

    expect(
      chunks.some(
        (chunk) => chunk.type === "text" && chunk.content === "early streamed chunk",
      ),
    ).toBe(true);
  });

  test("non-subagent stream completes on idle and yields text from SSE deltas", async () => {
    const client = createSettlingClient();
    const sessionId = "ses_non_subagent_idle";
    client.sdkClient = { session: { promptAsync: async () => {} } };

    const session = await wrapSettlingSession(client, sessionId);
    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("plain prompt")) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    setTimeout(() => {
      emitSdkEvent(client, {
        type: "message.part.delta",
        properties: { sessionID: sessionId, delta: "final response" },
      });
    }, 20);
    setTimeout(() => {
      emitSdkEvent(client, {
        type: "session.status",
        properties: { sessionID: sessionId, status: "idle" },
      });
    }, 80);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("stream did not finish")),
            1000,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(
      chunks.some(
        (chunk) => chunk.type === "text" && chunk.content === "final response",
      ),
    ).toBe(true);
  });
});
