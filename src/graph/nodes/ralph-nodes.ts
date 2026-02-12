/**
 * Ralph Prompt Utilities
 *
 * Provides the prompts used by the /ralph two-step workflow:
 *   Step 1: Task decomposition (buildSpecToTasksPrompt)
 *   Step 2: Feature implementation (buildImplementFeaturePrompt)
 */

import type { SourceControlType } from "../../config";

/**
 * Get SCM-appropriate history command for the implement feature prompt.
 */
export function getHistoryCommand(scm: SourceControlType): string {
  return scm === "sapling-phabricator"
    ? "sl smartlog -l 10"
    : "git log --oneline -20";
}

/**
 * Get SCM-appropriate commit command reference for the implement feature prompt.
 */
export function getCommitCommandReference(scm: SourceControlType): string {
  return scm === "sapling-phabricator"
    ? "/commit (uses sl commit)"
    : "/commit (uses git commit)";
}

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

/**
 * Build the implement-feature prompt (step 2 of the ralph workflow).
 * Accepts optional SCM type to customize history and commit command references.
 * Defaults to GitHub/Git if not specified.
 */
export function buildImplementFeaturePrompt(scm: SourceControlType = "github"): string {
  const historyCmd = getHistoryCommand(scm);
  const commitRef = getCommitCommandReference(scm);

  return `You are tasked with implementing a SINGLE feature from the task list.

# Getting up to speed
1. Run \`pwd\` to see the directory you're working in. Only make edits within the current git repository.
2. Read the git logs and progress files to get up to speed on what was recently worked on.
3. Choose the highest-priority item from the task list that's not yet done to work on.

# Typical Workflow

## Initialization

A typical workflow will start something like this:

\`\`\`
[Assistant] I'll start by getting my bearings and understanding the current state of the project.
[Tool Use] <bash - pwd>
[Tool Use] <read - progress.txt>
[Tool Use] <read - task-list.json>
[Assistant] Let me check the git log to see recent work.
[Tool Use] <bash - ${historyCmd}>
[Assistant] Now let me check if there's an init.sh script to restart the servers.
<Starts the development server>
[Assistant] Excellent! Now let me navigate to the application and verify that some fundamental features are still working.
<Tests basic functionality>
[Assistant] Based on my verification testing, I can see that the fundamental functionality is working well. The core chat features, theme switching, conversation loading, and error handling are all functioning correctly. Now let me review the tests.json file more comprehensively to understand what needs to be implemented next.
<Starts work on a new feature>
\`\`\`

## Test-Driven Development

Frequently use unit tests, integration tests, and end-to-end tests to verify your work AFTER you implement the feature. If the codebase has existing tests, run them often to ensure existing functionality is not broken.

### Testing Anti-Patterns

Use your testing-anti-patterns skill to avoid common pitfalls when writing tests.

## Design Principles

### Feature Implementation Guide: Managing Complexity

Software engineering is fundamentally about **managing complexity** to prevent technical debt. When implementing features, prioritize maintainability and testability over cleverness.

**1. Apply Core Principles (The Axioms)**
* **SOLID:** Adhere strictly to these, specifically **Single Responsibility** (a class should have only one reason to change) and **Dependency Inversion** (depend on abstractions/interfaces, not concrete details).
* **Pragmatism:** Follow **KISS** (Keep It Simple) and **YAGNI** (You Aren't Gonna Need It). Do not build generic frameworks for hypothetical future requirements.

**2. Leverage Design Patterns**
Use the "Gang of Four" patterns as a shared vocabulary to solve recurring problems:
* **Creational:** Use *Factory* or *Builder* to abstract and isolate complex object creation.
* **Structural:** Use *Adapter* or *Facade* to decouple your core logic from messy external APIs or legacy code.
* **Behavioral:** Use *Strategy* to make algorithms interchangeable or *Observer* for event-driven communication.

**3. Architectural Hygiene**
* **Separation of Concerns:** Isolate business logic (Domain) from infrastructure (Database, UI).
* **Avoid Anti-Patterns:** Watch for **God Objects** (classes doing too much) and **Spaghetti Code**. If you see them, refactor using polymorphism.

**Goal:** Create "seams" in your software using interfaces. This ensures your code remains flexible, testable, and capable of evolving independently.

## Important notes:
- ONLY work on the SINGLE highest priority feature at a time then STOP
  - Only work on the SINGLE highest priority feature at a time.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
- Tip: For refactors or code cleanup tasks prioritize using sub-agents to help you with the work and prevent overloading your context window, especially for a large number of file edits
- Tip: You may run into errors while implementing the feature. ALWAYS delegate to the debugger agent using the Task tool (you can ask it to navigate the web to find best practices for the latest version) and follow the guidelines there to create a debug report
    - AFTER the debug report is generated by the debugger agent follow these steps IN ORDER:
      1. First, add a new task to the task list with the highest priority to fix the bug
      2. Second, append the debug report to \`progress.txt\` for future reference
      3. Lastly, IMMEDIATELY STOP working on the current feature and EXIT
- You may be tempted to ignore unrelated errors that you introduced or were pre-existing before you started working on the feature. DO NOT IGNORE THEM. If you need to adjust priority, do so by updating the task list (move the fix to the top) and \`progress.txt\` file to reflect the new priorities
- AFTER implementing the feature AND verifying its functionality by creating tests, mark the feature as complete in the task list
- It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
- Commit progress with descriptive commit messages by running ${commitRef} using the \`Skill\` tool
- Write summaries of your progress in \`progress.txt\`
    - Tip: this can be useful to revert bad code changes and recover working states of the codebase
- Note: you are competing with another coding agent that also implements features. The one who does a better job implementing features will be promoted. Focus on quality, correctness, and thorough testing. The agent who breaks the rules for implementation will be fired.`;
}
