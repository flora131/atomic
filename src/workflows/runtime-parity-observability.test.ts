import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  getRuntimeParityMetricsSnapshot,
  incrementRuntimeParityCounter,
  observeRuntimeParityHistogram,
  resetRuntimeParityMetrics,
  runtimeParityDebug,
  setRuntimeParityGauge,
} from "./runtime-parity-observability.ts";

describe("runtime-parity-observability", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  test("records counters, gauges, and histograms", () => {
    incrementRuntimeParityCounter("workflow.runtime.parity.counter", { flow: "new" });
    incrementRuntimeParityCounter("workflow.runtime.parity.counter", { flow: "new" });
    setRuntimeParityGauge("workflow.runtime.parity.gauge", 3, { flow: "new" });
    observeRuntimeParityHistogram("workflow.runtime.parity.histogram", 2, { flow: "new" });
    observeRuntimeParityHistogram("workflow.runtime.parity.histogram", 5, { flow: "new" });

    const snapshot = getRuntimeParityMetricsSnapshot();
    expect(snapshot.counters["workflow.runtime.parity.counter{flow=new}"]).toBe(2);
    expect(snapshot.gauges["workflow.runtime.parity.gauge{flow=new}"]).toBe(3);
    expect(snapshot.histograms["workflow.runtime.parity.histogram{flow=new}"]).toEqual([2, 5]);
  });

  test("normalizes metric labels and supports custom increments", () => {
    incrementRuntimeParityCounter(
      "workflow.runtime.parity.counter",
      { z: "last", a: "first", ignored: undefined },
      3,
    );

    const snapshot = getRuntimeParityMetricsSnapshot();
    expect(snapshot.counters["workflow.runtime.parity.counter{a=first,z=last}"]).toBe(3);
  });

  test("debug log stays gated unless debug flags are enabled", () => {
    const originalAtomicDebug = process.env.ATOMIC_DEBUG;
    const originalWorkflowDebug = process.env.ATOMIC_WORKFLOW_DEBUG;
    delete process.env.ATOMIC_DEBUG;
    delete process.env.ATOMIC_WORKFLOW_DEBUG;

    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});
    runtimeParityDebug("phase", { ok: true });
    expect(debugSpy).not.toHaveBeenCalled();

    process.env.ATOMIC_WORKFLOW_DEBUG = "1";
    runtimeParityDebug("phase", { ok: true });
    expect(debugSpy).toHaveBeenCalledTimes(1);

    delete process.env.ATOMIC_WORKFLOW_DEBUG;
    process.env.ATOMIC_DEBUG = "1";
    runtimeParityDebug("phase-atomic", { ok: "atomic" });
    expect(debugSpy).toHaveBeenCalledTimes(2);
    expect(debugSpy.mock.calls[1]?.[0]).toBe(
      '[workflow.runtime.parity] phase-atomic {"ok":"atomic"}',
    );

    if (originalAtomicDebug === undefined) {
      delete process.env.ATOMIC_DEBUG;
    } else {
      process.env.ATOMIC_DEBUG = originalAtomicDebug;
    }
    if (originalWorkflowDebug === undefined) {
      delete process.env.ATOMIC_WORKFLOW_DEBUG;
    } else {
      process.env.ATOMIC_WORKFLOW_DEBUG = originalWorkflowDebug;
    }
    debugSpy.mockRestore();
  });
});
