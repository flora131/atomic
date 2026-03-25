import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { persistWorkflowTasksToDisk } from "@/services/workflows/helpers/persist-workflow-tasks.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTodoItem(overrides: Partial<NormalizedTodoItem> = {}): NormalizedTodoItem {
  return {
    id: "#1",
    description: "Implement feature",
    status: "pending",
    blockedBy: [],
    summary: "Implementing feature",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// persistWorkflowTasksToDisk
// ---------------------------------------------------------------------------

describe("persistWorkflowTasksToDisk", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
    cleanupDirs.length = 0;
  });

  test("writes tasks.json to the session directory after debounce", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "persist-test-"));
    cleanupDirs.push(sessionDir);

    const tasks = [
      makeTodoItem({ id: "#1", description: "Task one" }),
      makeTodoItem({ id: "#2", description: "Task two", status: "completed" }),
    ];

    persistWorkflowTasksToDisk(sessionDir, tasks);

    // Wait for the debounce timer (80ms) plus buffer
    await new Promise((resolve) => setTimeout(resolve, 200));

    const tasksPath = join(sessionDir, "tasks.json");
    const file = Bun.file(tasksPath);
    expect(await file.exists()).toBe(true);

    const written = JSON.parse(await file.text());
    expect(written).toHaveLength(2);
    expect(written[0].id).toBe("#1");
    expect(written[0].description).toBe("Task one");
    expect(written[1].id).toBe("#2");
    expect(written[1].status).toBe("completed");
  });

  test("coalesces rapid successive calls into a single write", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "coalesce-test-"));
    cleanupDirs.push(sessionDir);

    const tasksV1 = [makeTodoItem({ id: "#1", description: "Version 1" })];
    const tasksV2 = [makeTodoItem({ id: "#1", description: "Version 2" })];
    const tasksV3 = [makeTodoItem({ id: "#1", description: "Version 3" })];

    // Call three times rapidly -- only the last should be written
    persistWorkflowTasksToDisk(sessionDir, tasksV1);
    persistWorkflowTasksToDisk(sessionDir, tasksV2);
    persistWorkflowTasksToDisk(sessionDir, tasksV3);

    // Wait for the debounce timer
    await new Promise((resolve) => setTimeout(resolve, 200));

    const tasksPath = join(sessionDir, "tasks.json");
    const written = JSON.parse(await Bun.file(tasksPath).text());
    expect(written[0].description).toBe("Version 3");
  });

  test("writes prettified JSON with 2-space indentation", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "pretty-test-"));
    cleanupDirs.push(sessionDir);

    const tasks = [makeTodoItem({ id: "#1", description: "Pretty task" })];
    persistWorkflowTasksToDisk(sessionDir, tasks);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const raw = await Bun.file(join(sessionDir, "tasks.json")).text();
    // Should be indented (not minified)
    expect(raw).toContain("  ");
    // Should be valid JSON
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("writes empty array for empty task list", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "empty-test-"));
    cleanupDirs.push(sessionDir);

    persistWorkflowTasksToDisk(sessionDir, []);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const written = JSON.parse(
      await Bun.file(join(sessionDir, "tasks.json")).text(),
    );
    expect(written).toEqual([]);
  });
});
