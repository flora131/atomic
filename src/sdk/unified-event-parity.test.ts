import { describe, expect, mock, test } from "bun:test";
import { ClaudeAgentClient, OpenCodeClient, CopilotClient } from "./clients/index.ts";
import { extractMessageContent } from "./clients/claude.ts";
import type { EventType } from "./types.ts";

const PARITY_EVENTS: EventType[] = [
  "session.start",
  "session.idle",
  "session.error",
  "session.info",
  "session.warning",
  "session.title_changed",
  "session.truncation",
  "session.compaction",
  "message.delta",
  "message.complete",
  "reasoning.delta",
  "reasoning.complete",
  "turn.start",
  "turn.end",
  "tool.start",
  "tool.complete",
  "tool.partial_result",
  "skill.invoked",
  "subagent.start",
  "subagent.complete",
  "permission.requested",
  "human_input_required",
  "usage",
];

describe("Unified provider event parity", () => {
  test("all providers register shared event handlers", () => {
    const clients = [
      new ClaudeAgentClient(),
      new OpenCodeClient(),
      new CopilotClient(),
    ];

    for (const client of clients) {
      for (const eventType of PARITY_EVENTS) {
        const unsubscribe = client.on(eventType, () => {});
        expect(typeof unsubscribe).toBe("function");
        unsubscribe();
      }
    }
  });

  test("all providers emit the same event envelope shape", () => {
    const clients = [
      new ClaudeAgentClient(),
      new OpenCodeClient(),
      new CopilotClient(),
    ];

    for (const client of clients) {
      const events: Array<{
        type: EventType;
        sessionId: string;
        timestamp: string;
        data: Record<string, unknown>;
      }> = [];

      const unsubscribe = client.on("usage", (event) => {
        events.push({
          type: event.type,
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          data: event.data as Record<string, unknown>,
        });
      });

      (
        client as unknown as {
          emitEvent: (
            eventType: EventType,
            sessionId: string,
            data: Record<string, unknown>
          ) => void;
        }
      ).emitEvent("usage", "parity-session", {
        marker: "parity.marker",
        runtimeMode: "v1",
      });

      unsubscribe();

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("usage");
      expect(events[0]?.sessionId).toBe("parity-session");
      expect(events[0]?.data).toEqual({
        marker: "parity.marker",
        runtimeMode: "v1",
      });
      expect(Number.isNaN(Date.parse(events[0]?.timestamp ?? ""))).toBe(false);
    }
  });

  test("all providers support unsubscribe parity", () => {
    const clients = [
      new ClaudeAgentClient(),
      new OpenCodeClient(),
      new CopilotClient(),
    ];

    for (const client of clients) {
      let calls = 0;
      const unsubscribe = client.on("usage", () => {
        calls += 1;
      });

      (
        client as unknown as {
          emitEvent: (
            eventType: EventType,
            sessionId: string,
            data: Record<string, unknown>
          ) => void;
        }
      ).emitEvent("usage", "session-1", { marker: "first" });

      unsubscribe();

      (
        client as unknown as {
          emitEvent: (
            eventType: EventType,
            sessionId: string,
            data: Record<string, unknown>
          ) => void;
        }
      ).emitEvent("usage", "session-1", { marker: "second" });

      expect(calls).toBe(1);
    }
  });

  test("reasoning-capable paths emit stable thinkingSourceKey identity", async () => {
    const claudeFirst = extractMessageContent({
      message: {
        content: [
          { type: "metadata" },
          { type: "thinking", thinking: "first thought" },
          { type: "thinking", thinking: "other source" },
        ],
      },
    } as unknown as Parameters<typeof extractMessageContent>[0]);
    const claudeSecond = extractMessageContent({
      message: {
        content: [
          { type: "metadata" },
          { type: "thinking", thinking: "second thought" },
        ],
      },
    } as unknown as Parameters<typeof extractMessageContent>[0]);

    const claudeSourceKeys = [claudeFirst.thinkingSourceKey, claudeSecond.thinkingSourceKey];
    expect(claudeSourceKeys).toEqual(["1", "1"]);

    const openCodeClient = new OpenCodeClient();
    const openCodeSourceKeys: string[] = [];
    const unsubscribeOpenCode = openCodeClient.on("message.delta", (event) => {
      const data = event.data as { contentType?: string; thinkingSourceKey?: string };
      if (data.contentType === "thinking" && data.thinkingSourceKey) {
        openCodeSourceKeys.push(data.thinkingSourceKey);
      }
    });

    (
      openCodeClient as unknown as {
        handleSdkEvent: (event: Record<string, unknown>) => void;
      }
    ).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning_part_a",
          sessionID: "ses_reasoning",
          messageID: "msg_reasoning",
          type: "reasoning",
        },
      },
    });

    (
      openCodeClient as unknown as {
        handleSdkEvent: (event: Record<string, unknown>) => void;
      }
    ).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        partID: "reasoning_part_a",
        sessionID: "ses_reasoning",
        delta: "alpha",
      },
    });

    (
      openCodeClient as unknown as {
        handleSdkEvent: (event: Record<string, unknown>) => void;
      }
    ).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        partID: "reasoning_part_a",
        sessionID: "ses_reasoning",
        delta: "beta",
      },
    });

    unsubscribeOpenCode();

    expect(openCodeSourceKeys).toEqual(["reasoning_part_a", "reasoning_part_a"]);

    const copilotListeners: Array<(event: { type: string; data: Record<string, unknown> }) => void> =
      [];
    const mockCopilotSession = {
      sessionId: "copilot-thinking-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        copilotListeners.push(handler);
        return () => {
          const index = copilotListeners.indexOf(handler);
          if (index >= 0) {
            copilotListeners.splice(index, 1);
          }
        };
      }),
      send: mock(async () => {
        for (const listener of [...copilotListeners]) {
          listener({
            type: "assistant.reasoning_delta",
            data: {
              reasoningId: "reasoning_123",
              deltaContent: "step-1",
            },
          });
        }
        for (const listener of [...copilotListeners]) {
          listener({
            type: "assistant.reasoning_delta",
            data: {
              reasoningId: "reasoning_123",
              deltaContent: "step-2",
            },
          });
        }
        for (const listener of [...copilotListeners]) {
          listener({
            type: "session.idle",
            data: {},
          });
        }
      }),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const copilotClient = new CopilotClient({});
    const wrapCopilotSession = (
      copilotClient as unknown as {
        wrapSession: (
          sdkSession: {
            sessionId: string;
            on: (
              handler: (event: { type: string; data: Record<string, unknown> }) => void,
            ) => () => void;
            send: (args: { prompt: string }) => Promise<void>;
            sendAndWait: (args: { prompt: string }) => Promise<{ data: { content: string } }>;
            destroy: () => Promise<void>;
            abort: () => Promise<void>;
          },
          config: Record<string, unknown>,
        ) => {
          stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
            type: string;
            content: unknown;
            metadata?: Record<string, unknown>;
          }>;
        };
      }
    ).wrapSession.bind(copilotClient);

    const wrappedCopilotSession = wrapCopilotSession(mockCopilotSession, {});
    const copilotSourceKeys: string[] = [];

    for await (const chunk of wrappedCopilotSession.stream("hello")) {
      if (chunk.type !== "thinking") {
        continue;
      }
      const sourceKey = chunk.metadata?.thinkingSourceKey;
      if (typeof sourceKey === "string") {
        copilotSourceKeys.push(sourceKey);
      }
    }

    expect(copilotSourceKeys).toEqual(["reasoning_123", "reasoning_123"]);
  });
});
