import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  normalizeWorkflowRuntimeTaskStatus,
  resolveWorkflowRuntimeFeatureFlags,
  toWorkflowRuntimeTask,
  workflowRuntimeStrictTaskSchema,
} from "@/services/workflows/runtime-contracts.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";

describe("runtime-contracts", () => {
  test("emits parity metrics when normalizing runtime tasks", () => {
    resetRuntimeParityMetrics();
    toWorkflowRuntimeTask(
      {
        id: "#m1",
        title: "Metrics",
        status: "completed",
      },
      () => "fallback-id",
    );

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.task_normalized_total{path=schema_parse}"]).toBe(1);
    expect(metrics.histograms["workflow.runtime.parity.task_blocked_by_count{path=schema_parse}"]).toEqual([0]);
  });

  test("normalizes canonical task statuses and defaults unknown to pending", () => {
    expect(normalizeWorkflowRuntimeTaskStatus("completed")).toBe("completed");
    expect(normalizeWorkflowRuntimeTaskStatus("in_progress")).toBe("in_progress");
    expect(normalizeWorkflowRuntimeTaskStatus("in progress")).toBe("in_progress");
    expect(normalizeWorkflowRuntimeTaskStatus("failed")).toBe("failed");
    expect(normalizeWorkflowRuntimeTaskStatus("done")).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus("failure")).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus("unexpected-value")).toBe("pending");
  });

  test("normalizes task objects into canonical runtime task shape", () => {
    const task = toWorkflowRuntimeTask(
      {
        content: "Implement contract",
        status: "completed",
        blockedBy: ["#1", "", null],
      },
      () => "generated-id",
    );

    expect(task).toEqual({
      id: "generated-id",
      title: "Implement contract",
      status: "completed",
      blockedBy: ["#1"],
      error: undefined,
      identity: {
        canonicalId: "generated-id",
        providerBindings: undefined,
      },
      taskResult: undefined,
    });
  });

  test("normalizes task result envelopes on runtime tasks", () => {
    const task = toWorkflowRuntimeTask(
      {
        id: "#4",
        title: "Ship formatter",
        status: "completed",
        identity: {
          canonicalId: "#4",
          providerBindings: {
            subagent_id: ["worker-4"],
          },
        },
        taskResult: {
          task_id: "#4",
          tool_name: "task",
          title: "Ship formatter",
          metadata: {
            sessionId: "session-1",
            providerBindings: {
              subagent_id: "worker-4",
            },
          },
          status: "completed",
          output_text: "done",
          envelope_text: "task_id: #4",
        },
      },
      () => "fallback-id",
    );

    expect(task.taskResult).toEqual({
      task_id: "#4",
      tool_name: "task",
      title: "Ship formatter",
      metadata: {
        sessionId: "session-1",
        providerBindings: {
          subagent_id: "worker-4",
        },
      },
      status: "completed",
      output_text: "done",
      envelope_text: "task_id: #4",
    });

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.task_result_normalized_total{status=completed}"]).toBe(1);
    expect(metrics.gauges["workflow.runtime.parity.task_result_provider_bindings{taskId=#4}"]).toBe(1);
  });

  test("fails fast on task result envelope identity mismatch", () => {
    resetRuntimeParityMetrics();

    expect(() => toWorkflowRuntimeTask(
      {
        id: "#4",
        title: "Mismatched envelope",
        status: "completed",
        identity: {
          canonicalId: "#4",
          providerBindings: {
            subagent_id: ["worker-4"],
          },
        },
        taskResult: {
          task_id: "#4",
          tool_name: "task",
          title: "Mismatched envelope",
          metadata: {
            providerBindings: {
              subagent_id: "other-worker",
            },
          },
          status: "completed",
          output_text: "done",
        },
      },
      () => "fallback-id",
    )).toThrow("provider binding mismatch");

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.task_result_invariant_failures_total{provider=subagent_id,reason=provider_binding_mismatch}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.task_result_normalization_failures_total{reason=invalid_envelope}"]).toBe(1);
  });

  test("fails fast on task_result task_id mismatch", () => {
    resetRuntimeParityMetrics();

    expect(() =>
      toWorkflowRuntimeTask(
        {
          id: "#4",
          title: "Mismatched task id",
          status: "completed",
          identity: {
            canonicalId: "#4",
          },
          taskResult: {
            task_id: "#5",
            tool_name: "task",
            title: "Mismatched task id",
            status: "completed",
            output_text: "done",
          },
        },
        () => "fallback-id",
      )).toThrow("task_id mismatch");

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.task_result_invariant_failures_total{reason=task_id_mismatch}"]).toBe(1);
    expect(metrics.counters["workflow.runtime.parity.task_result_normalization_failures_total{reason=invalid_envelope}"]).toBe(1);
  });

  test("strict schema accepts canonical statuses only", () => {
    expect(() =>
      workflowRuntimeStrictTaskSchema.parse({
        id: "task-1",
        title: "Implement",
        status: "completed",
      }),
    ).not.toThrow();

    expect(() =>
      workflowRuntimeStrictTaskSchema.parse({
        id: "task-2",
        title: "Implement",
        status: "not_a_status",
      }),
    ).toThrow();
  });

  test("feature flag resolver merges overrides in order", () => {
    const resolved = resolveWorkflowRuntimeFeatureFlags(
      { emitTaskStatusEvents: false },
      { strictTaskContract: true },
    );

    expect(resolved).toEqual({
      ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
      emitTaskStatusEvents: false,
      strictTaskContract: true,
    });
  });

  test("enables strict task contract by default", () => {
    const resolved = resolveWorkflowRuntimeFeatureFlags();
    expect(resolved.strictTaskContract).toBe(true);
  });
});
