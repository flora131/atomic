import { describe, expect, test } from "bun:test";
import { CopilotClient } from "@/services/agents/clients/copilot.ts";
import {
  bindCopilotHandleSdkEvent,
  createRunningCopilotClient,
  seedCopilotSession,
} from "./copilot.mapping.test-support.ts";

describe("CopilotClient tool event mapping", () => {
  test("maps tool.execution_start using mcpToolName fallback", () => {
    const client = new CopilotClient({});
    const events: Array<{ sessionId: string; data: Record<string, unknown> }> = [];

    client.on("tool.start", (event) => {
      events.push({ sessionId: event.sessionId, data: event.data as Record<string, unknown> });
    });

    seedCopilotSession(client);
    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-1",
        mcpToolName: "filesystem/read_file",
        arguments: "README.md",
      },
    });

    expect(events).toEqual([
      {
        sessionId: "test-session",
        data: {
          toolName: "filesystem/read_file",
          toolInput: "README.md",
          toolCallId: "tool-1",
          parentId: undefined,
        },
      },
    ]);
  });

  test("maps tool.execution_complete with result fallbacks and tracked tool name", () => {
    const client = new CopilotClient({});
    const events: Array<{ sessionId: string; data: Record<string, unknown> }> = [];

    client.on("tool.complete", (event) => {
      events.push({ sessionId: event.sessionId, data: event.data as Record<string, unknown> });
    });

    seedCopilotSession(client, new Map([["tool-2", "view"]]));
    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-2",
        success: true,
        result: {
          detailedContent: "line 1\nline 2",
        },
      },
    });

    expect(events).toEqual([
      {
        sessionId: "test-session",
        data: {
          toolName: "view",
          success: true,
          toolResult: "line 1\nline 2",
          error: undefined,
          toolCallId: "tool-2",
          parentId: undefined,
        },
      },
    ]);
  });
});

describe("CopilotClient message_delta preserves parentToolCallId and messageId", () => {
  test("handleSdkEvent passes parentToolCallId and messageId to unified event", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: Record<string, unknown> }> = [];
    client.on("message.delta", (event) => {
      events.push({ data: event.data as Record<string, unknown> });
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "assistant.message_delta",
      data: {
        deltaContent: "Hello world",
        messageId: "msg-123",
        parentToolCallId: "tc-456",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data.delta).toBe("Hello world");
    expect(events[0]!.data.messageId).toBe("msg-123");
    expect(events[0]!.data.parentToolCallId).toBe("tc-456");
  });

  test("handleSdkEvent omits parentToolCallId when not present", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: Record<string, unknown> }> = [];
    client.on("message.delta", (event) => {
      events.push({ data: event.data as Record<string, unknown> });
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "assistant.message_delta",
      data: {
        deltaContent: "Main agent text",
        messageId: "msg-789",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data.delta).toBe("Main agent text");
    expect(events[0]!.data.messageId).toBe("msg-789");
    expect(events[0]!.data.parentToolCallId).toBeUndefined();
  });
});
