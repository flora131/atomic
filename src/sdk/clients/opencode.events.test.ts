import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "./opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("maps session.created info.id to session.start sessionId", () => {
    const client = new OpenCodeClient();
    const sessionStarts: string[] = [];

    const unsubscribe = client.on("session.start", (event) => {
      sessionStarts.push(event.sessionId);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.created",
      properties: {
        info: { id: "ses_test_created" },
      },
    });

    unsubscribe();

    expect(sessionStarts).toEqual(["ses_test_created"]);
  });

  test("maps tool part updates using part.sessionID when properties.sessionID is absent", () => {
    const client = new OpenCodeClient();
    const starts: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];
    const completes: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      starts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolCallId: data.toolCallId,
      });
    });
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      completes.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolCallId: data.toolCallId,
      });
    });

    const basePart = {
      id: "prt_tool_1",
      callID: "call_tool_1",
      sessionID: "ses_part_session",
      messageID: "msg_1",
      type: "tool",
      tool: "bash",
    };

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "running",
            input: { command: "pwd" },
          },
        },
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "completed",
            input: { command: "pwd" },
            output: "/tmp",
          },
        },
      },
    });

    unsubStart();
    unsubComplete();

    expect(starts).toEqual([
      {
        sessionId: "ses_part_session",
        toolName: "bash",
        toolCallId: "call_tool_1",
      },
    ]);
    expect(completes).toEqual([
      {
        sessionId: "ses_part_session",
        toolName: "bash",
        toolCallId: "call_tool_1",
      },
    ]);
  });
});

