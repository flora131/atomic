import { beforeEach, describe, expect, test } from "bun:test";
import type { BusEvent, BusEventDataMap, BusEventType } from "../events/bus-events.ts";
import { BatchDispatcher } from "../events/batch-dispatcher.ts";
import { EventBus } from "../events/event-bus.ts";
import { wireConsumers } from "../events/consumers/wire-consumers.ts";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import type { ChatMessage } from "./chat.tsx";
import { shouldDeferPostCompleteDeltaUntilDoneProjection } from "./chat.tsx";
import { _resetPartCounter } from "./parts/id.ts";
import { applyStreamPartEvent, type StreamPartEvent } from "./parts/stream-pipeline.ts";
import type { Part, ToolPart, TextPart } from "./parts/types.ts";
import {
  createAgentOrderingState,
  hasDoneStateProjection,
  registerAgentCompletionSequence,
  registerDoneStateProjection,
} from "./utils/agent-ordering-contract.ts";

const SESSION_ID = "mention-ordering-e2e";
const RUN_ID = 1;

function createAssistantMessage(): ChatMessage {
  return {
    id: "msg-mention-ordering-e2e",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    streaming: true,
    parts: [],
    toolCalls: [],
  };
}

function createRunningAgent(id: string, taskToolCallId: string): ParallelAgent {
  return {
    id,
    taskToolCallId,
    name: "codebase-analyzer",
    task: "Investigate timing windows",
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

function getInlineParts(message: ChatMessage, agentId: string): Part[] {
  const agentPart = (message.parts ?? []).find((part) => part.type === "agent");
  if (agentPart?.type !== "agent") return [];
  return agentPart.agents.find((agent) => agent.id === agentId)?.inlineParts ?? [];
}

function waitForBatchFlush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

interface DeferredDelta {
  delta: string;
  runId?: number;
}

beforeEach(() => {
  _resetPartCounter();
});

describe("@ mention mixed output timing windows e2e regression", () => {
  test("preserves done-before-post-complete text ordering across direct-vs-batched mixed output windows", async () => {
    const bus = new EventBus();
    const dispatcher = new BatchDispatcher(bus);
    const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
    const orderingState = createAgentOrderingState();
    const deferredByAgent = new Map<string, DeferredDelta[]>();
    const streamEvents: StreamPartEvent[] = [];
    const timeline: string[] = [];
    pipeline.onStreamParts((events) => streamEvents.push(...events));

    try {
      correlation.startRun(RUN_ID, SESSION_ID);

      let message = createAssistantMessage();
      message = applyStreamPartEvent(message, {
        type: "parallel-agents",
        agents: [createRunningAgent("agent_1", "task_1")],
        isLastMessage: true,
      });
      message = applyStreamPartEvent(message, {
        type: "tool-start",
        toolId: "agent_tool_1",
        toolName: "bash",
        input: { command: "sleep 1 && echo done" },
        agentId: "agent_1",
      });

      // Direct lifecycle lane observes completion before wildcard-batch text/tool output flushes.
      registerAgentCompletionSequence(orderingState, "agent_1", 7);

      publishEvent(bus, "stream.text.delta", {
        delta: "late-before-done ",
        messageId: message.id,
        agentId: "agent_1",
      });
      publishEvent(bus, "stream.tool.partial_result", {
        toolCallId: "agent_tool_1",
        partialOutput: "chunk-1\n",
        parentAgentId: "agent_1",
      });

      await waitForBatchFlush();
      const firstBatch = [...streamEvents];
      streamEvents.length = 0;

      for (const event of firstBatch) {
        if (event.type === "text-delta" && event.agentId) {
          const completionSequence = orderingState.lastCompletionSequenceByAgent.get(event.agentId);
          const doneProjected = hasDoneStateProjection(orderingState, event.agentId);
          if (shouldDeferPostCompleteDeltaUntilDoneProjection({ completionSequence, doneProjected })) {
            const deferred = deferredByAgent.get(event.agentId) ?? [];
            deferred.push({ delta: event.delta, runId: event.runId });
            deferredByAgent.set(event.agentId, deferred);
            continue;
          }
          timeline.push(`text:${event.agentId}:${event.delta}`);
        }
        message = applyStreamPartEvent(message, event);
      }

      const preProjectionInline = getInlineParts(message, "agent_1");
      const preProjectionText = preProjectionInline.find((part): part is TextPart => part.type === "text");
      const preProjectionTool = preProjectionInline.find((part): part is ToolPart => part.type === "tool");
      expect(preProjectionText).toBeUndefined();
      expect(preProjectionTool?.partialOutput).toBe("chunk-1\n");
      expect(deferredByAgent.get("agent_1")?.length).toBe(1);

      publishEvent(bus, "stream.agent.complete", {
        agentId: "agent_1",
        success: true,
        result: "agent completed",
      });
      publishEvent(bus, "stream.text.delta", {
        delta: "late-after-done",
        messageId: message.id,
        agentId: "agent_1",
      });
      publishEvent(bus, "stream.tool.complete", {
        toolId: "agent_tool_1",
        toolName: "bash",
        toolResult: "final output",
        success: true,
        parentAgentId: "agent_1",
      });

      await waitForBatchFlush();
      const secondBatch = [...streamEvents];

      for (const event of secondBatch) {
        if (event.type === "agent-terminal" && event.status === "completed") {
          const sequence = orderingState.lastCompletionSequenceByAgent.get(event.agentId) ?? 0;
          registerDoneStateProjection(orderingState, {
            agentId: event.agentId,
            sequence,
            projectionMode: "sync-bridge",
          });
          timeline.push(`done:${event.agentId}`);
          message = applyStreamPartEvent(message, event);

          const deferred = deferredByAgent.get(event.agentId) ?? [];
          deferredByAgent.delete(event.agentId);
          for (const pending of deferred) {
            timeline.push(`text:${event.agentId}:${pending.delta}`);
            message = applyStreamPartEvent(message, {
              type: "text-delta",
              runId: pending.runId,
              delta: pending.delta,
              agentId: event.agentId,
            });
          }
          continue;
        }

        if (event.type === "text-delta" && event.agentId) {
          const completionSequence = orderingState.lastCompletionSequenceByAgent.get(event.agentId);
          const doneProjected = hasDoneStateProjection(orderingState, event.agentId);
          if (shouldDeferPostCompleteDeltaUntilDoneProjection({ completionSequence, doneProjected })) {
            const deferred = deferredByAgent.get(event.agentId) ?? [];
            deferred.push({ delta: event.delta, runId: event.runId });
            deferredByAgent.set(event.agentId, deferred);
            continue;
          }
          timeline.push(`text:${event.agentId}:${event.delta}`);
        }

        message = applyStreamPartEvent(message, event);
      }

      const finalInline = getInlineParts(message, "agent_1");
      const finalText = finalInline.find((part): part is TextPart => part.type === "text");
      const finalTool = finalInline.find((part): part is ToolPart => part.type === "tool");
      const agentPart = (message.parts ?? []).find((part) => part.type === "agent");

      expect(hasDoneStateProjection(orderingState, "agent_1")).toBe(true);
      expect(deferredByAgent.get("agent_1")).toBeUndefined();
      expect(timeline).toEqual([
        "done:agent_1",
        "text:agent_1:late-before-done ",
        "text:agent_1:late-after-done",
      ]);
      expect(finalText?.content).toBe("late-before-done late-after-done");
      expect(finalTool?.partialOutput).toBe("chunk-1\n");
      expect(finalTool?.state.status).toBe("completed");
      expect(agentPart?.type).toBe("agent");
      if (agentPart?.type === "agent") {
        expect(agentPart.agents[0]?.status).toBe("completed");
      }
    } finally {
      dispose();
    }
  });
});
