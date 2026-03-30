# Workflow SDK

Documentation for the workflow SDK internals, including the task list tool, database schema, and UI lifecycle.

## Task List Tool

The `task_list` tool (`src/services/agents/tools/task-list.ts`) provides CRUD operations for managing tasks within a workflow session. It is backed by a session-scoped SQLite database and emits events for real-time UI updates via the event bus.

### Database Schema

The tool creates a SQLite database at `{sessionDir}/workflow.db` with WAL mode enabled for concurrent read/write performance.

#### `tasks` Table

| Column       | Type | Constraints                                                     | Description                                      |
| ------------ | ---- | --------------------------------------------------------------- | ------------------------------------------------ |
| `id`         | TEXT | PRIMARY KEY                                                     | Unique task identifier (kebab-case recommended)  |
| `description`| TEXT | NOT NULL                                                        | Human-readable task description                  |
| `status`     | TEXT | NOT NULL, CHECK(IN ('pending','in_progress','completed','error'))| Current task status                              |
| `summary`    | TEXT | NOT NULL                                                        | Present-participle phrase (e.g., "Fixing bug")   |
| `blocked_by` | TEXT | DEFAULT '[]'                                                    | JSON array of task IDs this task depends on      |
| `created_at` | TEXT | NOT NULL, DEFAULT datetime('now')                               | ISO timestamp of creation                        |
| `updated_at` | TEXT | NOT NULL, DEFAULT datetime('now')                               | ISO timestamp of last update                     |

#### `progress` Table

| Column       | Type    | Constraints                          | Description                          |
| ------------ | ------- | ------------------------------------ | ------------------------------------ |
| `id`         | INTEGER | PRIMARY KEY AUTOINCREMENT            | Auto-incrementing row ID             |
| `task_id`    | TEXT    | NOT NULL, FOREIGN KEY → tasks(id)    | References the parent task           |
| `entry`      | TEXT    | NOT NULL                             | Progress log entry text              |
| `created_at` | TEXT    | NOT NULL, DEFAULT datetime('now')    | ISO timestamp of the entry           |

#### Indexes

- `idx_progress_task_id` on `progress(task_id)` — speeds up progress lookups by task.
- `idx_tasks_status` on `tasks(status)` — enables efficient status-based filtering (e.g., "get all pending tasks").

### Actions

The tool uses an `action` discriminator to dispatch operations:

| Action                  | Required Fields            | Description                                    |
| ----------------------- | -------------------------- | ---------------------------------------------- |
| `create_tasks`          | `tasks[]`                  | Bulk-create tasks (INSERT OR REPLACE)          |
| `list_tasks`            | —                          | Return all tasks                               |
| `add_task`              | `task`                     | Add a single task                              |
| `update_task_status`    | `taskId`, `status`         | Update a task's status                         |
| `update_task_blockedBy` | `taskId`, `blockedBy[]`    | Update a task's dependency list                |
| `update_task_progress`  | `taskId`, `progress`       | Append a progress log entry                    |
| `get_task_progress`     | `taskId`                   | Retrieve progress entries for a task           |
| `delete_task`           | `taskId`                   | Delete a task and clean up dependencies        |
| `clear_progress`        | `taskId`                   | Clear all progress entries for a task          |

### Performance Characteristics

- **Prepared statements** are created once at initialization and reused for all operations.
- **Transactions** are used for multi-step mutations (`create_tasks`, `delete_task`) to ensure atomicity.
- **`delete_task` dependency cleanup**: When a task is deleted, all remaining tasks are scanned to remove the deleted ID from their `blockedBy` arrays. This is an O(n) operation over all tasks. This is acceptable for typical workflow sizes (10–50 tasks) but could become a bottleneck for very large task lists. A normalized junction table would be the appropriate optimization if needed.

### Resource Lifecycle

The tool exposes a `close()` method that closes the underlying SQLite connection. The conductor executor calls this in its `finally` block to prevent resource leaks, regardless of whether the workflow succeeded or failed.

## Task List UI

### Auto-Clear Behavior

After all tasks reach the `completed` status and the workflow is no longer active, the task list panel automatically hides itself after a **5-second delay** (`AUTO_CLEAR_DELAY_MS` in `src/components/task-list-lifecycle.ts`). This gives the user time to review the final task state before the panel is removed from the UI.

The delay is reset if new non-completed tasks arrive before the timer expires.
