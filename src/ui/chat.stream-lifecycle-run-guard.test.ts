import { beforeEach, describe, expect, test } from "bun:test";
import {
  emitAgentDoneRenderedObservability,
  buildAgentContinuationPayload,
  emitAgentDoneProjectionObservability,
  emitPostCompleteDeltaOrderingObservability,
  queueAgentTerminalBeforeDeferredDeltas,
  shouldFinalizeAgentOnlyStream,
  shouldDeferPostCompleteDeltaUntilDoneProjection,
  shouldProcessStreamPartEvent,
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

  test("drops stream parts during startup when run is not yet bound", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: null,
        partRunId: 7,
        isStreaming: true,
      }),
    ).toBe(false);
  });

  test("accepts stream parts after run is bound", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: 7,
        partRunId: 7,
        isStreaming: true,
      }),
    ).toBe(true);
  });

  test("keeps idle background parts when no stream is active", () => {
    expect(
      shouldProcessStreamPartEvent({
        activeRunId: null,
        partRunId: 7,
        isStreaming: false,
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

describe("post-complete delta gating", () => {
  test("defers post-complete deltas when completion exists but done is not projected", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: 4,
        doneProjected: false,
      }),
    ).toBe(true);
  });

  test("does not defer when done has already been projected", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: 4,
        doneProjected: true,
      }),
    ).toBe(false);
  });

  test("does not defer when no completion has been observed", () => {
    expect(
      shouldDeferPostCompleteDeltaUntilDoneProjection({
        completionSequence: undefined,
        doneProjected: false,
      }),
    ).toBe(false);
  });

  test("queues terminal before flushing deferred deltas for completed agents", () => {
    const order: string[] = [];
    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "msg-1",
      terminal: {
        type: "agent-terminal",
        runId: 1,
        agentId: "agent-1",
        status: "completed",
      },
      queueMessagePartUpdate: () => {
        order.push("terminal");
      },
      flushDeferredPostCompleteDeltas: () => {
        order.push("flush");
      },
    });

    expect(order).toEqual(["terminal", "flush"]);
  });

  test("does not flush deferred deltas for error terminal updates", () => {
    const order: string[] = [];
    queueAgentTerminalBeforeDeferredDeltas({
      messageId: "msg-1",
      terminal: {
        type: "agent-terminal",
        runId: 2,
        agentId: "agent-1",
        status: "error",
        error: "boom",
      },
      queueMessagePartUpdate: () => {
        order.push("terminal");
      },
      flushDeferredPostCompleteDeltas: () => {
        order.push("flush");
      },
    });

    expect(order).toEqual(["terminal"]);
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

describe("ordering diagnostics observability", () => {
  test("records done projection count and latency histogram", () => {
    emitAgentDoneProjectionObservability({
      provider: "claude",
      runId: 31,
      projectionMode: "effect",
      completionTimestampMs: 1000,
      event: {
        sessionId: "session-1",
        agentId: "agent-1",
        messageId: "msg-1",
        type: "agent_done_projected",
        sequence: 5,
        timestampMs: 1042,
        source: "ui-effect",
      },
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.agent_done_projection_total{mode=effect,provider=claude}"]).toBe(1);
    expect(metrics.histograms["workflow.runtime.parity.agent_done_projection_latency_ms{mode=effect,provider=claude}"]).toEqual([42]);
  });

  test("records sync-bridge done projection metrics", () => {
    emitAgentDoneProjectionObservability({
      provider: "claude",
      runId: 34,
      projectionMode: "sync-bridge",
      completionTimestampMs: 2000,
      event: {
        sessionId: "session-1",
        agentId: "agent-2",
        messageId: "msg-2",
        type: "agent_done_projected",
        sequence: 9,
        timestampMs: 2015,
        source: "sync-bridge",
      },
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.agent_done_projection_total{mode=sync-bridge,provider=claude}"]).toBe(1);
    expect(metrics.histograms["workflow.runtime.parity.agent_done_projection_latency_ms{mode=sync-bridge,provider=claude}"]).toEqual([15]);
  });

  test("records done-render markers and latency histogram", () => {
    emitAgentDoneRenderedObservability({
      provider: "claude",
      runId: 35,
      completionTimestampMs: 3000,
      projectionMode: "sync-bridge",
      event: {
        sessionId: "session-1",
        agentId: "agent-3",
        messageId: "msg-3",
        type: "agent_done_rendered",
        sequence: 11,
        timestampMs: 3012,
        source: "ui-effect",
      },
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.agent_done_rendered_total{provider=claude}"]).toBe(1);
    expect(metrics.histograms["workflow.runtime.parity.agent_done_rendered_latency_ms{provider=claude}"]).toEqual([12]);
  });

  test("records post-complete delta before done projection violations", () => {
    emitPostCompleteDeltaOrderingObservability({
      provider: "claude",
      runId: 32,
      doneProjected: false,
      event: {
        sessionId: "session-1",
        agentId: "agent-1",
        messageId: "msg-1",
        type: "post_complete_delta_rendered",
        sequence: 6,
        timestampMs: 2042,
        source: "wildcard-batch",
      },
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.agent_post_complete_delta_before_done_total{provider=claude}"]).toBe(1);
  });

  test("does not record violation counters when done is already projected", () => {
    emitPostCompleteDeltaOrderingObservability({
      provider: "claude",
      runId: 33,
      doneProjected: true,
      event: {
        sessionId: "session-1",
        agentId: "agent-2",
        messageId: "msg-2",
        type: "post_complete_delta_rendered",
        sequence: 8,
        timestampMs: 3042,
        source: "wildcard-batch",
      },
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.agent_post_complete_delta_before_done_total{provider=claude}"]).toBeUndefined();
  });
});
