/**
 * Prompt builders for the deep-research-codebase workflow.
 *
 * Each builder produces a focused, single-responsibility prompt for one
 * specialist sub-agent. The sub-agents themselves are dispatched as separate
 * `ctx.stage(...)` calls via the provider SDK's native `agent` parameter
 * (Claude SDK options, Copilot sessionOpts, OpenCode session.prompt). Because
 * each sub-agent already carries a detailed system prompt in `.claude/agents/`,
 * `.opencode/agents/`, and `.github/agents/`, these user-prompts are intentionally
 * short — they only supply the topic, the scope, and the output shape the
 * downstream synthesizer expects.
 *
 * Context-engineering principles applied throughout:
 *
 *   • Position-aware framing: the research question is repeated at the TOP
 *     and BOTTOM of every prompt. Long-context recall is strongest at the
 *     edges of the context window (see `context-fundamentals`).
 *
 *   • Informativity over exhaustiveness: each per-partition prompt embeds
 *     ONLY that partition's directories — never the full file list. This
 *     keeps token cost roughly constant in N rather than O(N²).
 *
 *   • Forward-only data flow: the analyzer prompt embeds the locator's
 *     output verbatim; the online-researcher prompt does the same. No
 *     sub-agent has to re-discover what its sibling already produced.
 *
 *   • Trailing-prose guarantee (failure-modes F6): every prompt asks for a
 *     short prose recap as the final assistant turn so downstream stages
 *     reading via `transcript()` never get an empty string when the agent
 *     ends on a tool call.
 *
 *   • Documentarian framing: every prompt explicitly forbids critique or
 *     improvement suggestions. We are recording what EXISTS.
 *
 *   • File-based handoff (filesystem-context skill): explorer findings are
 *     written deterministically to a scratch file by TypeScript (no extra
 *     LLM "synthesizer" stage) and the aggregator reads them by path.
 */

import type { PartitionUnit } from "./scout.ts";
import { deriveHistoryBrief } from "../../_context/index.ts";

/**
 * Render a `<PRIOR_RESEARCH_HINT>` block for inclusion in explorer prompts.
 * Caller is responsible for passing the already-bounded brief string
 * (`deriveHistoryBrief(historyOverview)` is the usual producer). Returns
 * an empty string when the brief is empty so the caller can inline the
 * result without conditional glue.
 */
function renderPriorResearchHint(brief: string | undefined): string {
  const trimmed = brief?.trim() ?? "";
  if (!trimmed) return "";
  return [
    ``,
    `<PRIOR_RESEARCH_HINT>`,
    `Previous research on this topic (kept brief; below the distraction`,
    `threshold). Use as a weak prior — trust fresh investigation when they`,
    `disagree:`,
    ``,
    trimmed,
    `</PRIOR_RESEARCH_HINT>`,
  ].join("\n");
}

// Re-export for SDK index call sites that need to compute a brief.
export { deriveHistoryBrief };

/**
 * Prepended to every stage prompt. Compresses agent prose output to cut
 * tokens without losing technical substance. Code blocks, tool-call
 * arguments, and structured file outputs remain verbatim.
 */
const CAVEMAN_PREAMBLE = `# Response Style (applies to all prose output)

Respond terse like smart caveman. All technical substance stay. Only fluff die.

## Persistence

ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Still active if unsure.

## Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact. File paths, line numbers, symbol names exact.

Pattern: \`[thing] [action] [reason]. [next step].\`

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"

## Intensity

Drop articles, fragments OK, short synonyms.

Example — "Why React component re-render?"
"New object ref each render. Inline object prop = new ref = re-render. Wrap in \`useMemo\`."

## Auto-Clarity

Drop caveman for: security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread, user asks to clarify or repeats question. Resume caveman after clear part done.

## Boundaries

Code/commits/PRs: write normal. Structured file outputs (scratch file sections, required headers/templates): write normal — schema wins. Section headers and required output shapes unchanged.

---
`;

const DOCUMENTARIAN_DISCLAIMER =
  "You are a documentarian, not a critic. Document what EXISTS — do not " +
  "propose improvements, identify issues, or suggest refactors. Focus on " +
  "concrete file paths, line numbers, and how things actually work.";

const TRAILING_PROSE_REMINDER =
  "End your turn with a short prose paragraph summarising what you produced. " +
  "Do NOT end the turn on a tool call — downstream stages read your assistant " +
  "transcript and will see nothing if the final message is a tool invocation.";

/** Slugify the user's prompt for use in the final research filename. */
export function slugifyPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .substring(0, 60);
  return slug || "research";
}

/** Render a partition's directory list as repo-relative paths with file/LOC counts. */
function renderPartitionAssignment(partition: PartitionUnit[]): string {
  return partition
    .map(
      (u) =>
        `  - \`${u.path}/\` (${u.fileCount} files, ${u.loc.toLocaleString()} LOC)`,
    )
    .join("\n");
}

/** Comma-separated repo-relative directory list (for inline grep/glob scope hints). */
function renderPartitionDirs(partition: PartitionUnit[]): string {
  return partition.map((u) => `\`${u.path}/\``).join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1a — codebase-scout (single LLM orientation call)
// ─────────────────────────────────────────────────────────────────────────────

export function buildScoutPrompt(opts: {
  question: string;
  tree: string;
  totalLoc: number;
  totalFiles: number;
  explorerCount: number;
  partitionPreview: PartitionUnit[][];
}): string {
  const partitionPreview = opts.partitionPreview
    .map((bin, i) => {
      const dirs = bin.map((u) => `\`${u.path}/\``).join(", ");
      const loc = bin.reduce((s, u) => s + u.loc, 0);
      return `  ${i + 1}. ${dirs} — ${loc.toLocaleString()} LOC`;
    })
    .join("\n");

  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<CONTEXT>`,
    `You are the codebase scout for the deep-research-codebase workflow. The`,
    `workflow has already computed the codebase layout deterministically:`,
    ``,
    `- Total source files: ${opts.totalFiles.toLocaleString()}`,
    `- Total LOC: ${opts.totalLoc.toLocaleString()}`,
    `- Partitions to investigate: ${opts.explorerCount} (chosen by LOC heuristic)`,
    ``,
    `Pre-computed partition assignments (${opts.explorerCount} partitions):`,
    partitionPreview,
    ``,
    `Compact directory tree (depth 3, ≤200 entries):`,
    "```",
    opts.tree,
    "```",
    `</CONTEXT>`,
    ``,
    `<TASK>`,
    `Read the tree above and produce a brief architectural orientation that`,
    `the downstream specialist sub-agents will use to anchor their searches.`,
    ``,
    `Cover, in ≤300 words:`,
    `  1. The repo's overall shape (monorepo vs single package, polyglot or not)`,
    `  2. The 3-5 most important top-level directories and what each contains`,
    `  3. Architectural boundaries / layering you can see from the tree`,
    `  4. Where entry points or main modules likely live`,
    ``,
    `Do NOT attempt to answer the research question yet — your job is`,
    `orientation for downstream specialists, not investigation. You may use`,
    `Read/Glob/Grep sparingly to verify guesses about a few key files,`,
    `but keep the output short.`,
    `</TASK>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Stay under 300 words. No bullet lists longer than 5 items.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — per-partition specialist sub-agents
// ─────────────────────────────────────────────────────────────────────────────
//
// Four specialists run per partition, dispatched as separate headless stages
// via the provider SDK's native `agent` parameter. Two layers of parallelism:
//
//   Layer 1 (independent searches):   locator   ∥  pattern-finder
//   Layer 2 (depend on locator):      analyzer  ∥  online-researcher
//
// The deterministic synthesis step (helpers/scratch.ts) then concatenates
// the four outputs into the explorer scratch file the aggregator will read.

/** codebase-locator — find files in the partition relevant to the question. */
export function buildLocatorPrompt(opts: {
  question: string;
  partition: PartitionUnit[];
  scoutOverview: string;
  index: number;
  total: number;
  /** ≤150-word brief derived from the history-analyzer output (D2). */
  priorResearchBrief?: string;
}): string {
  const assignment = renderPartitionAssignment(opts.partition);
  const dirs = renderPartitionDirs(opts.partition);
  const orientation =
    opts.scoutOverview.trim().length > 0
      ? opts.scoutOverview.trim()
      : "(scout overview unavailable — proceed without)";

  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<MISSION>`,
    `You are the codebase-locator for partition ${opts.index} of ${opts.total} in a`,
    `deep-research workflow. Find every file inside the SCOPE below that`,
    `relates to the research question, and return a categorized index.`,
    `</MISSION>`,
    ``,
    `<ARCHITECTURAL_ORIENTATION>`,
    orientation,
    `</ARCHITECTURAL_ORIENTATION>`,
    renderPriorResearchHint(opts.priorResearchBrief),
    ``,
    `<SCOPE>`,
    `Search ONLY within these directories. Other partitions cover the rest of`,
    `the codebase — do NOT wander outside your scope:`,
    ``,
    assignment,
    ``,
    `(Quick comma-separated form for tool args: ${dirs})`,
    `</SCOPE>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Return a markdown report with this exact structure:`,
    ``,
    `### Implementation`,
    `- \`<repo-relative path>\` — 1-line note on relevance`,
    ``,
    `### Tests`,
    `- ...`,
    ``,
    `### Types / Interfaces`,
    `- ...`,
    ``,
    `### Configuration`,
    `- ...`,
    ``,
    `### Examples / Fixtures`,
    `- ...`,
    ``,
    `### Documentation`,
    `- ...`,
    ``,
    `### Notable Clusters`,
    `- \`<repo-relative dir>/\` — N files, why it's a cluster`,
    ``,
    `Omit any section that has no entries (do not write "(none)" placeholders).`,
    `Use repo-relative paths. Do NOT read file contents — your job is location only.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Restrict every grep/glob to the SCOPE above.`,
    `Do not analyse implementations — siblings (analyzer, pattern-finder) cover that.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

/** codebase-pattern-finder — surface concrete reusable code patterns. */
export function buildPatternFinderPrompt(opts: {
  question: string;
  partition: PartitionUnit[];
  scoutOverview: string;
  index: number;
  total: number;
}): string {
  const assignment = renderPartitionAssignment(opts.partition);
  const dirs = renderPartitionDirs(opts.partition);
  const orientation =
    opts.scoutOverview.trim().length > 0
      ? opts.scoutOverview.trim()
      : "(scout overview unavailable — proceed without)";

  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<MISSION>`,
    `You are the codebase-pattern-finder for partition ${opts.index} of ${opts.total}.`,
    `Find concrete code patterns inside the SCOPE that demonstrate how the`,
    `topic of the research question is currently expressed in the codebase.`,
    `Return runnable-looking snippets, not abstract descriptions.`,
    `</MISSION>`,
    ``,
    `<ARCHITECTURAL_ORIENTATION>`,
    orientation,
    `</ARCHITECTURAL_ORIENTATION>`,
    ``,
    `<SCOPE>`,
    assignment,
    ``,
    `(Quick comma-separated form for tool args: ${dirs})`,
    `</SCOPE>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `For each distinct pattern you find, output:`,
    ``,
    `#### Pattern: <short name>`,
    `**Where:** \`<repo-relative path>:<line>\``,
    `**What:** 1-sentence description.`,
    "```<language>",
    `<5-30 lines of actual code from the file>`,
    "```",
    `**Variations / call-sites:** other \`file.ts:line\` references using the same pattern.`,
    ``,
    `Aim for 3-7 distinct patterns. Skip anything tangential to the question.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Restrict every grep/glob to the SCOPE above.`,
    `Quote code verbatim — never paraphrase a snippet.`,
    `Use file:line references for every claim.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

/** codebase-analyzer — document HOW the most relevant impl files work. */
export function buildAnalyzerPrompt(opts: {
  question: string;
  partition: PartitionUnit[];
  locatorOutput: string;
  scoutOverview: string;
  index: number;
  total: number;
  /** ≤150-word brief derived from the history-analyzer output (D2). */
  priorResearchBrief?: string;
}): string {
  const assignment = renderPartitionAssignment(opts.partition);
  const orientation =
    opts.scoutOverview.trim().length > 0
      ? opts.scoutOverview.trim()
      : "(scout overview unavailable — proceed without)";
  const locator =
    opts.locatorOutput.trim().length > 0
      ? opts.locatorOutput.trim()
      : "(locator returned no files — analyse the partition directly)";

  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<MISSION>`,
    `You are the codebase-analyzer for partition ${opts.index} of ${opts.total}.`,
    `The codebase-locator (your sibling) has already enumerated the files in`,
    `your partition that touch this topic. Your job is to read the 5-10 MOST`,
    `relevant IMPLEMENTATION files and document how they actually work, with`,
    `precise \`file.ts:line\` references throughout.`,
    `</MISSION>`,
    ``,
    `<ARCHITECTURAL_ORIENTATION>`,
    orientation,
    `</ARCHITECTURAL_ORIENTATION>`,
    renderPriorResearchHint(opts.priorResearchBrief),
    ``,
    `<SCOPE>`,
    assignment,
    `</SCOPE>`,
    ``,
    `<LOCATOR_FINDINGS>`,
    `Verbatim output from the codebase-locator sibling for this partition —`,
    `pick the implementation files to read from the "Implementation" section:`,
    ``,
    locator,
    `</LOCATOR_FINDINGS>`,
    ``,
    `<METHOD>`,
    `1. From the locator findings above, choose 5-10 implementation files most`,
    `   central to the research question. Prefer files that look like the`,
    `   primary entry points or data-flow hubs.`,
    `2. Read each chosen file in full (no offset / no limit).`,
    `3. For each file, document:`,
    `     • Its role (1 sentence)`,
    `     • Key exported symbols with \`file.ts:line\` refs`,
    `     • Control flow tied to the research question`,
    `     • Data flow (what comes in, what goes out, where state lives)`,
    `     • External dependencies it imports (libraries, sibling modules)`,
    `4. After per-file documentation, write a short cross-cutting synthesis`,
    `   (≤200 words) describing how these files compose to address the topic.`,
    `5. List any files OUTSIDE this partition that you noticed are referenced`,
    `   from your reads (so the aggregator can stitch findings across`,
    `   partitions). One file per line: \`<repo-relative path>\` — 1-line reason.`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Use this structure (omit empty sections):`,
    ``,
    `### Files Analysed`,
    `<bullet list of the 5-10 files you read, repo-relative paths>`,
    ``,
    `### Per-File Notes`,
    `#### \`<repo-relative path>\``,
    `- **Role:** ...`,
    `- **Key symbols:** \`name\` (\`file.ts:line\`), ...`,
    `- **Control flow:** ...`,
    `- **Data flow:** ...`,
    `- **Dependencies:** ...`,
    ``,
    `### Cross-Cutting Synthesis`,
    `<≤200 words on how these files compose to address the topic>`,
    ``,
    `### Out-of-Partition References`,
    `- \`<repo-relative path>\` — 1-line note on why it matters`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Use file:line references for every concrete claim — never abstract prose.`,
    `Read files in full; do not paginate via offset/limit unless a file is enormous.`,
    `Do NOT analyse files outside your partition — only LIST them as cross-refs.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

/** codebase-online-researcher — focused external doc fetch when libs are central. */
export function buildOnlineResearcherPrompt(opts: {
  question: string;
  partition: PartitionUnit[];
  locatorOutput: string;
  index: number;
  total: number;
}): string {
  const assignment = renderPartitionAssignment(opts.partition);
  const locator =
    opts.locatorOutput.trim().length > 0
      ? opts.locatorOutput.trim()
      : "(locator returned no files)";

  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<MISSION>`,
    `You are the codebase-online-researcher for partition ${opts.index} of ${opts.total}.`,
    `Decide whether external library / framework documentation is CENTRAL to`,
    `answering the research question for this partition. If yes, fetch focused`,
    `excerpts and tie them back to the partition's files. If no, output a`,
    `single-line "(no external research applicable)" and stop.`,
    `</MISSION>`,
    ``,
    `<SCOPE>`,
    assignment,
    `</SCOPE>`,
    ``,
    `<LOCATOR_FINDINGS>`,
    `Use this list to identify which third-party libraries / frameworks the`,
    `partition imports. If nothing relevant surfaces, return early.`,
    ``,
    locator,
    `</LOCATOR_FINDINGS>`,
    ``,
    `<METHOD>`,
    `1. Skim the locator output and any package manifests in the partition`,
    `   (package.json, go.mod, requirements.txt, Cargo.toml, etc.) to identify`,
    `   external dependencies that are LIKELY central to the research question.`,
    `2. If none qualify, output exactly:`,
    `     (no external research applicable)`,
    `   and end the turn with a one-sentence prose explanation of why.`,
    `3. If at least one qualifies, follow the token-efficient fetch order from`,
    `   your system prompt (llms.txt → Markdown for Agents → playwright-cli)`,
    `   to pull focused documentation excerpts.`,
    `4. For each library you researched, return:`,
    `     • Library name + version (if discoverable)`,
    `     • Key doc URLs you fetched`,
    `     • The specific behavior that bears on the research question`,
    `     • Where in the partition that behavior is exercised (\`file.ts:line\`)`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `If you skipped:`,
    ``,
    `(no external research applicable)`,
    ``,
    `<one-sentence justification>`,
    ``,
    `If you researched, repeat per library:`,
    ``,
    `#### <Library> (vX.Y)`,
    `**Docs:** <url>, <url>`,
    `**Relevant behaviour:** ...`,
    `**Where used:** \`<repo-relative path>:<line>\` — 1-line note`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Skipping is the correct answer when nothing is central — do NOT pad with`,
    `tutorials or general guides.`,
    `Quote URLs verbatim. Do NOT invent or paraphrase doc URLs.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1b — research-history specialists
// ─────────────────────────────────────────────────────────────────────────────

/** codebase-research-locator — find prior research docs about the topic. */
export function buildHistoryLocatorPrompt(opts: {
  question: string;
}): string {
  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<MISSION>`,
    `You are the codebase-research-locator. Surface prior research documents`,
    `about this topic from the project's research/ directory so the analyzer`,
    `(your sibling) can extract insights from them.`,
    `</MISSION>`,
    ``,
    `<SCOPE>`,
    `Primary: \`research/\` (and standard subdirs: docs/, tickets/, notes/).`,
    `Secondary: any sibling research directories at the repository root that match`,
    `\`*research*\`, \`*adr*\`, \`*rfc*\`, or \`specs\`.`,
    ``,
    `If no research directory exists at all, return a single section:`,
    ``,
    `### No Prior Research`,
    `(briefly note what you checked)`,
    `</SCOPE>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Group by document type. Within each group, sort newest first by filename.`,
    ``,
    `### Docs`,
    `- \`<repo-relative path>\` — 1-line title-derived summary`,
    ``,
    `### Tickets`,
    `- ...`,
    ``,
    `### Notes`,
    `- ...`,
    ``,
    `### Specs / ADRs / RFCs`,
    `- ...`,
    ``,
    `Omit empty sections.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Do NOT read file contents in depth — your sibling does that.`,
    `Do NOT investigate live source files — that's the explorers' job.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

/** codebase-research-analyzer — synthesize insights from located research docs. */
export function buildHistoryAnalyzerPrompt(opts: {
  question: string;
  locatorOutput: string;
}): string {
  const locator =
    opts.locatorOutput.trim().length > 0
      ? opts.locatorOutput.trim()
      : "(no prior research surfaced)";

  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<MISSION>`,
    `You are the codebase-research-analyzer. Extract HIGH-VALUE insights from`,
    `the prior research documents your sibling located, and produce a tight`,
    `synthesis the aggregator can fold in as supplementary context.`,
    `</MISSION>`,
    ``,
    `<LOCATOR_FINDINGS>`,
    locator,
    `</LOCATOR_FINDINGS>`,
    ``,
    `<METHOD>`,
    `1. Pick the 3-5 MOST relevant documents from the locator output.`,
    `2. Read each in full.`,
    `3. For each, capture:`,
    `     • Prior decisions on related topics (and what was actually shipped)`,
    `     • Completed investigations and their conclusions`,
    `     • Open questions / unresolved threads still in flight`,
    `4. Filter aggressively — drop tangential mentions and outdated context.`,
    `5. Synthesize into a single ≤400-word block. Cite document paths inline.`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Documents Reviewed`,
    `- \`<repo-relative path>\` — 1-line takeaway`,
    ``,
    `### Synthesis`,
    `<≤400 words covering decisions, conclusions, and open questions, with`,
    `inline path citations like (\`research/docs/2025-…md\`)>`,
    ``,
    `If no relevant prior research exists, output a single sentence saying so.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Stay under 400 words in the Synthesis section.`,
    `Do NOT investigate live source files — that's the explorers' job.`,
    `Do NOT write any new files — your output is consumed via session transcript.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — aggregator
// ─────────────────────────────────────────────────────────────────────────────

export function buildAggregatorPrompt(opts: {
  question: string;
  totalLoc: number;
  totalFiles: number;
  explorerCount: number;
  explorerFiles: {
    index: number;
    scratchPath: string;
    partition: PartitionUnit[];
  }[];
  finalPath: string;
  scoutOverview: string;
  historyOverview: string;
}): string {
  const explorerSummary = opts.explorerFiles
    .map((e) => {
      const dirs = e.partition.map((u) => `\`${u.path}/\``).join(", ");
      return `- **Partition ${e.index}** → \`${e.scratchPath}\`\n  Covered: ${dirs}`;
    })
    .join("\n");

  const orientation =
    opts.scoutOverview.trim().length > 0
      ? opts.scoutOverview.trim()
      : "(scout overview unavailable)";

  const history =
    opts.historyOverview.trim().length > 0
      ? opts.historyOverview.trim()
      : "(no historical research surfaced)";

  return [
    CAVEMAN_PREAMBLE,
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<MISSION>`,
    `You are the aggregator. ${opts.explorerCount} parallel partitions of the`,
    `codebase (${opts.totalLoc.toLocaleString()} LOC across ${opts.totalFiles.toLocaleString()} source files)`,
    `have each been investigated by four specialist sub-agents — codebase-locator,`,
    `codebase-pattern-finder, codebase-analyzer, and codebase-online-researcher`,
    `— dispatched directly via the agent SDK. The deterministic synthesis step`,
    `wrote one markdown findings file per partition. A separate research-history`,
    `pipeline (codebase-research-locator → codebase-research-analyzer) surveyed`,
    `the project's prior research documents. Your job: synthesise everything`,
    `into a single comprehensive research document.`,
    `</MISSION>`,
    ``,
    `<ARCHITECTURAL_ORIENTATION>`,
    orientation,
    `</ARCHITECTURAL_ORIENTATION>`,
    ``,
    `<HISTORICAL_CONTEXT>`,
    `Use as supplementary context — live findings take precedence:`,
    ``,
    history,
    `</HISTORICAL_CONTEXT>`,
    ``,
    `<EXPLORER_REPORTS>`,
    `Each file below has the same structure (Scope / Files in Scope / How It`,
    `Works / Patterns / External References / Out-of-Partition References).`,
    `These are LIVE evidence from the specialist sub-agents and take precedence`,
    `over historical context.`,
    ``,
    explorerSummary,
    `</EXPLORER_REPORTS>`,
    ``,
    `<METHOD>`,
    `1. Read EVERY explorer findings file in full using the Read tool with no`,
    `   offset or limit — these are not optional.`,
    `2. Cross-reference: stitch findings together across partitions using each`,
    `   file's "Out-of-Partition References" section.`,
    `3. Resolve contradictions by re-reading the underlying source files`,
    `   directly — do not paper over disagreements.`,
    `4. Integrate historical context where it adds value, but trust live`,
    `   findings when they conflict with history.`,
    `5. Write the final research document to: \`${opts.finalPath}\``,
    `6. After writing the file, output a ≤200-word executive summary as your`,
    `   final prose response so this transcript has content.`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `The file at \`${opts.finalPath}\` must follow this structure:`,
    ``,
    "```markdown",
    `---`,
    `date: <today's date YYYY-MM-DD HH:MM:SS TZ — run \`date '+%Y-%m-%d %H:%M:%S %Z'\`>`,
    `researcher: deep-research-codebase workflow`,
    `git_commit: <run \`git rev-parse --verify HEAD\`>`,
    `branch: <run \`git branch --show-current\`>`,
    `repository: <repo name from \`basename \\$(git rev-parse --show-toplevel)\`>`,
    `topic: "<the original research question>"`,
    `tags: [research, codebase, deep-research]`,
    `status: complete`,
    `last_updated: <today's date YYYY-MM-DD>`,
    `---`,
    ``,
    `# Research: <short title>`,
    ``,
    `## Research Question`,
    `<verbatim original question>`,
    ``,
    `## Executive Summary`,
    `3-5 paragraph high-level answer with concrete evidence.`,
    ``,
    `## Detailed Findings`,
    ``,
    `### <Component / Area 1>`,
    `Description with file:line references.`,
    ``,
    `### <Component / Area 2>`,
    `...`,
    ``,
    `## Architecture & Patterns`,
    `Cross-cutting patterns observed across multiple partitions.`,
    ``,
    `## Code References`,
    `- \`path/to/file.ts:123\` — what's there`,
    ``,
    `## Historical Context (from research/)`,
    `Relevant insights from prior research, with paths. Omit if no history.`,
    ``,
    `## Open Questions`,
    `Areas needing further investigation.`,
    ``,
    `## Methodology`,
    `Generated by the deep-research-codebase workflow with ${opts.explorerCount} partitions`,
    `covering ${opts.totalFiles.toLocaleString()} source files (${opts.totalLoc.toLocaleString()} LOC).`,
    `Each partition was investigated by four specialist sub-agents dispatched`,
    `directly via the provider SDK's native agent parameter:`,
    `codebase-locator, codebase-pattern-finder, codebase-analyzer, and`,
    `codebase-online-researcher. A separate research-history pipeline ran`,
    `codebase-research-locator → codebase-research-analyzer over the project's`,
    `prior research documents.`,
    "```",
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Prefer concrete file:line references over abstract descriptions.`,
    `Do NOT skim explorer reports — read each one in full.`,
    `If two partitions contradict each other, re-read the underlying source files.`,
    `End with the required ≤200-word executive summary AFTER writing the file.`,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}
