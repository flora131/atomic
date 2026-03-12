import { describe, expect, test } from "bun:test";
import { ClaudeAgentClient } from "@/services/agents/clients/index.ts";

describe("ClaudeAgentClient observability and parity", () => {
  test("tracks unmatched tool and subagent completion parity", () => {
    const client = new ClaudeAgentClient();

    (client as unknown as {
      emitEvent: (
        eventType: "tool.complete" | "subagent.complete",
        sessionId: string,
        data: Record<string, unknown>,
      ) => void;
    }).emitEvent("tool.complete", "session-1", { toolName: "Read", success: true });

    (client as unknown as {
      emitEvent: (
        eventType: "tool.complete" | "subagent.complete",
        sessionId: string,
        data: Record<string, unknown>,
      ) => void;
    }).emitEvent("subagent.complete", "session-1", {
      subagentId: "agent-1",
      success: true,
    });

    const integrity = (client as unknown as {
      streamIntegrity: {
        unmatchedToolCompletes: number;
        unmatchedSubagentCompletes: number;
      };
    }).streamIntegrity;

    expect(integrity.unmatchedToolCompletes).toBe(1);
    expect(integrity.unmatchedSubagentCompletes).toBe(1);
  });

  test("emits stream integrity counters through usage without payload leakage", async () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (client as unknown as {
        emitEvent: (
          eventType:
            | "tool.complete"
            | "subagent.complete"
            | "tool.start"
            | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("tool.complete", "session-usage", {
        toolName: "Read",
        success: true,
      });

      (client as unknown as {
        emitEvent: (
          eventType:
            | "tool.complete"
            | "subagent.complete"
            | "tool.start"
            | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("subagent.complete", "session-usage", {
        subagentId: "agent-1",
        success: true,
      });

      const session = (client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          persisted?: {
            sdkSessionId?: string | null;
            inputTokens?: number;
            outputTokens?: number;
            contextWindow?: number | null;
            systemToolsBaseline?: number | null;
          },
        ) => { destroy: () => Promise<void> };
      }).wrapQuery(null, "session-start-gaps", {});

      (client as unknown as {
        emitEvent: (
          eventType:
            | "tool.complete"
            | "subagent.complete"
            | "tool.start"
            | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("tool.start", "session-start-gaps", { toolName: "Read" });

      (client as unknown as {
        emitEvent: (
          eventType:
            | "tool.complete"
            | "subagent.complete"
            | "tool.start"
            | "subagent.start",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }).emitEvent("subagent.start", "session-start-gaps", {
        subagentType: "background",
      });

      await session.destroy();

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedToolCompletes: 1,
        },
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedSubagentCompletes: 1,
        },
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedToolStarts: 1,
        },
        {
          provider: "claude",
          marker: "claude.stream.integrity",
          unmatchedSubagentStarts: 1,
        },
      ]);

      for (const event of usageEvents) {
        expect("toolName" in event).toBe(false);
        expect("subagentId" in event).toBe(false);
        expect("subagentType" in event).toBe(false);
      }
    } finally {
      unsubscribe();
    }
  });
});
