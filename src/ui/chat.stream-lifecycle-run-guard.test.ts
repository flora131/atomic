import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  buildAgentContinuationPayload,
  emitAgentLifecycleContractObservability,
  emitAgentMainContinuationObservability,
  emitContractFailureTerminationObservability,
  getAgentContinuationContractViolation,
  shouldFinalizeAgentOnlyStream,
  shouldProcessStreamLifecycleEvent,
} from "./chat.tsx";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "../workflows/runtime-parity-observability.ts";

function shouldFinalizeOnIdle(args: {
  activeRunId: number | null;
  eventRunId: number;
  isStreaming: boolean;
}): boolean {
  if (!shouldProcessStreamLifecycleEvent(args.activeRunId, args.eventRunId)) {
    return false;
  }
  return args.isStreaming;
}

beforeEach(() => {
  resetRuntimeParityMetrics();
});

describe("chat stream lifecycle run guard", () => {
  test("ignores lifecycle events before stream.session.start binds a run", () => {
    expect(shouldProcessStreamLifecycleEvent(null, 7)).toBe(false);
  });

  test("ignores stale lifecycle events from a previous run", () => {
    expect(shouldProcessStreamLifecycleEvent(12, 11)).toBe(false);
  });

  test("accepts lifecycle events from the active run", () => {
    expect(shouldProcessStreamLifecycleEvent(12, 12)).toBe(true);
  });

  test("idle finalization runs only for the active stream run", () => {
    expect(
      shouldFinalizeOnIdle({
        activeRunId: 22,
        eventRunId: 21,
        isStreaming: true,
      }),
    ).toBe(false);

    expect(
      shouldFinalizeOnIdle({
        activeRunId: 22,
        eventRunId: 22,
        isStreaming: true,
      }),
    ).toBe(true);
  });
});

describe("agent-only stream finalization guard", () => {
  test("finalizes when live sub-agent state is present", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 1,
        messageAgentCount: 0,
      }),
    ).toBe(true);
  });

  test("finalizes when live state is cleared but message snapshot still has sub-agents", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 0,
        messageAgentCount: 1,
      }),
    ).toBe(true);
  });

  test("does not finalize before any sub-agent data exists", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 0,
        messageAgentCount: 0,
      }),
    ).toBe(false);
  });
});

describe("@agent continuation payload", () => {
  function createAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
    return {
      id: "agent-1",
      name: "worker",
      task: "task",
      status: "completed",
      startedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  test("builds payload from foreground sub-agent results", () => {
    const payload = buildAgentContinuationPayload({
      agents: [
        createAgent({ id: "fg-1", name: "worker", result: "Done A" }),
        createAgent({ id: "bg-1", name: "bg", background: true, result: "ignore" }),
        createAgent({ id: "fg-2", name: "reviewer", result: "Done B" }),
      ],
    });

    expect(payload).toBe(
      '[Sub-agent results]\n\nSub-agent "worker" result:\n\nDone A\n\nSub-agent "reviewer" result:\n\nDone B',
    );
  });

  test("falls back to assistant text when no sub-agent result exists", () => {
    const payload = buildAgentContinuationPayload({
      agents: [createAgent({ status: "completed", result: "" })],
      fallbackText: "Final agent output",
    });

    expect(payload).toBe("[Sub-agent result]\n\nFinal agent output");
  });

  test("uses foreground agent error text when result text is unavailable", () => {
    const payload = buildAgentContinuationPayload({
      agents: [createAgent({ status: "error", result: "", error: "Tool execution failed" })],
    });

    expect(payload).toBe('[Sub-agent results]\n\nSub-agent "worker" result:\n\nTool execution failed');
  });

  test("ignores background-only results and uses fallback text", () => {
    const payload = buildAgentContinuationPayload({
      agents: [createAgent({ id: "bg-1", background: true, result: "background only" })],
      fallbackText: "Foreground summary",
    });

    expect(payload).toBe("[Sub-agent result]\n\nForeground summary");
  });

  test("returns null when both agent results and fallback are empty", () => {
    const payload = buildAgentContinuationPayload({
      agents: [createAgent({ status: "error", error: "   " })],
      fallbackText: "   ",
    });

    expect(payload).toBeNull();
  });
});

describe("@agent continuation contract guard", () => {
  test("returns violation when @agent continuation payload is missing", () => {
    const violation = getAgentContinuationContractViolation({
      isAgentOnlyStream: true,
      continuationPayload: null,
    });

    expect(violation).toBe(
      "Contract violation (INV-OUTPUT-001): missing @agent continuation input; turn terminated.",
    );
  });

  test("does not return violation for non-agent streams", () => {
    const violation = getAgentContinuationContractViolation({
      isAgentOnlyStream: false,
      continuationPayload: null,
    });

    expect(violation).toBeNull();
  });

  test("does not return violation when payload exists", () => {
    const violation = getAgentContinuationContractViolation({
      isAgentOnlyStream: true,
      continuationPayload: "[Sub-agent results]\n\nok",
    });

    expect(violation).toBeNull();
  });
});

describe("contract failure observability", () => {
  test("records strict lifecycle violation diagnostics and metrics", () => {
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = "1";
    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});

    try {
      emitAgentLifecycleContractObservability({
        provider: "claude",
        runId: 17,
        code: "OUT_OF_ORDER_EVENT",
        eventType: "stream.agent.update",
        agentId: "agent-1",
      });
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      if (originalDebug === undefined) {
        delete process.env.DEBUG;
      } else {
        process.env.DEBUG = originalDebug;
      }
      debugSpy.mockRestore();
    }

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.agent_lifecycle_contract_violation_total{code=OUT_OF_ORDER_EVENT,eventType=stream.agent.update,provider=claude}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.agent_event_out_of_order_total{code=OUT_OF_ORDER_EVENT,eventType=stream.agent.update,provider=claude}"]).toBe(1);
  });

  test("records continuation and contract-termination metrics for missing payload", () => {
    emitAgentMainContinuationObservability({
      provider: "opencode",
      runId: 23,
      result: "missing",
    });
    emitContractFailureTerminationObservability({
      provider: "opencode",
      runId: 23,
      reason: "missing_agent_continuation",
      errorMessage: "Contract violation (INV-OUTPUT-001): missing @agent continuation input; turn terminated.",
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.agent_result_main_continuation_total{provider=opencode,result=missing}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.turn_terminated_due_to_contract_error_total{provider=opencode,reason=missing_agent_continuation}"]).toBe(1);
  });
});
