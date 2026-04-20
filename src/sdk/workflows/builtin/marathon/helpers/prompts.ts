/**
 * Marathon Prompt Utilities
 *
 * Terse prompts for the Marathon continuous-implementation workflow:
 *   - buildBootstrapPrompt:    one-time setup of spec.md, todo.md, tests/
 *   - buildImplementPrompt:    per-iteration implementation step
 *   - buildReviewPrompt:       fresh-context adversarial spec/impl review
 *
 * Plus parsers for the implementer status block and the reviewer verdict.
 *
 * The design follows Simon Last's "13-day coding agent" recipe: the
 * structural rules plus on-disk anchor files (spec.md, todo.md, tests/)
 * carry the work — prompts deliberately avoid re-teaching the agent its
 * job every iteration so tokens go to judgment rather than procedure.
 */

export const SPEC_FILE = "spec.md";
export const TODO_FILE = "todo.md";
export const TESTS_DIR = "tests";

// ============================================================================
// BOOTSTRAP
// ============================================================================

/** Build the one-time bootstrap prompt that seeds `spec.md`, `todo.md`, and `tests/`. */
export function buildBootstrapPrompt(spec: string): string {
  return `Before you start work on this project, create three files:
1. ${SPEC_FILE} — a complete spec with goals, implementation details,
   and a verification section describing exactly how you'll prove
   each piece works.
2. ${TODO_FILE} — a running to-do list you'll edit as you work. Break
   complex tasks into verifiable sub-tasks.
3. ${TESTS_DIR}/ — a folder of end-to-end tests that let you verify
   everything you build. Loop on them until each passes.

<specification>
${spec}
</specification>

Do not ask for clarification on anything you can resolve by reading
the specification. Start with the spec.`;
}

// ============================================================================
// IMPLEMENT
// ============================================================================

export interface ImplementContext {
  /** 1-indexed implementation iteration. */
  iteration: number;
  /**
   * Markdown feedback from the most recent adversarial reviewer. Present
   * only when the previous review found gaps; the implementer must address
   * every actionable finding before making unrelated progress.
   */
  reviewFeedback?: string;
}

/** Build the per-iteration implementation prompt. Emits a fenced `status` block the parser keys off. */
export function buildImplementPrompt(
  spec: string,
  context: ImplementContext,
): string {
  const { iteration, reviewFeedback } = context;
  const feedback = reviewFeedback?.trim() ?? "";
  const hasFeedback = feedback.length > 0;

  const feedbackBlock = hasFeedback
    ? `

<review_feedback>
${feedback}
</review_feedback>

A fresh-context reviewer flagged the findings above. Address every P0
and P1 finding before making unrelated progress.`
    : "";

  return `Iteration ${iteration}.

While you work: (a) consult ${SPEC_FILE} before every change, (b) check
off ${TODO_FILE} as you go, (c) run tests after every meaningful commit.

<specification>
${spec}
</specification>${feedbackBlock}

Do not ask for clarification on anything you can resolve by reading
the spec and running the tests. Start with the spec.

End your iteration with exactly one fenced \`\`\`status block:

\`\`\`status
iteration: ${iteration}
todos_open: <integer>
tests_status: <"all passing" | "<N> failing">
status: <IN_PROGRESS | COMPLETE>
\`\`\`

Set status: COMPLETE only when ${TODO_FILE} has zero unchecked items
AND the full test suite passes. Otherwise IN_PROGRESS.`;
}

// ============================================================================
// ADVERSARIAL REVIEW
// ============================================================================

export interface ReviewContext {
  /** 1-indexed implementation iteration at which this review runs. */
  iteration: number;
}

/** Build the fresh-context review prompt. Ends with a single `STATUS:` line the parser keys off. */
export function buildReviewPrompt(
  spec: string,
  context: ReviewContext,
): string {
  return `Review ${SPEC_FILE} and the current implementation for gaps (iteration ${context.iteration}).

You are running in a fresh context — no memory of prior iterations,
only what's on disk. Read ${SPEC_FILE}, ${TODO_FILE}, and the
${TESTS_DIR}/ folder, then run the tests and walk the changed code.

<specification>
${spec}
</specification>

Output gaps as markdown bullets — P0, P1, or P2 only, skip nits:

- [P<0|1|2>] <title>
  - Location: <file:line> or ${SPEC_FILE} or ${TODO_FILE}
  - Problem: <one or two sentences>
  - Fix: <concrete direction>

If there are no actionable findings, write (none).

End with EXACTLY one line, verbatim (no trailing punctuation):

STATUS: ALIGNED — no P0 or P1 findings AND verification passes.
STATUS: GAPS_FOUND — otherwise.`;
}

// ============================================================================
// PARSERS
// ============================================================================

/** Parsed verdict from the adversarial reviewer's markdown output. */
export interface ReviewVerdict {
  /** True when the reviewer emitted \`STATUS: ALIGNED\` as its last verdict. */
  aligned: boolean;
  /** The reviewer's full markdown output, trimmed. Passed back to the next
   *  implement iteration when \`aligned\` is false. */
  raw: string;
}

/**
 * Parse the reviewer's verdict. Tolerates extra prose and picks the LAST
 * matching STATUS line so trailing turns override earlier ones. When no
 * STATUS line is present, defaults to "not aligned" so the loop continues
 * rather than silently terminating on ambiguous output.
 */
export function parseReviewVerdict(raw: string): ReviewVerdict {
  const trimmed = raw.trim();
  const matches = [
    ...trimmed.matchAll(/^[ \t]*STATUS:\s*(ALIGNED|GAPS_FOUND)\b/gim),
  ];
  const last = matches.at(-1);
  const aligned = last?.[1]?.toUpperCase() === "ALIGNED";
  return { aligned, raw: trimmed };
}

/** Parsed implementer status block. */
export interface ImplementStatus {
  /** Declared status — COMPLETE, IN_PROGRESS, or UNKNOWN if missing/unparseable. */
  status: "IN_PROGRESS" | "COMPLETE" | "UNKNOWN";
  /** Declared count of unchecked todos, or null if the field was missing. */
  openTodos: number | null;
  /** Declared test status line (verbatim), or null if missing. */
  testsStatus: string | null;
}

/**
 * Parse the \`\`\`status block the implementer writes at the end of each
 * iteration. Extracts the LAST such block to tolerate earlier quoted
 * examples in the assistant's prose.
 */
export function parseImplementStatus(raw: string): ImplementStatus {
  const blockRe = /```status\s*\n([\s\S]*?)\n```/gi;
  let lastBlock: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw)) !== null) {
    if (m[1]) lastBlock = m[1];
  }
  if (lastBlock === null) {
    return { status: "UNKNOWN", openTodos: null, testsStatus: null };
  }

  const statusMatch = lastBlock.match(/^\s*status\s*:\s*(\S+)/im);
  const openMatch = lastBlock.match(/^\s*todos_open\s*:\s*(\d+)/im);
  const testsMatch = lastBlock.match(/^\s*tests_status\s*:\s*(.+)$/im);

  const statusUpper = statusMatch?.[1]?.toUpperCase();
  const status: ImplementStatus["status"] =
    statusUpper === "COMPLETE" || statusUpper === "IN_PROGRESS"
      ? statusUpper
      : "UNKNOWN";

  return {
    status,
    openTodos: openMatch?.[1] ? parseInt(openMatch[1], 10) : null,
    testsStatus: testsMatch?.[1]?.trim() ?? null,
  };
}
