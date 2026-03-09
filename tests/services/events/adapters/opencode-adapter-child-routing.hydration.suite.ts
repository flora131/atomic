// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import type {
  AgentEvent,
  AgentMessage,
  CodingAgentClient,
  EventType,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("OpenCodeStreamAdapter child-session hydration", () => {
  let bus: EventBus;
  let adapter: OpenCodeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
  });

  test("drops child-session tools when task metadata does not identify the child session", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research TUI UX practices",
          subagent_type: "codebase-online-researcher",
        },
        toolUseId: "task-tool-synth-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "tui patterns" },
        toolUseId: "child-tool-synth-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "task-tool-synth-1",
      ),
    ).toBeDefined();
    expect(
      events.some(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "child-tool-synth-1",
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "stream.agent.start" || event.type === "stream.agent.update",
      ),
    ).toBe(false);
  });

  test("attributes parallel child-session tools via task metadata session ids before subagent.start", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Locate TUI code",
          subagent_type: "codebase-locator",
        },
        toolMetadata: { sessionId: "child-session-a" },
        toolUseId: "task-tool-a",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Find UI patterns",
          subagent_type: "codebase-pattern-finder",
        },
        toolMetadata: { sessionId: "child-session-b" },
        toolUseId: "task-tool-b",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-a",
      timestamp: Date.now(),
      data: {
        toolName: "Read",
        toolInput: { filePath: "src/screens/chat-screen.tsx" },
        toolUseId: "child-tool-a",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: {
        toolName: "Glob",
        toolInput: { path: "src/**/*.ts" },
        toolUseId: "child-tool-b",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start" && event.data.toolId === "child-tool-a",
      )?.data.parentAgentId,
    ).toBe("task-tool-a");
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start" && event.data.toolId === "child-tool-b",
      )?.data.parentAgentId,
    ).toBe("task-tool-b");
  });

  test("hydrates OpenCode child-session tools from synced parent task parts when streamed task metadata omits the child session id", async () => {
    const events = collectEvents(bus);
    const client = createMockClient() as CodingAgentClient & {
      getSessionMessagesWithParts: ReturnType<typeof mock>;
    };
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);
    client.getSessionMessagesWithParts = mock(async (sessionId: string) => {
      if (sessionId === "test-session-123") {
        return [
          {
            info: {
              id: "parent-message-1",
              sessionID: "test-session-123",
              role: "assistant",
            },
            parts: [
              {
                type: "tool",
                id: "task-tool-history-1",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: { sessionId: "child-session-history-1" },
                },
              },
            ],
          },
        ];
      }

      if (sessionId === "child-session-history-1") {
        return [
          {
            info: {
              id: "child-message-1",
              sessionID: "child-session-history-1",
              role: "assistant",
            },
            parts: [
              {
                type: "tool",
                id: "child-tool-history-1",
                tool: "Read",
                state: {
                  status: "completed",
                  input: { filePath: "src/services/agents/clients/opencode.ts" },
                  output: "ok",
                },
              },
            ],
          },
        ];
      }

      return [];
    });

    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );
    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-history-hydration",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research BM25 explanation",
          subagent_type: "codebase-online-researcher",
        },
        toolUseId: "task-tool-history-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-history-1",
        subagentType: "codebase-online-researcher",
        task: "Research BM25 explanation",
        toolUseId: "task-tool-history-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research BM25 explanation",
          subagent_type: "codebase-online-researcher",
        },
        toolResult: "task_id: child-session-history-1\n\n<task_result>done</task_result>",
        success: true,
        toolUseId: "task-tool-history-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getSessionMessagesWithParts).toHaveBeenCalledWith("test-session-123");
    expect(client.getSessionMessagesWithParts).toHaveBeenCalledWith("child-session-history-1");
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "child-tool-history-1",
      )?.data.parentAgentId,
    ).toBe("agent-history-1");
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.complete"
          && event.data.toolId === "child-tool-history-1",
      )?.data.parentAgentId,
    ).toBe("agent-history-1");
  });

  test("keeps syncing OpenCode child-session tools from task metadata session id until they appear", async () => {
    const events = collectEvents(bus);
    const client = createMockClient() as CodingAgentClient & {
      getSessionMessagesWithParts: ReturnType<typeof mock>;
    };
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);
    const childToolsAvailableAt = Date.now() + 1300;
    let childFetchCount = 0;

    client.getSessionMessagesWithParts = mock(async (sessionId: string) => {
      if (sessionId !== "child-session-early-1") {
        return [];
      }

      childFetchCount += 1;
      if (Date.now() < childToolsAvailableAt) {
        return [];
      }

      return [
        {
          info: {
            id: "child-message-early-1",
            sessionID: "child-session-early-1",
            role: "assistant",
          },
          parts: [
            {
              type: "tool",
              id: "child-tool-early-1",
              tool: "WebSearch",
              state: {
                status: "completed",
                input: { query: "bm25 explanation" },
                output: "ok",
              },
            },
          ],
        },
      ];
    });

    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );
    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-early-child-hydration",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research BM25 explanation",
          subagent_type: "codebase-online-researcher",
        },
        toolMetadata: { sessionId: "child-session-early-1" },
        toolUseId: "task-tool-early-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;
    await new Promise((resolve) => setTimeout(resolve, 1800));

    expect(client.getSessionMessagesWithParts).toHaveBeenCalledWith("child-session-early-1");
    expect(childFetchCount).toBeGreaterThanOrEqual(4);
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "child-tool-early-1",
      )?.data.parentAgentId,
    ).toBe("task-tool-early-1");
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.complete"
          && event.data.toolId === "child-tool-early-1",
      )?.data.parentAgentId,
    ).toBe("task-tool-early-1");

    adapterWithClient.dispose();
  });
});
