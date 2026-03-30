/**
 * File-system watcher for tasks.json in a workflow session directory.
 *
 * DEPRECATION NOTE (2026-03-30): This watcher is retained as a fallback for
 * the `TaskListPanel` when the event bus is not available. The primary data
 * source for task updates in the Ralph workflow is now the "workflow:tasks-updated"
 * bus event emitted by the `task_list` tool. Once bus-only UI updates are fully
 * validated and all legacy TodoWrite consumers are migrated, this watcher and
 * the corresponding `persistWorkflowTasksToDisk` writer can be removed together.
 */

import { readFile } from "fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join } from "path";
import {
  normalizeTodoItems,
  type NormalizedTodoItem,
} from "@/state/parts/helpers/task-status.ts";

export function watchTasksJson(
  sessionDir: string,
  onUpdate: (items: NormalizedTodoItem[]) => void,
  deps?: {
    watchImpl?: (
      filename: string,
      listener:
        | ((
            eventType: string,
            filename: string | Buffer | null,
          ) => void)
        | ((
            eventType: string,
            filename: string | Buffer | null,
          ) => Promise<void>),
    ) => FSWatcher;
    readFileImpl?: (
      path: string,
      encoding: BufferEncoding,
    ) => Promise<string>;
  },
): () => void {
  const tasksPath = join(sessionDir, "tasks.json");
  const watchImpl = deps?.watchImpl ?? watch;
  const readFileImpl = deps?.readFileImpl ?? readFile;
  let disposed = false;
  let latestReadToken = 0;

  const isTasksJsonEvent = (filename: string | Buffer | null): boolean => {
    if (filename == null) return true;
    const normalized =
      typeof filename === "string"
        ? filename
        : filename.toString("utf-8");
    return normalized === "tasks.json";
  };

  const refresh = async (): Promise<void> => {
    const readToken = ++latestReadToken;
    try {
      const content = await readFileImpl(tasksPath, "utf-8");
      const tasks = normalizeTodoItems(JSON.parse(content));
      if (disposed || readToken !== latestReadToken) return;
      onUpdate(tasks);
    } catch {
      // File may not exist yet or be mid-write; ignore.
    }
  };

  const watcher = watchImpl(sessionDir, async (_eventType, filename) => {
    if (!isTasksJsonEvent(filename)) return;
    await refresh();
  });

  void refresh();

  return () => {
    disposed = true;
    watcher.close();
  };
}
