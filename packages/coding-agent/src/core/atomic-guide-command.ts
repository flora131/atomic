import * as path from "node:path";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { getChangelogPath, parseChangelog } from "../utils/changelog.ts";

export const ATOMIC_GUIDE_COMMAND_NAME = "atomic";
export const ATOMIC_GUIDE_COMMAND_DESCRIPTION = "Atomic onboarding and help guide";

const OVERVIEW = `# Atomic overview

Atomic turns one-off prompts into developer workflows: on-call debugging, repo research that turns into implementation, testing and review loops, and larger multi-stage automation. Start it in a project with \`atomic\`, then talk to it normally. Use \`@file\` to attach files, \`!command\` to run shell output through the model, and \`!!command\` to run shell output without adding it to context.

## Core session commands

| Command | Use |
|---|---|
| \`/login\` | configure auth |
| \`/model\` | switch model |
| \`/settings\` | thinking level, theme, message delivery, transport |
| \`/new\`, \`/resume\` | start or resume sessions |
| \`/tree\`, \`/fork\`, \`/clone\` | branch or navigate session history |
| \`/compact\` | summarize older context |
| \`/hotkeys\`, \`/changelog\` | local help and release notes |

## Examples of using Atomic

| Goal | How to use |
|---|---|
| On-call / broken behavior | Use \`/skill:workflow\` to create a workflow that runs \`/run debugger "Reproduce the failure, patch the root cause, and validate it"\` for a focused fix loop |
| Research → spec → implementation | Use \`/skill:workflow\` to create a workflow that runs \`/skill:research-codebase\`, then \`/skill:create-spec\`, then direct implementation or \`/workflow ralph ...\` |
| Testing / regression hardening | Use \`/skill:workflow\` to create a workflow that runs \`/skill:tdd\` for test-first work, then \`/parallel-review current diff\`, then land the change |
| Large repo discovery | Use \`/skill:workflow\` to create a workflow that runs \`/parallel codebase-locator "map the area" -> codebase-analyzer "trace the current flow" -> codebase-pattern-finder "find patterns" --bg\` |
| UI / product polish | Use \`/skill:workflow\` to create a workflow that runs \`/skill:impeccable\` for interface critique, refinement, and clearer UX decisions |

## Subagents

Subagents are focused child Atomic sessions you can point at one job inside the repo.

| Built-in subagent | Use |
|---|---|
| \`codebase-locator\` | find relevant files, tests, entrypoints, and configs |
| \`codebase-analyzer\` | explain current behavior with file:line refs |
| \`codebase-pattern-finder\` | find existing code to model after |
| \`debugger\` | reproduce, diagnose, and fix broken behavior |

How the direct commands map to repo work:
- \`/run\` = one specialist on one job, for example \`/run codebase-locator "Map the webhook retry flow"\`
- \`/parallel\` = several independent specialists at once, for example \`/parallel codebase-locator "map retry files" -> codebase-pattern-finder "find existing retry/backoff patterns" -> codebase-online-researcher "research current retry guidance" --bg\`
- \`/chain\` = ordered handoffs, for example \`/chain codebase-locator "find the auth files" -> codebase-analyzer "trace the auth flow" -> debugger "patch the failing auth edge case"\`

## Top skills

| Skill | When to use | How to run |
|---|---|---|
| \`research-codebase\` | write a grounded research artifact for one subsystem or question | \`/skill:research-codebase how the rate limiter works in src/middleware/\` |
| \`create-spec\` | turn research into an implementation-ready plan | \`/skill:create-spec from research/docs/<date>-<topic>.md\` |
| \`tdd\` | do test-first feature or bug work | \`/skill:tdd\` |
| \`prompt-engineer\` | tighten a vague prompt before a long run | \`/skill:prompt-engineer Draft a sharper implementation prompt for ...\` |
| \`workflow\` | author, inspect, or improve workflows; start by describing the desired workflow in natural language | \`/skill:workflow\` |
| \`subagent\` | learn delegation patterns and exact \`/run\`, \`/parallel\`, and \`/chain\` usage | \`/skill:subagent\` |
| \`impeccable\` | critique or refine frontend and product UI | \`/skill:impeccable\` |

## Built-in workflows

| Workflow | When to use | How to run |
|---|---|---|
| \`deep-research-codebase\` | broad repo or cross-cutting research before you decide what to change (for one area, use \`/skill:research-codebase\`; this indexes the whole repo) | \`/workflow deep-research-codebase prompt="How do payment retries work end to end?"\` |
| \`ralph\` | larger implementation loops where you want implementation, review, and validation built in | \`/workflow ralph prompt="Implement specs/<date>-<topic>.md and validate the changed behavior"\` |
| \`open-claude-design\` | UI and design-system work that benefits from generation and refinement loops | \`/workflow open-claude-design prompt="Refresh the settings page hierarchy"\` |

Use \`/workflow list\` to see what is available and \`/workflow inputs <name>\` to inspect inputs in your environment.

─────────────────────────────────────────────────────────────────

Where to next:

\`/atomic example\` — see the pieces used on a code task
\`/atomic workflows\` — learn when to use workflows`;

const EXAMPLE = `# Practical example

This is an example of a spec-driven development process using Atomic workflows. Use it when you are new to a repo or the task has non-trivial scope. Type the examples below into the Atomic TUI chat after starting \`atomic\` in your project.

## 1. Research what exists

Use \`/skill:research-codebase\` for a scoped area, subsystem, or directory:

\`/skill:research-codebase how the rate limiter works in src/middleware/\`

Use \`deep-research-codebase\` when the answer spans the whole repo or a cross-cutting implementation path:

\`/workflow deep-research-codebase prompt="How do payment retries work end to end?"\`

If the research prompt is vague, tighten it first with \`/skill:prompt-engineer\`:

\`/skill:prompt-engineer Draft a sharper repo-research prompt for understanding payment retries end to end, including retries, queues, and failure handling.\`

## 2. Create a spec when requirements are fuzzy

Skip this if the implementation request is already precise.

\`/skill:create-spec from research/docs/<date>-<topic>.md\`

## 3. Implement with review built in

For ordinary work, ask Atomic directly and require validation:

\`Implement the approved spec in specs/<date>-<topic>.md. Run focused tests and summarize validation.\`

For larger work, use subagents or a workflow:

\`/workflow ralph prompt="Implement specs/<date>-<topic>.md and validate the changed behavior"\`

## 4. Decide and land

If you used \`ralph\`, the workflow already ran parallel reviewers. Use its final result and review feedback to decide whether to ship or iterate again.

If you implemented directly instead of using \`ralph\`, you can still run:

\`/parallel-review current diff\`

Atomic will synthesize reviewer feedback and ask before applying fixes.

─────────────────────────────────────────────────────────────────

Where to next:

\`/atomic workflows\` — learn when to use workflows
\`/atomic overview\` — quick refresh`;

const WORKFLOWS = `# Workflows primer

A workflow is a TypeScript-defined pipeline built with \`defineWorkflow(...).run(...).compile()\`. It can run tasks, chains, parallel fan-out, human-in-the-loop prompts, background status, and model fallback chains.

Start by defining the workflow in natural language with \`/skill:workflow\`, the workflow creator skill. Describe the goal, inputs, stages, which steps are parallel or sequential, handoff/output shape, and any model or thinking-level preferences; let the skill help turn that into a reusable workflow before you hand-edit TypeScript.

## Built-in workflows

| Workflow | When to use | How to run |
|---|---|---|
| \`deep-research-codebase\` | broad repo or cross-cutting research before you decide what to change (for one area, use \`/skill:research-codebase\`; this indexes the whole repo) | \`/workflow deep-research-codebase prompt="How do payment retries work end to end?"\` |
| \`ralph\` | larger implementation and review loops | \`/workflow ralph prompt="Implement specs/<date>-<topic>.md and validate the changed behavior"\` |
| \`open-claude-design\` | frontend and product design work | \`/workflow open-claude-design prompt="Refresh the settings page hierarchy"\` |

Use \`/workflow inputs <name>\` to inspect the exact inputs in your environment.

Use \`/skill:research-codebase ...\` when you want research on one subsystem, directory, or focused question. Use \`/workflow deep-research-codebase ...\` when the answer needs end-to-end tracing across many parts of the repo.

If you are drafting research, reviewer, or synthesis prompts for a workflow, use \`/skill:prompt-engineer\` first. It is a good fit when a stage prompt feels vague, overloaded, or underspecified.

## What good workflow authoring looks like

A good workflow request is explicit about stage purpose, model choice, handoff, and the decision each step must return.

Example: prompt \`/skill:workflow\` with something like this:

~~~text
Create a reusable workflow called review-changes.

It should accept one required text input called target for a diff, PR summary, or review target.

Run two independent review stages in parallel with fresh context:
- one reviewer focused on correctness, regressions, and missing tests using openai-codex/gpt-5.5 at xhigh thinking
- one reviewer focused on edge cases, maintainability, and hidden risks using anthropic/claude-opus-4-7 at xhigh thinking

Then add an aggregate stage that consolidates both reviews, deduplicates overlap, keeps only evidence-backed issues, and separates blockers from optional suggestions using openai/gpt-5.5 at high thinking.

Finally add an adjudicate stage using anthropic/claude-sonnet-4 at high thinking that decides what to fix now, what to defer, and what to reject. Return a short action list with rationale.

The workflow should return structured output with consolidated_review and decision fields.
~~~

Why this is good:
- it names the workflow and required input
- it specifies which stages are parallel vs sequential
- each stage has one job
- it defines the handoff and final outputs
- it calls out model choice and thinking level where that matters

## Run and inspect

\`/workflow list\`

\`/workflow inputs ralph\`

\`/workflow ralph prompt="Migrate the database layer to Drizzle" max_loops=5\`

\`/workflow status\`

\`/workflow connect <run-id>\`

\`/workflow interrupt <run-id>\`

\`/workflow resume <run-id>\`

Workflows run as background tasks. Use F2 or \`/workflow connect <run-id>\` for the graph viewer. Human-in-the-loop prompts appear there, not as chat modals.

## Author your own

Use \`/skill:workflow\` to describe your workflow in natural language and build your first workflow. This is the recommended starting point for creation and design questions: say what you want the workflow to accomplish, what inputs it should accept, what stages should run, and what final output or decision it should return. Ask Atomic in chat when you want help refining or implementing one.

─────────────────────────────────────────────────────────────────

Where to next:

\`/atomic example\` — see workflows in a normal task flow
\`/atomic overview\` — quick refresh`;

const GUIDE_SECTIONS = [
	{
		name: "overview",
		aliases: [],
		label: "overview",
		description: "30-second overview",
		render: () => OVERVIEW,
	},
	{
		name: "workflows",
		aliases: ["workflow"],
		label: "workflows",
		description: "Workflow primer",
		render: () => WORKFLOWS,
	},
	{
		name: "example",
		aliases: ["examples"],
		label: "example",
		description: "Practical first workflow",
		render: () => EXAMPLE,
	},
	{
		name: "whats-new",
		aliases: ["what's new", "whats new", "news", "updates", "changelog"],
		label: "what's new",
		description: "Recent release notes",
		render: readLatestStableChangelog,
	},
] as const satisfies readonly {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly label: string;
	readonly description: string;
	readonly render: (cwd: string) => string;
}[];

type AtomicGuideSection = (typeof GUIDE_SECTIONS)[number];
type AtomicGuideSectionName = AtomicGuideSection["name"];

export type AtomicGuideHelpChoice = AtomicGuideSection["label"];

export type AtomicGuideMode = "help" | AtomicGuideSectionName;

export const ATOMIC_GUIDE_HELP_CHOICES: readonly AtomicGuideHelpChoice[] = GUIDE_SECTIONS.map(
	(section) => section.label,
);

const GUIDE_SECTIONS_BY_NAME = new Map<AtomicGuideSectionName, AtomicGuideSection>(
	GUIDE_SECTIONS.map((section) => [section.name, section]),
);
const GUIDE_SECTIONS_BY_LABEL = new Map<string, AtomicGuideSection>(
	GUIDE_SECTIONS.map((section) => [section.label, section]),
);
const GUIDE_SECTIONS_BY_INPUT = new Map<string, AtomicGuideSection>(
	GUIDE_SECTIONS.flatMap((section) =>
		[section.name, section.label, ...section.aliases].map((input) => [input, section] as const),
	),
);

export function isAtomicGuideHelpChoice(choice: string): choice is AtomicGuideHelpChoice {
	return GUIDE_SECTIONS_BY_LABEL.has(choice);
}

const ATOMIC_GUIDE_TRAILING_PUNCTUATION = "?!.,;:";

function stripTrailingAtomicGuidePunctuation(value: string): string {
	let end = value.length;
	while (end > 0 && ATOMIC_GUIDE_TRAILING_PUNCTUATION.includes(value.charAt(end - 1))) {
		end--;
	}
	return value.slice(0, end);
}

function getGuideSectionForChoice(choice: string): AtomicGuideSection | undefined {
	return GUIDE_SECTIONS_BY_LABEL.get(choice);
}

function getGuideSectionForMode(mode: AtomicGuideSectionName): AtomicGuideSection {
	const section = GUIDE_SECTIONS_BY_NAME.get(mode);
	if (!section) throw new Error(`Unknown Atomic guide section: ${mode}`);
	return section;
}

function getAtomicGuideHelpMenu(): string {
	const sectionHelp = GUIDE_SECTIONS.map(
		(section) => `- \`${section.label}\` — run \`/atomic ${section.label}\``,
	).join("\n");
	return `# Atomic\n\nSelect where to start:\n\n${sectionHelp}`;
}

export function normalizeAtomicGuideMode(args: string): AtomicGuideMode {
	const normalized = stripTrailingAtomicGuidePunctuation(args.trim().toLowerCase());
	if (!normalized) return "help";

	return GUIDE_SECTIONS_BY_INPUT.get(normalized)?.name ?? "help";
}

export function getAtomicGuideArgumentCompletions(prefix: string): AutocompleteItem[] | null {
	const query = prefix.trim().toLowerCase();
	const items = GUIDE_SECTIONS.map((section) => ({
		value: section.label,
		label: section.label,
		description: section.description,
	}));
	const filtered = query
		? items.filter((item) => item.value.startsWith(query) || item.label.startsWith(query))
		: items;
	return filtered.length > 0 ? filtered : null;
}

function readLatestStableChangelog(cwd: string): string {
	const changelogPath = getChangelogPath();
	const stableSections = parseChangelog(changelogPath)
		.filter((entry) => entry.prerelease === null)
		.slice(0, 3)
		.map((entry) => entry.content.trim())
		.filter(Boolean);

	if (stableSections.length === 0) {
		return `# What's new\n\nNo stable release sections were found. Try \`/changelog\` for the interactive changelog viewer.\n\n─────────────────────────────────────────────────────────────────\n\nWhere to next:\n\n\`/atomic example\` — see a practical first workflow\n\`/atomic overview\` — quick refresh`;
	}

	const relativePath = path.relative(cwd, changelogPath) || changelogPath;
	return `# What's new\n\n${stableSections.join("\n\n")}\n\nSource: \`${relativePath}\`\n\n─────────────────────────────────────────────────────────────────\n\nWhere to next:\n\n\`/atomic example\` — see a practical first workflow\n\`/atomic overview\` — quick refresh`;
}

export function getAtomicGuideMessage(mode: AtomicGuideMode, cwd: string): string {
	if (mode === "help") return getAtomicGuideHelpMenu();
	return getGuideSectionForMode(mode).render(cwd);
}

export function atomicGuideModeForChoice(choice: AtomicGuideHelpChoice): AtomicGuideMode {
	return getGuideSectionForChoice(choice)?.name ?? "help";
}

