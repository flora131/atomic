import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("discovers child session from tool part and re-emits subagent.start with correct subagentSessionId", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{
      sessionId: string;
      toolName?: string;
      parentAgentId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; parentAgentId?: string };
      toolStarts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        parentAgentId: data.parentAgentId,
      });
    });

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

    expect(starts).toHaveLength(1);
    expect(starts[0]!.subagentId).toBe("agent_1");
    expect(starts[0]!.subagentSessionId).toBeUndefined();

    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
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

    expect(starts).toHaveLength(2);
    expect(starts[1]!.subagentId).toBe("agent_1");
    expect(starts[1]!.subagentSessionId).toBe("ses_child");
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]!.sessionId).toBe("ses_child");
    expect(toolStarts[0]!.toolName).toBe("Read");
    expect(toolStarts[0]!.parentAgentId).toBe("agent_1");
  });

  test("emits child-session skill.invoked on the discovered subagent session", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const invocations: Array<{ sessionId: string; skillName?: string; skillPath?: string }> =
      [];
    const unsubscribe = client.on("skill.invoked", (event) => {
      const data = event.data as { skillName?: string; skillPath?: string };
      invocations.push({
        sessionId: event.sessionId,
        skillName: data.skillName,
        skillPath: data.skillPath,
      });
    });

    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "agent_skill_1",
          sessionID: "ses_parent",
          messageID: "msg_skill_1",
          type: "agent",
          name: "explore",
        },
      },
    });

    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "skill_tool_child_1",
          sessionID: "ses_child",
          messageID: "msg_child_skill_1",
          type: "tool",
          tool: "skill",
          callID: "skill_call_child_1",
          state: {
            status: "pending",
            input: {
              name: "frontend-design",
              path: "/tmp/skills/frontend-design/SKILL.md",
            },
          },
        },
      },
    });

    unsubscribe();

    expect(invocations).toEqual([
      {
        sessionId: "ses_child",
        skillName: "frontend-design",
        skillPath: "/tmp/skills/frontend-design/SKILL.md",
      },
    ]);
  });

  test("routes child-session discovery to envelope parent session during parallel runs", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parallel_other";

    const starts: Array<{ sessionId: string; subagentId?: string; subagentSessionId?: string }> =
      [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_A",
        part: {
          id: "agent_A",
          sessionID: "ses_A",
          messageID: "msg_A_1",
          type: "agent",
          name: "worker",
        },
      },
    });

    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_A",
        part: {
          id: "tool_child_A",
          sessionID: "ses_child_A",
          messageID: "msg_A_2",
          type: "tool",
          tool: "Read",
          state: {
            status: "pending",
            input: { filePath: "src/a.ts" },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(2);
    expect(starts[0]!.sessionId).toBe("ses_A");
    expect(starts[0]!.subagentId).toBe("agent_A");
    expect(starts[1]!.sessionId).toBe("ses_A");
    expect(starts[1]!.subagentId).toBe("agent_A");
    expect(starts[1]!.subagentSessionId).toBe("ses_child_A");
  });

  test("maps child tool events via session.created parentID before first child tool", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent_map";

    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{ sessionId: string; toolName?: string; parentAgentId?: string }> =
      [];
    const updates: Array<{ subagentId?: string; currentTool?: string; toolUses?: number }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });
    const unsubToolStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; parentAgentId?: string };
      toolStarts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        parentAgentId: data.parentAgentId,
      });
    });
    const unsubUpdate = client.on("subagent.update", (event) => {
      const data = event.data as { subagentId?: string; currentTool?: string; toolUses?: number };
      updates.push({
        subagentId: data.subagentId,
        currentTool: data.currentTool,
        toolUses: data.toolUses,
      });
    });

    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_map_1",
          sessionID: "ses_parent_map",
          messageID: "msg_parent_map_1",
          type: "agent",
          name: "codebase-locator",
        },
      },
    });

    handle({
      type: "session.created",
      properties: {
        info: { id: "ses_child_map_1", parentID: "ses_parent_map" },
      },
    });

    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_child_map_1",
          sessionID: "ses_child_map_1",
          messageID: "msg_child_map_1",
          type: "tool",
          tool: "Read",
          callID: "call_child_map_1",
          state: {
            status: "running",
            input: { filePath: "src/screens/chat-screen.tsx" },
          },
        },
      },
    });

    unsubStart();
    unsubToolStart();
    unsubUpdate();

    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({
      subagentId: "agent_map_1",
      subagentSessionId: undefined,
    });
    expect(starts[1]).toEqual({
      subagentId: "agent_map_1",
      subagentSessionId: "ses_child_map_1",
    });
    expect(toolStarts).toContainEqual({
      sessionId: "ses_child_map_1",
      toolName: "Read",
      parentAgentId: "agent_map_1",
    });
    expect(updates).toContainEqual({
      subagentId: "agent_map_1",
      currentTool: "Read",
      toolUses: 1,
    });
  });

  test("infers parent session for active child sessions when a single pending subagent exists", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession(
      "ses_child_active_1",
    );

    const starts: Array<{ sessionId: string; subagentId?: string; subagentSessionId?: string }> =
      [];
    const toolStarts: Array<{ sessionId: string; toolName?: string; parentAgentId?: string }> =
      [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });
    const unsubToolStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; parentAgentId?: string };
      toolStarts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        parentAgentId: data.parentAgentId,
      });
    });

    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_pending_1",
          sessionID: "ses_parent_pending_1",
          messageID: "msg_parent_pending_1",
          type: "agent",
          name: "codebase-analyzer",
        },
      },
    });

    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_child_active_1",
          sessionID: "ses_child_active_1",
          messageID: "msg_child_active_1",
          type: "tool",
          tool: "Glob",
          state: {
            status: "pending",
            input: { path: "src/**/*.ts" },
          },
        },
      },
    });

    unsubStart();
    unsubToolStart();

    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({
      sessionId: "ses_parent_pending_1",
      subagentId: "agent_pending_1",
      subagentSessionId: undefined,
    });
    expect(starts[1]).toEqual({
      sessionId: "ses_parent_pending_1",
      subagentId: "agent_pending_1",
      subagentSessionId: "ses_child_active_1",
    });
    expect(toolStarts).toContainEqual({
      sessionId: "ses_child_active_1",
      toolName: "Glob",
      parentAgentId: "agent_pending_1",
    });
  });

  test("does not re-emit subagent.start for subsequent tool events on same child session", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

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
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_1",
          sessionID: "ses_child",
          messageID: "msg_c1",
          type: "tool",
          tool: "Read",
          state: { status: "pending", input: {} },
        },
      },
    });
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_2",
          sessionID: "ses_child",
          messageID: "msg_c2",
          type: "tool",
          tool: "Write",
          state: { status: "pending", input: {} },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(2);
  });
});
