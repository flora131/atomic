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
