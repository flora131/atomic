import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../events/event-bus.ts";
import { BatchDispatcher } from "../../events/batch-dispatcher.ts";
import { wireConsumers } from "../../events/consumers/wire-consumers.ts";
import type { BusEvent, BusEventDataMap, BusEventType } from "../../events/bus-events.ts";
import type { ChatMessage } from "../chat.tsx";
import { getAgentInlineDisplayParts, type ParallelAgent } from "../components/parallel-agents-tree.tsx";
import { _resetPartCounter } from "./id.ts";
import { applyStreamPartEvent, type StreamPartEvent } from "./stream-pipeline.ts";

const SESSION_ID = "concurrent-inline-session";
const RUN_ID = 1;

function createAssistantMessage(): ChatMessage {
  return {
    id: "msg-concurrent-inline",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    streaming: true,
    parts: [],
    toolCalls: [],
  };
}

function createAgent(id: string, taskToolCallId: string, task: string): ParallelAgent {
  return {
    id,
    taskToolCallId,
    name: "codebase-analyzer",
    task,
    status: "running",
    startedAt: new Date().toISOString(),
  };
}

function publishEvent<T extends BusEventType>(
  bus: EventBus,
  type: T,
  data: BusEventDataMap[T],
): void {
  const event: BusEvent<T> = {
    type,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    timestamp: Date.now(),
    data,
  };
  bus.publish(event);
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForBatchFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

beforeEach(() => {
  _resetPartCounter();
});

describe("concurrent agent inline part isolation (integration)", () => {
  test("keeps interleaved concurrent agent events isolated per inlineParts branch", async () => {
    const bus = new EventBus();
    const dispatcher = new BatchDispatcher(bus);
    const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
    const streamEvents: StreamPartEvent[] = [];
    pipeline.onStreamParts((events) => streamEvents.push(...events));

    try {
      correlation.startRun(RUN_ID, SESSION_ID);

      let msg = createAssistantMessage();
      msg = applyStreamPartEvent(msg, {
        type: "tool-start",
        toolId: "task_a",
        toolName: "Task",
        input: { description: "Analyze auth flow" },
      });
      msg = applyStreamPartEvent(msg, {
        type: "tool-start",
        toolId: "task_b",
        toolName: "Task",
        input: { description: "Analyze billing flow" },
      });
      msg = applyStreamPartEvent(msg, {
        type: "parallel-agents",
        agents: [
          createAgent("agent_a", "task_a", "Analyze auth flow"),
          createAgent("agent_b", "task_b", "Analyze billing flow"),
        ],
        isLastMessage: true,
      });

      publishEvent(bus, "stream.text.delta", {
        delta: "agent-b answer",
        messageId: "msg-concurrent-inline",
        agentId: "agent_b",
      });
      publishEvent(bus, "stream.tool.start", {
        toolId: "agent_a_tool_1",
        toolName: "rg",
        toolInput: { pattern: "auth" },
        parentAgentId: "agent_a",
      });
      publishEvent(bus, "stream.text.delta", {
        delta: "agent-a answer\n\n```ts\nconst authEnabled = true;\n```",
        messageId: "msg-concurrent-inline",
        agentId: "agent_a",
      });
      publishEvent(bus, "stream.tool.start", {
        toolId: "agent_b_tool_1",
        toolName: "glob",
        toolInput: { pattern: "src/**/*.ts" },
        parentAgentId: "agent_b",
      });
      publishEvent(bus, "stream.tool.complete", {
        toolId: "agent_a_tool_1",
        toolName: "rg",
        toolResult: "found auth files",
        success: true,
        parentAgentId: "agent_a",
      });
      publishEvent(bus, "stream.tool.complete", {
        toolId: "agent_b_tool_1",
        toolName: "glob",
        toolResult: ["a.ts", "b.ts"],
        success: true,
        parentAgentId: "agent_b",
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      for (const event of streamEvents) {
        msg = applyStreamPartEvent(msg, event);
      }
      msg = applyStreamPartEvent(msg, {
        type: "thinking-meta",
        thinkingSourceKey: "agent:a:thinking",
        targetMessageId: "msg-concurrent-inline",
        streamGeneration: 1,
        thinkingMs: 210,
        thinkingText: "agent-a reasoning",
        includeReasoningPart: true,
        agentId: "agent_a",
      });
      msg = applyStreamPartEvent(msg, {
        type: "thinking-meta",
        thinkingSourceKey: "agent:b:thinking",
        targetMessageId: "msg-concurrent-inline",
        streamGeneration: 1,
        thinkingMs: 320,
        thinkingText: "agent-b reasoning",
        includeReasoningPart: true,
        agentId: "agent_b",
      });

      expect(msg.content).toBe("");
      expect((msg.parts ?? []).some((part) => part.type === "reasoning")).toBe(false);

      const agentPart = (msg.parts ?? []).find((part) => part.type === "agent");
      expect(agentPart?.type).toBe("agent");
      if (agentPart?.type !== "agent") return;

      const agentA = agentPart.agents.find((agent) => agent.id === "agent_a");
      const agentB = agentPart.agents.find((agent) => agent.id === "agent_b");
      expect(agentA).toBeDefined();
      expect(agentB).toBeDefined();

      const agentAReasoning = agentA?.inlineParts?.find((part) => part.type === "reasoning");
      const agentAText = agentA?.inlineParts?.find((part) => part.type === "text");
      const agentATool = agentA?.inlineParts?.find((part) => part.type === "tool");
      expect(agentAReasoning?.type).toBe("reasoning");
      expect(agentAText?.type).toBe("text");
      expect(agentATool?.type).toBe("tool");
      if (agentAReasoning?.type === "reasoning") {
        expect(agentAReasoning.content).toBe("agent-a reasoning");
      }
      if (agentAText?.type === "text") {
        expect(agentAText.content).toBe("agent-a answer\n\n```ts\nconst authEnabled = true;\n```");
        expect(agentAText.content.includes("agent-b")).toBe(false);
      }
      if (agentATool?.type === "tool") {
        expect(agentATool.toolCallId).toBe("agent_a_tool_1");
        expect(agentATool.state.status).toBe("completed");
      }

      const agentBReasoning = agentB?.inlineParts?.find((part) => part.type === "reasoning");
      const agentBText = agentB?.inlineParts?.find((part) => part.type === "text");
      const agentBTool = agentB?.inlineParts?.find((part) => part.type === "tool");
      expect(agentBReasoning?.type).toBe("reasoning");
      expect(agentBText?.type).toBe("text");
      expect(agentBTool?.type).toBe("tool");
      if (agentBReasoning?.type === "reasoning") {
        expect(agentBReasoning.content).toBe("agent-b reasoning");
      }
      if (agentBText?.type === "text") {
        expect(agentBText.content).toBe("agent-b answer");
        expect(agentBText.content.includes("agent-a")).toBe(false);
      }
      if (agentBTool?.type === "tool") {
        expect(agentBTool.toolCallId).toBe("agent_b_tool_1");
        expect(agentBTool.state.status).toBe("completed");
      }

      const agentAVerboseInline = getAgentInlineDisplayParts(agentA?.inlineParts ?? []);
      expect(agentAVerboseInline.some((part) => part.type === "reasoning")).toBe(true);
      expect(agentAVerboseInline.some(
        (part) => part.type === "text" && part.content.includes("```ts"),
      )).toBe(true);
      expect(agentAVerboseInline.some((part) => part.type === "tool")).toBe(true);

      const agentACompactInline = getAgentInlineDisplayParts(agentA?.inlineParts ?? []);
      expect(agentACompactInline.map((part) => part.id)).toEqual(
        agentAVerboseInline.map((part) => part.id),
      );

      const agentBVerboseInline = getAgentInlineDisplayParts(agentB?.inlineParts ?? []);
      expect(agentBVerboseInline.some((part) => part.type === "reasoning")).toBe(true);
      expect(agentBVerboseInline.some((part) => part.type === "text")).toBe(true);
      expect(agentBVerboseInline.some((part) => part.type === "tool")).toBe(true);

      const agentBCompactInline = getAgentInlineDisplayParts(agentB?.inlineParts ?? []);
      expect(agentBCompactInline.map((part) => part.id)).toEqual(
        agentBVerboseInline.map((part) => part.id),
      );
    } finally {
      dispose();
    }
  });

  test("replays buffered agent events into the correct concurrent inline branches when agents appear", async () => {
    const bus = new EventBus();
    const dispatcher = new BatchDispatcher(bus);
    const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
    const streamEvents: StreamPartEvent[] = [];
    pipeline.onStreamParts((events) => streamEvents.push(...events));

    try {
      correlation.startRun(RUN_ID, SESSION_ID);

      let msg = createAssistantMessage();
      msg = applyStreamPartEvent(msg, {
        type: "tool-start",
        toolId: "task_a",
        toolName: "Task",
        input: { description: "Buffer branch A" },
      });
      msg = applyStreamPartEvent(msg, {
        type: "tool-start",
        toolId: "task_b",
        toolName: "Task",
        input: { description: "Buffer branch B" },
      });

      publishEvent(bus, "stream.text.delta", {
        delta: "buffered agent-a text",
        messageId: "msg-concurrent-inline",
        agentId: "agent_a",
      });
      publishEvent(bus, "stream.tool.start", {
        toolId: "agent_a_tool_buffered",
        toolName: "bash",
        toolInput: { command: "echo buffered" },
        parentAgentId: "agent_a",
      });
      publishEvent(bus, "stream.tool.complete", {
        toolId: "agent_a_tool_buffered",
        toolName: "bash",
        toolResult: "buffered output",
        success: true,
        parentAgentId: "agent_a",
      });
      publishEvent(bus, "stream.text.delta", {
        delta: "buffered agent-b text",
        messageId: "msg-concurrent-inline",
        agentId: "agent_b",
      });
      msg = applyStreamPartEvent(msg, {
        type: "thinking-meta",
        thinkingSourceKey: "agent:b:buffered",
        targetMessageId: "msg-concurrent-inline",
        streamGeneration: 1,
        thinkingMs: 640,
        thinkingText: "buffered agent-b reasoning",
        includeReasoningPart: true,
        agentId: "agent_b",
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      for (const event of streamEvents) {
        msg = applyStreamPartEvent(msg, event);
      }

      expect((msg.parts ?? []).some((part) => part.type === "agent")).toBe(false);
      expect(msg.content).toBe("");

      msg = applyStreamPartEvent(msg, {
        type: "parallel-agents",
        agents: [
          createAgent("agent_a", "task_a", "Buffer branch A"),
          createAgent("agent_b", "task_b", "Buffer branch B"),
        ],
        isLastMessage: true,
      });

      const agentPart = (msg.parts ?? []).find((part) => part.type === "agent");
      expect(agentPart?.type).toBe("agent");
      if (agentPart?.type !== "agent") return;

      const agentA = agentPart.agents.find((agent) => agent.id === "agent_a");
      const agentB = agentPart.agents.find((agent) => agent.id === "agent_b");

      const agentAText = agentA?.inlineParts?.find((part) => part.type === "text");
      const agentATool = agentA?.inlineParts?.find((part) => part.type === "tool");
      expect(agentAText?.type).toBe("text");
      expect(agentATool?.type).toBe("tool");
      if (agentAText?.type === "text") {
        expect(agentAText.content).toBe("buffered agent-a text");
      }
      if (agentATool?.type === "tool") {
        expect(agentATool.toolCallId).toBe("agent_a_tool_buffered");
        expect(agentATool.state.status).toBe("completed");
      }

      const agentBReasoning = agentB?.inlineParts?.find((part) => part.type === "reasoning");
      const agentBText = agentB?.inlineParts?.find((part) => part.type === "text");
      expect(agentBReasoning?.type).toBe("reasoning");
      expect(agentBText?.type).toBe("text");
      if (agentBReasoning?.type === "reasoning") {
        expect(agentBReasoning.content).toBe("buffered agent-b reasoning");
      }
      if (agentBText?.type === "text") {
        expect(agentBText.content).toBe("buffered agent-b text");
      }

      expect(agentA?.inlineParts?.some(
        (part) => part.type === "reasoning" && part.content.includes("agent-b"),
      )).toBe(false);
      expect(agentB?.inlineParts?.some(
        (part) => part.type === "text" && part.content.includes("agent-a"),
      )).toBe(false);
    } finally {
      dispose();
    }
  });
});
