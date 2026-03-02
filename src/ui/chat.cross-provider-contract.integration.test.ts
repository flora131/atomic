import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentType } from "../models";
import {
  buildAgentContinuationPayload,
  emitAgentLifecycleContractObservability,
  emitAgentMainContinuationObservability,
  emitContractFailureTerminationObservability,
  getAgentContinuationContractViolation,
  getAutoCompactionIndicatorState,
  mergeAgentTaskLabel,
} from "./chat.tsx";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import {
  createAgentLifecycleLedger,
  registerAgentLifecycleComplete,
  registerAgentLifecycleStart,
  registerAgentLifecycleUpdate,
} from "./utils/agent-lifecycle-ledger.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "../workflows/runtime-parity-observability.ts";

const PROVIDERS: AgentType[] = ["claude", "opencode", "copilot"];

function createAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "worker",
    task: overrides.task ?? "Analyze auth retries",
    status: overrides.status ?? "completed",
    startedAt: overrides.startedAt ?? new Date(1000000000000).toISOString(),
    background: overrides.background,
    result: overrides.result,
    error: overrides.error,
  };
}

function runStrictContractFlow(provider: AgentType) {
  const ledger = createAgentLifecycleLedger();
  const started = registerAgentLifecycleStart(ledger, "agent-1");
  const updated = registerAgentLifecycleUpdate(ledger, "agent-1");
  const completed = registerAgentLifecycleComplete(ledger, "agent-1");
  const invalidUpdate = registerAgentLifecycleUpdate(ledger, "agent-1");

  if (!invalidUpdate.ok) {
    emitAgentLifecycleContractObservability({
      provider,
      runId: 14,
      code: invalidUpdate.code,
      eventType: "stream.agent.update",
      agentId: "agent-1",
    });
  }

  const canonicalLabel = mergeAgentTaskLabel(
    "sub-agent task",
    "Analyze auth retries",
    "general-purpose",
  );
  const preservedLabel = mergeAgentTaskLabel(canonicalLabel, "sub-agent task", "general-purpose");

  const continuationPayload = buildAgentContinuationPayload({
    agents: [
      createAgent({ id: "fg-1", name: "worker", result: "Completed auth investigation" }),
      createAgent({ id: "bg-1", name: "bg-worker", background: true, result: "ignore" }),
    ],
  });
  emitAgentMainContinuationObservability({
    provider,
    runId: 14,
    result: continuationPayload ? "forwarded" : "missing",
  });

  const missingContinuation = getAgentContinuationContractViolation({
    isAgentOnlyStream: true,
    continuationPayload: null,
  });
  if (missingContinuation) {
    emitAgentMainContinuationObservability({
      provider,
      runId: 14,
      result: "missing",
    });
    emitContractFailureTerminationObservability({
      provider,
      runId: 14,
      reason: "missing_agent_continuation",
      errorMessage: missingContinuation,
    });
  }

  const compactionStart = getAutoCompactionIndicatorState("start");
  const compactionSuccess = getAutoCompactionIndicatorState("complete", true);
  const compactionError = getAutoCompactionIndicatorState("complete", false, "token budget exhausted");
  if (compactionError.status === "error") {
    emitContractFailureTerminationObservability({
      provider,
      runId: 14,
      reason: "compaction_terminal_error",
      errorMessage: compactionError.errorMessage ?? "compaction failed",
    });
  }

  return {
    started,
    updated,
    completed,
    invalidUpdate,
    ledgerEntry: ledger.get("agent-1"),
    preservedLabel,
    continuationPayload,
    missingContinuation,
    compactionStart,
    compactionSuccess,
    compactionError,
  };
}

describe("chat strict contract cross-provider integration parity", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  test("lifecycle, labels, continuation, and compaction remain parity-stable", () => {
    const results = PROVIDERS.map((provider) => runStrictContractFlow(provider));
    const baseline = results[0];
    expect(baseline).toBeDefined();
    if (!baseline) {
      return;
    }

    for (const result of results.slice(1)) {
      expect(result).toEqual(baseline);
    }

    expect(baseline.started.ok).toBe(true);
    expect(baseline.updated.ok).toBe(true);
    expect(baseline.completed.ok).toBe(true);
    expect(baseline.invalidUpdate).toEqual({ ok: false, code: "OUT_OF_ORDER_EVENT" });
    expect(baseline.ledgerEntry).toEqual({
      started: true,
      completed: true,
      sequence: 3,
    });

    expect(baseline.preservedLabel).toBe("Analyze auth retries");
    expect(baseline.continuationPayload).toBe(
      '[Sub-agent results]\n\nSub-agent "worker" result:\n\nCompleted auth investigation',
    );
    expect(baseline.missingContinuation).toBe(
      "Contract violation (INV-OUTPUT-001): missing @agent continuation input; turn terminated.",
    );

    expect(baseline.compactionStart).toEqual({ status: "running" });
    expect(baseline.compactionSuccess).toEqual({ status: "completed" });
    expect(baseline.compactionError).toEqual({
      status: "error",
      errorMessage: "token budget exhausted",
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    for (const provider of PROVIDERS) {
      expect(
        metrics.counters[
          `workflow.runtime.parity.agent_lifecycle_contract_violation_total{code=OUT_OF_ORDER_EVENT,eventType=stream.agent.update,provider=${provider}}`
        ],
      ).toBe(1);
      expect(
        metrics.counters[
          `workflow.runtime.parity.agent_event_out_of_order_total{code=OUT_OF_ORDER_EVENT,eventType=stream.agent.update,provider=${provider}}`
        ],
      ).toBe(1);
      expect(
        metrics.counters[
          `workflow.runtime.parity.agent_result_main_continuation_total{provider=${provider},result=forwarded}`
        ],
      ).toBe(1);
      expect(
        metrics.counters[
          `workflow.runtime.parity.agent_result_main_continuation_total{provider=${provider},result=missing}`
        ],
      ).toBe(1);
      expect(
        metrics.counters[
          `workflow.runtime.parity.turn_terminated_due_to_contract_error_total{provider=${provider},reason=missing_agent_continuation}`
        ],
      ).toBe(1);
      expect(
        metrics.counters[
          `workflow.runtime.parity.turn_terminated_due_to_contract_error_total{provider=${provider},reason=compaction_terminal_error}`
        ],
      ).toBe(1);
    }
  });
});
