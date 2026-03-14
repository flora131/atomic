#!/usr/bin/env bun

import type { BusEvent, BusEventDataMap, BusEventType } from "@/services/events/bus-events/index.ts";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { wireConsumers } from "@/services/events/consumers/wire-consumers.ts";
import { collectDoneRenderMarkers } from "@/components/parallel-agents-tree.tsx";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import { applyStreamPartEvent, type StreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import {
  createAgentOrderingState,
  emitAgentDoneProjectionObservability,
  emitAgentDoneRenderedObservability,
  emitPostCompleteDeltaOrderingObservability,
  hasDoneStateProjection,
  registerAgentCompletionSequence,
  registerDoneStateProjection,
  shouldDeferPostCompleteDeltaUntilDoneProjection,
  type AgentOrderingEvent,
} from "@/state/chat/exports.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";
import type { ChatMessage } from "@/types/chat.ts";

const MAX_VISIBLE_AGENTS = 5;

function createAssistantMessage(sessionId: string): ChatMessage {
  return {
    id: `${sessionId}-msg`,
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
    task: "Ordering contract canary",
    status: "running",
    startedAt: new Date().toISOString(),
  };
}

function getMessageAgents(message: ChatMessage): ParallelAgent[] {
  const part = (message.parts ?? []).find((item) => item.type === "agent");
  if (part?.type !== "agent") return [];
  return part.agents;
}

function publishEvent<T extends BusEventType>(
  bus: EventBus,
  sessionId: string,
  runId: number,
  type: T,
  data: BusEventDataMap[T],
): void {
  const event: BusEvent<T> = {
    type,
    sessionId,
    runId,
    timestamp: Date.now(),
    data,
  };
  bus.publish(event);
}

function createOrderingEvent(args: {
  sessionId: string;
  agentId: string;
  messageId: string;
  type: AgentOrderingEvent["type"],
  source: AgentOrderingEvent["source"];
  sequence: number;
  timestampMs: number;
}): AgentOrderingEvent {
  return {
    sessionId: args.sessionId,
    agentId: args.agentId,
    messageId: args.messageId,
    type: args.type,
    sequence: args.sequence,
    timestampMs: args.timestampMs,
    source: args.source,
  };
}

function assertMetric(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function waitForBatchFlush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

async function replayScenario(runId: number, sessionId: string, agentIds: string[]): Promise<void> {
  const scenario = agentIds.length > 1 ? "multi" : "single";
  const bus = new EventBus();
  const dispatcher = new BatchDispatcher(bus);
  const { pipeline, dispose } = wireConsumers(bus, dispatcher);
  const streamEvents: StreamPartEvent[] = [];
  const orderingState = createAgentOrderingState();
  const deferredByAgent = new Map<string, Array<{ delta: string; runId?: number }>>();
  const completionTimestampByAgent = new Map<string, number>();
  const doneRenderedAgentIds = new Set<string>();
  let message = createAssistantMessage(sessionId);
  let sequence = runId * 100;

  const emitDoneRenderedMarkers = (): void => {
    const visibleAgents = getMessageAgents(message).slice(0, MAX_VISIBLE_AGENTS);
    const markers = collectDoneRenderMarkers(
      visibleAgents.map((agent) => ({ id: agent.id, status: agent.status })),
      doneRenderedAgentIds,
    );
    if (markers.length === 0) return;

    for (const agentId of markers) {
      const event = createOrderingEvent({
        sessionId,
        agentId,
        messageId: message.id,
        type: "agent_done_rendered",
        source: "ui-effect",
        sequence: ++sequence,
        timestampMs: Date.now(),
      });
      emitAgentDoneRenderedObservability({
        provider: "claude",
        runId,
        completionTimestampMs: completionTimestampByAgent.get(agentId),
        projectionMode: "sync-bridge",
        event,
      });
    }
  };

  const emitPostCompleteOrderingSample = (agentId: string, doneProjected: boolean): void => {
    const event = createOrderingEvent({
      sessionId,
      agentId,
      messageId: message.id,
      type: "post_complete_delta_rendered",
      source: "wildcard-batch",
      sequence: ++sequence,
      timestampMs: Date.now(),
    });
    emitPostCompleteDeltaOrderingObservability({
      provider: "claude",
      runId,
      doneProjected,
      scenario,
      projectionMode: "sync-bridge",
      event,
    });
  };

  pipeline.onStreamParts((events) => streamEvents.push(...events));

  const flushEvents = (): void => {
    const batch = [...streamEvents];
    streamEvents.length = 0;

    for (const event of batch) {
      if (event.type === "agent-terminal" && event.status === "completed") {
        const completionSequence = orderingState.lastCompletionSequenceByAgent.get(event.agentId) ?? ++sequence;
        registerDoneStateProjection(orderingState, {
          agentId: event.agentId,
          sequence: completionSequence,
          projectionMode: "sync-bridge",
        });
        emitAgentDoneProjectionObservability({
          provider: "claude",
          runId,
          projectionMode: "sync-bridge",
          completionTimestampMs: completionTimestampByAgent.get(event.agentId),
          event: createOrderingEvent({
            sessionId,
            agentId: event.agentId,
            messageId: message.id,
            type: "agent_done_projected",
            source: "sync-bridge",
            sequence: ++sequence,
            timestampMs: Date.now(),
          }),
        });

        message = applyStreamPartEvent(message, event);
        emitDoneRenderedMarkers();

        const deferred = deferredByAgent.get(event.agentId) ?? [];
        deferredByAgent.delete(event.agentId);
        for (const pending of deferred) {
          emitPostCompleteOrderingSample(event.agentId, true);
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
        if (typeof completionSequence === "number") {
          const doneProjected = hasDoneStateProjection(orderingState, event.agentId);
          if (shouldDeferPostCompleteDeltaUntilDoneProjection({ completionSequence, doneProjected })) {
            const deferred = deferredByAgent.get(event.agentId) ?? [];
            deferred.push({ delta: event.delta, runId: event.runId });
            deferredByAgent.set(event.agentId, deferred);
            continue;
          }
          emitPostCompleteOrderingSample(event.agentId, doneProjected);
        }
      }

      message = applyStreamPartEvent(message, event);
      emitDoneRenderedMarkers();
    }
  };

  try {
    publishEvent(bus, sessionId, runId, "stream.session.start", {});
    message = applyStreamPartEvent(message, {
      type: "parallel-agents",
      runId,
      agents: agentIds.map((agentId, index) => createRunningAgent(agentId, `task-${runId}-${index + 1}`)),
      isLastMessage: true,
    });

    // Direct lifecycle lane receives completion sequence before wildcard-batch text flushes.
    for (const agentId of agentIds) {
      registerAgentCompletionSequence(orderingState, agentId, ++sequence);
      completionTimestampByAgent.set(agentId, Date.now());
      publishEvent(bus, sessionId, runId, "stream.text.delta", {
        delta: `${agentId}-before-done `,
        messageId: message.id,
        agentId,
      });
    }

    await waitForBatchFlush();
    flushEvents();

    for (const agentId of agentIds) {
      publishEvent(bus, sessionId, runId, "stream.agent.complete", {
        agentId,
        success: true,
        result: "agent completed",
      });
      publishEvent(bus, sessionId, runId, "stream.text.delta", {
        delta: `${agentId}-after-done`,
        messageId: message.id,
        agentId,
      });
    }

    await waitForBatchFlush();
    flushEvents();

    assertMetric(
      agentIds.every((agentId) => hasDoneStateProjection(orderingState, agentId)),
      `Expected done projection for all ${scenario} scenario agents`,
    );
  } finally {
    dispose();
  }
}

resetRuntimeParityMetrics();
await replayScenario(1, "ordering-canary-single", ["ordering-agent-1"]);
await replayScenario(2, "ordering-canary-multi", ["ordering-agent-2", "ordering-agent-3"]);

const snapshot = getRuntimeParityMetricsSnapshot();

const doneProjectionKey = "workflow.runtime.parity.agent_done_projection_total{mode=sync-bridge,provider=claude}";
const doneProjectionLatencyKey = "workflow.runtime.parity.agent_done_projection_latency_ms{mode=sync-bridge,provider=claude}";
const doneRenderedKey = "workflow.runtime.parity.agent_done_rendered_total{provider=claude}";
const doneRenderedLatencyKey = "workflow.runtime.parity.agent_done_rendered_latency_ms{provider=claude}";

const doneProjectionTotal = snapshot.counters[doneProjectionKey] ?? 0;
const doneRenderedTotal = snapshot.counters[doneRenderedKey] ?? 0;
const doneProjectionLatency = snapshot.histograms[doneProjectionLatencyKey] ?? [];
const doneRenderedLatency = snapshot.histograms[doneRenderedLatencyKey] ?? [];

assertMetric(doneProjectionTotal === 3, "Expected one done projection metric sample per completed canary agent");
assertMetric(doneRenderedTotal === 3, "Expected one done-rendered metric sample per visible completed canary agent");
assertMetric(doneProjectionLatency.length === 3, "Expected one done projection latency sample per completed canary agent");
assertMetric(doneRenderedLatency.length === 3, "Expected one done-rendered latency sample per visible completed canary agent");
assertMetric(doneProjectionLatency.every((sample) => sample >= 0), "Done projection latency samples must be non-negative");
assertMetric(doneRenderedLatency.every((sample) => sample >= 0), "Done-rendered latency samples must be non-negative");

const report = {
  mode: process.env.ATOMIC_ORDERING_CONTRACT_CANARY === "1" ? "canary" : "ci",
  generatedAt: new Date().toISOString(),
  counters: {
    doneProjectionTotal,
    doneRenderedTotal,
  },
  histograms: {
    doneProjectionLatency,
    doneRenderedLatency,
  },
};

console.log(JSON.stringify(report, null, 2));
