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

/** Shape of a row returned from the tasks table */
interface TaskRow {
  id: string;
  description: string;
  status: string;
  summary: string;
  blocked_by: string;
  created_at: string;
  updated_at: string;
}

/** Shape of a row returned from the progress table */
interface ProgressRow {
  id: number;
  task_id: string;
  entry: string;
  created_at: string;
}

/**
 * JSON Schema for the task_list tool input.
 * Uses an `action` discriminator to dispatch to the correct CRUD handler.
 */
const taskListInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [
        "create_tasks",
        "list_tasks",
        "update_task_status",
        "add_task",
        "update_task_blockedBy",
        "update_task_progress",
        "get_task_progress",
        "delete_task",
        "clear_progress",
      ],
      description: "The CRUD operation to perform",
    },
    tasks: {
      type: "array",
      description: "Array of task objects (for create_tasks)",
      items: {
        type: "object",
        additionalProperties: false,
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
      additionalProperties: false,
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
    blockedBy: {
      type: "array",
      items: { type: "string" },
      description: "Array of task IDs this task is blocked by (for update_task_blockedBy)",
    },
  },
  required: ["action"],
};

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
  // Enforce foreign key constraints at the database level
  db.run("PRAGMA foreign_keys = ON;");

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

  // Index on status for efficient filtering (e.g., "get all pending tasks")
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`
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

  const updateBlockedBy = db.prepare(
    "UPDATE tasks SET blocked_by = $blocked_by, updated_at = datetime('now') WHERE id = $id"
  );

  const validStatuses = new Set<TaskItem["status"]>(["pending", "in_progress", "completed", "error"]);

  /** Safely parse a JSON string, returning fallback on failure */
  function safeParseBlockedBy(raw: string | null | undefined): string[] {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn(`[task-list] Corrupt blocked_by JSON, defaulting to []: ${raw}`);
      return [];
    }
  }

  /** Convert a DB row to a TaskItem */
  function rowToTaskItem(row: TaskRow): TaskItem {
    const status = validStatuses.has(row.status as TaskItem["status"])
      ? (row.status as TaskItem["status"])
      : "pending";
    if (!validStatuses.has(row.status as TaskItem["status"])) {
      console.warn(
        `[task-list] Task "${row.id}" has invalid status "${row.status}", defaulting to "pending"`
      );
    }
    return {
      id: row.id,
      description: row.description,
      status,
      summary: row.summary,
      blockedBy: safeParseBlockedBy(row.blocked_by),
    };
  }

  /** Read all tasks from DB and emit event for UI updates (best-effort) */
  function syncAndNotify(): TaskItem[] {
    const rows = selectAllTasks.all() as TaskRow[];
    const tasks = rows.map(rowToTaskItem);
    try {
      config.emitTaskUpdate?.(tasks);
    } catch (err) {
      console.warn("[task-list] emitTaskUpdate failed — UI may be stale:", err);
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
      "update_task_blockedBy (update dependencies), update_task_progress (append progress note), " +
      "get_task_progress (read progress), clear_progress (remove progress entries), " +
      "delete_task (remove). All mutations persist to SQLite and emit UI update events.",
    inputSchema: taskListInputSchema,

    close: () => {
      if (!closed) {
        closed = true;
        db.run("PRAGMA wal_checkpoint(TRUNCATE);");
        db.close();
      }
    },

    handler: (input: Record<string, unknown>): Record<string, unknown> => {
      if (closed) {
        return { error: "task_list tool has been closed" };
      }
      const action = input.action;
      if (typeof action !== "string") {
        return { error: "Missing or invalid 'action' field — must be a string" };
      }

      switch (action) {
        case "create_tasks": {
          const tasks = input.tasks as TaskItem[] | undefined;
          if (!tasks || !Array.isArray(tasks)) {
            return { error: "create_tasks requires a 'tasks' array" };
          }
          // Validate blockedBy references: IDs must exist in the batch or in the DB
          const batchIds = new Set(tasks.map((t) => t.id));
          // Collect all external refs (not in the batch) and check existence in one pass
          const externalRefs = new Set<string>();
          for (const t of tasks) {
            for (const id of t.blockedBy ?? []) {
              if (!batchIds.has(id)) externalRefs.add(id);
            }
          }
          if (externalRefs.size > 0) {
            const placeholders = [...externalRefs].map(() => "?").join(",");
            const existingRows = db
              .prepare(`SELECT id FROM tasks WHERE id IN (${placeholders})`)
              .all(...externalRefs) as { id: string }[];
            const existingIds = new Set(existingRows.map((r) => r.id));
            for (const t of tasks) {
              const refs = t.blockedBy ?? [];
              const invalidIds = refs.filter(
                (id) => !batchIds.has(id) && !existingIds.has(id)
              );
              if (invalidIds.length > 0) {
                return {
                  error: `Task "${t.id}" blockedBy references non-existent task(s): ${invalidIds.join(", ")}`,
                };
              }
            }
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
          const rows = selectAllTasks.all() as TaskRow[];
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
            | TaskRow
            | undefined;
          if (!existing) {
            return { error: `Task not found: ${taskId}` };
          }
          const oldStatus = existing.status;
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
          // Validate that all blockedBy references exist
          const refs = task.blockedBy ?? [];
          if (refs.length > 0) {
            const invalidIds = refs.filter(
              (id) => !selectTask.get({ $id: id })
            );
            if (invalidIds.length > 0) {
              return {
                error: `blockedBy references non-existent task(s): ${invalidIds.join(", ")}`,
              };
            }
          }
          insertTask.run({
            $id: task.id,
            $description: task.description,
            $status: task.status,
            $summary: task.summary,
            $blocked_by: JSON.stringify(refs),
          });
          const current = syncAndNotify();
          return { added: task, tasks: current, total: current.length };
        }

        case "update_task_blockedBy": {
          const taskId = input.taskId as string | undefined;
          const blockedBy = input.blockedBy as string[] | undefined;
          if (!taskId || typeof taskId !== "string") {
            return { error: "update_task_blockedBy requires a 'taskId' string" };
          }
          if (!Array.isArray(blockedBy)) {
            return { error: "update_task_blockedBy requires a 'blockedBy' array" };
          }
          const existing = selectTask.get({ $id: taskId }) as
            | TaskRow
            | undefined;
          if (!existing) {
            return { error: `Task not found: ${taskId}` };
          }
          // Validate that all referenced task IDs exist
          const invalidIds = blockedBy.filter(
            (id) => !selectTask.get({ $id: id })
          );
          if (invalidIds.length > 0) {
            return {
              error: `blockedBy references non-existent task(s): ${invalidIds.join(", ")}`,
            };
          }
          // Reject self-references
          if (blockedBy.includes(taskId)) {
            return { error: `Circular dependency: task "${taskId}" cannot block itself` };
          }
          // Detect transitive cycles: DFS from each proposed blocker to see if
          // any path leads back to taskId through existing dependencies.
          const allRows = selectAllTasks.all() as TaskRow[];
          const depsMap = new Map<string, string[]>();
          for (const row of allRows) {
            depsMap.set(
              row.id,
              row.id === taskId ? blockedBy : safeParseBlockedBy(row.blocked_by),
            );
          }
          const visited = new Set<string>();
          const stack = [...blockedBy];
          while (stack.length > 0) {
            const current = stack.pop()!;
            if (current === taskId) {
              return {
                error: `Circular dependency detected: updating blockedBy for "${taskId}" would create a cycle`,
              };
            }
            if (visited.has(current)) continue;
            visited.add(current);
            const deps = depsMap.get(current) ?? [];
            stack.push(...deps);
          }
          updateBlockedBy.run({
            $id: taskId,
            $blocked_by: JSON.stringify(blockedBy),
          });
          const current = syncAndNotify();
          return { taskId, blockedBy, tasks: current };
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
            | TaskRow
            | undefined;
          if (!existing) {
            return { error: `Task not found: ${taskId}` };
          }
          insertProgress.run({ $task_id: taskId, $entry: progress });
          const current = syncAndNotify();
          return { taskId, appended: true, tasks: current };
        }

        case "get_task_progress": {
          const taskId = input.taskId as string | undefined;
          if (taskId) {
            const existing = selectTask.get({ $id: taskId }) as
              | TaskRow
              | undefined;
            if (!existing) {
              return { error: `Task not found: ${taskId}` };
            }
            const rows = selectProgress.all({ $task_id: taskId }) as ProgressRow[];
            const entries = rows.map(
              (r) => `[${r.created_at}] ${r.entry}`
            );
            return { progress: entries.join("\n") };
          }
          const rows = selectAllProgress.all() as ProgressRow[];
          const entries = rows.map(
            (r) => `[${r.created_at}] [${r.task_id}] ${r.entry}`
          );
          return { progress: entries.join("\n") };
        }

        case "clear_progress": {
          const taskId = input.taskId as string | undefined;
          if (taskId) {
            const existing = selectTask.get({ $id: taskId }) as
              | TaskRow
              | undefined;
            if (!existing) {
              return { error: `Task not found: ${taskId}` };
            }
            deleteProgressForTask.run({ $task_id: taskId });
            return { cleared: true, taskId };
          }
          db.run("DELETE FROM progress");
          return { cleared: true, all: true };
        }

        case "delete_task": {
          const taskId = input.taskId as string | undefined;
          if (!taskId || typeof taskId !== "string") {
            return { error: "delete_task requires a 'taskId' string" };
          }
          const existing = selectTask.get({ $id: taskId }) as
            | TaskRow
            | undefined;
          if (!existing) {
            return { error: `Task not found: ${taskId}` };
          }
          const deleteTx = db.transaction((id: string) => {
            deleteProgressForTask.run({ $task_id: id });
            deleteTaskStmt.run({ $id: id });
            // Remove the deleted ID from other tasks' blockedBy arrays.
            // Uses a targeted SQL query to only touch rows that reference the deleted ID,
            // avoiding a full table scan + per-row JS deserialization.
            const dependentRows = db
              .prepare(
                `SELECT id, blocked_by FROM tasks WHERE blocked_by LIKE '%' || $id || '%'`
              )
              .all({ $id: id }) as Pick<TaskRow, "id" | "blocked_by">[];
            for (const row of dependentRows) {
              const deps = safeParseBlockedBy(row.blocked_by);
              if (deps.includes(id)) {
                updateBlockedBy.run({
                  $id: row.id,
                  $blocked_by: JSON.stringify(deps.filter((d) => d !== id)),
                });
              }
            }
          });
          deleteTx(taskId);
          const current = syncAndNotify();
          return { deleted: taskId, tasks: current, remaining: current.length };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    },
  };
}
