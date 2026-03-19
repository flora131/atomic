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
