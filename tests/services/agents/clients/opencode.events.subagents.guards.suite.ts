import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("does not synthesize nested task tool events from child sessions", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      subagentSessionId?: string;
    }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        subagentSessionId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        subagentSessionId: data.subagentSessionId,
      });
    });

    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_debugger",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "debugger",
        },
      },
    });
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_read_1",
          sessionID: "ses_child_debugger",
          messageID: "msg_child_1",
          type: "tool",
          tool: "Read",
          callID: "call_read_1",
          state: { status: "pending", input: { file: "src/index.ts" } },
        },
      },
    });

    const startsBeforeNestedTask = [...starts];
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "nested_task_1",
          sessionID: "ses_child_debugger",
          messageID: "msg_child_2",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "worker",
              description: "Debug message routing",
            },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toEqual(startsBeforeNestedTask);
  });

  test("does not emit subagent.start rows from task tool status updates", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      task?: string;
      subagentSessionId?: string;
    }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        task?: string;
        subagentSessionId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        task: data.task,
        subagentSessionId: data.subagentSessionId,
      });
    });

    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: { subagent_type: "debugger" },
          },
        },
      },
    });
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: { description: "Inspect workflow stream issues" },
          },
        },
      },
    });
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: { description: "Inspect workflow stream issues" },
            metadata: { sessionId: "ses_child_debugger" },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(0);
  });
});
