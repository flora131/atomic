import type { BusEventType } from "@/services/events/bus-events/index.ts";
import type { EventType } from "@/services/agents/types.ts";
import {
  incrementRuntimeParityCounter,
  observeRuntimeParityHistogram,
  runtimeParityDebug,
  setRuntimeParityGauge,
} from "@/services/workflows/runtime-parity-observability.ts";

export type AdapterProvider = "opencode" | "claude" | "copilot";

export type EventCoverageDisposition = "mapped" | "mapped_with_constraints" | "no_op";

export interface EventCoverageRule {
  disposition: EventCoverageDisposition;
  canonicalEvents: BusEventType[];
  rationale: string;
}

export const ALL_SDK_EVENT_TYPES: EventType[] = [
  "session.start",
  "session.idle",
  "session.error",
  "session.retry",
  "session.info",
  "session.warning",
  "session.title_changed",
  "session.truncation",
  "session.compaction",
  "message.delta",
  "message.complete",
  "reasoning.delta",
  "reasoning.complete",
  "turn.start",
  "turn.end",
  "tool.start",
  "tool.complete",
  "tool.partial_result",
  "skill.invoked",
  "subagent.start",
  "subagent.complete",
  "subagent.update",
  "permission.requested",
  "human_input_required",
  "usage",
];

type ProviderCoverage = Record<EventType, EventCoverageRule>;

const OPENCODE_EVENT_COVERAGE: ProviderCoverage = {
  // Intentionally no_op: the adapter publishes stream.session.start directly
  // in startStreaming() before provider events are subscribed, so this SDK
  // event is never observed by the handler factory. The canonical event is
  // guaranteed to be emitted exactly once per streaming run.
  "session.start": {
    disposition: "no_op",
    canonicalEvents: [],
    rationale: "Adapter emits canonical stream.session.start at stream start.",
  },
  "session.idle": { disposition: "mapped", canonicalEvents: ["stream.session.idle"], rationale: "Session idle lifecycle." },
  "session.error": { disposition: "mapped", canonicalEvents: ["stream.session.error"], rationale: "Session error lifecycle." },
  "session.retry": { disposition: "mapped", canonicalEvents: ["stream.session.retry"], rationale: "Retry lifecycle." },
  "session.info": { disposition: "mapped", canonicalEvents: ["stream.session.info"], rationale: "Informational notifications." },
  "session.warning": { disposition: "mapped", canonicalEvents: ["stream.session.warning"], rationale: "Warning notifications." },
  "session.title_changed": {
    disposition: "mapped",
    canonicalEvents: ["stream.session.title_changed"],
    rationale: "Session title updates.",
  },
  "session.truncation": {
    disposition: "mapped",
    canonicalEvents: ["stream.session.truncation"],
    rationale: "Context truncation lifecycle.",
  },
  "session.compaction": {
    disposition: "mapped",
    canonicalEvents: ["stream.session.compaction"],
    rationale: "Compaction lifecycle.",
  },
  "message.delta": {
    disposition: "mapped_with_constraints",
    canonicalEvents: ["stream.text.delta", "stream.thinking.delta"],
    rationale: "Mapped by contentType and empty deltas are skipped.",
  },
  "message.complete": {
    disposition: "mapped_with_constraints",
    canonicalEvents: ["stream.text.complete", "stream.thinking.complete"],
    rationale: "Finalizes accumulated text and active thinking blocks.",
  },
  "reasoning.delta": {
    disposition: "mapped",
    canonicalEvents: ["stream.thinking.delta"],
    rationale: "Provider-native reasoning deltas map to canonical thinking deltas.",
  },
  "reasoning.complete": {
    disposition: "mapped",
    canonicalEvents: ["stream.thinking.complete"],
    rationale: "Provider-native reasoning completion maps to canonical thinking completion.",
  },
  "turn.start": { disposition: "mapped", canonicalEvents: ["stream.turn.start"], rationale: "Turn lifecycle start." },
  "turn.end": { disposition: "mapped", canonicalEvents: ["stream.turn.end"], rationale: "Turn lifecycle end." },
  "tool.start": { disposition: "mapped", canonicalEvents: ["stream.tool.start"], rationale: "Tool lifecycle start." },
  "tool.complete": { disposition: "mapped", canonicalEvents: ["stream.tool.complete"], rationale: "Tool lifecycle complete." },
  "tool.partial_result": {
    disposition: "mapped",
    canonicalEvents: ["stream.tool.partial_result"],
    rationale: "Streaming tool output chunks.",
  },
  "skill.invoked": { disposition: "mapped", canonicalEvents: ["stream.skill.invoked"], rationale: "Skill invocation events." },
  "subagent.start": { disposition: "mapped", canonicalEvents: ["stream.agent.start"], rationale: "Sub-agent lifecycle start." },
  "subagent.complete": {
    disposition: "mapped",
    canonicalEvents: ["stream.agent.complete"],
    rationale: "Sub-agent lifecycle complete.",
  },
  "subagent.update": {
    disposition: "mapped",
    canonicalEvents: ["stream.agent.update"],
    rationale: "Sub-agent progress updates.",
  },
  "permission.requested": {
    disposition: "mapped",
    canonicalEvents: ["stream.permission.requested"],
    rationale: "Human approval flow.",
  },
  "human_input_required": {
    disposition: "mapped",
    canonicalEvents: ["stream.human_input_required"],
    rationale: "Workflow human-input requests.",
  },
  usage: {
    disposition: "mapped_with_constraints",
    canonicalEvents: ["stream.usage"],
    rationale: "Zero-token diagnostics are intentionally ignored.",
  },
};

const CLAUDE_EVENT_COVERAGE: ProviderCoverage = {
  ...OPENCODE_EVENT_COVERAGE,
  "message.complete": {
    disposition: "mapped_with_constraints",
    canonicalEvents: ["stream.text.complete", "stream.thinking.complete", "stream.tool.start"],
    rationale: "Sub-agent message.complete toolRequests materialize inline tool rows; text completion still follows stream-end semantics.",
  },
};

const COPILOT_EVENT_COVERAGE: ProviderCoverage = {
  ...OPENCODE_EVENT_COVERAGE,
  "message.delta": {
    disposition: "mapped_with_constraints",
    canonicalEvents: ["stream.text.delta", "stream.thinking.delta"],
    rationale: "Parent-tool deltas are mapped to agent-scoped deltas; main deltas remain in main stream.",
  },
  "message.complete": {
    disposition: "mapped_with_constraints",
    canonicalEvents: ["stream.text.complete", "stream.thinking.complete", "stream.tool.start"],
    rationale: "Sub-agent message.complete with parentToolCallId is a no-op to avoid duplicate tool request starts.",
  },
};

export const ADAPTER_EVENT_COVERAGE_POLICY: Record<AdapterProvider, ProviderCoverage> = {
  opencode: OPENCODE_EVENT_COVERAGE,
  claude: CLAUDE_EVENT_COVERAGE,
  copilot: COPILOT_EVENT_COVERAGE,
};

export function assertAdapterEventCoveragePolicyInvariant(
  policy: Record<AdapterProvider, ProviderCoverage> = ADAPTER_EVENT_COVERAGE_POLICY,
): void {
  const providers = Object.keys(policy) as AdapterProvider[];

  for (const provider of providers) {
    const coverage = policy[provider];
    let mappedCount = 0;
    let noopCount = 0;
    for (const eventType of ALL_SDK_EVENT_TYPES) {
      const rule = coverage[eventType];
      if (!rule) {
        incrementRuntimeParityCounter("workflow.runtime.parity.event_coverage_invariant_failures_total", {
          provider,
          reason: "missing_rule",
          eventType,
        });
        throw new Error(`Event coverage invariant failed: provider ${provider} missing rule for ${eventType}`);
      }

      if (rule.disposition !== "no_op" && rule.canonicalEvents.length === 0) {
        incrementRuntimeParityCounter("workflow.runtime.parity.event_coverage_invariant_failures_total", {
          provider,
          reason: "missing_canonical_events",
          eventType,
        });
        throw new Error(
          `Event coverage invariant failed: provider ${provider} rule ${eventType} must map at least one canonical event`,
        );
      }

      if (rule.disposition === "no_op") {
        noopCount += 1;
      } else {
        mappedCount += 1;
      }
    }

    observeRuntimeParityHistogram(
      "workflow.runtime.parity.event_coverage_mapped_events",
      mappedCount,
      { provider },
    );
    setRuntimeParityGauge("workflow.runtime.parity.event_coverage_noop_events", noopCount, { provider });
    incrementRuntimeParityCounter("workflow.runtime.parity.event_coverage_validations_total", { provider });
    runtimeParityDebug("event_coverage_validated", {
      provider,
      mappedCount,
      noopCount,
      total: ALL_SDK_EVENT_TYPES.length,
    });
  }
}

assertAdapterEventCoveragePolicyInvariant();
