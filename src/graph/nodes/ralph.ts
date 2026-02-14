/**
 * Ralph Prompt Utilities
 *
 * Provides the prompt used by the /ralph workflow's first step:
 *   Step 1: Task decomposition (buildSpecToTasksPrompt)
 *
 * Step 2 is handled by worker sub-agents (see worker.md agent definitions).
 */

/** Build the spec-to-tasks prompt for decomposing a spec into TodoItem[] */
export function buildSpecToTasksPrompt(specContent: string): string {
  return `You are tasked with decomposing a feature specification or natural language request into an ordered task list with dependencies.

Read the following specification and create a comprehensive and structured JSON array of tasks to be implemented in order of highest to lowest priority.

<input>
${specContent}
</input>

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
