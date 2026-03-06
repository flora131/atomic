import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentType } from "../models";
import {
  buildAgentContinuationPayload,
  emitAgentMainContinuationObservability,
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
    result: "forwarded",
  });

  return {
    started,
    updated,
    completed,
    invalidUpdate,
    ledgerEntry: ledger.get("agent-1"),
    preservedLabel,
    continuationPayload,
  };
}

describe("chat cross-provider integration parity", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  test("lifecycle, labels, and continuation remain parity-stable", () => {
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

    const metrics = getRuntimeParityMetricsSnapshot();
    for (const provider of PROVIDERS) {
      expect(
        metrics.counters[
          `workflow.runtime.parity.agent_result_main_continuation_total{provider=${provider},result=forwarded}`
        ],
      ).toBe(1);
    }
  });
});
