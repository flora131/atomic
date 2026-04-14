/**
 * Ralph Prompt Utilities
 *
 * Prompts used by the Ralph plan → orchestrate → review → debug loop:
 *   - buildPlannerPrompt:           initial planning OR re-planning from a debugger report
 *   - buildOrchestratorPrompt:      spawn workers to execute the task list
 *   - buildInfraDiscoveryPrompts:   prompts for parallel sub-agent infrastructure discovery
 *   - buildReviewPrompt:            structured code review with injected changeset + discovery context
 *   - buildDebuggerReportPrompt:    diagnose review findings, produce a re-plan brief
 *
 * Plus Zod schemas for structured output, parsing helpers for the reviewer
 * JSON output, and the debugger markdown report.
 */

import { z } from "zod";

// ============================================================================
// STRUCTURED OUTPUT SCHEMAS
// ============================================================================

/** Zod schema for a single review finding. */
export const ReviewFindingSchema = z.object({
  title: z.string().describe("Brief title prefixed with priority, e.g. '[P0] Missing null check'"),
  body: z.string().describe("Detailed explanation of the issue, its impact, and a suggested fix"),
  confidence_score: z.number().min(0).max(1).optional().describe("Confidence in the finding (0.0–1.0)"),
  priority: z.number().int().min(0).max(3).optional().describe("Severity: 0=P0 critical, 1=P1 important, 2=P2 moderate, 3=P3 minor"),
  code_location: z.object({
    absolute_file_path: z.string().describe("Absolute path to the file containing the issue"),
    line_range: z.object({
      start: z.number().int().describe("Start line number"),
      end: z.number().int().describe("End line number"),
    }),
  }).optional().describe("Location of the issue in the codebase"),
});

/** Zod schema for the full structured review output. */
export const ReviewResultSchema = z.object({
  findings: z.array(ReviewFindingSchema).describe("List of review findings, ordered by priority"),
  overall_correctness: z.string().describe("'patch is correct' or 'patch is incorrect'"),
  overall_explanation: z.string().describe("Summary of overall quality and correctness"),
  overall_confidence_score: z.number().min(0).max(1).optional().describe("Overall confidence in the review (0.0–1.0)"),
});

/** JSON Schema derived from the Zod schema — used by Claude and OpenCode SDKs. */
export const REVIEW_RESULT_JSON_SCHEMA = z.toJSONSchema(ReviewResultSchema);

/** Result from a reviewer stage with structured output support. */
export interface StructuredReviewResult {
  /** Parsed and filtered review from SDK structured output, or null if unavailable */
  structured: ReviewResult | null;
  /** Raw text output for fallback parsing and debugger input */
  raw: string;
}

/**
 * Merge two parallel reviewer results into one.
 *
 * Two independent reviewers run the same prompt simultaneously. This function
 * unions their findings and picks the more conservative overall_correctness.
 * When either reviewer's structured output is unavailable, it falls back to
 * text parsing ({@link parseReviewResult}) before merging.
 */
export function mergeReviewResults(
  a: StructuredReviewResult,
  b: StructuredReviewResult,
): StructuredReviewResult {
  const rawCombined = [a.raw, b.raw].filter(Boolean).join("\n\n---\n\n");

  // Resolve: prefer structured output, fall back to text parsing
  const parsedA = a.structured ?? (a.raw.trim() ? parseReviewResult(a.raw) : null);
  const parsedB = b.structured ?? (b.raw.trim() ? parseReviewResult(b.raw) : null);

  if (!parsedA && !parsedB) {
    return { structured: null, raw: rawCombined };
  }

  const findingsA = parsedA?.findings ?? [];
  const findingsB = parsedB?.findings ?? [];

  const correctnessA = parsedA?.overall_correctness ?? "patch is correct";
  const correctnessB = parsedB?.overall_correctness ?? "patch is correct";
  const isIncorrect =
    correctnessA === "patch is incorrect" ||
    correctnessB === "patch is incorrect";

  const explanations = [
    parsedA?.overall_explanation,
    parsedB?.overall_explanation,
  ].filter(Boolean) as string[];

  const confidences = [
    parsedA?.overall_confidence_score,
    parsedB?.overall_confidence_score,
  ].filter((c): c is number => c !== undefined);

  return {
    structured: {
      findings: [...findingsA, ...findingsB],
      overall_correctness: isIncorrect ? "patch is incorrect" : "patch is correct",
      overall_explanation: explanations.join(" | "),
      overall_confidence_score:
        confidences.length > 0 ? Math.max(...confidences) : undefined,
    },
    raw: rawCombined,
  };
}

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

export interface OrchestratorContext {
  /**
   * Trailing commentary from the planner's last assistant message, if any.
   * The Copilot and OpenCode workflows create a fresh session for each
   * sub-agent, so the planner's in-session output is NOT automatically
   * visible to the orchestrator — only what the planner persisted via
   * `TaskCreate`. Forward the planner's final text here so the orchestrator
   * sees any caveats, risks, or execution hints that didn't fit into task
   * bodies.
   */
  plannerNotes?: string;
}

/**
 * Build the orchestrator prompt. The orchestrator retrieves the planner's
 * task list, validates the dependency graph, and spawns parallel workers.
 *
 * @param spec - The original user specification. Required because the
 *   orchestrator runs in a fresh session on Copilot/OpenCode and needs the
 *   end-user goal to resolve ambiguous tasks.
 * @param context - Optional planner handoff context (trailing commentary).
 */
export function buildOrchestratorPrompt(
  spec: string,
  context: OrchestratorContext = {},
): string {
  const plannerNotes = context.plannerNotes?.trim() ?? "";
  const plannerSection =
    plannerNotes.length > 0
      ? `## Planner Notes (trailing commentary)

The planner produced the notes below alongside the task list. They capture
caveats, risks, or execution hints that did not fit into individual task
bodies. Treat them as guidance, not as task definitions.

<planner_notes>
${plannerNotes}
</planner_notes>

`
      : "";

  return `You are an orchestrator managing a set of implementation tasks.

## Original User Specification

<specification>
${spec}
</specification>

${plannerSection}## Retrieve Task List

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
// INFRASTRUCTURE DISCOVERY
// ============================================================================

/** Prompts for the three parallel infrastructure-discovery sub-agents. */
export interface InfraDiscoveryPrompts {
  /** Prompt for the codebase-locator sub-agent. */
  locator: string;
  /** Prompt for the codebase-analyzer sub-agent. */
  analyzer: string;
  /** Prompt for the codebase-pattern-finder sub-agent. */
  patternFinder: string;
}

/**
 * Build prompts for three parallel sub-agent stages that discover the
 * repository's build, test, lint, and CI infrastructure. Each sub-agent
 * explores the codebase dynamically — no hard-coded file lists or patterns.
 *
 * Inspired by the deep-research-codebase workflow which dispatches
 * codebase-locator, codebase-analyzer, and codebase-pattern-finder
 * sub-agents in parallel for exploratory research.
 */
export function buildInfraDiscoveryPrompts(): InfraDiscoveryPrompts {
  return {
    locator: `# Locate Build & Test Infrastructure Files

Find ALL files in this repository that define or configure the build, test,
lint, type-check, and CI/CD infrastructure. Report their paths and a
one-line description of each.

## What to look for

- **Package manifest**: package.json, Cargo.toml, go.mod, pyproject.toml, etc.
- **Lockfiles**: bun.lockb, bun.lock, package-lock.json, yarn.lock, pnpm-lock.yaml, etc.
- **Build config**: tsconfig.json, webpack.config.*, vite.config.*, esbuild.*, rollup.config.*, Makefile, etc.
- **Test config**: jest.config.*, vitest.config.*, playwright.config.*, .mocharc.*, pytest.ini, etc.
- **Lint / format config**: .eslintrc.*, eslint.config.*, biome.json, .prettierrc.*, oxlint.json, etc.
- **CI/CD workflows**: .github/workflows/*.yml, .gitlab-ci.yml, Jenkinsfile, .circleci/config.yml, etc.
- **Agent config files**: CLAUDE.md, AGENTS.md, .claude/*, .github/copilot-instructions.md (these often document project commands)

## Output format

Respond with a flat list:

\`\`\`
<path> — <one-line description>
\`\`\`

Be exhaustive. Do NOT skip files just because they seem minor — CI configs
and agent instruction files often contain the authoritative command list.
End with a brief trailing summary (1-2 sentences) of what you found.`,

    analyzer: `# Analyze Build & Test Infrastructure

Examine this repository's build, test, lint, and type-check infrastructure.
Your goal is to produce a concise reference that tells a reviewer exactly
which commands to run to verify an implementation.

## Investigation steps

1. Read the package manifest (package.json, Cargo.toml, go.mod, etc.) and
   list every script/target related to building, testing, linting,
   type-checking, or formatting.
2. Identify the package manager (bun, npm, yarn, pnpm, cargo, go, make)
   from lockfiles or config.
3. Read CI workflow files (.github/workflows/*.yml, etc.) and extract the
   key \`run:\` commands — these are the authoritative "what CI actually
   executes" list.
4. Read CLAUDE.md / AGENTS.md if present — they often document the
   canonical commands for contributors.
5. Identify the test framework(s) in use and how to invoke them.

## Output format

\`\`\`
## Package Manager
<name>

## Build Commands
- \`<command>\` — <what it does>

## Test Commands
- \`<command>\` — <what it does>

## Lint / Type-check Commands
- \`<command>\` — <what it does>

## CI Commands (from workflow files)
- \`<command>\` — <source file and context>
\`\`\`

Be specific — include the exact invocation string (e.g. \`bun test\`, not
just "run tests"). If a command has variants (e.g. test:unit, test:e2e),
list each separately. End with a brief trailing summary.`,

    patternFinder: `# Find Build & Test Patterns

Search this repository for existing patterns that show how code is built,
tested, and validated. A reviewer needs to know not just WHAT commands exist,
but HOW they are used in practice.

## What to find

1. **Test file patterns**: Where do tests live? What naming convention
   (*.test.ts, *.spec.ts, *_test.go, etc.)? Show 2-3 example paths.
2. **Test execution patterns**: How are tests actually run? Find examples in
   CI configs, scripts, or documentation. Note any environment variables or
   flags that are standard (e.g. CLAUDECODE=1, --coverage).
3. **Build patterns**: How is the project built? Is there a multi-step build
   (e.g. codegen → compile → bundle)? What order matters?
4. **Quality gate patterns**: What checks gate a merge? Look at CI workflows,
   pre-commit hooks, and PR check configurations. List the commands in the
   order CI runs them.
5. **Dependency install pattern**: How are dependencies installed before
   build/test (e.g. \`bun install\`, \`npm ci\`)?

## Output format

For each pattern found, report:
- The pattern name
- The concrete command or file path
- A brief explanation of when/how it's used

End with a brief trailing summary of the overall build/test workflow order
(e.g. "install → typecheck → lint → test → build").`,
  };
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
  /**
   * Full branch changeset captured by {@link captureBranchChangeset}.
   * Contains diff stat, name-status, and uncommitted changes relative to
   * the parent branch — giving the reviewer complete visibility into every
   * change this branch introduces.
   */
  changeset: {
    baseBranch: string;
    diffStat: string;
    uncommitted: string;
    nameStatus: string;
    errors: string[];
  };
  /** 1-indexed loop iteration, used in the prompt header. */
  iteration?: number;
  /**
   * When true, instructs the reviewer to call the `submit_review` tool
   * instead of outputting JSON directly. Used by the Copilot SDK which
   * achieves structured output through tool definitions.
   */
  useSubmitTool?: boolean;
  /**
   * Raw output from the parallel infrastructure-discovery sub-agents
   * (codebase-locator, codebase-analyzer, codebase-pattern-finder).
   * When present, the reviewer uses this to identify and run the
   * repository's build/test/lint commands as part of verification.
   */
  discoveryContext?: string;
}

/**
 * Build the reviewer prompt. Injects a deterministic branch-relative
 * changeset so the reviewer sees every file this branch has touched —
 * both committed and uncommitted — without expensive tool calls.
 */
export function buildReviewPrompt(
  spec: string,
  context: ReviewContext,
): string {
  const { changeset } = context;
  const hasChanges =
    changeset.diffStat.length > 0 ||
    changeset.uncommitted.length > 0;
  const hasErrors = changeset.errors.length > 0;

  // ── Changeset section ──────────────────────────────────────────────────

  let changesetSection: string;

  if (hasChanges || hasErrors) {
    const parts: string[] = [];

    parts.push(
      `## Branch Changeset (relative to \`${changeset.baseBranch}\`)`,
    );

    // Surface git errors first — the agent needs to know the data is partial
    if (hasErrors) {
      parts.push(
        "",
        "### Git Errors",
        "",
        "The following git commands failed during changeset capture. The data",
        "below may be **incomplete**. You should re-run the failed commands",
        "yourself to get the full picture, or flag the gap as a finding.",
        "",
        ...changeset.errors.map((e) => `- ${e}`),
      );
    }

    if (hasChanges) {
      parts.push(
        "",
        "The following shows every change this branch introduces — both committed",
        "and uncommitted. Use this to scope your review. Read the actual file",
        "contents for any file that warrants closer inspection.",
      );
    }

    if (changeset.nameStatus.length > 0) {
      parts.push(
        "",
        "### Changed Files",
        "",
        "```",
        changeset.nameStatus,
        "```",
      );
    }

    if (changeset.diffStat.length > 0) {
      parts.push(
        "",
        "### Diff Summary",
        "",
        "```",
        changeset.diffStat,
        "```",
      );
    }

    if (changeset.uncommitted.length > 0) {
      parts.push(
        "",
        "### Uncommitted Changes (`git status -s`)",
        "",
        "These changes are in the working tree but not yet committed:",
        "",
        "```",
        changeset.uncommitted,
        "```",
      );
    }

    changesetSection = parts.join("\n");
  } else {
    changesetSection = `## Branch Changeset (relative to \`${changeset.baseBranch}\`)

No changes detected relative to \`${changeset.baseBranch}\`. Either nothing
was implemented, all changes were reverted, or you are already on the base
branch. Cross-check the task list to verify whether the implementation ran.`;
  }

  // ── Header ─────────────────────────────────────────────────────────────

  const header = context.iteration
    ? `# Code Review Request (Iteration ${context.iteration})`
    : "# Code Review Request";

  // ── Output instructions ────────────────────────────────────────────────

  const outputSection = context.useSubmitTool
    ? `## Output

You MUST submit your review by calling the \`submit_review\` tool exactly
once with your complete structured review. Do NOT output the review as
plain text — the tool enforces the required schema.`
    : `## Output

Your review output is captured via structured output. The schema is enforced
by the SDK — focus on providing accurate, well-reasoned data for each field.`;

  // ── Discovery context section ────────────────────────────────────────────

  const discoverySection = context.discoveryContext
    ? `## Build & Test Infrastructure Discovery

Three sub-agents explored this repository's build, test, lint, and CI
infrastructure. Their findings are below. Use them to identify the exact
commands you must run to verify the implementation.

${context.discoveryContext}
`
    : "";

  // ── Full prompt ────────────────────────────────────────────────────────

  return `${header}

## Original Specification

<user_request>
${spec}
</user_request>

${changesetSection}

${discoverySection}## Project Conventions

Use the repository's \`AGENTS.md\` and/or \`CLAUDE.md\` files (if present) for
guidance on style, conventions, testing expectations, and architectural
patterns. Your review should respect these project-level norms — flag
deviations only when they conflict with correctness or security, not personal
preference.

## Retrieve Task List

Call \`TaskList\` to fetch the current task plan and statuses. Use it to:
1. Identify completed vs incomplete tasks.
2. Cross-reference the plan against the specification.
3. Calculate completion metrics.

## Verification Step

**Before writing any findings**, run the build, test, lint, and type-check
commands identified in the "Build & Test Infrastructure Discovery" section
above. Execute them via Bash from the repository root. Run ALL commands even
if earlier ones fail — the goal is a complete picture.

- Build failures and type errors → P0 finding.
- Test failures → P1 finding.
- Lint violations → P1 finding.

Include the exact command, exit status, and relevant error output in each
finding's body. If no discovery section is present, attempt to discover
commands yourself by reading package.json, CI configs, or CLAUDE.md.

## Review Focus Areas (priority order)

1. **Task Completion & Specification Gap Analysis** — HIGHEST priority. Every
   task in PENDING / IN_PROGRESS / ERROR status MUST become a P0 finding.
   Every spec requirement not covered by any task is a P0 finding. Do NOT
   mark the patch correct if any task is incomplete.
2. **Verification Failures** — Any build, test, lint, or type-check command
   that failed during the verification step above is a P0 or P1 finding.
   Reference the specific command and error output.
3. **Correctness of Logic** — does the code implement the requirements?
4. **Error Handling & Edge Cases** — boundary, empty/null, error paths.
5. **Security** — injection, secret leakage, auth bypasses.
6. **Performance** — obvious resource leaks, N+1, hot loops.
7. **Test Coverage** — critical paths and edge cases tested.

## Review Guidelines

- Be **constructive and helpful** in your feedback. Every finding should
  include a clear explanation of the impact and a concrete suggested fix.
- Avoid nitpicks (P3) unless they affect readability or maintainability in
  a significant way. The review loop filters out P3 findings.
- When in doubt, give the implementation the benefit of the doubt — flag
  genuine issues, not stylistic preferences.

${outputSection}

### Field Guidance

- **findings**: Each finding should have:
  - \`title\`: Prefix with priority level, e.g. "[P0] Missing null check"
  - \`body\`: What's wrong, why it matters, and how to fix it
  - \`priority\`: 0 = P0 critical, 1 = P1 important, 2 = P2 moderate, 3 = P3 minor
  - \`confidence_score\`: 0.0 – 1.0, how confident you are this is a real issue
  - \`code_location\`: absolute file path and line range (when applicable)

- **overall_correctness**: Set to \`"patch is incorrect"\` whenever there is at
  least one P0 or P1 finding (including incomplete tasks). Use
  \`"patch is correct"\` only when findings are empty or strictly P2/P3.

- **overall_explanation**: Summary of overall quality, correctness, and any
  patterns observed.

Begin your review now.`;
}

// ============================================================================
// DEBUGGER
// ============================================================================

export interface DebuggerContext {
  /** 1-indexed loop iteration the debugger is investigating. */
  iteration: number;
  /**
   * Branch changeset captured immediately before the review. Provides the
   * debugger with the same file-level context as the reviewer.
   */
  changeset: {
    baseBranch: string;
    diffStat: string;
    uncommitted: string;
    nameStatus: string;
    errors: string[];
  };
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

  const { changeset } = context;
  const hasChanges =
    changeset.nameStatus.length > 0 || changeset.uncommitted.length > 0;
  const hasErrors = changeset.errors.length > 0;

  let changesetSection: string;
  if (hasChanges || hasErrors) {
    const parts: string[] = [];
    if (hasErrors) {
      parts.push(
        "**Git errors** (changeset may be incomplete — re-run these yourself):",
        ...changeset.errors.map((e) => `- ${e}`),
        "",
      );
    }
    if (changeset.nameStatus.length > 0) {
      parts.push(`Changed files (relative to \`${changeset.baseBranch}\`):`, "```", changeset.nameStatus, "```");
    }
    if (changeset.uncommitted.length > 0) {
      parts.push(`Uncommitted (\`git status -s\`):`, "```", changeset.uncommitted, "```");
    }
    changesetSection = parts.join("\n");
  } else {
    changesetSection = "(no changes detected)";
  }

  return `# Debugging Report Request (Iteration ${context.iteration})

The reviewer flagged the issues below. Investigate them as a debugger and
produce a structured report that the planner will consume on the next loop
iteration.

**You are NOT applying fixes.** Your only deliverable is the report. Do not
edit files. Investigation tool calls (Read, grep, LSP, running tests in
read-only mode) are fine; mutations are not.

## Reviewer Findings

${findingsSection}

## Branch Changeset

${changesetSection}

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

export function filterActionable(parsed: {
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
