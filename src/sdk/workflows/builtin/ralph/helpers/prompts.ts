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
  title: z
    .string()
    .describe(
      "Brief title prefixed with priority, e.g. '[P0] Missing null check'",
    ),
  body: z
    .string()
    .describe(
      "Detailed explanation of the issue, its impact, and a suggested fix",
    ),
  confidence_score: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Confidence in the finding (0.0–1.0)"),
  priority: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe(
      "Severity: 0=P0 critical, 1=P1 important, 2=P2 moderate, 3=P3 minor",
    ),
  code_location: z
    .object({
      absolute_file_path: z
        .string()
        .describe("Absolute path to the file containing the issue"),
      line_range: z.object({
        start: z.number().int().describe("Start line number"),
        end: z.number().int().describe("End line number"),
      }),
    })
    .optional()
    .describe("Location of the issue in the codebase"),
});

/** Zod schema for the full structured review output. */
export const ReviewResultSchema = z.object({
  findings: z
    .array(ReviewFindingSchema)
    .describe("List of review findings, ordered by priority"),
  overall_correctness: z
    .string()
    .describe("'patch is correct' or 'patch is incorrect'"),
  overall_explanation: z
    .string()
    .describe("Summary of overall quality and correctness"),
  overall_confidence_score: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Overall confidence in the review (0.0–1.0)"),
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
  const parsedA =
    a.structured ?? (a.raw.trim() ? parseReviewResult(a.raw) : null);
  const parsedB =
    b.structured ?? (b.raw.trim() ? parseReviewResult(b.raw) : null);

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
      overall_correctness: isIncorrect
        ? "patch is incorrect"
        : "patch is correct",
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
 * Build the planner prompt. The first iteration authors an RFC from the
 * original spec; subsequent iterations revise the RFC using the debugger
 * report from the previous loop iteration.
 *
 * The planner's deliverable is a filled-in Technical Design Document / RFC
 * rendered as markdown text
 * consumes the RFC as design context
 */
export function buildPlannerPrompt(
  spec: string,
  context: PlannerContext = { iteration: 1 },
): string {
  const debuggerReport = context.debuggerReport?.trim() ?? "";
  const isReplan = context.iteration > 1 && debuggerReport.length > 0;

  const header = isReplan
    ? `# Technical Design Revision (Iteration ${context.iteration})

The previous iteration's implementation was flagged by the reviewer, and the
debugger investigated. Revise the RFC so it reflects the corrected approach.`
    : `# Technical Design (Iteration 1)

Author a Technical Design Document / RFC for the specification below.`;

  const specBlock = `## Original Specification

<specification>
${spec}
</specification>`;

  const debuggerBlock = isReplan
    ? `

## Debugger Report (authoritative)

<debugger_report>
${debuggerReport}
</debugger_report>

### Revision Focus

Fold every issue in the debugger report into the revised RFC:

- **Section 5 (Detailed Design)** — specify the corrected approach. Every
  "Issue Identified" in the report should map to a concrete design change.
- **Section 6 (Alternatives Considered)** — if the root cause points to a
  better option than the one previously chosen, promote it and demote the
  current choice to "rejected" with the new rejection reason.
- **Section 8 (Migration, Rollout, and Testing)** — add validation steps
  that would have caught the regression.
- **Section 9 (Open Questions / Unresolved Issues)** — surface any
  uncertainty the debugger flagged as unresolved.`
    : "";

  return `${header}

${specBlock}${debuggerBlock}

${
  isReplan
    ? `## Step 1: Author a Revised RFC

This is a re-plan iteration — the debugger report above MUST be folded into
the design. Always author a revised RFC here, even if the original
specification was a file path. If the spec is a path, Read the file first to
get the original design, then produce a revised RFC that incorporates the
debugger findings. Do NOT short-circuit to just the path on re-plan.`
    : `## Step 1: Spec Path Short-Circuit (do this FIRST)

The specification above may be either a **file path** to an existing spec
document, or **raw prose** describing a feature.

Before doing anything else, determine which case you're in:

- If the specification looks like a path (ends in \`.md\`, \`.txt\`, \`.rst\`,
  or similar; starts with \`/\`, \`./\`, or \`~/\`; or contains \`/\` and no
  line breaks), attempt to Read it.
- If the Read succeeds, the user has already authored a spec file — there is
  **nothing to draft**. Resolve the path to an absolute path (via Bash
  \`realpath <path>\` or equivalent) and output ONLY that absolute path as
  your final message. Emit nothing else: no RFC, no summary, no commentary.
  The orchestrator will read the file itself.
- If Read fails, or the specification is clearly inline prose (multiple
  sentences, paragraph structure, no file extension), proceed to Step 2 and
  author the full RFC below.

Do NOT author an RFC when the user has already provided a spec file — just
forward the path. Duplicating the spec wastes tokens and introduces drift.`
}

## Step 2: Author the RFC${isReplan ? " (revision)" : " (only if Step 1 did not short-circuit)"}

1. **Investigate first.** Use Grep/Glob/Read to ground the RFC in the actual
   codebase — the services, modules, data models, and external integrations
   this feature will touch. Use Bash for metadata:
   - \`git config user.name\` → Author(s)
   - \`date '+%Y-%m-%d'\` → Created / Last Updated
2. **Render the RFC template below as your final message.** Preserve every
   section header verbatim and the metadata table exactly. Replace each
   \`_Instruction:_\` italicized block and each \`> **Example:**\` blockquote
   with real, feature-specific content — the templates are authoring guides,
   not final copy.
3. **Diagrams are load-bearing.** Section 4.1 MUST include a Mermaid System
   Architecture diagram grounded in the real components this feature touches.
4. **Non-goals matter.** Section 3.2 prevents scope creep. Always fill it in
   with explicit exclusions — do not leave it generic.
5. **Alternatives must be real.** Section 6 must list at least two concrete
   alternatives (not strawmen) with honest pros, cons, and rejection reasons.
6. **Surface uncertainty.** Put unresolved decisions in Section 9 with an
   owner placeholder (e.g., \`[OWNER: infra team]\`) — do not paper over gaps
   with vague language.

## Constraints

- Output nothing else after the RFC (or path) — no meta-commentary, no
  summary. The document (or path) stands on its own.
- Match depth to stakes: a greenfield service warrants deep sections 5-7; a
  small refactor can abbreviate them, but every section header must be present.`;
}
// ============================================================================
// ORCHESTRATOR
// ============================================================================

export interface OrchestratorContext {
  /**
   * The planner's final assistant message. Under the RFC-based Ralph flow,
   * this is the authoritative design input — either an absolute path to a
   * pre-existing spec file or an inline RFC markdown document. The
   * orchestrator decomposes it into the task list using its SDK-specific
   * task-persistence tool (`TaskCreate` / `sql` / `todowrite`).
   */
  plannerNotes?: string;
}

/**
 * Build the orchestrator prompt. The orchestrator decomposes the planner's
 * design output (a spec path or inline RFC) into a task list using its
 * SDK-specific task-persistence tool, validates the dependency graph, and
 * spawns parallel workers.
 *
 * @param spec - The user's original specification. Used as context/fallback
 *   when the planner output is missing or ambiguous.
 * @param context - Planner handoff (the spec path or RFC markdown).
 */
export function buildOrchestratorPrompt(
  spec: string,
  context: OrchestratorContext = {},
): string {
  const plannerNotes = context.plannerNotes?.trim() ?? "";
  const plannerSection =
    plannerNotes.length > 0
      ? `<planner_output>
${plannerNotes}
</planner_output>`
      : `<planner_output>
(empty — fall back to the Original User Specification below)
</planner_output>`;

  return `You are the workflow orchestrator. You run a three-phase loop:

1. **Decompose** the design document into a task list.
2. **Execute** the tasks by spawning parallel worker sub-agents.
3. **Report** completion status.

## Design Input (authoritative)

The planner produced the output below. It is in **one of two formats**:
- **A file path** (single line, ends in \`.md\`/\`.txt\`/similar, or starts
  with \`/\` / \`./\` / \`~/\`). Read the file to get the spec — its contents
  are what you decompose.
- **An inline RFC markdown document** (multi-section, starts with a metadata
  table or \`# ... Technical Design Document\` header). Decompose it directly.

${plannerSection}

## Original User Specification (context / fallback)

<specification>
${spec}
</specification>

## Phase 1: Decompose the Spec into a Task List

Read the spec (from the path or the inline RFC) and decompose it into an
ordered, parallelism-friendly list of implementation tasks. For each task,
derive:

- A short **gerund subject** (e.g., "Implementing auth middleware").
- An **actionable description** (5-10 words, imperative, specific).
- A **blockedBy / dependency list** (IDs of tasks that must complete first).

**Decomposition guidelines:**

1. **Maximize parallelism.** Tasks with empty dependencies form the first
   wave and run concurrently. Split independent work streams into separate
   tasks rather than chaining them.
2. **Compartmentalize.** Each task should be self-contained — minimize
   shared state and file conflicts. Prefer tasks that touch distinct
   modules/files.
3. **Dependencies only when truly necessary.** Every unnecessary dependency
   reduces throughput. Ask: "Can this genuinely not start without the
   blocked task?"
4. **Start with foundations.** Setup, schema, and shared utilities come
   before feature code. Tests come after the code they cover.
5. **Match sections to task categories.** RFC Section 5 (Detailed Design)
   typically yields 60-80% of tasks. Sections 8.3 (Test Plan) and 7
   (Cross-Cutting) yield validation and infra tasks.

### Persist the Task List

Persist every task using task management tools and encode dependencies. Use your task tools to better manage the status of tasks and mark tasks as complete when their work is done.

## Phase 2: Dependency Graph Integrity Check

BEFORE executing any tasks, validate the graph you just persisted:

1. For each task, check that every dependency reference points to a task ID
   that actually exists.
2. Any reference to a non-existent task ID is a **dangling dependency** —
   drop it. The task itself is still valid; only the corrupted reference
   is removed.
3. Re-evaluate readiness after cleanup.

This step is critical. Dangling dependencies will permanently block tasks.

## Phase 3: Execute

### Readiness Rules

A task is READY only when:
1. Its status is \`pending\`.
2. ALL tasks it depends on are \`completed\`.

Do NOT spawn a worker for a task whose dependencies are not yet completed.

### Execution Loop

1. **Identify all ready tasks** — pending tasks whose dependencies are
   completed.
2. **Spawn parallel workers** — for each ready task, dispatch a worker
   sub-agent (via \`Agent\`/\`Task\`/\`agent\` tool) with a focused prompt
   containing: the task subject + description, relevant context from the
   spec/RFC, and instructions to implement and test.
3. **Monitor completions** — as workers finish, mark tasks \`completed\` and
   spawn newly-unblocked tasks IMMEDIATELY.
4. **Continue until ALL tasks are \`completed\` or \`error\`.** Do NOT stop
   early.
5. **Report a summary** when finished: each task and its final status.

Spawn ALL ready tasks in parallel — do not serialize when multiple are
ready simultaneously.

## Error Handling

When a worker task FAILS:

1. **Diagnose** the error.
2. **Retry with fix**: spawn a new worker with the error context included.
3. **Retry limit**: up to 3 retries per task. After that, mark it \`error\`.
4. **Continue regardless**: do NOT stop. Execute all other unblocked tasks.
5. **Unblocked tasks proceed**: only direct dependents of an \`error\` task
   should be skipped.

NEVER mark tasks "blocked-by-failure" and stop. Complete as much work as
possible.

## Task Status Protocol

Update statuses **immediately** at every transition via task tool.

### Required update sequence per task

1. **IMMEDIATELY BEFORE spawning** a worker → mark \`in_progress\`.
2. **IMMEDIATELY AFTER** the worker returns → mark \`completed\` or
   \`error\`.

### Timing rules

- Update status in the same turn as the triggering event. Never batch.
- When multiple workers complete in parallel, issue a SEPARATE update per
  task.
- Mark previous tasks \`completed\` before marking new ones
  \`in_progress\`.`;
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
    changeset.diffStat.length > 0 || changeset.uncommitted.length > 0;
  const hasErrors = changeset.errors.length > 0;

  // ── Changeset section ──────────────────────────────────────────────────

  let changesetSection: string;

  if (hasChanges || hasErrors) {
    const parts: string[] = [];

    parts.push(`## Branch Changeset (relative to \`${changeset.baseBranch}\`)`);

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
      parts.push("", "### Diff Summary", "", "```", changeset.diffStat, "```");
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
      parts.push(
        `Changed files (relative to \`${changeset.baseBranch}\`):`,
        "```",
        changeset.nameStatus,
        "```",
      );
    }
    if (changeset.uncommitted.length > 0) {
      parts.push(
        `Uncommitted (\`git status -s\`):`,
        "```",
        changeset.uncommitted,
        "```",
      );
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
