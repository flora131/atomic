import { describe, expect, test } from "bun:test";
import {
  ADAPTER_EVENT_COVERAGE_POLICY,
  ALL_SDK_EVENT_TYPES,
  assertAdapterEventCoveragePolicyInvariant,
} from "@/services/events/adapters/event-coverage-policy.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";

describe("event coverage policy e2e parity", () => {
  test("validates parity metrics for all providers in one pass", () => {
    resetRuntimeParityMetrics();
    assertAdapterEventCoveragePolicyInvariant();

    const metrics = getRuntimeParityMetricsSnapshot();
    for (const provider of ["opencode", "claude", "copilot"] as const) {
      expect(
        metrics.counters[
          `workflow.runtime.parity.event_coverage_validations_total{provider=${provider}}`
        ],
      ).toBe(1);
      expect(
        metrics.histograms[
          `workflow.runtime.parity.event_coverage_mapped_events{provider=${provider}}`
        ],
      ).toEqual([ALL_SDK_EVENT_TYPES.length - 1]);
      expect(
        metrics.gauges[
          `workflow.runtime.parity.event_coverage_noop_events{provider=${provider}}`
        ],
      ).toBe(1);
    }
  });

  test("enforces explicit provider policy behavior for message.complete parity", () => {
    expect(ADAPTER_EVENT_COVERAGE_POLICY.opencode["message.complete"]).toMatchObject({
      disposition: "mapped_with_constraints",
      canonicalEvents: ["stream.text.complete", "stream.thinking.complete"],
    });
    expect(ADAPTER_EVENT_COVERAGE_POLICY.claude["message.complete"]).toMatchObject({
      disposition: "mapped_with_constraints",
      canonicalEvents: ["stream.text.complete", "stream.thinking.complete"],
    });
    expect(ADAPTER_EVENT_COVERAGE_POLICY.copilot["message.complete"]).toMatchObject({
      disposition: "mapped_with_constraints",
      canonicalEvents: ["stream.text.complete", "stream.thinking.complete", "stream.tool.start"],
    });
  });
});
