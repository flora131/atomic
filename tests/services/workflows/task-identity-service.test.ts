import { describe, expect, test, beforeEach } from "bun:test";
import { TaskIdentityService } from "@/services/workflows/task-identity-service.ts";
import type { WorkflowRuntimeTask } from "@/services/workflows/runtime-contracts.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTask(overrides?: Partial<WorkflowRuntimeTask>): WorkflowRuntimeTask {
  return {
    id: "#1",
    title: "Implement identity service",
    status: "pending",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskIdentityService", () => {
  let service: TaskIdentityService;

  beforeEach(() => {
    service = new TaskIdentityService();
  });

  // -----------------------------------------------------------------------
  // backfillTask — basic identity assignment
  // -----------------------------------------------------------------------

  describe("backfillTask", () => {
    test("assigns canonical ID matching the task ID", () => {
      const backfilled = service.backfillTask(createTask({ id: "#42" }));

      expect(backfilled.identity?.canonicalId).toBe("#42");
    });

    test("creates task_id provider binding containing both raw and alias forms", () => {
      const backfilled = service.backfillTask(createTask({ id: "#42" }));

      expect(backfilled.identity?.providerBindings?.task_id).toContain("#42");
      expect(backfilled.identity?.providerBindings?.task_id).toContain("42");
    });

    test("registers task for resolution via alias (# stripped)", () => {
      service.backfillTask(createTask({ id: "#42" }));

      expect(service.resolveCanonicalTaskId("task_id", "42")).toBe("#42");
      expect(service.resolveCanonicalTaskId("task_id", "#42")).toBe("#42");
    });

    test("preserves existing identity metadata", () => {
      const existing: WorkflowRuntimeTask = {
        id: "#5",
        title: "Pre-existing identity",
        status: "pending",
        identity: {
          canonicalId: "#5",
          providerBindings: {
            subagent_id: ["worker-5"],
          },
        },
      };

      const backfilled = service.backfillTask(existing);

      expect(backfilled.identity?.providerBindings?.subagent_id).toContain("worker-5");
      expect(backfilled.identity?.providerBindings?.task_id).toContain("#5");
    });

    test("normalizes whitespace in task ID", () => {
      const backfilled = service.backfillTask(createTask({ id: "  #7  " }));

      expect(backfilled.id).toBe("#7");
      expect(backfilled.identity?.canonicalId).toBe("#7");
    });

    test("handles task ID without # prefix", () => {
      const backfilled = service.backfillTask(createTask({ id: "task-abc" }));

      expect(backfilled.identity?.canonicalId).toBe("task-abc");
      expect(backfilled.identity?.providerBindings?.task_id).toContain("task-abc");
    });

    test("handles numeric-only task ID", () => {
      const backfilled = service.backfillTask(createTask({ id: "99" }));

      expect(backfilled.identity?.canonicalId).toBe("99");
      expect(service.resolveCanonicalTaskId("task_id", "99")).toBe("99");
    });
  });

  // -----------------------------------------------------------------------
  // backfillTasks — batch operations
  // -----------------------------------------------------------------------

  describe("backfillTasks", () => {
    test("handles mixed task snapshots", () => {
      const tasks = service.backfillTasks([
        createTask({ id: "#1" }),
        createTask({ id: "#2", title: "Second", status: "in_progress" }),
      ]);

      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.identity?.canonicalId).toBe("#1");
      expect(tasks[1]?.identity?.canonicalId).toBe("#2");
      expect(service.resolveCanonicalTaskId("task_id", "2")).toBe("#2");
    });

    test("handles empty array", () => {
      const tasks = service.backfillTasks([]);
      expect(tasks).toHaveLength(0);
    });

    test("registers all tasks for resolution", () => {
      service.backfillTasks([
        createTask({ id: "#10" }),
        createTask({ id: "#20" }),
        createTask({ id: "#30" }),
      ]);

      expect(service.resolveCanonicalTaskId("task_id", "10")).toBe("#10");
      expect(service.resolveCanonicalTaskId("task_id", "20")).toBe("#20");
      expect(service.resolveCanonicalTaskId("task_id", "30")).toBe("#30");
    });
  });

  // -----------------------------------------------------------------------
  // bindProviderId — provider binding
  // -----------------------------------------------------------------------

  describe("bindProviderId", () => {
    test("creates provider binding and resolves canonical task id", () => {
      const backfilled = service.backfillTask(createTask());
      const bound = service.bindProviderId(backfilled, "subagent_id", "worker-#1");

      expect(bound.identity?.providerBindings?.subagent_id).toContain("worker-#1");
      expect(service.resolveCanonicalTaskId("subagent_id", "worker-#1")).toBe("#1");
    });

    test("binding operations are idempotent", () => {
      const first = service.bindProviderId(createTask(), "subagent_id", "worker-1");
      const second = service.bindProviderId(first, "subagent_id", "worker-1");

      expect(second.identity?.providerBindings?.subagent_id).toEqual(["worker-1"]);
      expect(service.resolveCanonicalTaskId("subagent_id", "worker-1")).toBe("#1");
    });

    test("allows binding multiple provider IDs to the same task", () => {
      let task = service.backfillTask(createTask({ id: "#3" }));
      task = service.bindProviderId(task, "subagent_id", "worker-a");
      task = service.bindProviderId(task, "subagent_id", "worker-b");

      expect(task.identity?.providerBindings?.subagent_id).toContain("worker-a");
      expect(task.identity?.providerBindings?.subagent_id).toContain("worker-b");
      expect(service.resolveCanonicalTaskId("subagent_id", "worker-a")).toBe("#3");
      expect(service.resolveCanonicalTaskId("subagent_id", "worker-b")).toBe("#3");
    });

    test("allows binding different providers to the same task", () => {
      let task = service.backfillTask(createTask({ id: "#4" }));
      task = service.bindProviderId(task, "subagent_id", "worker-x");
      task = service.bindProviderId(task, "session_id", "session-abc");

      expect(service.resolveCanonicalTaskId("subagent_id", "worker-x")).toBe("#4");
      expect(service.resolveCanonicalTaskId("session_id", "session-abc")).toBe("#4");
    });

    test("normalizes provider name to lowercase", () => {
      const task = service.backfillTask(createTask({ id: "#5" }));
      service.bindProviderId(task, "SubAgent_ID", "worker-z");

      expect(service.resolveCanonicalTaskId("subagent_id", "worker-z")).toBe("#5");
    });

    test("trims whitespace from provider ID value", () => {
      const task = service.backfillTask(createTask({ id: "#6" }));
      service.bindProviderId(task, "subagent_id", "  worker-y  ");

      expect(service.resolveCanonicalTaskId("subagent_id", "worker-y")).toBe("#6");
    });

    test("ignores empty provider name", () => {
      const task = service.backfillTask(createTask({ id: "#7" }));
      const bound = service.bindProviderId(task, "", "worker-q");

      // Empty provider should be ignored; no binding created for it
      expect(service.resolveCanonicalTaskId("", "worker-q")).toBeNull();
      // But task_id bindings should still work
      expect(service.resolveCanonicalTaskId("task_id", "#7")).toBe("#7");
    });

    test("ignores empty provider ID value", () => {
      const task = service.backfillTask(createTask({ id: "#8" }));
      const bound = service.bindProviderId(task, "subagent_id", "");

      expect(service.resolveCanonicalTaskId("subagent_id", "")).toBeNull();
    });

    test("ignores whitespace-only provider ID value", () => {
      const task = service.backfillTask(createTask({ id: "#9" }));
      service.bindProviderId(task, "subagent_id", "   ");

      expect(service.resolveCanonicalTaskId("subagent_id", "   ")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // resolveCanonicalTaskId — resolution
  // -----------------------------------------------------------------------

  describe("resolveCanonicalTaskId", () => {
    test("returns null for unregistered provider binding", () => {
      expect(service.resolveCanonicalTaskId("subagent_id", "nonexistent")).toBeNull();
    });

    test("returns null for empty provider", () => {
      expect(service.resolveCanonicalTaskId("", "some-id")).toBeNull();
    });

    test("returns null for empty provider ID", () => {
      expect(service.resolveCanonicalTaskId("subagent_id", "")).toBeNull();
    });

    test("resolves via task_id alias with # prefix stripped", () => {
      service.backfillTask(createTask({ id: "#100" }));

      expect(service.resolveCanonicalTaskId("task_id", "100")).toBe("#100");
      expect(service.resolveCanonicalTaskId("task_id", "#100")).toBe("#100");
    });

    test("does not resolve via alias for non-task_id providers", () => {
      service.backfillTask(createTask({ id: "#50" }));

      // Without explicit binding, non-task_id providers cannot resolve
      expect(service.resolveCanonicalTaskId("subagent_id", "50")).toBeNull();
    });

    test("resolves case-insensitive provider names", () => {
      const task = service.backfillTask(createTask({ id: "#11" }));
      service.bindProviderId(task, "SubAgent_ID", "worker-case");

      expect(service.resolveCanonicalTaskId("SUBAGENT_ID", "worker-case")).toBe("#11");
      expect(service.resolveCanonicalTaskId("subagent_id", "worker-case")).toBe("#11");
    });

    test("first binding wins when same provider ID bound to different tasks", () => {
      service.backfillTask(createTask({ id: "#A" }));
      service.backfillTask(createTask({ id: "#B" }));

      // Bind same provider ID to task A, then to task B
      const taskA = service.backfillTask(createTask({ id: "#A" }));
      service.bindProviderId(taskA, "subagent_id", "shared-worker");

      const taskB = service.backfillTask(createTask({ id: "#B" }));
      service.bindProviderId(taskB, "subagent_id", "shared-worker");

      // First registration wins
      expect(service.resolveCanonicalTaskId("subagent_id", "shared-worker")).toBe("#A");
    });
  });

  // -----------------------------------------------------------------------
  // Cross-cutting: independent service instances
  // -----------------------------------------------------------------------

  describe("isolation", () => {
    test("separate service instances have independent state", () => {
      const service1 = new TaskIdentityService();
      const service2 = new TaskIdentityService();

      const task1 = service1.backfillTask(createTask({ id: "#X" }));
      service1.bindProviderId(task1, "subagent_id", "worker-x");

      // service2 should not be able to resolve service1's bindings
      expect(service2.resolveCanonicalTaskId("subagent_id", "worker-x")).toBeNull();
      expect(service1.resolveCanonicalTaskId("subagent_id", "worker-x")).toBe("#X");
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases: pre-existing provider bindings with duplicates
  // -----------------------------------------------------------------------

  describe("providerBindings deduplication", () => {
    test("deduplicates provider bindings from existing identity", () => {
      const task: WorkflowRuntimeTask = {
        id: "#D",
        title: "Dedup test",
        status: "pending",
        identity: {
          canonicalId: "#D",
          providerBindings: {
            subagent_id: ["worker-d", "worker-d", "worker-d"],
          },
        },
      };

      const backfilled = service.backfillTask(task);
      expect(backfilled.identity?.providerBindings?.subagent_id).toEqual(["worker-d"]);
    });

    test("filters empty strings from provider binding arrays", () => {
      const task: WorkflowRuntimeTask = {
        id: "#E",
        title: "Empty filter test",
        status: "pending",
        identity: {
          canonicalId: "#E",
          providerBindings: {
            subagent_id: ["", "  ", "worker-e"],
          },
        },
      };

      const backfilled = service.backfillTask(task);
      expect(backfilled.identity?.providerBindings?.subagent_id).toEqual(["worker-e"]);
    });
  });
});
