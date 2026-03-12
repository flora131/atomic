import { describe, expect, test } from "bun:test";
import { applyStreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import { createAssistantMessage, registerStreamPipelineHooks } from "./stream-pipeline.fixtures.ts";

registerStreamPipelineHooks();

describe("applyStreamPartEvent - agent buffering and hydration", () => {
  test("keeps agent-scoped TaskOutput buffered until agent part exists", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Waiting for agents..." });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_output_agent_1",
      toolName: "TaskOutput",
      input: { task_id: "agent_1", block: true },
      agentId: "agent_1",
    });
    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "task_output_agent_1",
      toolName: "TaskOutput",
      output: { retrieval_status: "timeout", task: null },
      success: true,
      agentId: "agent_1",
    });

    expect(msg.toolCalls).toEqual([]);
    expect(msg.parts?.map((part) => part.type)).toEqual(["text"]);

    const textPart = msg.parts?.[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Waiting for agents...");
      expect(textPart.isStreaming).toBe(true);
    }
  });

  test("continues streaming text when agent-scoped TaskOutput is buffered", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "Waiting for all agents to complete before synthesizing the findings into a comprehensive research document...",
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_output_agent_2",
      toolName: "TaskOutput",
      input: { task_id: "agent_2", block: true },
      agentId: "agent_2",
    });

    const next = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "First agent completed. Waiting for the remaining three...",
    });

    expect(next.parts?.map((part) => part.type)).toEqual(["text"]);
    const preToolText = next.parts?.[0];
    expect(preToolText?.type).toBe("text");
    if (preToolText?.type === "text") {
      expect(preToolText.content).toBe(
        "Waiting for all agents to complete before synthesizing the findings into a comprehensive research document...First agent completed. Waiting for the remaining three...",
      );
      expect(preToolText.isStreaming).toBe(true);
    }
  });

  test("replays buffered agent thinking-meta into inlineParts when agent appears", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "agent:source",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 510,
      thinkingText: "buffered agent reasoning",
      includeReasoningPart: true,
      agentId: "agent_1",
    });

    expect((msg.parts ?? []).some((part) => part.type === "reasoning")).toBe(false);

    const next = applyStreamPartEvent(msg, {
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

    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      const inlineReasoning = agentPart.agents[0]?.inlineParts?.find((part) => part.type === "reasoning");
      expect(inlineReasoning?.type).toBe("reasoning");
      if (inlineReasoning?.type === "reasoning") {
        expect(inlineReasoning.content).toBe("buffered agent reasoning");
        expect(inlineReasoning.thinkingSourceKey).toBe("agent:source");
        expect(inlineReasoning.durationMs).toBe(510);
      }
    }
  });

  test("preserves inline tool parts when a task-correlated row is hydrated", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "task_1",
          taskToolCallId: "task_1",
          name: "task",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "child-tool-1",
      toolName: "Read",
      input: { filePath: "src/app.ts" },
      agentId: "task_1",
    });

    const promoted = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_real_1",
          taskToolCallId: "task_1",
          name: "debugger",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    const agentPart = promoted.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.id).toBe("agent_real_1");
      const inlineTool = agentPart.agents[0]?.inlineParts?.find(
        (part) => part.type === "tool" && part.toolCallId === "child-tool-1",
      );
      expect(inlineTool?.type).toBe("tool");
      if (inlineTool?.type === "tool") {
        expect(inlineTool.toolName).toBe("Read");
        expect(inlineTool.state.status).toBe("running");
      }
    }
  });

  test("keeps a single subagent tree attached to its task tool instead of grouping it into a shared tree", () => {
    let msg = createAssistantMessage();

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_single_1",
      toolName: "Task",
      input: { description: "Inspect auth flow" },
    });

    const taskToolPart = msg.parts?.find(
      (part) => part.type === "tool" && part.toolCallId === "task_single_1",
    );
    expect(taskToolPart?.type).toBe("tool");

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_single_1",
          taskToolCallId: "task_single_1",
          name: "codebase-analyzer",
          task: "Inspect auth flow",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    const agentParts = (msg.parts ?? []).filter((part) => part.type === "agent");
    expect(agentParts).toHaveLength(1);
    expect(agentParts[0]?.type).toBe("agent");
    if (agentParts[0]?.type === "agent" && taskToolPart?.type === "tool") {
      expect(agentParts[0].parentToolPartId).toBe(taskToolPart.id);
      expect(agentParts[0].agents[0]?.id).toBe("agent_single_1");
    }
  });

  test("replays buffered task-correlated tool events when the agent row arrives", () => {
    let msg = createAssistantMessage();

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "child-tool-buffered",
      toolName: "Read",
      input: { filePath: "src/main.ts" },
      agentId: "task_2",
    });

    const promoted = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_real_2",
          taskToolCallId: "task_2",
          name: "debugger",
          task: "Investigate",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    const agentPart = promoted.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.id).toBe("agent_real_2");
      const inlineTool = agentPart.agents[0]?.inlineParts?.find(
        (part) => part.type === "tool" && part.toolCallId === "child-tool-buffered",
      );
      expect(inlineTool?.type).toBe("tool");
      if (inlineTool?.type === "tool") {
        expect(inlineTool.toolName).toBe("Read");
        expect(inlineTool.state.status).toBe("running");
      }
    }
  });

  test("replays buffered OpenCode child-session tools from the real task correlation when the subagent row is promoted", () => {
    let msg = createAssistantMessage();

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_open_1",
      toolName: "Task",
      input: { description: "Inspect OpenCode child session" },
    });

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "task_open_1",
          taskToolCallId: "task_open_1",
          name: "codebase-online-researcher",
          task: "Inspect OpenCode child session",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ],
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "child-open-tool-1",
      toolName: "Read",
      input: { filePath: "src/services/agents/clients/opencode.ts" },
      agentId: "task_open_1",
    });
    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "child-open-tool-1",
      toolName: "Read",
      output: "ok",
      success: true,
      agentId: "task_open_1",
    });

    const promoted = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_open_1",
          taskToolCallId: "task_open_1",
          name: "codebase-online-researcher",
          task: "Inspect OpenCode child session",
          status: "completed",
          startedAt: new Date().toISOString(),
          result: "done",
        },
      ],
      isLastMessage: true,
    });

    const agentPart = promoted.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.id).toBe("agent_open_1");
      const inlineTool = agentPart.agents[0]?.inlineParts?.find(
        (part) => part.type === "tool" && part.toolCallId === "child-open-tool-1",
      );
      expect(inlineTool?.type).toBe("tool");
      if (inlineTool?.type === "tool") {
        expect(inlineTool.state.status).toBe("completed");
      }
      expect(agentPart.agents[0]?.inlineParts?.some((part) => part.type === "text")).toBe(false);
    }
  });
});
