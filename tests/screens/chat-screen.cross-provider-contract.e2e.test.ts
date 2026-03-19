import { describe, expect, test } from "bun:test";
import type { AgentType } from "@/services/models/index.ts";
import {
  getAutoCompactionIndicatorState,
  mergeAgentTaskLabel,
  shouldFinalizeAgentOnlyStream,
} from "@/state/chat/exports.ts";
import {
  createAgentLifecycleLedger,
  registerAgentLifecycleComplete,
  registerAgentLifecycleStart,
  registerAgentLifecycleUpdate,
} from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";

const PROVIDERS: AgentType[] = ["claude", "opencode", "copilot"];

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
    shouldFinalize,
    compactionStart: getAutoCompactionIndicatorState("start"),
    compactionComplete: getAutoCompactionIndicatorState("complete", true),
  };
}

describe("chat cross-provider e2e parity", () => {
  test.each(PROVIDERS)(
    "provider %s: successful agent-only turn preserves strict lifecycle parity",
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
      expect(result.shouldFinalize).toBe(true);
      expect(result.compactionStart).toEqual({ status: "running" });
      expect(result.compactionComplete).toEqual({ status: "completed" });
    },
  );
});
