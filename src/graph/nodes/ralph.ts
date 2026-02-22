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
- CRITICAL: Every task ID must be in strict \`#N\` format. Ranges like \`#2-#11\` are invalid.
- CRITICAL: Never condense multiple tasks into one row. Each task needs its own object.
- CRITICAL: Every object must include \`id\`, \`content\`, \`status\`, \`activeForm\`, and \`blockedBy\`.
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
- After each worker completes, YOU (the main agent) must call TodoWrite with updated statuses.
- Do NOT rely on worker sub-agents to call TodoWrite.
- Continue until all tasks are completed or an error/deadlock is surfaced.`;
}

/** Build a prompt to continue processing remaining tasks after a previous iteration. */
export function buildContinuePrompt(tasks: TaskItem[], sessionId: string): string {
  const taskListJson = JSON.stringify(tasks, null, 2);
  const completed = tasks.filter((t) => isCompletedStatus(t.status)).length;
  const total = tasks.length;
  return `# Ralph Session Continue

Session ID: ${sessionId}
Progress: ${completed}/${total} tasks completed

Current task state:

\`\`\`json
${taskListJson}
\`\`\`

Some tasks are still incomplete. Continue processing tasks in dependency order. Dispatch workers for ready tasks. After each worker finishes, YOU (the main agent) must call TodoWrite to persist status updates. Continue until all tasks are completed or an error/deadlock is surfaced.`;
}

// ============================================================================
// STEP 3: REVIEW & FIX
// ============================================================================

/** Represents a single finding from the code review */
export interface ReviewFinding {
  title: string;
  body: string;
  confidence_score?: number;
  priority?: number;
  code_location?: {
    absolute_file_path: string;
    line_range: { start: number; end: number };
  };
}

/** Represents the complete review result from the reviewer sub-agent */
export interface ReviewResult {
  findings: ReviewFinding[];
  overall_correctness: string;
  overall_explanation: string;
  overall_confidence_score?: number;
}

/** Build a prompt for the reviewer sub-agent to review completed implementation */
export function buildReviewPrompt(tasks: TaskItem[], userPrompt: string): string {
  const completedTasks = tasks
    .filter((t) => isCompletedStatus(t.status))
    .map((t) => `- ${t.id ?? "?"}: ${t.content}`)
    .join("\n");

  return `# Code Review Request

## Implementation Summary

The implementation phase has completed for the following user request:

<user_request>
${userPrompt}
</user_request>

## Completed Tasks

The following tasks were completed during implementation:

${completedTasks}

## Review Instructions

Your task is to conduct a thorough code review of the changes made during this implementation. Use \`git diff\` to examine the actual code changes that were made.

### Review Focus Areas

Examine the implementation for:

1. **Correctness of Logic**: Does the code correctly implement the specified requirements? Are there any logical errors or incorrect assumptions?

2. **Error Handling**: Are errors properly caught and handled? Are edge cases considered? Are error messages clear and actionable?

3. **Edge Cases**: Does the code handle boundary conditions, empty inputs, null/undefined values, and other edge cases appropriately?

4. **Security Concerns**: Are there any security vulnerabilities such as injection attacks, exposure of sensitive data, or improper authentication/authorization?

5. **Performance Implications**: Are there any obvious performance issues like unnecessary loops, inefficient algorithms, or resource leaks?

6. **Test Coverage**: Are the changes adequately tested? Are there missing test cases for critical paths or edge cases?

### Output Format

Produce your review findings in the following JSON format:

\`\`\`json
{
  "findings": [
    {
      "title": "[P0] Brief title of the finding (prefix with priority: P0=critical, P1=important, P2=moderate, P3=minor)",
      "body": "Detailed explanation of the issue, why it matters, and suggested fix",
      "confidence_score": 0.95,
      "priority": 0,
      "code_location": {
        "absolute_file_path": "/full/path/to/file.ts",
        "line_range": { "start": 42, "end": 45 }
      }
    }
  ],
  "overall_correctness": "patch is correct" OR "patch is incorrect",
  "overall_explanation": "Summary of the overall quality and correctness of the implementation",
  "overall_confidence_score": 0.85
}
\`\`\`

### Priority Definitions

- **P0 (Critical)**: Bugs, security issues, or correctness problems that must be fixed immediately
- **P1 (Important)**: Significant issues affecting functionality, performance, or maintainability
- **P2 (Moderate)**: Issues that should be addressed but don't block functionality
- **P3 (Minor)**: Style suggestions, minor improvements, or low-impact optimizations

### Guidelines

- Focus on substantive issues that affect correctness, security, or functionality
- Provide specific, actionable feedback with clear explanations
- Include exact file paths and line ranges when referencing code
- Use confidence scores to indicate how certain you are about each finding
- Set overall_correctness to "patch is incorrect" only if there are P0 or P1 issues that prevent the feature from working correctly

Begin your review now.`;
}

/** Parse the reviewer's JSON output, handling various formats */
export function parseReviewResult(content: string): ReviewResult | null {
  try {
    // First try: direct JSON parsing
    const parsed = JSON.parse(content);
    if (parsed.findings && parsed.overall_correctness) {
      // Filter out low-priority findings (P3)
      const actionableFindings = (parsed.findings as ReviewFinding[]).filter(
        (f) => f.priority === undefined || f.priority <= 2
      );
      return {
        ...parsed,
        findings: actionableFindings,
      };
    }
  } catch {
    // Continue to next attempt
  }

  try {
    // Second try: extract from markdown code fence
    const codeBlockMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch?.[1]) {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (parsed.findings && parsed.overall_correctness) {
        const actionableFindings = (parsed.findings as ReviewFinding[]).filter(
          (f) => f.priority === undefined || f.priority <= 2
        );
        return {
          ...parsed,
          findings: actionableFindings,
        };
      }
    }
  } catch {
    // Continue to next attempt
  }

  try {
    // Third try: extract JSON object from surrounding prose
    const jsonObjectMatch = content.match(/\{[\s\S]*"findings"[\s\S]*\}/);
    if (jsonObjectMatch) {
      const parsed = JSON.parse(jsonObjectMatch[0]);
      if (parsed.findings && parsed.overall_correctness) {
        const actionableFindings = (parsed.findings as ReviewFinding[]).filter(
          (f) => f.priority === undefined || f.priority <= 2
        );
        return {
          ...parsed,
          findings: actionableFindings,
        };
      }
    }
  } catch {
    // All attempts failed
  }

  return null;
}

/** Build a fix specification document from review findings */
export function buildFixSpecFromReview(
  review: ReviewResult,
  tasks: TaskItem[],
  userPrompt: string
): string {
  // If no actionable findings or patch is correct, return empty string
  if (
    review.findings.length === 0 ||
    (review.overall_correctness === "patch is correct" && review.findings.length === 0)
  ) {
    return "";
  }

  // Build the fix specification
  let fixSpec = `# Review Fix Specification

## Original Implementation

${userPrompt}

## Review Verdict

**Overall Correctness:** ${review.overall_correctness}

${review.overall_explanation}

## Findings Requiring Fixes

`;

  // Sort findings by priority (P0 first, then P1, then P2)
  const sortedFindings = [...review.findings].sort((a, b) => {
    const priorityA = a.priority ?? 3;
    const priorityB = b.priority ?? 3;
    return priorityA - priorityB;
  });

  // Add each finding as a section
  sortedFindings.forEach((finding, index) => {
    const priorityLabel = finding.priority !== undefined ? `P${finding.priority}` : "P2";
    const location = finding.code_location
      ? `${finding.code_location.absolute_file_path}:${finding.code_location.line_range.start}-${finding.code_location.line_range.end}`
      : "Location not specified";

    fixSpec += `### Finding ${index + 1}: ${finding.title}

- **Priority:** ${priorityLabel}
- **Location:** ${location}
- **Issue:** ${finding.body}
- **Rubric:** The fix is complete when the issue described above is resolved, the code correctly handles this case, and existing tests continue to pass.

`;
  });

  // Add fix guidelines
  fixSpec += `## Fix Guidelines

- Address each finding in priority order (P0 first, then P1, then P2).
- Run existing tests after each fix to verify no regressions.
- Focus on correctness and minimal changes — do not refactor unrelated code.
- If a finding cannot be addressed, document why and mark the task as blocked.
`;

  return fixSpec;
}
