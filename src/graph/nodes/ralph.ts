/**
 * Ralph Prompt Utilities
 *
 * Provides the prompts used by the /ralph two-step workflow:
 *   Step 1: Task decomposition (buildSpecToTasksPrompt)
 *   Step 2: Worker sub-agent dispatch (buildTaskListPreamble)
 *
 * The worker agent prompt lives in .claude/agents/worker.md (and equivalent
 * paths for OpenCode / Copilot). It is registered by each SDK at session
 * start — the workflow only needs to spawn the "worker" sub-agent with
 * the task list as context.
 */

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
export function buildTaskListPreamble(tasks: Array<{ id?: string; content: string; status: string; activeForm: string; blockedBy?: string[] }>): string {
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
