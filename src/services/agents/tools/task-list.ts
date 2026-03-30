/**
 * TaskList Tool Definition
 *
 * Provides a task_list tool for the Ralph workflow that uses SQLite (via bun:sqlite)
 * for persistence and emits events via a callback for real-time UI updates.
 *
 * Replaces the prompt-driven TodoWrite approach with a dedicated CRUD tool
 * registered via CodingAgentClient.registerTool(), automatically bridged
 * to all three SDKs (Claude, OpenCode, Copilot).
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import type { ToolDefinition } from "@/services/agents/types.ts";

export interface TaskItem {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "error";
  summary: string;
  blockedBy?: string[];
}

export interface TaskListToolConfig {
  workflowName: string;
  sessionId: string;
  sessionDir: string;
  emitTaskUpdate?: (tasks: TaskItem[]) => void;
}

/**
 * Extended ToolDefinition that exposes a close() method for explicit
 * database resource cleanup. Callers should invoke close() when the
 * workflow session ends to release the underlying SQLite connection.
 */
export interface TaskListTool extends ToolDefinition {
  close: () => void;
}

/**
 * JSON Schema for the task_list tool input.
 * Uses an `action` discriminator to dispatch to the correct CRUD handler.
 */
const taskListInputSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "create_tasks",
        "list_tasks",
        "update_task_status",
        "add_task",
        "update_task_progress",
        "get_task_progress",
        "delete_task",
      ],
      description: "The CRUD operation to perform",
    },
    tasks: {
      type: "array",
      description: "Array of task objects (for create_tasks)",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "error"],
          },
          summary: { type: "string" },
          blockedBy: { type: "array", items: { type: "string" } },
        },
        required: ["id", "description", "status", "summary"],
      },
    },
    taskId: {
      type: "string",
      description: "ID of the task to operate on",
    },
    status: {
      type: "string",
      enum: ["pending", "in_progress", "completed", "error"],
    },
    task: {
      type: "object",
      description: "A single task object (for add_task)",
      properties: {
        id: { type: "string" },
        description: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "error"],
        },
        summary: { type: "string" },
        blockedBy: { type: "array", items: { type: "string" } },
      },
      required: ["id", "description", "status", "summary"],
    },
    progress: {
      type: "string",
      description: "Progress text to append (for update_task_progress)",
    },
  },
  required: ["action"],
} as const;

/**
 * Create a task_list tool definition backed by a session-scoped SQLite database.
 *
 * The factory captures workflowName, sessionId, and sessionDir in a closure.
 * It opens a SQLite database in WAL mode at {sessionDir}/workflow.db,
 * creates the tasks and progress tables, and prepares all SQL statements upfront.
 *
 * On every task mutation, the optional emitTaskUpdate callback is invoked
 * with the current task list for real-time UI updates via the event bus.
 */
export function createTaskListTool(config: TaskListToolConfig): TaskListTool {
  const dbPath = join(config.sessionDir, "workflow.db");
  const db = new Database(dbPath);
  let closed = false;

  // Enable WAL mode for concurrent read/write performance
  db.run("PRAGMA journal_mode = WAL;");

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'error')),
      summary TEXT NOT NULL,
      blocked_by TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      entry TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_progress_task_id ON progress(task_id);`
  );

  // Prepared statements for performance
  const insertTask = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, description, status, summary, blocked_by, created_at, updated_at)
     VALUES ($id, $description, $status, $summary, $blocked_by, datetime('now'), datetime('now'))`
  );

  const updateStatus = db.prepare(
    "UPDATE tasks SET status = $status, updated_at = datetime('now') WHERE id = $id"
  );

  const selectAllTasks = db.prepare("SELECT * FROM tasks");

  const selectTask = db.prepare("SELECT * FROM tasks WHERE id = $id");

  const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = $id");

  const deleteProgressForTask = db.prepare(
    "DELETE FROM progress WHERE task_id = $task_id"
  );

  const insertProgress = db.prepare(
    "INSERT INTO progress (task_id, entry) VALUES ($task_id, $entry)"
  );

  const selectProgress = db.prepare(
    "SELECT entry, created_at FROM progress WHERE task_id = $task_id ORDER BY created_at"
  );

  const selectAllProgress = db.prepare(
    "SELECT task_id, entry, created_at FROM progress ORDER BY created_at"
  );

  /** Convert a DB row to a TaskItem */
  function rowToTaskItem(row: Record<string, unknown>): TaskItem {
    return {
      id: row.id as string,
      description: row.description as string,
      status: row.status as TaskItem["status"],
      summary: row.summary as string,
      blockedBy: JSON.parse((row.blocked_by as string) || "[]") as string[],
    };
  }

  /** Read all tasks from DB and emit event for UI updates (best-effort) */
  function syncAndNotify(): TaskItem[] {
    const rows = selectAllTasks.all() as Record<string, unknown>[];
    const tasks = rows.map(rowToTaskItem);
    try {
      config.emitTaskUpdate?.(tasks);
    } catch {
      // UI updates are best-effort; do not fail the tool call
    }
    return tasks;
  }

  /** Build a status summary string from a list of tasks */
  function buildStatusSummary(tasks: TaskItem[]): string {
    const done = tasks.filter((t) => t.status === "completed").length;
    const inProg = tasks.filter((t) => t.status === "in_progress").length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const errored = tasks.filter((t) => t.status === "error").length;
    return `${tasks.length} tasks: ${done} done, ${inProg} in progress, ${pending} pending, ${errored} error`;
  }

  return {
    name: "task_list",
    description:
      "Manage workflow tasks with CRUD operations. Supports: create_tasks (batch create), " +
      "list_tasks (view all), update_task_status (change status), add_task (add one), " +
      "update_task_progress (append progress note), get_task_progress (read progress), " +
      "delete_task (remove). All mutations persist to SQLite and emit UI update events.",
    inputSchema: taskListInputSchema as unknown as Record<string, unknown>,

    close: () => {
      if (!closed) {
        closed = true;
        db.close();
      }
    },

    handler: (input: Record<string, unknown>): Record<string, unknown> => {
      if (closed) {
        return { error: "task_list tool has been closed" };
      }
      const action = input.action as string;

      switch (action) {
        case "create_tasks": {
          const tasks = input.tasks as TaskItem[] | undefined;
          if (!tasks || !Array.isArray(tasks)) {
            return { error: "create_tasks requires a 'tasks' array" };
          }
          const insertMany = db.transaction((items: TaskItem[]) => {
            for (const t of items) {
              insertTask.run({
                $id: t.id,
                $description: t.description,
                $status: t.status,
                $summary: t.summary,
                $blocked_by: JSON.stringify(t.blockedBy ?? []),
              });
            }
          });
          insertMany(tasks);
          const current = syncAndNotify();
          return { created: tasks.length, tasks: current };
        }

        case "list_tasks": {
          const rows = selectAllTasks.all() as Record<string, unknown>[];
          const tasks = rows.map(rowToTaskItem);
          return {
            tasks,
            statusSummary: buildStatusSummary(tasks),
          };
        }

        case "update_task_status": {
          const taskId = input.taskId as string | undefined;
          const status = input.status as string | undefined;
          if (!taskId || typeof taskId !== "string") {
            return { error: "update_task_status requires a 'taskId' string" };
          }
          if (!status || typeof status !== "string") {
            return { error: "update_task_status requires a 'status' string" };
          }
          const existing = selectTask.get({ $id: taskId }) as
            | Record<string, unknown>
            | undefined;
          if (!existing) {
            return { error: `Task not found: ${taskId}` };
          }
          const oldStatus = existing.status as string;
          updateStatus.run({ $status: status, $id: taskId });
          const current = syncAndNotify();
          return {
            taskId,
            oldStatus,
            newStatus: status,
            tasks: current,
            statusSummary: buildStatusSummary(current),
          };
        }

        case "add_task": {
          const task = input.task as TaskItem | undefined;
          if (!task || typeof task !== "object") {
            return { error: "add_task requires a 'task' object" };
          }
          insertTask.run({
            $id: task.id,
            $description: task.description,
            $status: task.status,
            $summary: task.summary,
            $blocked_by: JSON.stringify(task.blockedBy ?? []),
          });
          const current = syncAndNotify();
          return { added: task, tasks: current, total: current.length };
        }

        case "update_task_progress": {
          const taskId = input.taskId as string | undefined;
          const progress = input.progress as string | undefined;
          if (!taskId || typeof taskId !== "string") {
            return { error: "update_task_progress requires a 'taskId' string" };
          }
          if (!progress || typeof progress !== "string") {
            return { error: "update_task_progress requires a 'progress' string" };
          }
          const existing = selectTask.get({ $id: taskId }) as
            | Record<string, unknown>
            | undefined;
          if (!existing) {
            return { error: `Task not found: ${taskId}` };
          }
          insertProgress.run({ $task_id: taskId, $entry: progress });
          return { taskId, appended: true };
        }

        case "get_task_progress": {
          const taskId = input.taskId as string | undefined;
          if (taskId) {
            const rows = selectProgress.all({ $task_id: taskId }) as Record<
              string,
              unknown
            >[];
            const entries = rows.map(
              (r) => `[${r.created_at}] ${r.entry}`
            );
            return { progress: entries.join("\n") };
          }
          const rows = selectAllProgress.all() as Record<string, unknown>[];
          const entries = rows.map(
            (r) => `[${r.created_at}] [${r.task_id}] ${r.entry}`
          );
          return { progress: entries.join("\n") };
        }

        case "delete_task": {
          const taskId = input.taskId as string | undefined;
          if (!taskId || typeof taskId !== "string") {
            return { error: "delete_task requires a 'taskId' string" };
          }
          const existing = selectTask.get({ $id: taskId }) as
            | Record<string, unknown>
            | undefined;
          if (!existing) {
            return { error: `Task not found: ${taskId}` };
          }
          deleteProgressForTask.run({ $task_id: taskId });
          deleteTaskStmt.run({ $id: taskId });
          const current = syncAndNotify();
          return { deleted: taskId, tasks: current, remaining: current.length };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    },
  };
}
