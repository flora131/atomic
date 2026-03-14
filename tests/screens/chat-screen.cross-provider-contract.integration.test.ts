import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentType } from "@/services/models/index.ts";
import {
  mergeAgentTaskLabel,
} from "@/state/chat/exports.ts";
import {
  createAgentLifecycleLedger,
  registerAgentLifecycleComplete,
  registerAgentLifecycleStart,
  registerAgentLifecycleUpdate,
} from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import {
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";

const PROVIDERS: AgentType[] = ["claude", "opencode", "copilot"];

function runStrictContractFlow() {
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

  return {
    started,
    updated,
    completed,
    invalidUpdate,
    ledgerEntry: ledger.get("agent-1"),
    preservedLabel,
  };
}

describe("chat cross-provider integration parity", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  test("lifecycle and labels remain parity-stable", () => {
    const results = PROVIDERS.map(() => runStrictContractFlow());
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
  });
});
