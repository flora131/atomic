import { describe, expect, test } from "bun:test";
import { applyStreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import {
  type ParallelAgent,
  createAssistantMessage,
  registerStreamPipelineHooks,
} from "./stream-pipeline.fixtures.ts";

registerStreamPipelineHooks();

describe("applyStreamPartEvent - agent continuation", () => {
  test("returns to main text stream after subagent completion", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });

    const runningAgents: ParallelAgent[] = [
      {
        id: "agent_1",
        taskToolCallId: "task_1",
        name: "researcher",
        task: "Investigate",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ];

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: runningAgents,
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "task_1",
      output: "subagent output",
      success: true,
    });

    const completedAgents: ParallelAgent[] = [
      {
        ...runningAgents[0]!,
        status: "completed",
        result: "subagent output",
        durationMs: 1200,
      },
    ];

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: completedAgents,
      isLastMessage: true,
    });

    const next = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "Main assistant continues.",
    });

    expect(next.content).toBe("Main assistant continues.");
    expect(next.parts?.map((part) => part.type)).toEqual(["tool", "agent", "text"]);

    const trailingText = next.parts?.[2];
    expect(trailingText?.type).toBe("text");
    if (trailingText?.type === "text") {
      expect(trailingText.content).toBe("Main assistant continues.");
      expect(trailingText.isStreaming).toBe(true);
    }
  });

  test("keeps main continuation text separate from completed subagent result", () => {
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
          status: "completed",
          result: "subagent output",
          startedAt: new Date().toISOString(),
          durationMs: 900,
        },
      ],
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "Main ",
    });
    const next = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "assistant reply",
    });

    const textParts = next.parts?.filter((part) => part.type === "text") ?? [];
    expect(textParts).toHaveLength(1);
    const textPart = textParts[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Main assistant reply");
    }

    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.result).toBe("subagent output");
      expect(agentPart.agents[0]?.status).toBe("completed");
    }
  });

  test("keeps control on main stream after subagent completion updates", () => {
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
          status: "completed",
          result: "subagent output",
          startedAt: new Date().toISOString(),
          durationMs: 900,
        },
      ],
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Main starts" });

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "completed",
          result: "subagent output\n\nwith details",
          startedAt: new Date().toISOString(),
          durationMs: 920,
        },
      ],
      isLastMessage: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: " and continues" });

    expect(next.parts?.map((part) => part.type)).toEqual(["tool", "agent", "text"]);
    expect(next.content).toBe("Main starts and continues");

    const textPart = next.parts?.[2];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Main starts and continues");
      expect(textPart.isStreaming).toBe(true);
    }

    const agentPart = next.parts?.[1];
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.result).toBe("subagent output\n\nwith details");
      expect(agentPart.agents[0]?.status).toBe("completed");
    }
  });

  test("normalizes subagent result formatting during streaming agent updates", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Review implementation" },
    });

    const next = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "reviewer",
          task: "Review implementation",
          status: "completed",
          result: "\r\n\r\n```json\r\n{\"ok\": true}\r\n```\r\n",
          startedAt: new Date().toISOString(),
          durationMs: 900,
        },
      ],
      isLastMessage: true,
    });

    expect(next.parallelAgents?.[0]?.result).toBe("```json\n{\"ok\": true}\n```");

    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.result).toBe("```json\n{\"ok\": true}\n```");
    }
  });
});
