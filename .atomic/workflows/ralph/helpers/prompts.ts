/**
 * Ralph Prompt Utilities
 *
 * Prompts used by the Ralph plan → orchestrate → review → debug loop:
 *   - buildPlannerPrompt:        initial planning OR re-planning from a debugger report
 *   - buildOrchestratorPrompt:   spawn workers to execute the task list
 *   - buildReviewPrompt:         structured code review with injected git status
 *   - buildDebuggerReportPrompt: diagnose review findings, produce a re-plan brief
 *
 * Plus parsing helpers for the reviewer JSON output and the debugger markdown
 * report.
 *
 * Zero-dependency: no imports from the Atomic runtime.
 */

// ============================================================================
// PLANNER
// ============================================================================

export interface PlannerContext {
  /** 1-indexed loop iteration. Iteration 1 = initial plan; >1 = re-plan. */
  iteration: number;
  /** Markdown report from the previous iteration's debugger sub-agent. */
  debuggerReport?: string;
}

/**
 * Build the planner prompt. The first iteration decomposes the original spec;
 * subsequent iterations decompose the work needed to resolve the debugger
 * report from the previous loop iteration.
 */
export function buildPlannerPrompt(
  spec: string,
  context: PlannerContext = { iteration: 1 },
): string {
  const debuggerReport = context.debuggerReport?.trim() ?? "";
  const isReplan = context.iteration > 1 && debuggerReport.length > 0;

  if (isReplan) {
    return `# Re-Planning (Iteration ${context.iteration})

The previous Ralph iteration produced an implementation that the reviewer
flagged as incomplete or incorrect. The debugger investigated and produced
the report below. Use it to re-plan.

## Original Specification

<specification>
${spec}
</specification>

## Debugger Report (authoritative)

<debugger_report>
${debuggerReport}
</debugger_report>

## Your Task

Decompose the work needed to resolve every issue in the debugger report into
an ordered task list, then persist them via TaskCreate.

<instructions>
1. Treat the debugger report as authoritative. Every "Issue Identified" must
   map to at least one task. Every "Suggested Plan Adjustment" must appear as
   (or be subsumed by) a task.
2. Drop any work from the original specification that is already complete and
   unaffected by the report.
3. Order tasks by priority: P0 fixes first, then dependent work, then
   validation/tests.
4. Optimize for parallel execution — minimize blockedBy dependencies.
5. After creating all tasks via TaskCreate, call TaskList to verify.
</instructions>

<constraints>
- All tasks start as "pending".
- blockedBy must reference IDs that exist in the task list.
- Do not split fixes that touch the same file across multiple tasks unless they are truly independent.
</constraints>`;
  }

  // Initial iteration
  return `# Planning (Iteration 1)

You are a task decomposition engine.

<specification>
${spec}
</specification>

<instructions>
Decompose the specification above into an ordered list of implementation tasks
and persist them via TaskCreate.

1. Read the specification and identify every distinct deliverable.
2. Order tasks by priority: foundational/infrastructure first, then features,
   then tests, then polish.
3. Analyze technical dependencies between tasks.
4. After creating all tasks via TaskCreate, call TaskList to verify.
</instructions>

<constraints>
- All tasks start as "pending".
- blockedBy must only reference IDs that exist in the task list.
- Optimize for parallel execution — minimize unnecessary dependencies.
</constraints>`;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/**
 * Build the orchestrator prompt. The orchestrator retrieves the planner's
 * task list, validates the dependency graph, and spawns parallel workers.
 */
export function buildOrchestratorPrompt(): string {
  return `You are an orchestrator managing a set of implementation tasks.

## Retrieve Task List

Start by retrieving the current task list using your TaskList tool. The
planner has already created all tasks; you MUST retrieve them before any
execution.

## Dependency Graph Integrity Check

BEFORE executing any tasks, validate the dependency graph:

1. For each task, check that every ID in its "blockedBy" array corresponds to
   an actual task ID in the list.
2. If a blockedBy reference points to a task ID that does NOT exist, that
   reference is a **dangling dependency** caused by data corruption during
   planning.
3. **Remove dangling dependencies**: Drop any blockedBy entry that references
   a non-existent task ID. The task is still valid — only the corrupted
   reference should be removed.
4. After cleanup, re-evaluate which tasks are ready.

This step is critical. Dangling dependencies will permanently block tasks.

## Dependency Rules

A task is READY only when:
1. Its status is "pending"
2. ALL tasks in its "blockedBy" array are "completed"

Do NOT spawn a worker for a task whose dependencies are not yet completed.

## Instructions

1. **Retrieve the task list** via TaskList. This is your source of truth.
2. **Validate the dependency graph** as above. Remove dangling dependencies.
3. **Identify ready tasks**: pending tasks whose blockedBy is fully completed.
4. **Spawn parallel workers**: for each ready task, spawn a worker via the
   Task tool with a focused prompt containing the task description, context
   from completed dependencies, and instructions to implement and test.
5. **Monitor completions**: as workers finish, mark tasks completed and spawn
   the newly-unblocked tasks immediately.
6. **Continue until ALL tasks are complete.** Do NOT stop early.
7. **Report a summary** when finished, listing each task and its final status.

## IMPORTANT

Spawn ALL ready tasks in parallel — do not serialize when multiple tasks are
ready simultaneously.

## Error Handling

When a worker task FAILS:

1. **Diagnose** the error.
2. **Retry with fix**: spawn a new worker with the error context included.
3. **Retry limit**: up to 3 retries per task. After that, mark it as "error".
4. **Continue regardless**: do NOT stop. Execute all other unblocked tasks.
5. **Unblocked tasks proceed**: only direct dependents of an "error" task
   should be skipped.

NEVER mark tasks as "blocked-by-failure" and stop. Complete as much work as
possible.

## Task Status Protocol

Update task statuses **immediately** at every transition via TaskUpdate.

### Required update sequence per task

1. **IMMEDIATELY BEFORE spawning** a worker for a task → mark "in_progress".
2. **IMMEDIATELY AFTER** the worker returns → mark "completed" or "error".

### Timing rules

- Update status in the same turn as the event that triggered it. Never batch.
- When multiple workers complete in parallel, issue a SEPARATE update for
  each.
- Mark previous tasks "completed" before marking new ones "in_progress".`;
}

// ============================================================================
// REVIEWER
// ============================================================================

/** A single finding from the reviewer sub-agent. */
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

/** Parsed reviewer JSON output. */
export interface ReviewResult {
  findings: ReviewFinding[];
  overall_correctness: string;
  overall_explanation: string;
  overall_confidence_score?: number;
}

export interface ReviewContext {
  /** Output of `git status -s` captured immediately before the review. */
  gitStatus: string;
  /** 1-indexed loop iteration, used in the prompt header. */
  iteration?: number;
  /**
   * Whether this is the second consecutive review pass within the same loop
   * iteration (i.e. the previous pass had zero findings and we are
   * confirming before counting two clean reviews in a row).
   */
  isConfirmationPass?: boolean;
}

/**
 * Build the reviewer prompt. Injects deterministic `git status -s` so the
 * reviewer doesn't have to re-discover what changed.
 */
export function buildReviewPrompt(
  spec: string,
  context: ReviewContext,
): string {
  const gitStatus = context.gitStatus.trim();
  const gitSection =
    gitStatus.length > 0
      ? `## Working Tree (\`git status -s\`)

These files have uncommitted changes — they are the files actually touched in
this iteration. Use them to focus your review:

\`\`\`
${gitStatus}
\`\`\``
      : `## Working Tree (\`git status -s\`)

The working tree is clean. Either nothing was implemented this iteration or
all changes were already committed. Cross-check the task list to verify
whether the implementation actually ran.`;

  const header = context.iteration
    ? `# Code Review Request (Iteration ${context.iteration}${context.isConfirmationPass ? ", confirmation pass" : ""})`
    : "# Code Review Request";

  const confirmationNote = context.isConfirmationPass
    ? `\n\n**Note**: This is a confirmation pass. The previous review of this same iteration produced zero findings. Re-verify with fresh eyes; do not assume the prior pass was correct.`
    : "";

  return `${header}${confirmationNote}

## Original Specification

<user_request>
${spec}
</user_request>

${gitSection}

## Retrieve Task List

Call \`TaskList\` to fetch the current task plan and statuses. Use it to:
1. Identify completed vs incomplete tasks.
2. Cross-reference the plan against the specification.
3. Calculate completion metrics.

## Review Focus Areas (priority order)

1. **Task Completion & Specification Gap Analysis** — HIGHEST priority. Every
   task in PENDING / IN_PROGRESS / ERROR status MUST become a P0 finding.
   Every spec requirement not covered by any task is a P0 finding. Do NOT
   mark the patch correct if any task is incomplete.
2. **Correctness of Logic** — does the code implement the requirements?
3. **Error Handling & Edge Cases** — boundary, empty/null, error paths.
4. **Security** — injection, secret leakage, auth bypasses.
5. **Performance** — obvious resource leaks, N+1, hot loops.
6. **Test Coverage** — critical paths and edge cases tested.

## Output Format

Output ONLY a JSON object inside a single fenced \`\`\`json block. No prose
before or after. Use this schema exactly:

\`\`\`json
{
  "findings": [
    {
      "title": "[P0] Brief title (P0=critical, P1=important, P2=moderate, P3=minor)",
      "body": "Detailed explanation, why it matters, and a suggested fix",
      "confidence_score": 0.95,
      "priority": 0,
      "code_location": {
        "absolute_file_path": "/full/path/to/file.ts",
        "line_range": { "start": 42, "end": 45 }
      }
    }
  ],
  "overall_correctness": "patch is correct",
  "overall_explanation": "Summary of overall quality and correctness",
  "overall_confidence_score": 0.85
}
\`\`\`

Set \`overall_correctness\` to \`"patch is incorrect"\` whenever there is at
least one P0 or P1 finding (including incomplete tasks). Use
\`"patch is correct"\` only when findings are empty or strictly P3.

Begin your review now.`;
}

// ============================================================================
// DEBUGGER
// ============================================================================

export interface DebuggerContext {
  /** 1-indexed loop iteration the debugger is investigating. */
  iteration: number;
  /** Output of `git status -s` from immediately before the review. */
  gitStatus: string;
}

/**
 * Build a prompt asking the debugger sub-agent to investigate a set of review
 * findings and produce a structured report. The debugger MUST NOT apply
 * fixes — its only deliverable is the report, which the next iteration's
 * planner consumes.
 */
export function buildDebuggerReportPrompt(
  review: ReviewResult | null,
  rawReview: string,
  context: DebuggerContext,
): string {
  let findingsSection: string;
  if (review !== null && review.findings.length > 0) {
    const sorted = [...review.findings].sort(
      (a, b) => (a.priority ?? 3) - (b.priority ?? 3),
    );
    findingsSection = sorted
      .map((f, i) => {
        const pri = f.priority !== undefined ? `P${f.priority}` : "P2";
        const loc = f.code_location
          ? `${f.code_location.absolute_file_path}:${f.code_location.line_range.start}-${f.code_location.line_range.end}`
          : "unspecified";
        return `### Finding ${i + 1}: [${pri}] ${f.title}
- **Location:** ${loc}
- **Issue:** ${f.body}`;
      })
      .join("\n\n");
  } else {
    const trimmed = rawReview.trim();
    findingsSection =
      trimmed.length > 0
        ? `Reviewer output (could not parse as JSON):

\`\`\`
${trimmed}
\`\`\``
        : `(no reviewer output captured)`;
  }

  const gitStatus = context.gitStatus.trim();
  const gitSection =
    gitStatus.length > 0
      ? `\`\`\`
${gitStatus}
\`\`\``
      : `(working tree clean)`;

  return `# Debugging Report Request (Iteration ${context.iteration})

The reviewer flagged the issues below. Investigate them as a debugger and
produce a structured report that the planner will consume on the next loop
iteration.

**You are NOT applying fixes.** Your only deliverable is the report. Do not
edit files. Investigation tool calls (Read, grep, LSP, running tests in
read-only mode) are fine; mutations are not.

## Reviewer Findings

${findingsSection}

## Working Tree (\`git status -s\`)

${gitSection}

## Investigation Steps

For each finding:
1. Locate the relevant code (LSP / grep / Read).
2. Identify the **root cause**, not just the symptom.
3. List the absolute file paths that must change.
4. Note constraints, pitfalls, or invariants the next planner must respect.

## Output Format

Respond with EXACTLY one fenced \`\`\`markdown block containing the report.
No prose before or after the block. Use this exact section structure:

\`\`\`markdown
# Debugger Report

## Issues Identified
- [P<priority>] <one-line issue summary>
  - **Root cause:** <one or two sentences>
  - **Files:** <abs/path/file.ext, abs/path/other.ext>
  - **Fix approach:** <imperative description>

## Suggested Plan Adjustments
1. <imperative task description, suitable as a planner task>
2. <...>

## Pitfalls
- <invariant or gotcha the planner/workers must respect>
- <...>
\`\`\`

Keep the report tight — every line must be load-bearing for re-planning. Omit
the "Pitfalls" section entirely if there are none. Begin now.`;
}

// ============================================================================
// PARSING HELPERS
// ============================================================================

/**
 * Parse the reviewer's JSON output. Tries, in order:
 *   1. Direct JSON.parse on the entire content.
 *   2. The LAST fenced ```json (or unlabelled) code block.
 *   3. The LAST balanced object containing a "findings" key in surrounding prose.
 *
 * Filters out P3 (minor/style) findings — only P0/P1/P2 count as actionable.
 * Returns null when no parse strategy succeeds.
 */
export function parseReviewResult(content: string): ReviewResult | null {
  // Strategy 1: direct JSON
  try {
    const parsed = JSON.parse(content);
    if (parsed && parsed.findings && parsed.overall_correctness) {
      return filterActionable(parsed);
    }
  } catch {
    /* fall through */
  }

  // Strategy 2: last fenced code block
  const blockRe = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let lastBlock: string | null = null;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(content)) !== null) {
    if (blockMatch[1]) lastBlock = blockMatch[1];
  }
  if (lastBlock !== null) {
    try {
      const parsed = JSON.parse(lastBlock);
      if (parsed && parsed.findings && parsed.overall_correctness) {
        return filterActionable(parsed);
      }
    } catch {
      /* fall through */
    }
  }

  // Strategy 3: last "{...findings...}" object in surrounding prose
  const objRe = /\{[\s\S]*?"findings"[\s\S]*?\}/g;
  let lastObj: string | null = null;
  let objMatch: RegExpExecArray | null;
  while ((objMatch = objRe.exec(content)) !== null) {
    lastObj = objMatch[0];
  }
  if (lastObj !== null) {
    try {
      const parsed = JSON.parse(lastObj);
      if (parsed && parsed.findings && parsed.overall_correctness) {
        return filterActionable(parsed);
      }
    } catch {
      /* nothing more to try */
    }
  }

  return null;
}

function filterActionable(parsed: {
  findings: ReviewFinding[];
  overall_correctness: string;
  overall_explanation?: string;
  overall_confidence_score?: number;
}): ReviewResult {
  const actionable = parsed.findings.filter(
    (f) => f.priority === undefined || f.priority <= 2,
  );
  return {
    findings: actionable,
    overall_correctness: parsed.overall_correctness,
    overall_explanation: parsed.overall_explanation ?? "",
    overall_confidence_score: parsed.overall_confidence_score,
  };
}

/**
 * Extract the LAST fenced ```markdown block from a piece of text. Used for
 * parsing the debugger's structured report out of a long Claude pane
 * scrollback or any other output that may include extra prose.
 *
 * Falls back to the trimmed full input when no fenced block is present, so
 * the planner still receives the debugger's content even if formatting drifts.
 */
export function extractMarkdownBlock(content: string): string {
  const blockRe = /```markdown\s*\n([\s\S]*?)\n```/g;
  let last: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(content)) !== null) {
    if (match[1]) last = match[1];
  }
  if (last !== null) return last.trim();
  return content.trim();
}
