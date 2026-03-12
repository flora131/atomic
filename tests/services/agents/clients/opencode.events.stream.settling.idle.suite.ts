import { describe, expect, test } from "bun:test";
import {
  createSettlingClient,
  emitSdkEvent,
  wrapSettlingSession,
} from "./opencode.events.stream.settling.test-support.ts";

describe("OpenCodeClient event mapping idle settling", () => {
  test("stream resolves even when no terminal idle event arrives", async () => {
    const client = createSettlingClient();
    const sessionId = "ses_stream_no_idle";

    client.sdkClient = {
      session: {
        promptAsync: async () => {
          emitSdkEvent(client, {
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
            emitSdkEvent(client, {
              type: "session.status",
              properties: { sessionID: sessionId, status: "idle" },
            });
          }, 50);
        },
      },
    };

    const session = await wrapSettlingSession(client, sessionId);
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
    const client = createSettlingClient();
    const sessionId = "ses_idle_before_prompt_settle";
    client.sdkClient = { session: { promptAsync: async () => {} } };

    const session = await wrapSettlingSession(client, sessionId);
    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("run task", { agent: "worker" })) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    const idleTimer = setTimeout(() => {
      emitSdkEvent(client, {
        type: "session.status",
        properties: { sessionID: sessionId, status: "idle" },
      });
    }, 20);
    const toolTimer = setTimeout(() => {
      emitSdkEvent(client, {
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
          timeoutId = setTimeout(
            () => reject(new Error("stream did not complete")),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(idleTimer);
      clearTimeout(toolTimer);
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(
      chunks.some((chunk) => {
        if (chunk.type !== "tool_use") return false;
        return (chunk.content as { name?: string }).name === "Read";
      }),
    ).toBe(true);
  });

  test("stream keeps child-session progress isolated when currentSessionId points to another session", async () => {
    const client = createSettlingClient();
    client.sdkClient = {
      session: {
        promptAsync: async (params: Record<string, unknown>) => {
          const sid = params.sessionID as string;
          const childSid = `${sid}_child`;

          emitSdkEvent(client, {
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
          emitSdkEvent(client, {
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
          setTimeout(() => {
            emitSdkEvent(client, {
              type: "session.status",
              properties: { sessionID: sid, status: "idle" },
            });
          }, 50);
        },
      },
    };

    const session = await wrapSettlingSession(client, "ses_A");
    client.currentSessionId = "ses_B";

    const chunks: Array<{ type: string; content: unknown }> = [];
    for await (const chunk of session.stream("run task", { agent: "worker" })) {
      chunks.push({ type: chunk.type, content: chunk.content });
    }

    expect(
      chunks.some((chunk) => chunk.type === "tool_use"),
    ).toBe(true);
  });

  test("stream completes when terminal session event arrives before prompt resolves", async () => {
    const client = createSettlingClient();
    const sessionId = "ses_terminal_before_prompt";
    client.sdkClient = { session: { promptAsync: async () => {} } };

    const session = await wrapSettlingSession(client, sessionId);
    const consumePromise = (async () => {
      for await (const _chunk of session.stream("run task", { agent: "worker" })) {
      }
    })();

    setTimeout(() => {
      emitSdkEvent(client, {
        type: "session.status",
        properties: { sessionID: sessionId, status: "idle" },
      });
    }, 20);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("stream did not complete")),
            1000,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });
});
