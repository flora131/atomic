import { describe, expect, test } from "bun:test";
import {
  createOpenCodeClient,
  emitOpenCodeSdkEvent,
  setOpenCodeCurrentSessionId,
} from "./opencode.events.mapping.test-support.ts";

describe("OpenCodeClient event mapping", () => {
  test("maps tool part updates using part.sessionID when properties.sessionID is absent", () => {
    const client = createOpenCodeClient();
    const starts: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];
    const completes: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      starts.push({ sessionId: event.sessionId, toolName: data.toolName, toolCallId: data.toolCallId });
    });
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      completes.push({ sessionId: event.sessionId, toolName: data.toolName, toolCallId: data.toolCallId });
    });

    const basePart = {
      id: "prt_tool_1",
      callID: "call_tool_1",
      sessionID: "ses_part_session",
      messageID: "msg_1",
      type: "tool",
      tool: "bash",
    };

    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: { part: { ...basePart, state: { status: "running", input: { command: "pwd" } } } },
    });
    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: { ...basePart, state: { status: "completed", input: { command: "pwd" }, output: "/tmp" } },
      },
    });

    unsubStart();
    unsubComplete();

    expect(starts).toEqual([{ sessionId: "ses_part_session", toolName: "bash", toolCallId: "call_tool_1" }]);
    expect(completes).toEqual([{ sessionId: "ses_part_session", toolName: "bash", toolCallId: "call_tool_1" }]);
  });

  test("emits skill.invoked once for native Skill tool lifecycle updates", () => {
    const client = createOpenCodeClient();
    const invocations: Array<{ sessionId: string; skillName?: string; skillPath?: string }> = [];
    const unsubscribe = client.on("skill.invoked", (event) => {
      const data = event.data as { skillName?: string; skillPath?: string };
      invocations.push({ sessionId: event.sessionId, skillName: data.skillName, skillPath: data.skillPath });
    });

    const basePart = {
      id: "skill_tool_part_1",
      callID: "skill_tool_call_1",
      sessionID: "ses_skill_main",
      messageID: "msg_skill_main",
      type: "tool",
      tool: "skill",
    };

    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "pending",
            input: { name: "explain-code", path: "/tmp/skills/explain-code/SKILL.md" },
          },
        },
      },
    });
    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "running",
            input: { name: "explain-code", path: "/tmp/skills/explain-code/SKILL.md" },
          },
        },
      },
    });
    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "completed",
            input: { name: "explain-code", path: "/tmp/skills/explain-code/SKILL.md" },
            output: "loaded",
          },
        },
      },
    });

    unsubscribe();

    expect(invocations).toEqual([
      {
        sessionId: "ses_skill_main",
        skillName: "explain-code",
        skillPath: "/tmp/skills/explain-code/SKILL.md",
      },
    ]);
  });

  test("emits task tool lifecycle for parent-session task parts", () => {
    const client = createOpenCodeClient();
    setOpenCodeCurrentSessionId(client, "ses_parent");

    const starts: Array<{ toolName?: string; toolCallId?: string }> = [];
    const completes: Array<{ toolName?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      starts.push({ toolName: data.toolName, toolCallId: data.toolCallId });
    });
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      completes.push({ toolName: data.toolName, toolCallId: data.toolCallId });
    });

    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent",
          callID: "call_task_parent",
          sessionID: "ses_parent",
          messageID: "msg_task_1",
          type: "tool",
          tool: "task",
          state: { status: "running", input: { subagent_type: "debugger", description: "debug stream ordering" } },
        },
      },
    });
    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent",
          callID: "call_task_parent",
          sessionID: "ses_parent",
          messageID: "msg_task_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: { subagent_type: "debugger", description: "debug stream ordering" },
            output: "done",
          },
        },
      },
    });

    unsubStart();
    unsubComplete();

    expect(starts).toEqual([{ toolName: "task", toolCallId: "call_task_parent" }]);
    expect(completes).toEqual([{ toolName: "task", toolCallId: "call_task_parent" }]);
  });

  test("includes task tool metadata on tool.start for parent-session task parts", () => {
    const client = createOpenCodeClient();
    setOpenCodeCurrentSessionId(client, "ses_parent");

    const starts: Array<{ toolName?: string; toolCallId?: string; toolMetadata?: Record<string, unknown> }> = [];
    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string; toolMetadata?: Record<string, unknown> };
      starts.push({ toolName: data.toolName, toolCallId: data.toolCallId, toolMetadata: data.toolMetadata });
    });

    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent_meta",
          callID: "call_task_parent_meta",
          sessionID: "ses_parent",
          messageID: "msg_task_meta_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "debug stream ordering",
            },
            metadata: {
              sessionId: "ses_child_meta_1",
              model: { providerID: "openai", modelID: "gpt-5.3-codex-high" },
            },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        toolName: "task",
        toolCallId: "call_task_parent_meta",
        toolMetadata: {
          sessionId: "ses_child_meta_1",
          model: { providerID: "openai", modelID: "gpt-5.3-codex-high" },
        },
      },
    ]);
  });

  test("does not synthesize subagent.start from parent-session task tool parts", () => {
    const client = createOpenCodeClient();
    setOpenCodeCurrentSessionId(client, "ses_parent");
    const lifecycle: string[] = [];

    const unsubSubagentStart = client.on("subagent.start", (event) => {
      const data = event.data as { toolCallId?: string };
      if (data.toolCallId === "task_tool_ordering") {
        lifecycle.push("subagent.start");
      }
    });
    const unsubToolStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      if (data.toolName === "task") {
        lifecycle.push("tool.start");
      }
    });

    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_ordering",
          callID: "call_task_ordering",
          sessionID: "ses_parent",
          messageID: "msg_task_ordering",
          type: "tool",
          tool: "task",
          state: { status: "running", input: { subagent_type: "debugger", description: "fix ordering" } },
        },
      },
    });

    unsubSubagentStart();
    unsubToolStart();

    expect(lifecycle).toEqual(["tool.start"]);
  });

  test("maps subtask parts to subagent.start with agent name and task", () => {
    const client = createOpenCodeClient();
    const starts: Array<{ sessionId: string; subagentId?: string; subagentType?: string; task?: string }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentType?: string; task?: string };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        task: data.task,
      });
    });

    emitOpenCodeSdkEvent(client, {
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
});
