import { beforeEach, describe, expect, test } from "bun:test";
import {
  addHitlQuestion,
  createAgentPart,
  createMockAgent,
  createMockMessage,
  createReasoningPart,
  createToolPart,
  finalizeLastTextPart,
  handleTextDelta,
  resetStreamOrderState,
  resolveHitlQuestion,
  type AgentPart,
  type ToolPart,
  upsertPart,
  verifyMonotonicIds,
} from "./stream-order.test-support.ts";

describe("Stream render order complex flows", () => {
  beforeEach(() => {
    resetStreamOrderState();
  });

  test("agent spawn mid-stream", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "Spawning agent...");
    msg = finalizeLastTextPart(msg);

    const agentPart = createAgentPart([createMockAgent("agent_1", "debugger")]);
    msg.parts = upsertPart(msg.parts!, agentPart);
    msg.parts = upsertPart(msg.parts!, createToolPart("tool_1", "bash"));
    msg = handleTextDelta(msg, " Agent completed.");

    expect(msg.parts).toHaveLength(4);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("agent");
    expect(msg.parts![2]!.type).toBe("tool");
    expect(msg.parts![3]!.type).toBe("text");
    expect((msg.parts![1] as AgentPart).agents[0]!.name).toBe("debugger");
    verifyMonotonicIds(msg.parts!);
  });

  test("complex realistic scenario preserves full order", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "Let me think about this...");
    msg = finalizeLastTextPart(msg);
    expect(msg.parts).toHaveLength(1);

    msg.parts = upsertPart(
      msg.parts!,
      createReasoningPart("I need to check the file first", false),
    );
    expect(msg.parts).toHaveLength(2);

    msg = handleTextDelta(msg, " Now checking file...");
    msg = finalizeLastTextPart(msg);
    expect(msg.parts).toHaveLength(3);

    let tool1 = createToolPart("tool_1", "view", "running");
    msg.parts = upsertPart(msg.parts!, tool1);
    expect(msg.parts).toHaveLength(4);

    const tool1Idx = msg.parts!.findIndex(
      (part) => part.type === "tool" && (part as ToolPart).toolCallId === "tool_1",
    );
    tool1 = addHitlQuestion(msg.parts![tool1Idx] as ToolPart, "req_1");
    tool1 = resolveHitlQuestion(tool1, "allow");
    tool1 = {
      ...tool1,
      state: { status: "completed", output: "file content", durationMs: 100 },
    };
    msg.parts = upsertPart(msg.parts!, tool1);

    const tool2 = createToolPart("tool_2", "edit", "completed");
    msg.parts = upsertPart(msg.parts!, tool2);
    expect(msg.parts).toHaveLength(5);

    const agentPart = createAgentPart(
      [createMockAgent("agent_1", "task", true)],
      tool2.id,
    );
    msg.parts = upsertPart(msg.parts!, agentPart);
    expect(msg.parts).toHaveLength(6);

    msg = handleTextDelta(msg, " Background task is running.");
    expect(msg.parts).toHaveLength(7);

    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("reasoning");
    expect(msg.parts![2]!.type).toBe("text");
    expect(msg.parts![3]!.type).toBe("tool");
    expect(msg.parts![4]!.type).toBe("tool");
    expect(msg.parts![5]!.type).toBe("agent");
    expect(msg.parts![6]!.type).toBe("text");

    const finalTool1 = msg.parts![3] as ToolPart;
    expect(finalTool1.hitlResponse?.answerText).toBe("allow");
    expect(finalTool1.state.status).toBe("completed");

    const finalAgent = msg.parts![5] as AgentPart;
    expect(finalAgent.agents[0]!.background).toBe(true);
    expect(finalAgent.parentToolPartId).toBe(tool2.id);

    verifyMonotonicIds(msg.parts!);
    expect(msg.parts![0]!.id < msg.parts![1]!.id).toBe(true);
    expect(msg.parts![1]!.id < msg.parts![2]!.id).toBe(true);
    expect(msg.parts![2]!.id < msg.parts![3]!.id).toBe(true);
    expect(msg.parts![3]!.id < msg.parts![4]!.id).toBe(true);
    expect(msg.parts![4]!.id < msg.parts![5]!.id).toBe(true);
    expect(msg.parts![5]!.id < msg.parts![6]!.id).toBe(true);
  });

  test("interleaved text and tool calls", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "First");
    msg = finalizeLastTextPart(msg);
    msg.parts = upsertPart(msg.parts!, createToolPart("tool_1", "bash"));
    msg = handleTextDelta(msg, "Second");
    msg = finalizeLastTextPart(msg);
    msg.parts = upsertPart(msg.parts!, createToolPart("tool_2", "view"));
    msg = handleTextDelta(msg, "Third");

    expect(msg.parts).toHaveLength(5);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");
    expect(msg.parts![3]!.type).toBe("tool");
    expect(msg.parts![4]!.type).toBe("text");
    verifyMonotonicIds(msg.parts!);
  });

  test("background agent does not break ordering", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "Starting task...");
    msg = finalizeLastTextPart(msg);

    const toolPart = createToolPart("tool_1", "task", "running");
    msg.parts = upsertPart(msg.parts!, toolPart);
    msg.parts = upsertPart(
      msg.parts!,
      createAgentPart([createMockAgent("agent_1", "task", true)], toolPart.id),
    );
    msg = handleTextDelta(msg, " Task is running in background.");

    expect(msg.parts).toHaveLength(4);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("agent");
    expect(msg.parts![3]!.type).toBe("text");
    expect((msg.parts![2] as AgentPart).agents[0]!.background).toBe(true);
    verifyMonotonicIds(msg.parts!);
  });
});
