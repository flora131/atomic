/**
 * Ralph Prompt Utilities
 *
 * Provides the prompts used by the /ralph two-step workflow:
 *   Step 1: Task decomposition (buildSpecToTasksPrompt)
 *   Step 2: Worker sub-agent dispatch (buildBootstrappedTaskContext / buildWorkerAssignment)
 *
 * The worker agent prompt lives in .claude/agents/worker.md (and equivalent
 * paths for OpenCode / Copilot). It is registered by each SDK at session
 * start — the workflow only needs to spawn the "worker" sub-agent with
 * the task list as context.
 */

export interface TaskItem {
  id?: string;
  content: string;
  status: string;
  activeForm: string;
  blockedBy?: string[];
}

function isCompletedStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "completed" || normalized === "complete" || normalized === "done";
}

// ============================================================================
// STEP 1: TASK DECOMPOSITION
// ============================================================================

/** Build the spec-to-tasks prompt for decomposing a spec into TodoItem[] */
export function buildSpecToTasksPrompt(specContent: string): string {
  return `You are tasked with decomposing a feature specification into an ordered task list.

Read the following specification and create a comprehensive and structured JSON array of tasks to be implemented in order of highest to lowest priority.

<specification>
${specContent}
</specification>

# Output Format

Produce a JSON array where each element follows this exact schema:

\`\`\`json
[
  {
    "id": "#1",
    "content": "Concise description of the task",
    "status": "pending",
    "activeForm": "Present-participle form (e.g., 'Implementing auth endpoint')",
    "blockedBy": []
  }
]
\`\`\`

# Field Definitions

- \`id\`: Sequential identifier ("#1", "#2", "#3", ...).
- \`content\`: A concise, actionable description of the task.
- \`status\`: Always "pending" for new tasks.
- \`activeForm\`: Present-participle description shown in the UI spinner (e.g., "Implementing X", "Adding Y").
- \`blockedBy\`: Array of task IDs that must complete before this task can start. Use this for technical dependencies (e.g., tests blocked by implementation, UI blocked by API). Leave empty ([]) for tasks with no dependencies.

# Guidelines

- Parse the specification thoroughly. Every distinct deliverable should be a separate task.
- Order tasks by priority: foundational/infrastructure tasks first, then features, then tests, then polish.
- Analyze technical dependencies between tasks and populate \`blockedBy\` arrays.
- Keep \`content\` concise (under 80 characters).
- Output ONLY the JSON array. No surrounding text, no markdown fences, no explanation.`;
}

// ============================================================================
// STEP 2: TASK LIST PREAMBLE
// ============================================================================

/** Build a preamble that includes the task list JSON for step 2 after context clearing */
export function buildTaskListPreamble(tasks: TaskItem[]): string {
  const taskListJson = JSON.stringify(tasks, null, 2);
  return `# Task List from Planning Phase

The following task list was created during the planning phase. Your FIRST action MUST be to call the TodoWrite tool with this exact task list to load it into the system.

\`\`\`json
${taskListJson}
\`\`\`

After calling TodoWrite with the above tasks, proceed with the implementation instructions below.

---

`;
}

/** Build a prompt for assigning a single task to a worker sub-agent. */
export function buildWorkerAssignment(task: TaskItem, allTasks: TaskItem[]): string {
  const taskId = task.id ?? "unknown";

  const dependencies = (task.blockedBy ?? []).map((dependencyId) => {
    const dependency = allTasks.find((candidate) => candidate.id === dependencyId);
    if (!dependency) {
      return `- ${dependencyId}: (not found)`;
    }
    return `- ${dependencyId}: ${dependency.content}`;
  });

  const completedTasks = allTasks
    .filter((candidate) => isCompletedStatus(candidate.status))
    .map((candidate) => `- ${candidate.id ?? "?"}: ${candidate.content}`);

  const dependencySection = dependencies.length > 0
    ? `# Dependencies

${dependencies.join("\n")}

`
    : "";

  const completedSection = completedTasks.length > 0
    ? `# Completed Tasks

${completedTasks.join("\n")}

`
    : "";

  return `# Task Assignment

**Task ID:** ${taskId}
**Task:** ${task.content}

${dependencySection}${completedSection}# Instructions

Focus solely on this task.
Implement it until complete and tested.
Do not modify unrelated task statuses.
If blocked, record the issue and set the task status to "error".
Begin implementation.`;
}

/** Build a bootstrap context for the main agent after the planning phase. */
export function buildBootstrappedTaskContext(tasks: TaskItem[], sessionId: string): string {
  const taskListJson = JSON.stringify(tasks, null, 2);
  return `# Ralph Session Bootstrap

Session ID: ${sessionId}

The planning phase produced the task list below:

\`\`\`json
${taskListJson}
\`\`\`

# Instructions

- Process tasks in dependency order.
- Respect each task's blockedBy list before starting work.
- Dispatch workers with explicit task assignments and update TodoWrite as progress changes.
- Continue until all tasks are completed or an error/deadlock is surfaced.`;
}
