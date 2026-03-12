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

describe("adapter event coverage policy", () => {
  test("records validation parity metrics", () => {
    resetRuntimeParityMetrics();
    assertAdapterEventCoveragePolicyInvariant();

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.event_coverage_validations_total{provider=opencode}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.event_coverage_validations_total{provider=claude}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.event_coverage_validations_total{provider=copilot}"]).toBe(1);
  });

  test("defines coverage for every SDK event type per provider", () => {
    for (const provider of Object.keys(ADAPTER_EVENT_COVERAGE_POLICY)) {
      const coverage = ADAPTER_EVENT_COVERAGE_POLICY[provider as keyof typeof ADAPTER_EVENT_COVERAGE_POLICY];

      for (const eventType of ALL_SDK_EVENT_TYPES) {
        expect(coverage[eventType]).toBeDefined();
      }
    }
  });

  test("every coverage rule is explicit", () => {
    for (const coverage of Object.values(ADAPTER_EVENT_COVERAGE_POLICY)) {
      for (const eventType of ALL_SDK_EVENT_TYPES) {
        const rule = coverage[eventType];
        expect(rule.disposition).toBeDefined();
        expect(rule.rationale.length).toBeGreaterThan(0);
      }
    }
  });

  test("throws descriptive errors when mapped rules are missing canonical coverage", () => {
    resetRuntimeParityMetrics();
    const invalidPolicy = {
      ...ADAPTER_EVENT_COVERAGE_POLICY,
      opencode: {
        ...ADAPTER_EVENT_COVERAGE_POLICY.opencode,
        "tool.start": {
          disposition: "mapped" as const,
          canonicalEvents: [],
          rationale: "invalid",
        },
      },
    };

    expect(() => assertAdapterEventCoveragePolicyInvariant(invalidPolicy)).toThrow("must map at least one canonical event");

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.event_coverage_invariant_failures_total{eventType=tool.start,provider=opencode,reason=missing_canonical_events}"]).toBe(1);
  });
});
