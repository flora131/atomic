/**
 * Persist Workflow Tasks to Disk
 *
 * Service-layer utility that writes NormalizedTodoItem[] to tasks.json
 * in the workflow session directory. Uses atomic write (temp + rename)
 * to prevent partial reads by the file watcher.
 *
 * This module is intentionally kept in the services layer so that the
 * state layer (use-tool-events.ts) can import it without violating the
 * layered architecture constraints.
 *
 * DEPRECATION NOTE (2026-03-30): This function is a candidate for removal
 * once bus-only UI updates are fully validated. The Ralph workflow now uses
 * the SQLite-backed `task_list` tool, which persists tasks to workflow.db
 * and publishes "workflow.tasks.updated" bus events directly. This file-based
 * persistence is only retained for the TodoWrite code path used by non-Ralph
 * contexts and as a fallback for the TaskListPanel file watcher
 * (`watchTasksJson`). Once all consumers subscribe to bus events exclusively,
 * this function and the tasks.json file watcher can be removed together.
 */

import { join } from "path";
import { rename, unlink } from "fs/promises";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

async function atomicWrite(
  targetPath: string,
  content: string,
): Promise<void> {
  const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
  const tempPath = join(dir, `.tasks-${crypto.randomUUID()}.tmp`);

  try {
    await Bun.write(tempPath, content);
    await rename(tempPath, targetPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors.
    }
    throw error;
  }
}

/**
 * Persist workflow tasks to tasks.json in the given session directory.
 *
 * Fire-and-forget: errors are logged but do not throw.
 * Debounced internally — rapid successive calls coalesce into a single write.
 *
 * @deprecated Candidate for removal — see module-level deprecation note.
 * Only used by the TodoWrite code path in use-tool-events.ts.
 */
let pendingWrite: { timer: ReturnType<typeof setTimeout>; tasks: NormalizedTodoItem[]; sessionDir: string } | null = null;

export function persistWorkflowTasksToDisk(
  sessionDir: string,
  tasks: NormalizedTodoItem[],
): void {
  // Coalesce rapid writes with a short debounce
  if (pendingWrite?.timer) {
    clearTimeout(pendingWrite.timer);
  }

  pendingWrite = {
    tasks,
    sessionDir,
    timer: setTimeout(async () => {
      const snapshot = pendingWrite;
      pendingWrite = null;
      if (!snapshot) return;

      const tasksPath = join(snapshot.sessionDir, "tasks.json");
      try {
        const content = JSON.stringify(snapshot.tasks, null, 2);
        await atomicWrite(tasksPath, content);
      } catch (error) {
        console.error("[workflow] Failed to persist tasks.json from TodoWrite:", error);
      }
    }, 80),
  };
}
