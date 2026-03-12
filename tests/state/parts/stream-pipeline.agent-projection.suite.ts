import { describe, expect, test } from "bun:test";
import { applyStreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import {
  type ParallelAgent,
  createAssistantMessage,
  registerStreamPipelineHooks,
} from "./stream-pipeline.fixtures.ts";

registerStreamPipelineHooks();

describe("applyStreamPartEvent - agent projection", () => {
  test("merges parallel agents into agent part for subagent/background updates", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });

    const agents: ParallelAgent[] = [
      {
        id: "agent_1",
        taskToolCallId: "task_1",
        name: "researcher",
        task: "Investigate",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
      },
    ];

    const next = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents,
      isLastMessage: true,
    });

    expect(next.parallelAgents).toHaveLength(1);
    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.background).toBe(true);
      expect(agentPart.agents[0]?.status).toBe("background");
    }
  });

  test("applies agent-terminal updates into reducer lane", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });
    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    const next = applyStreamPartEvent(msg, {
      type: "agent-terminal",
      agentId: "agent_1",
      status: "completed",
      result: "sub-agent finished",
    });

    expect(next.parallelAgents?.[0]?.status).toBe("completed");
    expect(next.parallelAgents?.[0]?.result).toBe("sub-agent finished");
    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.status).toBe("completed");
      expect(agentPart.agents[0]?.result).toBe("sub-agent finished");
    }
  });

  test("keeps completed agent-terminal projection idempotent", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });
    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    const projected = applyStreamPartEvent(msg, {
      type: "agent-terminal",
      agentId: "agent_1",
      status: "completed",
      result: "sub-agent finished",
    });
    const repeated = applyStreamPartEvent(projected, {
      type: "agent-terminal",
      agentId: "agent_1",
      status: "completed",
      result: "should be ignored",
    });

    expect(repeated).toBe(projected);
    expect(repeated.parallelAgents?.[0]?.result).toBe("sub-agent finished");
  });

  test("keeps error agent-terminal projection idempotent", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });
    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    const projected = applyStreamPartEvent(msg, {
      type: "agent-terminal",
      agentId: "agent_1",
      status: "error",
      error: "initial failure",
    });
    const repeated = applyStreamPartEvent(projected, {
      type: "agent-terminal",
      agentId: "agent_1",
      status: "error",
      error: "should be ignored",
    });

    expect(repeated).toBe(projected);
    expect(repeated.parallelAgents?.[0]?.error).toBe("initial failure");
  });

  test("routes agent thinking-meta into inlineParts", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });
    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    const next = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "agent:source",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 350,
      thinkingText: "agent reasoning",
      includeReasoningPart: true,
      agentId: "agent_1",
    });

    expect((next.parts ?? []).some((part) => part.type === "reasoning")).toBe(false);
    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      const inlineReasoning = agentPart.agents[0]?.inlineParts?.find((part) => part.type === "reasoning");
      expect(inlineReasoning?.type).toBe("reasoning");
      if (inlineReasoning?.type === "reasoning") {
        expect(inlineReasoning.content).toBe("agent reasoning");
        expect(inlineReasoning.thinkingSourceKey).toBe("agent:source");
        expect(inlineReasoning.durationMs).toBe(350);
      }
    }
  });

  test("keeps agent-scoped tool events out of top-level toolCalls", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });
    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "agent_tool_1",
      toolName: "Read",
      input: { filePath: "src/screens/chat-screen.tsx" },
      agentId: "agent_1",
    });
    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "agent_tool_1",
      toolName: "Read",
      output: "ok",
      success: true,
      agentId: "agent_1",
    });

    expect(msg.toolCalls?.map((toolCall) => toolCall.id)).toEqual(["task_1"]);
    const topLevelToolIds = (msg.parts ?? [])
      .filter((part) => part.type === "tool")
      .map((part) => part.toolCallId);
    expect(topLevelToolIds).toEqual(["task_1"]);

    const agentPart = msg.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      const inlineTool = agentPart.agents[0]?.inlineParts?.find(
        (part) => part.type === "tool" && part.toolCallId === "agent_tool_1",
      );
      expect(inlineTool?.type).toBe("tool");
      if (inlineTool?.type === "tool") {
        expect(inlineTool.state.status).toBe("completed");
      }
    }
  });
});
