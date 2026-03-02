import { describe, expect, test } from "bun:test";
import { TaskIdentityService } from "./task-identity-service.ts";
import type { WorkflowRuntimeTask } from "./runtime-contracts.ts";

function createTask(overrides?: Partial<WorkflowRuntimeTask>): WorkflowRuntimeTask {
  return {
    id: "#1",
    title: "Implement identity service",
    status: "pending",
    ...overrides,
  };
}

describe("TaskIdentityService", () => {
  test("creates provider binding and resolves canonical task id", () => {
    const service = new TaskIdentityService();

    const backfilled = service.backfillTask(createTask());
    const bound = service.bindProviderId(backfilled, "subagent_id", "worker-#1");

    expect(bound.identity?.providerBindings?.subagent_id).toEqual(["worker-#1"]);
    expect(service.resolveCanonicalTaskId("subagent_id", "worker-#1")).toBe("#1");
  });

  test("backfills legacy tasks without identity metadata", () => {
    const service = new TaskIdentityService();

    const backfilled = service.backfillTask(createTask({ id: "#42", identity: undefined }));

    expect(backfilled.identity?.canonicalId).toBe("#42");
    expect(backfilled.identity?.providerBindings?.task_id).toContain("#42");
    expect(backfilled.identity?.providerBindings?.task_id).toContain("42");
    expect(service.resolveCanonicalTaskId("task_id", "42")).toBe("#42");
  });

  test("binding operations are idempotent", () => {
    const service = new TaskIdentityService();

    const first = service.bindProviderId(createTask(), "subagent_id", "worker-1");
    const second = service.bindProviderId(first, "subagent_id", "worker-1");

    expect(second.identity?.providerBindings?.subagent_id).toEqual(["worker-1"]);
    expect(service.resolveCanonicalTaskId("subagent_id", "worker-1")).toBe("#1");
  });

  test("backfillTasks handles mixed task snapshots", () => {
    const service = new TaskIdentityService();
    const tasks = service.backfillTasks([
      createTask({ id: "#1" }),
      createTask({ id: "#2", title: "Second", status: "in_progress" }),
    ]);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.identity?.canonicalId).toBe("#1");
    expect(tasks[1]?.identity?.canonicalId).toBe("#2");
    expect(service.resolveCanonicalTaskId("task_id", "2")).toBe("#2");
  });
});
