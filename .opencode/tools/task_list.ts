/**
 * OpenCode Custom Tool: task_list
 *
 * Provides persistent CRUD task management backed by SQLite.
 * Auto-discovered by OpenCode from .opencode/tools/task_list.ts.
 *
 * Replaces the MCP-bridge approach with a native OpenCode custom tool
 * that runs in-process within the OpenCode server.
 */

import { tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";

// ============================================================================
// Database Management
// ============================================================================

/** Module-level DB cache keyed by sessionID for connection reuse */
const databases = new Map<string, Database>();

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
  task_id: string;
  entry: string;
  created_at: string;
}

const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "error"]);

function getDb(sessionID: string): Database {
  const cached = databases.get(sessionID);
  if (cached) return cached;

  const dbDir = join(homedir(), ".atomic", "sessions", "task-list", sessionID);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(join(dbDir, "workflow.db"));
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");

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

  db.run("CREATE INDEX IF NOT EXISTS idx_progress_task_id ON progress(task_id);");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);");

  databases.set(sessionID, db);
  return db;
}

// ============================================================================
// Helpers
// ============================================================================

function safeParseBlockedBy(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToTask(row: TaskRow) {
  const status = VALID_STATUSES.has(row.status) ? row.status : "pending";
  return {
    id: row.id,
    description: row.description,
    status,
    summary: row.summary,
    blockedBy: safeParseBlockedBy(row.blocked_by),
  };
}

function buildStatusSummary(tasks: ReturnType<typeof rowToTask>[]) {
  const done = tasks.filter((t) => t.status === "completed").length;
  const inProg = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const errored = tasks.filter((t) => t.status === "error").length;
  return `${tasks.length} tasks: ${done} done, ${inProg} in progress, ${pending} pending, ${errored} error`;
}

// ============================================================================
// Action Handlers
// ============================================================================

interface TaskInput {
  id: string;
  description: string;
  status: string;
  summary: string;
  blockedBy?: string[];
}

function handleCreateTasks(db: Database, tasks: TaskInput[]) {
  if (!tasks || !Array.isArray(tasks)) {
    return { error: "create_tasks requires a 'tasks' array" };
  }

  const batchIds = new Set(tasks.map((t) => t.id));
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
      const invalidIds = refs.filter((id) => !batchIds.has(id) && !existingIds.has(id));
      if (invalidIds.length > 0) {
        return { error: `Task "${t.id}" blockedBy references non-existent task(s): ${invalidIds.join(", ")}` };
      }
    }
  }

  const insert = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, description, status, summary, blocked_by, created_at, updated_at)
     VALUES ($id, $description, $status, $summary, $blocked_by, datetime('now'), datetime('now'))`,
  );
  const insertMany = db.transaction((items: TaskInput[]) => {
    for (const t of items) {
      insert.run({
        $id: t.id,
        $description: t.description,
        $status: t.status,
        $summary: t.summary,
        $blocked_by: JSON.stringify(t.blockedBy ?? []),
      });
    }
  });
  insertMany(tasks);

  const allTasks = (db.prepare("SELECT * FROM tasks").all() as TaskRow[]).map(rowToTask);
  return { created: tasks.length, tasks: allTasks };
}

function handleListTasks(db: Database) {
  const tasks = (db.prepare("SELECT * FROM tasks").all() as TaskRow[]).map(rowToTask);
  return { tasks, statusSummary: buildStatusSummary(tasks) };
}

function handleUpdateTaskStatus(db: Database, taskId: string, status: string) {
  if (!taskId) return { error: "update_task_status requires a 'taskId' string" };
  if (!status) return { error: "update_task_status requires a 'status' string" };

  const existing = db.prepare("SELECT * FROM tasks WHERE id = $id").get({ $id: taskId }) as TaskRow | undefined;
  if (!existing) return { error: `Task not found: ${taskId}` };

  const oldStatus = existing.status;
  db.prepare("UPDATE tasks SET status = $status, updated_at = datetime('now') WHERE id = $id").run({ $status: status, $id: taskId });

  const allTasks = (db.prepare("SELECT * FROM tasks").all() as TaskRow[]).map(rowToTask);
  return { taskId, oldStatus, newStatus: status, tasks: allTasks, statusSummary: buildStatusSummary(allTasks) };
}

function handleAddTask(db: Database, task: TaskInput) {
  if (!task || typeof task !== "object") return { error: "add_task requires a 'task' object" };

  const refs = task.blockedBy ?? [];
  if (refs.length > 0) {
    const invalidIds = refs.filter((id) => !db.prepare("SELECT id FROM tasks WHERE id = $id").get({ $id: id }));
    if (invalidIds.length > 0) {
      return { error: `blockedBy references non-existent task(s): ${invalidIds.join(", ")}` };
    }
  }

  db.prepare(
    `INSERT OR REPLACE INTO tasks (id, description, status, summary, blocked_by, created_at, updated_at)
     VALUES ($id, $description, $status, $summary, $blocked_by, datetime('now'), datetime('now'))`,
  ).run({
    $id: task.id,
    $description: task.description,
    $status: task.status,
    $summary: task.summary,
    $blocked_by: JSON.stringify(refs),
  });

  const allTasks = (db.prepare("SELECT * FROM tasks").all() as TaskRow[]).map(rowToTask);
  return { added: task, tasks: allTasks, total: allTasks.length };
}

function handleUpdateBlockedBy(db: Database, taskId: string, blockedBy: string[]) {
  if (!taskId) return { error: "update_task_blockedBy requires a 'taskId' string" };
  if (!Array.isArray(blockedBy)) return { error: "update_task_blockedBy requires a 'blockedBy' array" };

  const existing = db.prepare("SELECT * FROM tasks WHERE id = $id").get({ $id: taskId }) as TaskRow | undefined;
  if (!existing) return { error: `Task not found: ${taskId}` };

  const invalidIds = blockedBy.filter((id) => !db.prepare("SELECT id FROM tasks WHERE id = $id").get({ $id: id }));
  if (invalidIds.length > 0) return { error: `blockedBy references non-existent task(s): ${invalidIds.join(", ")}` };

  if (blockedBy.includes(taskId)) return { error: `Circular dependency: task "${taskId}" cannot block itself` };

  // Detect transitive cycles via DFS
  const allRows = db.prepare("SELECT * FROM tasks").all() as TaskRow[];
  const depsMap = new Map<string, string[]>();
  for (const row of allRows) {
    depsMap.set(row.id, row.id === taskId ? blockedBy : safeParseBlockedBy(row.blocked_by));
  }
  const visited = new Set<string>();
  const stack = [...blockedBy];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) {
      return { error: `Circular dependency detected: updating blockedBy for "${taskId}" would create a cycle` };
    }
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(depsMap.get(current) ?? []));
  }

  db.prepare("UPDATE tasks SET blocked_by = $blocked_by, updated_at = datetime('now') WHERE id = $id").run({
    $id: taskId,
    $blocked_by: JSON.stringify(blockedBy),
  });

  const allTasks = (db.prepare("SELECT * FROM tasks").all() as TaskRow[]).map(rowToTask);
  return { taskId, blockedBy, tasks: allTasks };
}

function handleUpdateProgress(db: Database, taskId: string, progress: string) {
  if (!taskId) return { error: "update_task_progress requires a 'taskId' string" };
  if (!progress) return { error: "update_task_progress requires a 'progress' string" };

  const existing = db.prepare("SELECT id FROM tasks WHERE id = $id").get({ $id: taskId });
  if (!existing) return { error: `Task not found: ${taskId}` };

  db.prepare("INSERT INTO progress (task_id, entry) VALUES ($task_id, $entry)").run({ $task_id: taskId, $entry: progress });
  const allTasks = (db.prepare("SELECT * FROM tasks").all() as TaskRow[]).map(rowToTask);
  return { taskId, appended: true, tasks: allTasks };
}

function handleGetProgress(db: Database, taskId?: string) {
  if (taskId) {
    const existing = db.prepare("SELECT id FROM tasks WHERE id = $id").get({ $id: taskId });
    if (!existing) return { error: `Task not found: ${taskId}` };

    const rows = db.prepare("SELECT entry, created_at FROM progress WHERE task_id = $task_id ORDER BY created_at").all({ $task_id: taskId }) as ProgressRow[];
    return { progress: rows.map((r) => `[${r.created_at}] ${r.entry}`).join("\n") };
  }

  const rows = db.prepare("SELECT task_id, entry, created_at FROM progress ORDER BY created_at").all() as ProgressRow[];
  return { progress: rows.map((r) => `[${r.created_at}] [${r.task_id}] ${r.entry}`).join("\n") };
}

function handleClearProgress(db: Database, taskId?: string) {
  if (taskId) {
    const existing = db.prepare("SELECT id FROM tasks WHERE id = $id").get({ $id: taskId });
    if (!existing) return { error: `Task not found: ${taskId}` };
    db.prepare("DELETE FROM progress WHERE task_id = $task_id").run({ $task_id: taskId });
    return { cleared: true, taskId };
  }
  db.run("DELETE FROM progress");
  return { cleared: true, all: true };
}

function handleDeleteTask(db: Database, taskId: string) {
  if (!taskId) return { error: "delete_task requires a 'taskId' string" };

  const existing = db.prepare("SELECT id FROM tasks WHERE id = $id").get({ $id: taskId });
  if (!existing) return { error: `Task not found: ${taskId}` };

  const deleteTx = db.transaction((id: string) => {
    db.prepare("DELETE FROM progress WHERE task_id = $task_id").run({ $task_id: id });
    db.prepare("DELETE FROM tasks WHERE id = $id").run({ $id: id });

    // Remove the deleted ID from other tasks' blockedBy arrays
    const dependentRows = db
      .prepare(`SELECT id, blocked_by FROM tasks WHERE blocked_by LIKE '%' || $id || '%'`)
      .all({ $id: id }) as Pick<TaskRow, "id" | "blocked_by">[];
    for (const row of dependentRows) {
      const deps = safeParseBlockedBy(row.blocked_by);
      if (deps.includes(id)) {
        db.prepare("UPDATE tasks SET blocked_by = $blocked_by, updated_at = datetime('now') WHERE id = $id").run({
          $id: row.id,
          $blocked_by: JSON.stringify(deps.filter((d) => d !== id)),
        });
      }
    }
  });
  deleteTx(taskId);

  const allTasks = (db.prepare("SELECT * FROM tasks").all() as TaskRow[]).map(rowToTask);
  return { deleted: taskId, tasks: allTasks, remaining: allTasks.length };
}

// ============================================================================
// Tool Definition
// ============================================================================

const z = tool.schema;

const taskSchema = z.object({
  id: z.string().describe("Unique task identifier"),
  description: z.string().describe("Task description"),
  status: z.enum(["pending", "in_progress", "completed", "error"]).describe("Task status"),
  summary: z.string().describe("Brief summary of the task"),
  blockedBy: z.array(z.string()).optional().describe("IDs of tasks this task is blocked by"),
});

export default tool({
  description:
    "Manage workflow tasks with CRUD operations. Supports: create_tasks (batch create), " +
    "list_tasks (view all), update_task_status (change status), add_task (add one), " +
    "update_task_blockedBy (update dependencies), update_task_progress (append progress note), " +
    "get_task_progress (read progress), clear_progress (remove progress entries), " +
    "delete_task (remove). All mutations persist to SQLite.",
  args: {
    action: z
      .enum([
        "create_tasks",
        "list_tasks",
        "update_task_status",
        "add_task",
        "update_task_blockedBy",
        "update_task_progress",
        "get_task_progress",
        "delete_task",
        "clear_progress",
      ])
      .describe("The CRUD operation to perform"),
    tasks: z
      .array(taskSchema)
      .optional()
      .describe("Array of task objects (for create_tasks)"),
    taskId: z.string().optional().describe("ID of the task to operate on"),
    status: z
      .enum(["pending", "in_progress", "completed", "error"])
      .optional()
      .describe("New status (for update_task_status)"),
    task: taskSchema.optional().describe("A single task object (for add_task)"),
    progress: z
      .string()
      .optional()
      .describe("Progress text to append (for update_task_progress)"),
    blockedBy: z
      .array(z.string())
      .optional()
      .describe("Array of task IDs this task is blocked by (for update_task_blockedBy)"),
  },
  async execute(args, context) {
    const db = getDb(context.sessionID);

    let result: Record<string, unknown>;

    switch (args.action) {
      case "create_tasks":
        result = handleCreateTasks(db, args.tasks as TaskInput[]);
        break;
      case "list_tasks":
        result = handleListTasks(db);
        break;
      case "update_task_status":
        result = handleUpdateTaskStatus(db, args.taskId!, args.status!);
        break;
      case "add_task":
        result = handleAddTask(db, args.task as TaskInput);
        break;
      case "update_task_blockedBy":
        result = handleUpdateBlockedBy(db, args.taskId!, args.blockedBy!);
        break;
      case "update_task_progress":
        result = handleUpdateProgress(db, args.taskId!, args.progress!);
        break;
      case "get_task_progress":
        result = handleGetProgress(db, args.taskId);
        break;
      case "clear_progress":
        result = handleClearProgress(db, args.taskId);
        break;
      case "delete_task":
        result = handleDeleteTask(db, args.taskId!);
        break;
      default:
        result = { error: `Unknown action: ${args.action}` };
    }

    return JSON.stringify(result);
  },
});
