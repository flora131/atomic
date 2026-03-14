import { beforeEach, describe, expect, test } from "bun:test";
import { shouldContinueParentSessionLoop } from "@/state/chat/shared/helpers/stream-continuation.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";

describe("stream continuation helpers", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  describe("parent loop continuation", () => {
    test("parent loop continues on tool-calls finish reason", () => {
      const signal = shouldContinueParentSessionLoop({
        finishReason: "tool-calls",
        hasActiveForegroundAgents: false,
        hasRunningBlockingTool: false,
        hasPendingTaskContract: false,
      });

      expect(signal).toEqual({
        shouldContinue: true,
        reason: "finish-reason",
      });

      const metrics = getRuntimeParityMetricsSnapshot();
      expect(
        metrics.counters[
          "workflow.runtime.parity.loop_decision_total{decision=continue,finishReason=tool-calls,reason=finish-reason}"
        ],
      ).toBe(1);
    });

    test("parent loop continues while pending work remains", () => {
      const signal = shouldContinueParentSessionLoop({
        finishReason: "stop",
        hasActiveForegroundAgents: false,
        hasRunningBlockingTool: true,
        hasPendingTaskContract: false,
      });

      expect(signal).toEqual({
        shouldContinue: true,
        reason: "pending-work",
      });
    });

    test("parent loop terminates on terminal finish reason with no pending work", () => {
      const signal = shouldContinueParentSessionLoop({
        finishReason: "stop",
        hasActiveForegroundAgents: false,
        hasRunningBlockingTool: false,
        hasPendingTaskContract: false,
      });

      expect(signal).toEqual({
        shouldContinue: false,
        reason: "terminal",
      });

      const metrics = getRuntimeParityMetricsSnapshot();
      expect(
        metrics.counters[
          "workflow.runtime.parity.loop_decision_total{decision=stop,finishReason=stop,reason=terminal}"
        ],
      ).toBe(1);
      expect(
        metrics.gauges[
          "workflow.runtime.parity.loop_pending_task_contract{finishReason=stop}"
        ],
      ).toBe(0);
      expect(
        metrics.histograms[
          "workflow.runtime.parity.loop_pending_flags{finishReason=stop}"
        ],
      ).toEqual([0]);
    });
  });
});
