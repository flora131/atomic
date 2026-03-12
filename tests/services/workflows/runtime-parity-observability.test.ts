import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  getRuntimeParityMetricsSnapshot,
  incrementRuntimeParityCounter,
  observeRuntimeParityHistogram,
  resetRuntimeParityMetrics,
  runtimeParityDebug,
  setRuntimeParityGauge,
} from "@/services/workflows/runtime-parity-observability.ts";

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
    const originalDebug = process.env.DEBUG;
    const originalWorkflowDebug = process.env.ATOMIC_WORKFLOW_DEBUG;
    delete process.env.DEBUG;
    delete process.env.ATOMIC_WORKFLOW_DEBUG;

    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});
    runtimeParityDebug("phase", { ok: true });
    expect(debugSpy).not.toHaveBeenCalled();

    process.env.DEBUG = "1";
    runtimeParityDebug("phase", { ok: true });
    expect(debugSpy).toHaveBeenCalledTimes(1);

    process.env.DEBUG = "0";
    runtimeParityDebug("phase-disabled", { ok: "disabled" });
    expect(debugSpy).toHaveBeenCalledTimes(1);

    delete process.env.DEBUG;
    process.env.ATOMIC_WORKFLOW_DEBUG = "1";
    runtimeParityDebug("phase-workflow", { ok: "workflow" });
    expect(debugSpy).toHaveBeenCalledTimes(2);

    delete process.env.ATOMIC_WORKFLOW_DEBUG;
    runtimeParityDebug("phase-disabled-2", { ok: "disabled" });
    expect(debugSpy).toHaveBeenCalledTimes(2);
    expect(debugSpy.mock.calls[1]?.[0]).toBe(
      '[workflow.runtime.parity] phase-workflow {"ok":"workflow"}',
    );

    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
    if (originalWorkflowDebug === undefined) {
      delete process.env.ATOMIC_WORKFLOW_DEBUG;
    } else {
      process.env.ATOMIC_WORKFLOW_DEBUG = originalWorkflowDebug;
    }
    debugSpy.mockRestore();
  });
});
