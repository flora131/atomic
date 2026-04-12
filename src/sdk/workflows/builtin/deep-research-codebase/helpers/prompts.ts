/**
 * Prompt builders for the deep-research-codebase workflow.
 *
 * Context-engineering principles applied throughout:
 *   - Position-aware placement: the research question is repeated at the
 *     TOP and BOTTOM of every prompt (recall is 85-95% at the edges and
 *     drops to 76-82% in the middle — see context-fundamentals).
 *   - Informativity over exhaustiveness: each explorer prompt contains
 *     only that explorer's partition, never the full file list.
 *   - Explicit trailing commentary (F6): every prompt asks the agent to
 *     produce a short text summary AFTER any tool/file output, so the
 *     transcript is not empty when downstream stages read it.
 *   - File-based handoff (filesystem-context skill): explorer findings
 *     are written to disk and the aggregator reads them by path, instead
 *     of inlining N transcripts into the aggregator's prompt.
 *   - Documentarian role: every prompt explicitly forbids critique or
 *     improvement suggestions; we are recording what exists.
 */

import path from "node:path";
import type { PartitionUnit } from "./scout.ts";

const DOCUMENTARIAN_DISCLAIMER =
  "You are a documentarian, not a critic. Document what EXISTS — do not " +
  "propose improvements, identify issues, or suggest refactors. Focus on " +
  "concrete file paths, line numbers, and how things actually work.";

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

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — codebase-scout
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
    `- Explorers to spawn: ${opts.explorerCount} (chosen by LOC heuristic)`,
    ``,
    `Pre-computed partition assignments (${opts.explorerCount} explorers):`,
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
    `will help the ${opts.explorerCount} parallel explorer sub-agents understand the`,
    `layout BEFORE they dive into their assigned partitions.`,
    ``,
    `Cover, in ≤300 words:`,
    `  1. The repo's overall shape (monorepo vs single package, polyglot or not)`,
    `  2. The 3-5 most important top-level directories and what each contains`,
    `  3. Architectural boundaries / layering you can see from the tree`,
    `  4. Where entry points or main modules likely live`,
    ``,
    `Do NOT attempt to answer the research question yet — your job is`,
    `orientation for downstream explorers, not investigation. You may use`,
    `Read/Glob/Grep sparingly to verify your guesses about a few key files,`,
    `but keep the output short.`,
    `</TASK>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Stay under 300 words. No bullet lists longer than 5 items.`,
    `End with a short prose paragraph (NOT a tool call) so this transcript`,
    `has content for downstream stages to read.`,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — explorer-N
// ─────────────────────────────────────────────────────────────────────────────

export function buildExplorerPrompt(opts: {
  question: string;
  index: number;
  total: number;
  partition: PartitionUnit[];
  scoutOverview: string;
  scratchPath: string;
  root: string;
}): string {
  const assignmentLines = opts.partition
    .map((u) => {
      const abs = path.join(opts.root, u.path);
      return `  - \`${abs}/\` (${u.fileCount} files, ${u.loc.toLocaleString()} LOC)`;
    })
    .join("\n");

  // Comma-separated absolute dir list — used in subagent dispatch prompts as
  // an unambiguous scope constraint that the locator/pattern-finder can pass
  // straight to Glob.
  const dirListAbs = opts.partition
    .map((u) => `\`${path.join(opts.root, u.path)}\``)
    .join(", ");

  const orientation = opts.scoutOverview.trim().length > 0
    ? opts.scoutOverview.trim()
    : "(scout overview unavailable — proceed without)";

  return [
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<YOUR_IDENTITY>`,
    `You are explorer ${opts.index} of ${opts.total}. You are a COORDINATOR — your`,
    `job is to dispatch specialized research sub-agents and synthesize their`,
    `findings. You do NOT use Read/Glob/Grep yourself; you orchestrate the`,
    `specialists. The codebase has been partitioned across ${opts.total} parallel`,
    `explorers — you are responsible for your assigned slice. Other explorers`,
    `are simultaneously covering the rest.`,
    `</YOUR_IDENTITY>`,
    ``,
    `<ARCHITECTURAL_ORIENTATION>`,
    `The codebase scout produced this overview to help you orient before dispatch:`,
    ``,
    orientation,
    `</ARCHITECTURAL_ORIENTATION>`,
    ``,
    `<YOUR_ASSIGNMENT>`,
    `Your assigned directories (DO NOT search outside these — other explorers`,
    `cover the rest):`,
    ``,
    assignmentLines,
    `</YOUR_ASSIGNMENT>`,
    ``,
    `<RESEARCH_PROTOCOL>`,
    `Execute these steps IN ORDER. Each numbered step must complete before the`,
    `next begins. Use the exact \`@"name (agent)"\` dispatch syntax shown below.`,
    ``,
    `── STEP 1 — Locate relevant files (codebase-locator) ──`,
    ``,
    `Dispatch the codebase-locator. Constrain it strictly to your assigned dirs:`,
    ``,
    `  @"codebase-locator (agent)" CRITICAL: search ONLY within these directories`,
    `  (do not search elsewhere): ${dirListAbs}.`,
    ``,
    `  Find files in those directories that relate to this research question:`,
    `  "${opts.question}"`,
    ``,
    `  Categorize results by purpose: implementation, tests, types, config,`,
    `  examples, docs. Return absolute paths grouped by category.`,
    ``,
    `── STEP 2 — Analyze the most relevant files (codebase-analyzer) ──`,
    ``,
    `Pick the 5-10 most relevant IMPLEMENTATION files from STEP 1's output and`,
    `dispatch the codebase-analyzer:`,
    ``,
    `  @"codebase-analyzer (agent)" Document how the following files work as`,
    `  they relate to the research question "${opts.question}":`,
    `  <list the files you picked, one per line>`,
    ``,
    `  Cover control flow, data flow, key abstractions, and any external`,
    `  dependencies. Use file:line references throughout. Do NOT critique or`,
    `  suggest improvements — describe what exists.`,
    ``,
    `── STEP 3 — Find existing patterns (codebase-pattern-finder) ──`,
    ``,
    `Dispatch the pattern-finder, scoped to your dirs:`,
    ``,
    `  @"codebase-pattern-finder (agent)" CRITICAL: search ONLY within these`,
    `  directories: ${dirListAbs}.`,
    ``,
    `  Find existing code patterns related to "${opts.question}" inside those`,
    `  directories. Return concrete code snippets with file:line references.`,
    ``,
    `── STEP 4 — External documentation research (CONDITIONAL) ──`,
    ``,
    `ONLY run this step IF Step 2 surfaced external library or dependency`,
    `usage that is CENTRAL to answering the research question. Otherwise SKIP.`,
    ``,
    `If applicable, dispatch:`,
    ``,
    `  @"codebase-online-researcher (agent)" Research the documentation for`,
    `  <library/dependency name> as it relates to: "${opts.question}".`,
    ``,
    `  Return links and concrete findings. The agent should follow the`,
    `  token-efficient fetch order described in its instructions.`,
    ``,
    `── STEP 5 — Synthesize and write findings ──`,
    ``,
    `Combine the outputs from Steps 1-4 into a single markdown document and`,
    `use the Write tool to write it to:`,
    ``,
    `  ${opts.scratchPath}`,
    ``,
    `Use the OUTPUT_FORMAT below.`,
    ``,
    `── STEP 6 — Brief summary ──`,
    ``,
    `As your final response (after the Write tool call), output a 2-3 sentence`,
    `prose summary of what you found. This is REQUIRED so the aggregator can`,
    `index your report and the transcript is not empty.`,
    `</RESEARCH_PROTOCOL>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `The file at \`${opts.scratchPath}\` must be a markdown document with these`,
    `sections, in this order. Each section should reflect what the corresponding`,
    `sub-agent returned:`,
    ``,
    `# Explorer ${opts.index} Findings`,
    ``,
    `## Scope`,
    `One-line description of which directories you covered.`,
    ``,
    `## Overview`,
    `1-2 paragraph synthesis of all sub-agent findings as they relate to the`,
    `research question.`,
    ``,
    `## Files in Scope`,
    `From codebase-locator (Step 1). Categorized list with absolute paths.`,
    ``,
    `## How It Works`,
    `From codebase-analyzer (Step 2). Control flow, data flow, key abstractions,`,
    `with file:line references throughout.`,
    ``,
    `## Patterns`,
    `From codebase-pattern-finder (Step 3). Concrete code examples with`,
    `file:line refs.`,
    ``,
    `## External References`,
    `From codebase-online-researcher (Step 4) — INCLUDE ONLY if Step 4 ran.`,
    `Otherwise omit this section. Include links the online researcher returned.`,
    ``,
    `## Cross-References`,
    `Files OUTSIDE your assigned directories that other explorers should check,`,
    `with a 1-line note on why each is relevant.`,
    ``,
    `## File Index`,
    `Bulleted list of every file the sub-agents touched, each with a 1-line`,
    `description of what's in it.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Use file:line references throughout — concrete, not abstract.`,
    `Do NOT investigate directories outside your assignment, even via sub-agents.`,
    `Do NOT skip Steps 1-3 or 5-6. Step 4 is the only optional step.`,
    `Do NOT use Read/Glob/Grep directly — coordinate via sub-agents only.`,
    `End your turn with the required 2-3 sentence prose summary AFTER writing`,
    `the file (do not end on a tool call).`,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1b — research-history (parallel sibling of codebase-scout)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The research-history scout dispatches specialized sub-agents to surface
 * historical context from the project's `research/` directory:
 *   - codebase-research-locator → finds prior research docs about the topic
 *   - codebase-research-analyzer → extracts key insights from the most
 *     relevant docs
 *
 * Output is consumed via session transcript (not file write) — kept short
 * (≤400 words) so the aggregator can embed it cheaply.
 */
export function buildHistoryPrompt(opts: {
  question: string;
  root: string;
}): string {
  return [
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<YOUR_IDENTITY>`,
    `You are the research-history scout for the deep-research-codebase`,
    `workflow. You run in parallel with the codebase-scout. Your job is to`,
    `surface relevant historical context from the project's existing research`,
    `directory using specialized sub-agents — NOT to investigate the live`,
    `codebase (the explorers will do that).`,
    `</YOUR_IDENTITY>`,
    ``,
    `<RESEARCH_PROTOCOL>`,
    `Execute these steps in order:`,
    ``,
    `── STEP 1 — Locate prior research documents ──`,
    ``,
    `Dispatch the research-locator sub-agent:`,
    ``,
    `  @"codebase-research-locator (agent)" Locate research documents related`,
    `  to: "${opts.question}". Search the \`${path.join(opts.root, "research")}\``,
    `  directory and any sibling research directories. Return categorized`,
    `  document paths (docs/, tickets/, notes/, etc.) with 1-line summaries.`,
    ``,
    `If no research/ directory exists or no relevant docs are found, note`,
    `that explicitly and SKIP STEP 2.`,
    ``,
    `── STEP 2 — Extract insights from the most relevant documents ──`,
    ``,
    `Pick the 3-5 MOST relevant documents from STEP 1 and dispatch the`,
    `research-analyzer:`,
    ``,
    `  @"codebase-research-analyzer (agent)" Extract key insights from these`,
    `  documents as they relate to the research question "${opts.question}":`,
    `  <list the doc paths you picked>`,
    ``,
    `  Filter out noise. Focus on prior decisions, completed investigations,`,
    `  and unresolved questions that bear on the current research question.`,
    ``,
    `── STEP 3 — Synthesize ──`,
    ``,
    `Output a 200-400 word synthesis of historical context as your final`,
    `prose response. Cover:`,
    `  - Key prior decisions on related topics`,
    `  - Past investigations and their conclusions`,
    `  - Open questions from prior research`,
    `  - Document paths the aggregator should reference (with brief notes)`,
    ``,
    `If no relevant history exists, output a single sentence saying so.`,
    ``,
    `Do NOT write any files — your output is consumed via session transcript.`,
    `</RESEARCH_PROTOCOL>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Stay under 400 words total in your final synthesis.`,
    `Do NOT investigate live source files — that's the explorers' job.`,
    `End with the prose synthesis (do not end on a tool call).`,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic variants (Copilot / OpenCode)
// ─────────────────────────────────────────────────────────────────────────────
//
// The Claude variants above use `@"name (agent)"` sub-agent dispatch, which is
// a Claude-specific feature. Copilot and OpenCode sessions are bound to a
// single agent for the lifetime of the session, so replicating the specialist
// pattern would require spawning separate child sessions for each specialist —
// a linear blow-up in session count that is not worth the context-isolation
// benefit for a partition-scoped explorer.
//
// Instead, these generic variants guide a single default-agent session through
// the same conceptual steps (locate → analyze → patterns → synthesize) using
// its own built-in file tools. The graph topology remains identical to the
// Claude version: scout ∥ history → explorer-1..N → aggregator.

/**
 * Generic explorer prompt (Copilot / OpenCode). Drives a single default-agent
 * session through the locate → analyze → patterns → synthesize sequence using
 * built-in tools directly, instead of Claude's sub-agent dispatch.
 */
export function buildExplorerPromptGeneric(opts: {
  question: string;
  index: number;
  total: number;
  partition: PartitionUnit[];
  scoutOverview: string;
  historyOverview: string;
  scratchPath: string;
  root: string;
}): string {
  const assignmentLines = opts.partition
    .map((u) => {
      const abs = path.join(opts.root, u.path);
      return `  - \`${abs}/\` (${u.fileCount} files, ${u.loc.toLocaleString()} LOC)`;
    })
    .join("\n");

  const dirListAbs = opts.partition
    .map((u) => `\`${path.join(opts.root, u.path)}\``)
    .join(", ");

  const orientation = opts.scoutOverview.trim().length > 0
    ? opts.scoutOverview.trim()
    : "(scout overview unavailable — proceed without)";

  const history = opts.historyOverview.trim().length > 0
    ? opts.historyOverview.trim()
    : "(no historical research surfaced)";

  return [
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<YOUR_IDENTITY>`,
    `You are explorer ${opts.index} of ${opts.total} in a deep-research workflow.`,
    `The codebase has been partitioned across ${opts.total} parallel explorers —`,
    `you are responsible for ONE assigned slice. Other explorers are`,
    `simultaneously investigating the rest. You are a documentarian, not a`,
    `critic: record what EXISTS, do not propose improvements.`,
    ``,
    `Your session is fresh — it was created specifically for this task. Every`,
    `piece of context you need is in this prompt; nothing carries over from the`,
    `scout or from other explorers. Treat this prompt as your complete briefing.`,
    `</YOUR_IDENTITY>`,
    ``,
    `<ARCHITECTURAL_ORIENTATION>`,
    `The codebase scout produced this overview to help you orient:`,
    ``,
    orientation,
    `</ARCHITECTURAL_ORIENTATION>`,
    ``,
    `<HISTORICAL_CONTEXT>`,
    `Prior research surfaced by the research-history scout (supplementary —`,
    `live findings you produce below take precedence):`,
    ``,
    history,
    `</HISTORICAL_CONTEXT>`,
    ``,
    `<YOUR_ASSIGNMENT>`,
    `Your assigned directories (DO NOT search outside these — other explorers`,
    `cover the rest):`,
    ``,
    assignmentLines,
    `</YOUR_ASSIGNMENT>`,
    ``,
    `<RESEARCH_PROTOCOL>`,
    `Execute these steps IN ORDER using your built-in file tools (read, grep,`,
    `glob, shell). Each step must complete before the next begins.`,
    ``,
    `── STEP 1 — Locate relevant files ──`,
    ``,
    `Use grep / glob to find files within ONLY these directories:`,
    `${dirListAbs}`,
    ``,
    `that relate to the research question. CRITICAL: restrict every search to`,
    `the directories listed above — do not wander into the rest of the codebase.`,
    ``,
    `Categorize what you find by purpose:`,
    `  - Implementation (core logic)`,
    `  - Tests (unit / integration / e2e)`,
    `  - Types / interfaces`,
    `  - Configuration`,
    `  - Examples / fixtures`,
    `  - Documentation`,
    ``,
    `Record absolute paths grouped by category. Do NOT read file contents yet.`,
    ``,
    `── STEP 2 — Analyze the most relevant implementation files ──`,
    ``,
    `Pick the 5-10 MOST relevant implementation files from STEP 1 and read them`,
    `in full. For each file, document:`,
    `  - Its role (what it does, why it exists)`,
    `  - Key abstractions, types, and functions with \`file.ts:line\` references`,
    `  - Control flow and data flow as they relate to the research question`,
    `  - External dependencies it uses (libraries, other modules)`,
    ``,
    `Use file:line references throughout — never abstract descriptions.`,
    ``,
    `── STEP 3 — Find existing patterns ──`,
    ``,
    `Search (within your assigned directories only) for concrete code patterns`,
    `related to the research question. Return snippets with \`file.ts:line\``,
    `references so the aggregator can cite them directly.`,
    ``,
    `── STEP 4 — External documentation (CONDITIONAL) ──`,
    ``,
    `ONLY run this step IF Step 2 surfaced external library usage that is`,
    `CENTRAL to answering the research question. Otherwise skip it entirely.`,
    ``,
    `If applicable, use your web-fetch / web-search tools to pull focused`,
    `documentation excerpts for the relevant library, tied back to how your`,
    `assigned files use it. Return links and concrete findings only — no`,
    `general tutorials.`,
    ``,
    `── STEP 5 — Synthesize and write findings ──`,
    ``,
    `Combine the outputs from Steps 1-4 into a single markdown document and`,
    `write it to this path using your write / edit tool:`,
    ``,
    `  ${opts.scratchPath}`,
    ``,
    `Use the OUTPUT_FORMAT below. This file is the ONLY way your findings`,
    `reach the aggregator — be complete and precise.`,
    ``,
    `── STEP 6 — Brief prose summary (REQUIRED) ──`,
    ``,
    `AFTER writing the file, output a 2-3 sentence prose summary as your final`,
    `textual response. This is required for two reasons:`,
    `  1. The aggregator uses it as an index of your report`,
    `  2. If your session ends on a tool call with no trailing prose, the`,
    `     downstream handoff will be empty and the aggregator will miss your`,
    `     contribution entirely.`,
    `</RESEARCH_PROTOCOL>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `The file at \`${opts.scratchPath}\` must be a markdown document with these`,
    `sections, in this order:`,
    ``,
    `# Explorer ${opts.index} Findings`,
    ``,
    `## Scope`,
    `One-line description of which directories you covered.`,
    ``,
    `## Overview`,
    `1-2 paragraph synthesis of your findings as they relate to the research`,
    `question.`,
    ``,
    `## Files in Scope`,
    `From Step 1. Categorized list with absolute paths.`,
    ``,
    `## How It Works`,
    `From Step 2. Control flow, data flow, key abstractions, with \`file.ts:line\``,
    `references throughout.`,
    ``,
    `## Patterns`,
    `From Step 3. Concrete code examples with \`file.ts:line\` references.`,
    ``,
    `## External References`,
    `From Step 4 — INCLUDE ONLY if Step 4 ran. Otherwise omit this section.`,
    ``,
    `## Cross-References`,
    `Files OUTSIDE your assigned directories that other explorers should check,`,
    `with a 1-line note on why each is relevant.`,
    ``,
    `## File Index`,
    `Bulleted list of every file you touched, each with a 1-line description.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Use file:line references throughout — concrete, not abstract.`,
    `Do NOT investigate directories outside your assignment.`,
    `Do NOT skip Steps 1-3 or 5-6. Step 4 is the only optional step.`,
    `End your turn with the required 2-3 sentence prose summary AFTER writing`,
    `the file — do NOT end on a tool call, or your findings will be lost to the`,
    `aggregator.`,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}

/**
 * Generic research-history prompt (Copilot / OpenCode). A single default-agent
 * session searches the project's research/ directory using its own file tools,
 * instead of dispatching Claude's codebase-research-locator / analyzer
 * sub-agents.
 */
export function buildHistoryPromptGeneric(opts: {
  question: string;
  root: string;
}): string {
  const researchDir = path.join(opts.root, "research");

  return [
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<YOUR_IDENTITY>`,
    `You are the research-history scout for the deep-research-codebase`,
    `workflow. You run in parallel with the codebase-scout. Your job is to`,
    `surface relevant historical context from the project's existing research`,
    `directory (${researchDir}) — NOT to investigate the live codebase (the`,
    `explorers will do that).`,
    `</YOUR_IDENTITY>`,
    ``,
    `<RESEARCH_PROTOCOL>`,
    `Execute these steps in order using your built-in file tools (read, grep,`,
    `glob, shell):`,
    ``,
    `── STEP 1 — Locate prior research documents ──`,
    ``,
    `Search \`${researchDir}\` (and any sibling research directories that exist)`,
    `for documents related to the research question. Look for:`,
    `  - Research docs (research/docs/, research/*.md)`,
    `  - Decision records / ADRs`,
    `  - Tickets, notes, or RFCs about related topics`,
    ``,
    `If no research/ directory exists at all, note that explicitly and SKIP`,
    `to the final synthesis step with a single-sentence "no history" output.`,
    ``,
    `── STEP 2 — Extract insights from the most relevant documents ──`,
    ``,
    `Pick the 3-5 MOST relevant documents from STEP 1 and read them. For each,`,
    `extract:`,
    `  - Prior decisions that bear on the current question`,
    `  - Completed investigations and their conclusions`,
    `  - Open questions or unresolved threads`,
    ``,
    `Filter out noise — skip anything that isn't directly relevant.`,
    ``,
    `── STEP 3 — Synthesize ──`,
    ``,
    `Output a 200-400 word synthesis of historical context as your final`,
    `prose response. Cover:`,
    `  - Key prior decisions on related topics`,
    `  - Past investigations and their conclusions`,
    `  - Open questions from prior research`,
    `  - Document paths the aggregator should reference (with brief notes)`,
    ``,
    `If no relevant history exists, output a single sentence saying so.`,
    ``,
    `Do NOT write any files — your output is consumed via session transcript.`,
    `Your final assistant message must contain the synthesis as prose. If you`,
    `end on a tool call with no trailing text, the aggregator will see nothing.`,
    `</RESEARCH_PROTOCOL>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Stay under 400 words total in your final synthesis.`,
    `Do NOT investigate live source files — that's the explorers' job.`,
    `End with the prose synthesis (do not end on a tool call).`,
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
  explorerFiles: { index: number; scratchPath: string; partition: PartitionUnit[] }[];
  finalPath: string;
  scoutOverview: string;
  historyOverview: string;
}): string {
  const explorerSummary = opts.explorerFiles
    .map((e) => {
      const dirs = e.partition.map((u) => `\`${u.path}/\``).join(", ");
      return `- **Explorer ${e.index}** → \`${e.scratchPath}\`\n  Covered: ${dirs}`;
    })
    .join("\n");

  const orientation = opts.scoutOverview.trim().length > 0
    ? opts.scoutOverview.trim()
    : "(scout overview unavailable)";

  const history = opts.historyOverview.trim().length > 0
    ? opts.historyOverview.trim()
    : "(no historical research surfaced)";

  return [
    `<RESEARCH_QUESTION>`,
    opts.question,
    `</RESEARCH_QUESTION>`,
    ``,
    `<YOUR_IDENTITY>`,
    `You are the aggregator. ${opts.explorerCount} parallel explorer sub-agents`,
    `have completed their investigations of the codebase`,
    `(${opts.totalLoc.toLocaleString()} LOC across ${opts.totalFiles.toLocaleString()} source files),`,
    `and a parallel research-history scout has surveyed the project's prior`,
    `research documents. Each explorer wrote a detailed findings file. Your`,
    `job is to synthesize these findings — together with historical context —`,
    `into a single comprehensive research document that answers the question.`,
    `</YOUR_IDENTITY>`,
    ``,
    `<ARCHITECTURAL_ORIENTATION>`,
    orientation,
    `</ARCHITECTURAL_ORIENTATION>`,
    ``,
    `<HISTORICAL_CONTEXT>`,
    `The research-history scout dispatched codebase-research-locator and`,
    `codebase-research-analyzer over the project's research/ directory. Their`,
    `synthesis (use as supplementary context — live findings take precedence):`,
    ``,
    history,
    `</HISTORICAL_CONTEXT>`,
    ``,
    `<EXPLORER_REPORTS>`,
    `Read each explorer's findings file in full. Each file has the same`,
    `structure (Scope / Overview / Files in Scope / How It Works / Patterns /`,
    `External References / Cross-References / File Index). The findings`,
    `inside each file were produced by codebase-locator, codebase-analyzer,`,
    `codebase-pattern-finder, and (sometimes) codebase-online-researcher`,
    `sub-agents — they are LIVE evidence and take precedence over history.`,
    ``,
    explorerSummary,
    `</EXPLORER_REPORTS>`,
    ``,
    `<TASK>`,
    `1. Read EVERY explorer findings file in full, one at a time, using the`,
    `   Read tool with no offset or limit.`,
    `2. Synthesize the findings into a unified research document.`,
    `3. Cross-reference: identify connections between findings from different`,
    `   explorers, especially via the "Cross-References" sections.`,
    `4. Integrate historical context where it adds value — but live findings`,
    `   from the explorers are the primary source of truth. If history and`,
    `   live findings disagree, trust the live findings.`,
    `5. Resolve any remaining contradictions by re-reading the underlying`,
    `   source files directly.`,
    `6. Write the final research document to: \`${opts.finalPath}\``,
    `7. After writing the file, output a ≤200-word executive summary as your`,
    `   final prose response so this transcript has content.`,
    `</TASK>`,
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
    `Cross-cutting patterns observed across multiple components.`,
    ``,
    `## Code References`,
    `- \`path/to/file.ts:123\` — what's there`,
    ``,
    `## Historical Context (from research/)`,
    `Relevant insights from prior research documents, with paths. Omit this`,
    `section entirely if the research-history scout found nothing.`,
    ``,
    `## Open Questions`,
    `Areas needing further investigation.`,
    ``,
    `## Methodology`,
    `Generated by the deep-research-codebase workflow with ${opts.explorerCount} parallel`,
    `explorers covering ${opts.totalFiles.toLocaleString()} source files`,
    `(${opts.totalLoc.toLocaleString()} LOC). Each explorer dispatched the`,
    `codebase-locator, codebase-analyzer, codebase-pattern-finder, and (when`,
    `applicable) codebase-online-researcher sub-agents over its assigned`,
    `partition. A parallel research-history scout dispatched`,
    `codebase-research-locator and codebase-research-analyzer over the`,
    `project's prior research documents.`,
    "```",
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    DOCUMENTARIAN_DISCLAIMER,
    `Prefer concrete file:line references over abstract descriptions.`,
    `Do NOT skim explorer reports — read each one in full.`,
    `If two explorers contradict each other, re-read the underlying source files.`,
    `End with the required ≤200-word executive summary AFTER writing the file.`,
    `</CONSTRAINTS>`,
    ``,
    `<RESEARCH_QUESTION_REMINDER>`,
    opts.question,
    `</RESEARCH_QUESTION_REMINDER>`,
  ].join("\n");
}
