import { describe, expect, test } from "bun:test";
import type { AgentType } from "../models";
import {
  buildAgentContinuationPayload,
  getAutoCompactionIndicatorState,
  mergeAgentTaskLabel,
  shouldFinalizeAgentOnlyStream,
} from "./chat.tsx";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import {
  createAgentLifecycleLedger,
  registerAgentLifecycleComplete,
  registerAgentLifecycleStart,
  registerAgentLifecycleUpdate,
} from "./utils/agent-lifecycle-ledger.ts";

const PROVIDERS: AgentType[] = ["claude", "opencode", "copilot"];

function createAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "worker",
    task: overrides.task ?? "Investigate auth guard ordering",
    status: overrides.status ?? "completed",
    startedAt: overrides.startedAt ?? new Date(1000000000000).toISOString(),
    background: overrides.background,
    result: overrides.result,
    error: overrides.error,
  };
}

interface ProviderFixture {
  firstTask: string | undefined;
  secondTask: string | undefined;
}

const SUCCESS_FIXTURES: Record<AgentType, ProviderFixture> = {
  claude: {
    firstTask: "Investigate auth guard ordering",
    secondTask: "sub-agent task",
  },
  opencode: {
    firstTask: "sub-agent task",
    secondTask: "Investigate auth guard ordering",
  },
  copilot: {
    firstTask: "subagent task",
    secondTask: "Investigate auth guard ordering",
  },
};

function runProviderTurn(fixture: ProviderFixture) {
  const ledger = createAgentLifecycleLedger();
  const started = registerAgentLifecycleStart(ledger, "agent-e2e-1");
  const updated = registerAgentLifecycleUpdate(ledger, "agent-e2e-1");
  const completed = registerAgentLifecycleComplete(ledger, "agent-e2e-1");

  const mergedInitialTask = mergeAgentTaskLabel(undefined, fixture.firstTask, "general-purpose");
  const finalTask = mergeAgentTaskLabel(mergedInitialTask, fixture.secondTask, "general-purpose");

  const continuationPayload = buildAgentContinuationPayload({
    agents: [createAgent({ id: "fg-1", task: finalTask, result: "Auth guard analysis complete" })],
  });

  const shouldFinalize = shouldFinalizeAgentOnlyStream({
    hasStreamingMessage: true,
    isStreaming: true,
    isAgentOnlyStream: true,
    liveAgentCount: 1,
    messageAgentCount: 0,
  });

  return {
    started,
    updated,
    completed,
    ledgerEntry: ledger.get("agent-e2e-1"),
    finalTask,
    continuationPayload,
    shouldFinalize,
    compactionStart: getAutoCompactionIndicatorState("start"),
    compactionComplete: getAutoCompactionIndicatorState("complete", true),
  };
}

describe("chat cross-provider e2e parity", () => {
  test.each(PROVIDERS)(
    "provider %s: successful agent-only turn preserves strict lifecycle and continuation parity",
    (provider) => {
      const result = runProviderTurn(SUCCESS_FIXTURES[provider]);

      expect(result.started.ok).toBe(true);
      expect(result.updated.ok).toBe(true);
      expect(result.completed.ok).toBe(true);
      expect(result.ledgerEntry).toEqual({
        started: true,
        completed: true,
        sequence: 3,
      });
      expect(result.finalTask).toBe("Investigate auth guard ordering");
      expect(result.continuationPayload).toBe(
        '[Sub-agent results]\n\nSub-agent "worker" result:\n\nAuth guard analysis complete',
      );
      expect(result.shouldFinalize).toBe(true);
      expect(result.compactionStart).toEqual({ status: "running" });
      expect(result.compactionComplete).toEqual({ status: "completed" });
    },
  );
});
