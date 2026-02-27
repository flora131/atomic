import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "./opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("defaults directory to process.cwd() for project-scoped agent resolution", () => {
    const client = new OpenCodeClient();
    const options = client as unknown as { clientOptions?: { directory?: string } };
    expect(options.clientOptions?.directory).toBe(process.cwd());
  });

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

  test("maps subtask parts to subagent.start with agent name and task", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      task?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        task?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        task: data.task,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "subtask",
          prompt: "Research Rust TUI stacks",
          description: "Research the best technology stacks in Rust for terminal games",
          agent: "codebase-online-researcher",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_parent",
        subagentId: "subtask_1",
        subagentType: "codebase-online-researcher",
        task: "Research the best technology stacks in Rust for terminal games",
      },
    ]);
  });

  test("emits thinking source identity for reasoning deltas", () => {
    const client = new OpenCodeClient();
    const deltas: Array<{
      sessionId: string;
      delta?: string;
      contentType?: string;
      thinkingSourceKey?: string;
    }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as {
        delta?: string;
        contentType?: string;
        thinkingSourceKey?: string;
      };
      deltas.push({
        sessionId: event.sessionId,
        delta: data.delta,
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning_part_1",
          sessionID: "ses_reasoning",
          messageID: "msg_reasoning",
          type: "reasoning",
        },
        delta: "inspect constraints",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        sessionId: "ses_reasoning",
        delta: "inspect constraints",
        contentType: "reasoning",
        thinkingSourceKey: "reasoning_part_1",
      },
    ]);
  });

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
          // callID is missing/undefined
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_agent_no_callid",
        subagentId: "agent-2",
        subagentType: "worker",
        toolCallId: "agent-2", // Falls back to id
      },
    ]);
  });

  test("emits tool.complete when tool status is completed but output is undefined", () => {
    // Uses a non-Task tool because Task tools are intentionally suppressed
    // from tool.start/tool.complete — they use synthesized subagent events.
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
          state: {
            status: "completed",
            input: { command: "echo hello" },
            // output is intentionally omitted (undefined)
          },
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

  test("maps step-finish part to subagent.complete", () => {
    const client = new OpenCodeClient();
    const completes: Array<{
      sessionId: string;
      subagentId?: string;
      success?: boolean;
      result?: string;
    }> = [];

    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: string;
      };
      completes.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        success: data.success,
        result: data.result,
      });
    });

    // Test successful completion
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "ses_step",
          messageID: "msg_step",
          type: "step-finish",
          reason: "success",
        },
      },
    });

    // Test error completion
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-2",
          sessionID: "ses_step",
          messageID: "msg_step_2",
          type: "step-finish",
          reason: "error",
        },
      },
    });

    unsubComplete();

    expect(completes).toEqual([
      {
        sessionId: "ses_step",
        subagentId: "step-1",
        success: true,
        result: "success",
      },
      {
        sessionId: "ses_step",
        subagentId: "step-2",
        success: false,
        result: "error",
      },
    ]);
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
    // subagentSessionId is intentionally omitted from the initial emission
    // because AgentPart.sessionID is the parent session, not the child.
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
    // subagentSessionId intentionally omitted — see AgentPart comment.
    expect(starts[0]!.subagentSessionId).toBeUndefined();
  });

  test("discovers child session from tool part and re-emits subagent.start with correct subagentSessionId", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    // Set currentSessionId so the client knows the parent session.
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];
    const toolStarts: Array<{
      sessionId: string;
      toolName?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      toolStarts.push({ sessionId: event.sessionId, toolName: data.toolName });
    });

    // 1. Agent part arrives (parent session)
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "agent_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "explore",
        },
      },
    });

    // Initial subagent.start without subagentSessionId
    expect(starts).toHaveLength(1);
    expect(starts[0]!.subagentId).toBe("agent_1");
    expect(starts[0]!.subagentSessionId).toBeUndefined();

    // 2. First tool from child session arrives
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_child_1",
          sessionID: "ses_child",
          messageID: "msg_child_1",
          type: "tool",
          tool: "Read",
          callID: "call_child_1",
          state: { status: "pending", input: { file: "foo.ts" } },
        },
      },
    });

    unsubStart();
    unsubTool();

    // Re-emitted subagent.start with correct child session ID
    expect(starts).toHaveLength(2);
    expect(starts[1]!.subagentId).toBe("agent_1");
    expect(starts[1]!.subagentSessionId).toBe("ses_child");

    // Tool event emitted on the child session
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]!.sessionId).toBe("ses_child");
    expect(toolStarts[0]!.toolName).toBe("Read");
  });

  test("does not re-emit subagent.start for subsequent tool events on same child session", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });

    // Agent part
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: { id: "agent_1", sessionID: "ses_parent", messageID: "msg_1", type: "agent", name: "explore" },
      },
    });

    // First child tool → triggers re-emit
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_1", sessionID: "ses_child", messageID: "msg_c1", type: "tool",
          tool: "Read", state: { status: "pending", input: {} },
        },
      },
    });

    // Second child tool → should NOT re-emit
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_2", sessionID: "ses_child", messageID: "msg_c2", type: "tool",
          tool: "Write", state: { status: "pending", input: {} },
        },
      },
    });

    unsubStart();

    // Only 2 subagent.start events: initial + one re-emit
    expect(starts).toHaveLength(2);
  });
});
