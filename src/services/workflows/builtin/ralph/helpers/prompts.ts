/**
 * Ralph Prompt Utilities
 *
 * Provides the prompts used by the /ralph two-step workflow:
 *   Step 1: Task decomposition (buildSpecToTasksPrompt)
 *   Step 2: Worker sub-agent dispatch (buildWorkerAssignment)
 *   Step 3: Review & Fix (buildReviewPrompt, buildFixSpecFromReview)
 *
 * The worker agent prompt lives in .claude/agents/worker.md (and equivalent
 * paths for OpenCode / Copilot). It is registered by each SDK at session
 * start — the workflow only needs to spawn the "worker" sub-agent with
 * the task list as context.
 */

import type {
    WorkflowRuntimeTaskIdentity,
    WorkflowRuntimeTaskResultEnvelope,
} from "@/services/workflows/runtime-contracts.ts";

export interface TaskItem {
    id?: string;
    description: string;
    status: string;
    summary: string;
    blockedBy?: string[];
    identity?: WorkflowRuntimeTaskIdentity;
    taskResult?: WorkflowRuntimeTaskResultEnvelope;
}

function isCompletedStatus(status: string): boolean {
    return status.trim().toLowerCase() === "completed";
}

// ============================================================================
// STEP 1: TASK DECOMPOSITION
// ============================================================================

/** Build the spec-to-tasks prompt for decomposing a spec into tasks via the task_list tool */
export function buildSpecToTasksPrompt(specContent: string): string {
    return `You are a task decomposition engine.

<specification>
${specContent}
</specification>

<instructions>
Decompose the specification above into an ordered list of implementation tasks,
then persist them using the task_list tool.

1. Read the specification and identify every distinct deliverable.
2. Order tasks by priority: foundational/infrastructure first, then features, then tests, then polish.
3. Analyze technical dependencies between tasks and populate blockedBy arrays.
4. Call the task_list tool with the "create_tasks" action, passing all tasks at once.
</instructions>

<tool_usage>
You MUST call the task_list tool to create tasks. Do NOT output raw JSON.

Call the tool like this:
{
  "action": "create_tasks",
  "tasks": [
    {
      "id": "1",
      "description": "Concise imperative task description, under 80 characters",
      "status": "pending",
      "summary": "Present-participle phrase for UI display, under 60 characters",
      "blockedBy": []
    }
  ]
}

Field definitions:

| Field       | Type     | Constraint                                                                 |
|-------------|----------|----------------------------------------------------------------------------|
| id          | string   | Sequential starting at "1". Values: "1", "2", "3", …                      |
| description | string   | Concise imperative task description, under 80 characters.                  |
| status      | string   | Always the literal value "pending".                                        |
| summary     | string   | Present-participle phrase for UI display (e.g. "Implementing auth endpoint"). Under 60 characters. |
| blockedBy   | string[] | Array of id values this task depends on. Use [] when there are no dependencies. Every value in this array MUST be the id of another task in the list. |
</tool_usage>

<constraints>
- Every task object MUST have all five fields. Do not omit any field.
- Do not add fields beyond the five listed above.
- id is a string. Correct: "1". Wrong: 1 or "#1".
- blockedBy values are strings. Correct: ["1", "2"]. Wrong: [1, 2] or ["#1", "#2"].
- blockedBy must only reference id values that exist in the task list.
- status is always "pending". Do not use any other value.
- You MUST call the task_list tool. Do NOT output a raw JSON array as text.
</constraints>`;
}

// ============================================================================
// STEP 2: WORKER ASSIGNMENT
// ============================================================================

/** Build a prompt for assigning a single task to a worker sub-agent. */
export function buildWorkerAssignment(
    task: TaskItem,
    allTasks: TaskItem[],
): string {
    const taskId = task.id ?? "unknown";

    const dependencies = (task.blockedBy ?? []).map((dependencyId) => {
        const dependency = allTasks.find(
            (candidate) => candidate.id === dependencyId,
        );
        if (!dependency) {
            return `- ${dependencyId}: (not found)`;
        }
        return `- ${dependencyId}: ${dependency.description}`;
    });

    const completedTasks = allTasks
        .filter((candidate) => isCompletedStatus(candidate.status))
        .map((candidate) => `- ${candidate.id ?? "?"}: ${candidate.description}`);

    const dependencySection =
        dependencies.length > 0
            ? `# Dependencies

${dependencies.join("\n")}

`
            : "";

    const completedSection =
        completedTasks.length > 0
            ? `# Completed Tasks

${completedTasks.join("\n")}

`
            : "";

    return `# Task Assignment

**Task ID:** ${taskId}
**Task:** ${task.description}

${dependencySection}${completedSection}# Instructions

Focus solely on this task.
Implement it until complete and tested.
Do not modify unrelated task statuses.
If blocked, record the issue and set the task status to "error".
Begin implementation.`;
}

// ============================================================================
// STEP 2b: ORCHESTRATOR
// ============================================================================

/**
 * Build the orchestrator prompt that instructs the main agent to manage
 * parallel task execution using its native sub-agent capabilities.
 *
 * The orchestrator retrieves the current task list from the task_list tool
 * (SQLite-backed CRUD) via the list_tasks action, rather than receiving
 * tasks inline. This avoids duplicating task data in the prompt and ensures
 * the orchestrator always sees the latest state.
 *
 * The prompt encodes:
 *   - Instructions to retrieve tasks via list_tasks action
 *   - blockedBy enforcement rules
 *   - Error handling and failure propagation
 *   - Task status protocol (in_progress → completed/error)
 */
export function buildOrchestratorPrompt(
): string {

    return `You are an orchestrator managing a set of implementation tasks.

## Retrieve Task List

Start by calling the task_list tool to retrieve the current task list:
\`{"action": "list_tasks"}\`

The planner has already created all tasks via the task_list tool (persisted
to SQLite). You MUST call list_tasks before proceeding with any execution.

## Dependency Graph Integrity Check

BEFORE executing any tasks, validate the dependency graph:

1. For each task, check that every ID in its "blockedBy" array corresponds to an actual task ID in the task list.
2. If a blockedBy reference points to a task ID that does NOT exist in the list, that reference is a **dangling dependency** caused by data corruption during planning.
3. **Remove dangling dependencies**: Drop any blockedBy entry that references a non-existent task ID. The task is still valid — only the corrupted reference should be removed.
4. After cleanup, re-evaluate which tasks are ready.

This step is critical. Dangling dependencies will permanently block tasks if not removed.

## Dependency Rules

A task is READY to execute only when:
1. Its status is "pending"
2. ALL tasks listed in its "blockedBy" array have status "completed"

Do NOT spawn a sub-agent for a task whose dependencies are not yet completed.

## Instructions

1. **Retrieve the task list** by calling list_tasks. This is your source of truth for all task data.

2. **Validate the dependency graph** using the integrity check above. Remove any dangling dependencies.

3. **Identify ready tasks**: Find all tasks with status "pending" whose blockedBy
   dependencies are all "completed". These are ready to execute.

4. **Spawn parallel sub-agents**: For each ready task, spawn a sub-agent using
   the Task tool. Give each sub-agent a focused prompt with:
   - The task description
   - Context about completed dependency tasks
   - Instructions to implement the task fully and test it

5. **Monitor completions**: As sub-agents complete, check if any blocked tasks
   are now unblocked. Spawn new sub-agents for newly-unblocked tasks immediately.

6. **Continue until ALL tasks are complete.** Do NOT stop early.

7. **Report a summary** when finished, listing each task and its final status.

## IMPORTANT

Spawn ALL ready tasks in parallel — do not wait for one to finish
before starting another unblocked task. Do NOT serialize task execution
when multiple tasks are ready simultaneously.

## Error Handling

When a sub-agent task FAILS:

1. **Diagnose**: Read the error output to understand the root cause.
2. **Retry with fix**: Spawn a NEW sub-agent for the same task with the error context included in its prompt. Instruct it to fix the issue and complete the task.
3. **Retry limit**: Retry each failed task up to 3 times. If it still fails after retries, mark it as "error".
4. **Continue regardless**: After marking a task as "error", do NOT stop. Continue executing all other tasks that are not blocked by the errored task.
5. **Unblocked tasks proceed**: Tasks whose dependencies are all "completed" are still ready — execute them even if sibling tasks have errors.

NEVER mark tasks as "blocked-by-failure" and stop. The goal is to complete as much work as possible. Only the specific tasks whose direct dependencies are in "error" status should be skipped — all other tasks must still be attempted.

## Task Status Protocol

The task list drives a real-time UI widget. Users watch it to track progress.
Stale statuses make it look like the system is stuck. You MUST update the
task list **immediately** at every transition — not in batches, not later.

### Required update sequence for EACH task

1. **IMMEDIATELY BEFORE spawning** a sub-agent for a task, call the task_list
   tool to set that task's status to "in_progress":
   \`{"action": "update_task_status", "taskId": "<id>", "status": "in_progress"}\`
2. **IMMEDIATELY AFTER a sub-agent returns** (success or failure), call the
   task_list tool to set that task's status to "completed" or "error":
   \`{"action": "update_task_status", "taskId": "<id>", "status": "completed"}\`

### Timing rules

- Call the task_list tool **within the same tool-call turn** as the event that
  triggered the status change. Do NOT wait to combine it with other updates.
- When multiple sub-agents complete in parallel, issue a SEPARATE
  update_task_status call for each completion — do not batch them.
- When spawning the next wave of tasks, first mark the previous task(s) as
  "completed", then mark the new task(s) as "in_progress" BEFORE spawning.

### Incremental API

Each task_list call updates a SINGLE task by ID. You do NOT need to send the
full task list — just the task ID and new status. This is more efficient and
avoids data loss from dropped tasks in snapshot payloads.

### Checking task state

To see the current state of all tasks, call:
\`{"action": "list_tasks"}\``;
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
export function buildReviewPrompt(
    userPrompt: string,
    priorDebuggerOutput?: string,
): string {

    return `# Code Review Request

## Original Specification

The implementation was requested to fulfill the following specification:

<user_request>
${userPrompt}
</user_request>

## Retrieve Task List

Start by calling the task_list tool to retrieve the current task list and progress:
\`{"action": "list_tasks"}\`

Use the returned task data to:
1. Build the task plan (all tasks with their statuses)
2. Identify completed vs incomplete tasks
3. Calculate completion metrics

You can also retrieve detailed progress notes for individual tasks:
\`{"action": "get_task_progress"}\`

## Review Instructions

Your task is to conduct a thorough code review of the changes made during this implementation. Use the task list from the task_list tool to understand the scope and status of all tasks.

### Review Focus Areas

Examine the implementation for:

1. **Task Completion & Specification Gap Analysis**: This is the MOST IMPORTANT review step. You MUST:
   a. Check the task list for completion status. If any tasks are not completed, the implementation is incomplete and MUST be flagged.
   b. For each task in ERROR, PENDING, or BLOCKED status, create a separate P0 finding describing what specification requirement is missing from the implementation.
   c. Cross-reference the task plan against the original specification. Identify any specification requirements NOT covered by any task (missing tasks).
   d. Identify completed tasks that only partially fulfill their corresponding specification requirement.
   Do NOT approve an incomplete implementation. If tasks are incomplete, overall_correctness MUST be "patch is incorrect".

2. **Correctness of Logic**: Does the code correctly implement the specified requirements? Are there any logical errors or incorrect assumptions?

3. **Error Handling**: Are errors properly caught and handled? Are edge cases considered? Are error messages clear and actionable?

4. **Edge Cases**: Does the code handle boundary conditions, empty inputs, null/undefined values, and other edge cases appropriately?

5. **Security Concerns**: Are there any security vulnerabilities such as injection attacks, exposure of sensitive data, or improper authentication/authorization?

6. **Performance Implications**: Are there any obvious performance issues like unnecessary loops, inefficient algorithms, or resource leaks?

7. **Test Coverage**: Are the changes adequately tested? Are there missing test cases for critical paths or edge cases?

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

- **P0 (Critical)**: Bugs, security issues, correctness problems, or specification gaps that must be fixed immediately
- **P1 (Important)**: Significant issues affecting functionality, performance, or maintainability
- **P2 (Moderate)**: Issues that should be addressed but don't block functionality
- **P3 (Minor)**: Style suggestions, minor improvements, or low-impact optimizations

### Guidelines

- Begin by retrieving the task list via the task_list tool, then perform the specification gap analysis — this is the highest-priority review step
- Focus on substantive issues that affect correctness, security, or functionality
- Provide specific, actionable feedback with clear explanations
- Include exact file paths and line ranges when referencing code
- Use confidence scores to indicate how certain you are about each finding
- Set overall_correctness to "patch is incorrect" if there are P0 or P1 issues that prevent the feature from working correctly, including specification gaps
${priorDebuggerOutput
            ? `
## Prior Debugging Context

The following fixes were applied by the debugger in the previous iteration. Pay special attention to whether these fixes actually resolved the issues they targeted, and whether they introduced any regressions:

<prior_debugger_output>
${priorDebuggerOutput}
</prior_debugger_output>
`
            : ""
        }
Begin your review now.`;
}

/** Build a fix specification document from review findings */
export function buildFixSpecFromReview(
    review: ReviewResult,
    tasks: TaskItem[],
    userPrompt: string,
): string {
    // If no actionable findings or patch is correct, return empty string
    if (
        review.findings.length === 0 ||
        (review.overall_correctness === "patch is correct" &&
            review.findings.length === 0)
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
        const priorityLabel =
            finding.priority !== undefined ? `P${finding.priority}` : "P2";
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

/** Build a fallback fix specification using raw reviewer output */
export function buildFixSpecFromRawReview(
    rawReviewResult: string,
    userPrompt: string,
): string {
    const trimmed = rawReviewResult.trim();
    if (trimmed.length === 0) {
        return "";
    }

    return `# Review Fix Specification

## Original Implementation

${userPrompt}

## Reviewer Output (Unparsed)

The reviewer response could not be parsed as structured JSON. Treat the raw output below as authoritative review feedback and apply any actionable fixes.

\`\`\`
${trimmed}
\`\`\`

## Fix Guidelines

- Extract concrete issues from the reviewer output and fix them.
- Focus on correctness and minimal changes.
- Run relevant tests after each fix to prevent regressions.
- If any feedback is unclear or non-actionable, document the interpretation used.
`;
}

// ============================================================================
// REVIEW RESULT PARSING
// ============================================================================

/** Parse the reviewer's JSON output, handling various formats */
export function parseReviewResult(content: string): ReviewResult | null {
    try {
        // First try: direct JSON parsing
        const parsed = JSON.parse(content);
        if (parsed.findings && parsed.overall_correctness) {
            // Filter out low-priority findings (P3)
            const actionableFindings = (
                parsed.findings as ReviewFinding[]
            ).filter((f) => f.priority === undefined || f.priority <= 2);
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
        const codeBlockMatch = content.match(
            /```(?:json)?\s*\n([\s\S]*?)\n```/,
        );
        if (codeBlockMatch?.[1]) {
            const parsed = JSON.parse(codeBlockMatch[1]);
            if (parsed.findings && parsed.overall_correctness) {
                const actionableFindings = (
                    parsed.findings as ReviewFinding[]
                ).filter((f) => f.priority === undefined || f.priority <= 2);
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
                const actionableFindings = (
                    parsed.findings as ReviewFinding[]
                ).filter((f) => f.priority === undefined || f.priority <= 2);
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
