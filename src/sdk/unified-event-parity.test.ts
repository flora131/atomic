import { describe, expect, test } from "bun:test";
import { ClaudeAgentClient, OpenCodeClient, CopilotClient } from "./clients/index.ts";
import type { EventType } from "./types.ts";

const PARITY_EVENTS: EventType[] = [
  "session.start",
  "session.idle",
  "session.error",
  "message.delta",
  "message.complete",
  "tool.start",
  "tool.complete",
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
});
