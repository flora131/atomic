import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("maps agent part to subagent.start with toolCallId from callID", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent-1",
          sessionID: "ses_agent",
          messageID: "msg_1",
          type: "agent",
          name: "explorer",
          callID: "call-123",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_agent",
        subagentId: "agent-1",
        subagentType: "explorer",
        toolCallId: "call-123",
      },
    ]);
  });

  test("maps agent part to subagent.start with toolCallId fallback to id when callID is missing", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent-2",
          sessionID: "ses_agent_no_callid",
          messageID: "msg_2",
          type: "agent",
          name: "worker",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_agent_no_callid",
        subagentId: "agent-2",
        subagentType: "worker",
        toolCallId: "agent-2",
      },
    ]);
  });

  test("uses preceding task tool part id as correlation for subsequent agent part", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as {
        handleSdkEvent: (payload: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_1",
          callID: "task_call_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "pending",
            input: {
              subagent_type: "debugger",
              description: "Inspect workflow stream issues",
            },
          },
        },
      },
    });

    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_from_task",
          callID: "call_agent_1",
          sessionID: "ses_parent",
          messageID: "msg_2",
          type: "agent",
          name: "debugger",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        subagentId: "agent_from_task",
        subagentType: "debugger",
        toolCallId: "task_tool_1",
      },
    ]);
  });

  test("ignores user @mention agent parts to avoid orphan subagent rows", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as {
        handleSdkEvent: (payload: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

    handleSdkEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg_user_1", sessionID: "ses_parent", role: "user" },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "user_agent_ref",
          sessionID: "ses_parent",
          messageID: "msg_user_1",
          type: "agent",
          name: "debugger",
        },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_1",
          callID: "task_call_1",
          sessionID: "ses_parent",
          messageID: "msg_asst_1",
          type: "tool",
          tool: "task",
          state: {
            status: "pending",
            input: {
              subagent_type: "debugger",
              description: "Investigate initialization hang",
            },
          },
        },
      },
    });
    handleSdkEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg_asst_1", sessionID: "ses_parent", role: "assistant" },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_from_task",
          callID: "call_agent_1",
          sessionID: "ses_parent",
          messageID: "msg_asst_1",
          type: "agent",
          name: "debugger",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        subagentId: "agent_from_task",
        subagentType: "debugger",
        toolCallId: "task_tool_1",
      },
    ]);
  });

  test("does not leak completed task correlation into later agent parts", () => {
    const client = new OpenCodeClient();
    const starts: Array<{ subagentId?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; toolCallId?: string };
      starts.push({
        subagentId: data.subagentId,
        toolCallId: data.toolCallId,
      });
    });

    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as {
        handleSdkEvent: (payload: Record<string, unknown>) => void;
      }).handleSdkEvent(event);

    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_stale",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "initial task",
            },
          },
        },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_stale",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "debugger",
              description: "initial task",
            },
          },
        },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_after_task",
          callID: "call_after_task",
          sessionID: "ses_parent",
          messageID: "msg_2",
          type: "agent",
          name: "worker",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        subagentId: "agent_after_task",
        toolCallId: "call_after_task",
      },
    ]);
  });

  test("emits tool.complete when tool status is completed but output is undefined", () => {
    const client = new OpenCodeClient();
    const completes: Array<{
      sessionId: string;
      toolName?: string;
      toolResult?: unknown;
      success?: boolean;
    }> = [];

    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as {
        toolName?: string;
        toolResult?: unknown;
        success?: boolean;
      };
      completes.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolResult: data.toolResult,
        success: data.success,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_bash_1",
          callID: "call_bash_1",
          sessionID: "ses_task",
          messageID: "msg_1",
          type: "tool",
          tool: "bash",
          state: { status: "completed", input: { command: "echo hello" } },
        },
      },
    });

    unsubComplete();

    expect(completes).toHaveLength(1);
    expect(completes[0]!.sessionId).toBe("ses_task");
    expect(completes[0]!.toolName).toBe("bash");
    expect(completes[0]!.toolResult).toBeUndefined();
    expect(completes[0]!.success).toBe(true);
  });

  test("omits subagentSessionId from initial agent part subagent.start (parent session != child)", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentSessionId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "agent_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "explore",
          callID: "call_1",
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(1);
    expect(starts[0]!.sessionId).toBe("ses_parent");
    expect(starts[0]!.subagentId).toBe("agent_1");
    expect(starts[0]!.subagentSessionId).toBeUndefined();
  });

  test("omits subagentSessionId from initial subtask part subagent.start", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentSessionId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask_2",
          sessionID: "ses_subtask_session",
          messageID: "msg_1",
          type: "subtask",
          prompt: "Find files",
          description: "Locate relevant source files",
          agent: "codebase-locator",
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(1);
    expect(starts[0]!.subagentId).toBe("subtask_2");
    expect(starts[0]!.subagentSessionId).toBeUndefined();
  });
});
