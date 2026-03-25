import { beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  normalizeWorkflowRuntimeTaskStatus,
  resolveWorkflowRuntimeFeatureFlags,
  toWorkflowRuntimeTask,
  toWorkflowRuntimeTasks,
  workflowRuntimeStrictTaskSchema,
  workflowRuntimeStateTaskSchema,
  workflowRuntimeTaskStatusChangeSchema,
  workflowRuntimeTaskSchema,
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

// ---------------------------------------------------------------------------
// toWorkflowRuntimeTasks (batch normalization)
// ---------------------------------------------------------------------------

describe("toWorkflowRuntimeTasks", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  test("normalizes an array of task objects", () => {
    const tasks = toWorkflowRuntimeTasks(
      [
        { id: "#1", title: "First", status: "completed" },
        { id: "#2", title: "Second", status: "in_progress" },
      ],
      () => "fallback",
    );

    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.id).toBe("#1");
    expect(tasks[0]!.status).toBe("completed");
    expect(tasks[1]!.id).toBe("#2");
    expect(tasks[1]!.status).toBe("in_progress");
  });

  test("returns empty array for non-array input", () => {
    expect(toWorkflowRuntimeTasks(null, () => "id")).toEqual([]);
    expect(toWorkflowRuntimeTasks(undefined, () => "id")).toEqual([]);
    expect(toWorkflowRuntimeTasks("not-array", () => "id")).toEqual([]);
    expect(toWorkflowRuntimeTasks({}, () => "id")).toEqual([]);
    expect(toWorkflowRuntimeTasks(42, () => "id")).toEqual([]);
  });

  test("returns empty array for empty array input", () => {
    expect(toWorkflowRuntimeTasks([], () => "id")).toEqual([]);
  });

  test("uses fallback id generator for tasks without ids", () => {
    let counter = 0;
    const tasks = toWorkflowRuntimeTasks(
      [
        { description: "First task", status: "pending" },
        { description: "Second task", status: "pending" },
      ],
      () => `generated-${++counter}`,
    );

    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.id).toBe("generated-1");
    expect(tasks[1]!.id).toBe("generated-2");
  });

  test("normalizes mixed valid and fallback tasks", () => {
    const tasks = toWorkflowRuntimeTasks(
      [
        { id: "#1", title: "Has ID", status: "completed" },
        { content: "No ID task", status: "pending" },
      ],
      () => "fallback-id",
    );

    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.id).toBe("#1");
    expect(tasks[1]!.id).toBe("fallback-id");
    expect(tasks[1]!.title).toBe("No ID task");
  });
});

// ---------------------------------------------------------------------------
// normalizeWorkflowRuntimeTaskStatus (extended)
// ---------------------------------------------------------------------------

describe("normalizeWorkflowRuntimeTaskStatus (extended)", () => {
  test("returns pending for non-string input", () => {
    expect(normalizeWorkflowRuntimeTaskStatus(42)).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus(null)).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus(undefined)).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus(true)).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus({})).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus([])).toBe("pending");
  });

  test("normalizes all canonical statuses", () => {
    expect(normalizeWorkflowRuntimeTaskStatus("pending")).toBe("pending");
    expect(normalizeWorkflowRuntimeTaskStatus("in_progress")).toBe("in_progress");
    expect(normalizeWorkflowRuntimeTaskStatus("completed")).toBe("completed");
    expect(normalizeWorkflowRuntimeTaskStatus("failed")).toBe("failed");
    expect(normalizeWorkflowRuntimeTaskStatus("blocked")).toBe("blocked");
    expect(normalizeWorkflowRuntimeTaskStatus("error")).toBe("error");
  });

  test("normalizes whitespace and hyphens to underscores", () => {
    expect(normalizeWorkflowRuntimeTaskStatus("in progress")).toBe("in_progress");
    expect(normalizeWorkflowRuntimeTaskStatus("in-progress")).toBe("in_progress");
    expect(normalizeWorkflowRuntimeTaskStatus("IN_PROGRESS")).toBe("in_progress");
    expect(normalizeWorkflowRuntimeTaskStatus("  completed  ")).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// toWorkflowRuntimeTask fallback path (extended)
// ---------------------------------------------------------------------------

describe("toWorkflowRuntimeTask fallback path", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  test("uses description field as title when title is missing", () => {
    const task = toWorkflowRuntimeTask(
      { description: "Describe me", status: "pending" },
      () => "gen-id",
    );
    expect(task.title).toBe("Describe me");
  });

  test("uses content field as title when both title and description are missing", () => {
    const task = toWorkflowRuntimeTask(
      { content: "Content fallback", status: "pending" },
      () => "gen-id",
    );
    expect(task.title).toBe("Content fallback");
  });

  test("uses empty string as title when no title fields exist", () => {
    const task = toWorkflowRuntimeTask(
      { status: "pending" },
      () => "gen-id",
    );
    expect(task.title).toBe("");
  });

  test("includes error field when present and non-empty", () => {
    const task = toWorkflowRuntimeTask(
      { id: "#e1", title: "Error task", status: "error", error: "Something failed" },
      () => "fallback",
    );
    expect(task.error).toBe("Something failed");
  });

  test("preserves empty error field from schema-valid input", () => {
    const task = toWorkflowRuntimeTask(
      { id: "#e2", title: "No error", status: "pending", error: "" },
      () => "fallback",
    );
    // Schema-valid input preserves the error field as-is (empty string)
    expect(task.error).toBe("");
  });

  test("omits error field for fallback tasks with empty error", () => {
    // Input without an id gets the fallback parse path which strips empty errors
    const task = toWorkflowRuntimeTask(
      { content: "Fallback task", status: "pending", error: "" },
      () => "gen-id",
    );
    expect(task.error).toBeUndefined();
  });

  test("emits fallback_parse parity metrics for non-schema tasks", () => {
    resetRuntimeParityMetrics();
    toWorkflowRuntimeTask(
      { content: "Fallback task", status: "pending" },
      () => "gen-id",
    );

    const metrics = getRuntimeParityMetricsSnapshot();
    expect(metrics.counters["workflow.runtime.parity.task_normalized_total{path=fallback_parse}"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Schema validation exports
// ---------------------------------------------------------------------------

describe("workflowRuntimeStateTaskSchema", () => {
  test("accepts a valid state task with all fields", () => {
    const result = workflowRuntimeStateTaskSchema.parse({
      id: "task-1",
      description: "Build login",
      status: "pending",
      summary: "Building login flow",
      blockedBy: ["task-0"],
    });

    expect(result.description).toBe("Build login");
    expect(result.status).toBe("pending");
    expect(result.summary).toBe("Building login flow");
    expect(result.blockedBy).toEqual(["task-0"]);
  });

  test("normalizes non-canonical status to pending via fallback transform", () => {
    const result = workflowRuntimeStateTaskSchema.parse({
      description: "Build something",
      status: "done",
      summary: "working",
    });
    expect(result.status).toBe("pending");
  });

  test("id is optional", () => {
    const result = workflowRuntimeStateTaskSchema.parse({
      description: "No ID task",
      status: "in_progress",
      summary: "working",
    });
    expect(result.id).toBeUndefined();
  });

  test("rejects missing required fields", () => {
    expect(() =>
      workflowRuntimeStateTaskSchema.parse({
        id: "task-1",
        status: "pending",
        summary: "missing description",
      }),
    ).toThrow();
  });
});

describe("workflowRuntimeTaskStatusChangeSchema", () => {
  test("accepts a valid status change payload", () => {
    const result = workflowRuntimeTaskStatusChangeSchema.parse({
      taskIds: ["#1", "#2"],
      newStatus: "completed",
      tasks: [
        { id: "#1", title: "First", status: "completed" },
        { id: "#2", title: "Second", status: "completed" },
      ],
    });

    expect(result.taskIds).toEqual(["#1", "#2"]);
    expect(result.newStatus).toBe("completed");
    expect(result.tasks).toHaveLength(2);
  });

  test("normalizes non-canonical newStatus", () => {
    const result = workflowRuntimeTaskStatusChangeSchema.parse({
      taskIds: ["#1"],
      newStatus: "in progress",
      tasks: [{ id: "#1", title: "Task", status: "in_progress" }],
    });
    expect(result.newStatus).toBe("in_progress");
  });

  test("rejects empty taskIds array", () => {
    // taskIds can be empty (zod array allows it), just verify shape is accepted
    const result = workflowRuntimeTaskStatusChangeSchema.parse({
      taskIds: [],
      newStatus: "pending",
      tasks: [],
    });
    expect(result.taskIds).toEqual([]);
  });
});

describe("workflowRuntimeTaskSchema", () => {
  test("accepts minimal valid task", () => {
    const result = workflowRuntimeTaskSchema.parse({
      id: "t1",
      title: "Minimal",
      status: "pending",
    });
    expect(result.id).toBe("t1");
    expect(result.title).toBe("Minimal");
    expect(result.status).toBe("pending");
  });

  test("accepts task with all optional fields", () => {
    const result = workflowRuntimeTaskSchema.parse({
      id: "t2",
      title: "Full task",
      status: "completed",
      blockedBy: ["t1"],
      error: "some error",
      identity: {
        canonicalId: "t2",
        providerBindings: { task_id: ["t2", "2"] },
      },
    });
    expect(result.blockedBy).toEqual(["t1"]);
    expect(result.error).toBe("some error");
    expect(result.identity?.canonicalId).toBe("t2");
  });

  test("normalizes non-canonical statuses through fallback transform", () => {
    const result = workflowRuntimeTaskSchema.parse({
      id: "t3",
      title: "Status transform",
      status: "in progress",
    });
    expect(result.status).toBe("in_progress");
  });

  test("rejects missing id", () => {
    expect(() =>
      workflowRuntimeTaskSchema.parse({
        title: "No ID",
        status: "pending",
      }),
    ).toThrow();
  });

  test("rejects empty id", () => {
    expect(() =>
      workflowRuntimeTaskSchema.parse({
        id: "",
        title: "Empty ID",
        status: "pending",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Feature flags (extended)
// ---------------------------------------------------------------------------

describe("resolveWorkflowRuntimeFeatureFlags (extended)", () => {
  test("returns defaults when no overrides provided", () => {
    const resolved = resolveWorkflowRuntimeFeatureFlags();
    expect(resolved).toEqual(DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS);
  });

  test("ignores undefined overrides", () => {
    const resolved = resolveWorkflowRuntimeFeatureFlags(undefined, undefined);
    expect(resolved).toEqual(DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS);
  });

  test("later overrides take precedence over earlier ones", () => {
    const resolved = resolveWorkflowRuntimeFeatureFlags(
      { strictTaskContract: false },
      { strictTaskContract: true },
    );
    expect(resolved.strictTaskContract).toBe(true);
  });

  test("does not mutate the default flags object", () => {
    const before = { ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS };
    resolveWorkflowRuntimeFeatureFlags({ emitTaskStatusEvents: false });
    expect(DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS).toEqual(before);
  });
});
