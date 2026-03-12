import type { EventBus } from "@/services/events/event-bus.ts";
import { pipelineError } from "@/services/events/pipeline-logger.ts";
import {
  incrementRuntimeParityCounter,
  observeRuntimeParityHistogram,
  runtimeParityDebug,
} from "@/services/workflows/runtime-parity-observability.ts";
import {
  formatAgentLifecycleViolation,
  type AgentLifecycleViolationCode,
} from "@/lib/ui/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent, DoneStateProjection } from "@/lib/ui/agent-ordering-contract.ts";

const AGENT_OUT_OF_ORDER_VIOLATION_CODES = new Set<AgentLifecycleViolationCode>([
  "OUT_OF_ORDER_EVENT",
  "INVALID_TERMINAL_TRANSITION",
]);

type AgentOrderingScenario = "single" | "multi";

export function emitAgentLifecycleContractObservability(args: {
  provider?: string;
  runId?: number;
  code: AgentLifecycleViolationCode;
  eventType: "stream.agent.start" | "stream.agent.update" | "stream.agent.complete";
  agentId: string;
  eventBus?: EventBus;
}): void {
  const provider = args.provider ?? "unknown";
  incrementRuntimeParityCounter("workflow.runtime.parity.agent_lifecycle_contract_violation_total", {
    provider,
    code: args.code,
    eventType: args.eventType,
  });
  if (AGENT_OUT_OF_ORDER_VIOLATION_CODES.has(args.code)) {
    incrementRuntimeParityCounter("workflow.runtime.parity.agent_event_out_of_order_total", {
      provider,
      code: args.code,
      eventType: args.eventType,
    });
  }
  runtimeParityDebug("agent_lifecycle_contract_violation", {
    provider,
    runId: args.runId,
    code: args.code,
    eventType: args.eventType,
    agentId: args.agentId,
  });
  pipelineError("EventBus", "agent_lifecycle_contract_violation", {
    provider,
    code: args.code,
    eventType: args.eventType,
    agentId: args.agentId,
  });
  args.eventBus?.reportError({
    kind: "contract_violation",
    eventType: args.eventType,
    error: formatAgentLifecycleViolation(args),
    eventData: { code: args.code, agentId: args.agentId, provider },
  });
}

export function emitAgentDoneProjectionObservability(args: {
  provider?: string;
  runId?: number;
  event: AgentOrderingEvent;
  projectionMode: DoneStateProjection["projectionMode"];
  completionTimestampMs?: number;
}): void {
  const provider = args.provider ?? "unknown";
  incrementRuntimeParityCounter("workflow.runtime.parity.agent_done_projection_total", {
    provider,
    mode: args.projectionMode,
  });
  if (typeof args.completionTimestampMs === "number") {
    observeRuntimeParityHistogram(
      "workflow.runtime.parity.agent_done_projection_latency_ms",
      Math.max(0, args.event.timestampMs - args.completionTimestampMs),
      {
        provider,
        mode: args.projectionMode,
      },
    );
  }
  runtimeParityDebug("agent_done_projection", {
    provider,
    runId: args.runId,
    event: args.event,
    projectionMode: args.projectionMode,
    completionTimestampMs: args.completionTimestampMs,
  });
}

export function emitAgentDoneRenderedObservability(args: {
  provider?: string;
  runId?: number;
  event: AgentOrderingEvent;
  completionTimestampMs?: number;
  projectionMode?: DoneStateProjection["projectionMode"];
}): void {
  const provider = args.provider ?? "unknown";
  incrementRuntimeParityCounter("workflow.runtime.parity.agent_done_rendered_total", {
    provider,
  });
  if (typeof args.completionTimestampMs === "number") {
    observeRuntimeParityHistogram(
      "workflow.runtime.parity.agent_done_rendered_latency_ms",
      Math.max(0, args.event.timestampMs - args.completionTimestampMs),
      { provider },
    );
  }
  runtimeParityDebug("agent_done_rendered", {
    provider,
    runId: args.runId,
    event: args.event,
    projectionMode: args.projectionMode,
    completionTimestampMs: args.completionTimestampMs,
  });
}

export function emitPostCompleteDeltaOrderingObservability(args: {
  provider?: string;
  runId?: number;
  event: AgentOrderingEvent;
  doneProjected: boolean;
  scenario: AgentOrderingScenario;
  projectionMode?: DoneStateProjection["projectionMode"];
}): void {
  const provider = args.provider ?? "unknown";
  if (!args.doneProjected) {
    incrementRuntimeParityCounter("workflow.runtime.parity.agent_post_complete_delta_before_done_total", {
      provider,
    });
    incrementRuntimeParityCounter("workflow.runtime.parity.agent_ordering_contract_violation_total", {
      provider,
      scenario: args.scenario,
    });
  }
  runtimeParityDebug("agent_post_complete_delta_ordering", {
    provider,
    runId: args.runId,
    event: args.event,
    doneProjected: args.doneProjected,
    scenario: args.scenario,
    projectionMode: args.projectionMode,
  });
}
