# Atomic

<p align="center">
  <img src="assets/atomic.png" alt="Atomic" width="800">
</p>

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/flora131/atomic)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](./package.json)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun&logoColor=black)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Atomic is an open-source **multi-agent harness** that orchestrates **Claude Code**, **OpenCode**, and **GitHub Copilot CLI** through a unified interface — with **containerized execution**, **DAG-based workflows**, **deep codebase research**, and **autonomous multi-hour coding sessions**.

> One CLI. Three agent SDKs. Research it, spec it, ship it — then wake up to completed code ready for review.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Video Overview](#video-overview)
- [Core Features](#core-features)
  - [Multi-Agent SDK Support](#multi-agent-sdk-support)
  - [Workflow SDK — Build Your Own Harness](#workflow-sdk--build-your-own-harness)
  - [Deep Codebase Research](#deep-codebase-research)
  - [Autonomous Execution (Ralph)](#autonomous-execution-ralph)
  - [Containerized Execution](#containerized-execution)
  - [Specialized Sub-Agents](#specialized-sub-agents)
  - [19 Built-in Skills](#19-built-in-skills)
  - [Interactive TUI](#interactive-tui)
- [Architecture](#architecture)
- [Commands Reference](#commands-reference)
- [Configuration](#configuration)
- [Installation Options](#installation-options)
- [Updating & Uninstalling](#updating--uninstalling)
- [Telemetry](#telemetry)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

---

## Quick Start

### Prerequisites

- **macOS, Linux, or Windows** (PowerShell 7+ required on Windows — [install guide](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows))
- **At least one coding agent installed and logged in:**
  - [Claude Code](https://code.claude.com/docs/en/quickstart) — run `claude` and complete authentication
  - [OpenCode](https://opencode.ai) — run `opencode` and complete authentication
  - [GitHub Copilot CLI](https://github.com/features/copilot/cli) — run `copilot` and complete authentication

### 1. Install

**Devcontainer (recommended):**

> [!TIP]
> Devcontainers isolate the coding agent from your host system, reducing the risk of destructive actions like unintended file deletions or misapplied shell commands. This makes them the safest way to run Atomic.
>
> Use the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) for VS Code or [DevPod](https://devpod.sh) to spawn and manage your devcontainers.

Add a single feature to your `.devcontainer/devcontainer.json` — this installs Atomic, the coding agent, GitHub CLI, and all dependencies automatically.

```
your-project/
├── .devcontainer/
│   └── devcontainer.json   ← add the feature here
├── src/
└── ...
```

```jsonc
{
  "features": {
    "ghcr.io/flora131/atomic/claude:1": {}   // or /opencode:1 or /copilot:1
  }
}
```

| Feature | Reference | Agent |
|---------|-----------|-------|
| Atomic + Claude Code | `ghcr.io/flora131/atomic/claude:1` | [Claude Code](https://claude.ai) |
| Atomic + OpenCode | `ghcr.io/flora131/atomic/opencode:1` | [OpenCode](https://opencode.ai) |
| Atomic + Copilot CLI | `ghcr.io/flora131/atomic/copilot:1` | [Copilot CLI](https://github.com/github/copilot-cli) |

Each feature installs the Atomic CLI, all shared dependencies (bun, playwright-cli), agent-specific configurations (agents, skills), and the agent CLI itself. Features are versioned in sync with Atomic CLI releases.

**macOS / Linux (standalone):**

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
# or with wget:
wget -qO- https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows PowerShell (standalone):**

```powershell
irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

### 2. Initialize Your Project

```bash
cd your-project
atomic init
```

Select your coding agent when prompted. The CLI configures your project automatically.

### 3. Generate Context Files

Start a chat session and run `/init` to generate `CLAUDE.md` and `AGENTS.md`:

```bash
atomic chat -a <claude|opencode|copilot>
```

```
/init
```

This explores your codebase using sub-agents and generates documentation that gives coding agents the context they need.

### 4. Ship Features

```
Research  →  Spec  →  Implement, Verify & Review  →  PR
```

```bash
# Research the codebase
/research-codebase Describe your feature or question
/clear

# Create a specification (review carefully — it becomes the contract)
/create-spec research-path
/clear

# Implement autonomously
/ralph "<prompt-or-spec-path>"

# Review the implementation
# Ralph runs tests, reviews correctness, and fixes issues automatically —
# but you should still read the code changes before shipping.
Review the code changes against the spec. Flag anything that doesn't match.

# Commit and ship
/gh-commit
/gh-create-pr
```

> **Testing and verification are automated.** Ralph's review-debug loop runs tests, checks correctness and test coverage against the spec, and fixes issues — but we suggest to review the final diff yourself before committing.

If something breaks, use the debugging agent:

```
Use the debugging agent to create a debugging report for [error message]
```

---

## Video Overview

[![Atomic Video Overview](https://img.youtube.com/vi/Lq8-qzGfoy4/maxresdefault.jpg)](https://www.youtube.com/watch?v=Lq8-qzGfoy4)

---

## Core Features

### Multi-Agent SDK Support

Atomic is the only harness that unifies **three production agent SDKs** behind a single interface. Switch between agents with a flag — your workflows, skills, and sub-agents work across all of them.

| Agent | SDK | Command |
| --- | --- | --- |
| Claude Code | `@anthropic-ai/claude-agent-sdk` | `atomic chat -a claude` |
| OpenCode | `@opencode-ai/sdk` | `atomic chat -a opencode` |
| GitHub Copilot CLI | `@github/copilot-sdk` | `atomic chat -a copilot` |

Each agent gets its own configuration directory (`.claude/`, `.opencode/`, `.github/`), skills, and context files — all managed by Atomic. Write a workflow once, run it on any agent.

### Workflow SDK — Build Your Own Harness

Every team has a process — triage bugs this way, ship features that way, review PRs with these checks. Most of it lives in a wiki nobody reads or in one senior engineer's head. The **Workflow SDK** (`@bastani/atomic-workflows`) lets you encode that process as a type-safe DAG with conditional branching, human approval gates, and bounded review loops — then run it as a slash command.

Drop a `.ts` file in `.atomic/workflows/` and it becomes available to anyone on the team:

```
/fix-bug "Users get 403 after password reset — see JIRA-4821"
```

Triage → human approval gate → regression test first → fix → review loop (max 3 rounds). Your process, enforced by the workflow — not by hope.

<details>
<summary>See an example of the workflow definition</summary>

```ts
// .atomic/workflows/fix-bug.ts
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "fix-bug",
  description: "Triage → reproduce → fix → verify",
})
  .version("1.0.0")
  .argumentHint("<bug-description-or-ticket-url>")
  .stage({ name: "triage", agent: "codebase-analyzer", description: "TRIAGE",
    prompt: (ctx) => `Identify root cause, affected code paths, and blast radius:\n${ctx.userPrompt}`,
    outputMapper: (r) => ({ triage: JSON.parse(r) }) })
  .askUserQuestion({ name: "approve",
    question: { question: "Diagnosis correct?", options: [{ label: "Yes" }, { label: "No" }] },
    outputMapper: (answer) => ({ approved: answer === "Yes" }) })
  .if((ctx) => !ctx.state.approved)
    .stage({ name: "re-triage", agent: "codebase-analyzer", description: "RE-TRIAGE",
      prompt: () => `Initial diagnosis was rejected. Dig deeper.`,
      outputMapper: (r) => ({ triage: JSON.parse(r) }) })
  .endIf()
  .stage({ name: "fix", agent: null, description: "FIX",
    prompt: (ctx) => `Write a regression test FIRST, then fix:\n${JSON.stringify(ctx.state.triage)}`,
    outputMapper: () => ({}) })
  .loop({ maxCycles: 3 })
    .stage({ name: "review", agent: "reviewer", description: "REVIEW",
      prompt: () => `Verify: regression test fails without fix, passes with it. No unrelated changes.`,
      outputMapper: (r) => ({ review: JSON.parse(r) }) })
    .break(() => (state) => state.review?.allPassing === true)
    .stage({ name: "iterate", agent: null, description: "ITERATE",
      prompt: (ctx) => `Fix review issues:\n${JSON.stringify(ctx.state.review)}`,
      outputMapper: () => ({}) })
  .endLoop()
  .compile();
```

</details>

**Key capabilities:**

| Capability | Description |
| --- | --- |
| **Stages** | LLM-powered agent sessions with per-stage model and reasoning effort overrides |
| **Tools** | Deterministic functions (no LLM) for data transformation |
| **Human-in-the-loop** | Pause execution for user approval or input |
| **Conditional branching** | `.if()` / `.elseIf()` / `.else()` / `.endIf()` |
| **Bounded loops** | `.loop({ maxCycles })` / `.endLoop()` with `.break()` for early exit |
| **Custom state** | Shared state with built-in reducers (`concat`, `merge`, `mergeById`, `max`, `min`, `sum`, custom) |
| **Verification** | `atomic workflow verify` checks reachability, deadlocks, bounded loops, and valid references |

Drop a `.ts` file in `.atomic/workflows/` (project-local) or `~/.atomic/workflows/` (global) and it becomes a slash command automatically. You can also ask Atomic to create workflows for you:

```
Use your workflow-creator skill to create a workflow that plans, implements, and reviews a feature.
```

<details>
<summary>Full Workflow SDK Reference</summary>

#### Node Types

| Method | Purpose |
| --- | --- |
| `.stage({ ... })` | Run an agent session (LLM-powered) |
| `.tool({ ... })` | Run a deterministic function (no LLM) |
| `.askUserQuestion({ ... })` | Pause for user input |

#### Control Flow

| Method | Purpose |
| --- | --- |
| `.if(condition)` / `.elseIf()` / `.else()` / `.endIf()` | Conditional branching |
| `.loop({ maxCycles })` / `.endLoop()` | Bounded loops |
| `.break(condition)` | Early exit from a loop |

#### Metadata

| Method | Purpose |
| --- | --- |
| `.version("1.0.0")` | Set SemVer version |
| `.argumentHint("<file-path>")` | CLI usage hint |
| `.compile()` | **Required** — terminal method that produces the compiled workflow |

#### Stage Configuration

```ts
.stage({
  name: "analyze",              // Unique identifier
  agent: "planner",             // Agent definition name (or null for defaults)
  description: "⌕ ANALYZE",    // Display label
  prompt: (ctx) => "...",       // Build the prompt from context
  outputMapper: (response) =>   // Extract structured data from response
    ({ key: JSON.parse(response) }),
  sessionConfig: {              // Optional: per-stage model overrides
    model: { claude: "claude-opus-4-20250514" },
    reasoningEffort: { claude: "high" },
  },
  disallowedTools: {            // Optional: per-provider tool exclusions
    claude: ["AskUserQuestion"],
    opencode: ["question"],
    copilot: ["ask_user"],
  },
})
```

#### Custom State

Define shared state with built-in reducers that control how updates merge across stages:

```ts
export default defineWorkflow({
  name: "stateful-workflow",
  description: "Workflow with shared state",
  globalState: {
    findings: { default: () => [], reducer: "concat" },
    score: { default: 0, reducer: "max" },
    tasks: { default: () => [], reducer: "mergeById", key: "id" },
  },
})
  // ... stages ...
  .compile();
```

**Available reducers:** `replace` (default), `concat`, `merge`, `mergeById`, `max`, `min`, `sum`, `or`, `and`, or a custom `(current, update) => result` function.

#### Common Patterns

<details>
<summary>Review loop with early exit</summary>

```ts
defineWorkflow({ name: "review-loop", description: "Iterative review" })
  .stage({ name: "implement", agent: null, description: "⚡ IMPLEMENT",
    prompt: (ctx) => ctx.userPrompt, outputMapper: () => ({}) })
  .loop({ maxCycles: 5 })
    .stage({ name: "review", agent: "reviewer", description: "🔍 REVIEW",
      prompt: (ctx) => `Review against: ${ctx.userPrompt}`,
      outputMapper: (r) => ({ reviewResult: JSON.parse(r) }) })
    .break(() => (state) => state.reviewResult?.allPassing === true)
    .stage({ name: "fix", agent: null, description: "🔧 FIX",
      prompt: (ctx) => `Fix issues from review`, outputMapper: () => ({}) })
  .endLoop()
  .compile();
```

</details>

<details>
<summary>Human-in-the-loop approval</summary>

```ts
.askUserQuestion({
  name: "approve",
  question: {
    question: "Approve this plan?",
    options: [{ label: "Yes" }, { label: "No" }],
  },
  outputMapper: (answer) => ({ approved: answer === "Yes" }),
})
.if((ctx) => ctx.state.approved)
  .stage({ name: "implement", agent: null, description: "⚡ IMPLEMENT",
    prompt: (ctx) => ctx.userPrompt, outputMapper: () => ({}) })
.else()
  .stage({ name: "re-plan", agent: "planner", description: "⌕ RE-PLAN",
    prompt: (ctx) => `Re-plan: ${ctx.userPrompt}`,
    outputMapper: (r) => ({ plan: JSON.parse(r) }) })
.endIf()
```

</details>

<details>
<summary>Conditional branching</summary>

```ts
defineWorkflow({ name: "triage", description: "Route by type" })
  .stage({ name: "classify", agent: "planner", description: "⌕ CLASSIFY",
    prompt: (ctx) => `Classify: ${ctx.userPrompt}`,
    outputMapper: (r) => ({ type: JSON.parse(r).type }) })
  .if((ctx) => ctx.stageOutputs.get("classify")?.parsedOutput?.type === "bug")
    .stage({ name: "fix-bug", agent: null, description: "🔧 FIX",
      prompt: (ctx) => `Fix the bug`, outputMapper: () => ({}) })
  .elseIf((ctx) => ctx.stageOutputs.get("classify")?.parsedOutput?.type === "feature")
    .stage({ name: "build", agent: null, description: "⚡ BUILD",
      prompt: (ctx) => `Build the feature`, outputMapper: () => ({}) })
  .else()
    .stage({ name: "research", agent: "researcher", description: "🔍 RESEARCH",
      prompt: (ctx) => `Research: ${ctx.userPrompt}`,
      outputMapper: (r) => ({ findings: r }) })
  .endIf()
  .compile();
```

</details>

#### Context Available in Stages

| Property | Type | Description |
| --- | --- | --- |
| `ctx.userPrompt` | `string` | Original user input |
| `ctx.stageOutputs` | `ReadonlyMap<string, StageOutput>` | Prior stage outputs |
| `ctx.tasks` | `readonly TaskItem[]` | Current task list |
| `ctx.state` | `TState` | Typed workflow state |
| `ctx.abortSignal` | `AbortSignal` | Cancellation signal |

#### Key Rules

1. Every workflow file must use `export default` with `.compile()` at the end
2. Node names must be unique across all node types
3. Every `.if()` needs `.endIf()`, every `.loop()` needs `.endLoop()`
4. `.break()` can only appear inside loops
5. Agents reference markdown definition files in your agent config directory

For complete documentation, see the [Workflow SDK package](packages/workflow-sdk/).

</details>

### Deep Codebase Research

The `/research-codebase` command dispatches **specialized sub-agents in parallel** to analyze your codebase:

- Understand how authentication flows work in an unfamiliar codebase
- Track down root causes by analyzing code paths across dozens of files
- Search through docs, READMEs, and inline documentation
- Query external documentation via [DeepWiki MCP](https://deepwiki.com) integration
- Get up to speed on a new project in minutes instead of hours

**Research sub-agents:**

| Sub-Agent | Model | Purpose |
| --- | --- | --- |
| `codebase-locator` | Haiku | Locate files, directories, and components relevant to the research topic |
| `codebase-analyzer` | Sonnet | Analyze implementation details, trace data flow, and explain technical workings |
| `codebase-pattern-finder` | Haiku | Find similar implementations, usage examples, and existing patterns to model after |
| `codebase-online-researcher` | Sonnet | Fetch up-to-date information from the web and repository-specific knowledge from DeepWiki |
| `codebase-research-locator` | Haiku | Discover relevant documents in `research/` and `specs/` directories |
| `codebase-research-analyzer` | Sonnet | Extract high-value insights, decisions, and technical details from research documents |

**Why specialized research agents instead of one general-purpose agent?**

A single agent asked to "research the auth system" will try to search, read, analyze, and summarize — all within one context window. As that window fills with file contents, search results, and intermediate reasoning, the agent's ability to synthesize degrades. This is a fundamental constraint of transformer-based models: attention quality drops as context length grows.

Atomic solves this by dispatching **purpose-built sub-agents** — a `codebase-locator` that only finds relevant files, a `codebase-analyzer` that only reads and analyzes implementation details, a `codebase-online-researcher` that only queries external documentation. Each agent operates in its own context window with only the tools it needs. The parent agent receives distilled findings from each sub-agent, keeping its own context clean for synthesis.

This mirrors how effective engineering teams work: you don't send one person to simultaneously search the codebase, read the docs, and analyze the architecture. You parallelize. The result is faster research, higher-quality findings, and significantly less hallucination — because each agent is reasoning over a small, focused context rather than a bloated one.

**Run parallel research sessions** to evaluate competing approaches simultaneously:

```bash
# Terminal 1: Research LangChain approach
atomic chat -a claude "/research-codebase Research implementing GraphRAG using \
  LangChain's graph retrieval patterns. Look up langchain-ai/langchain for \
  graph store integrations."

# Terminal 2: Research Microsoft's GraphRAG
atomic chat -a claude "/research-codebase Research implementing GraphRAG using \
  Microsoft's GraphRAG library. Look up microsoft/graphrag for their \
  community detection pipeline."

# Terminal 3: Research LlamaIndex approach
atomic chat -a claude "/research-codebase Research implementing GraphRAG using \
  LlamaIndex's property graph index. Look up run-llama/llama_index."
```

Each agent spawns sub-agents that query DeepWiki, pull external documentation, and cross-reference with your codebase. Then run `/create-spec` on each research doc, spin up git worktrees, and run `/ralph` in each — wake up to three complete implementations on separate branches.

> Works identically with `atomic chat -a opencode` and `atomic chat -a copilot`.

Research outputs persist in your `research/` directory and specs persist in your `specs/` directory — both become context for future sessions, so every investigation and every specification compounds.

### Autonomous Execution (Ralph)

<p align="center">
  <img src="assets/ralph-wiggum.jpg" alt="Ralph Wiggum" width="600">
</p>

The [Ralph Wiggum Method](https://ghuntley.com/ralph/) enables **multi-hour autonomous coding sessions**. After approving your spec, let Ralph work in the background while you focus on other tasks.

**How Ralph works:**

1. **Task Decomposition** — A `planner` sub-agent breaks your spec into a structured task list with dependency tracking, stored in a SQLite database with WAL mode for parallel access
2. **Worker Loop** — Dispatches `worker` sub-agents for ready tasks, executing up to 100 iterations with concurrent execution of independent tasks
3. **Review & Fix** — A `reviewer` sub-agent audits the implementation; if issues are found, a `fixer` sub-agent generates corrective tasks that re-enter the worker loop

```bash
atomic chat -a <claude|opencode|copilot>
```

```
# From a prompt
/ralph "Build a REST API for user management"

# From a spec file
/ralph "specs/YYYY-MM-DD-my-feature.md"
```

**Best practice:** Run Ralph in a separate [git worktree](https://git-scm.com/docs/git-worktree) to isolate autonomous execution:

```bash
git worktree add ../my-project-ralph feature-branch
cd ../my-project-ralph
atomic chat -a claude
# /ralph "Build the auth module"
```

### Containerized Execution

Atomic ships as **devcontainer features** that bundle the CLI, agent, and all dependencies into isolated containers. This is the recommended way to run autonomous agents safely.

```jsonc
// .devcontainer/devcontainer.json
{
  "image": "mcr.microsoft.com/devcontainers/rust:latest",
  "features": {
    "ghcr.io/flora131/atomic/claude:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  }
}
```

**Why containerize?**

- Agents run `rm`, `git reset --hard`, and arbitrary shell commands — containers limit blast radius
- Reproducible environments across team members and CI
- Pre-installed dependencies: bun, playwright-cli, agent CLI, GitHub CLI
- Features are versioned in sync with Atomic releases

Each feature installs Atomic + one agent. Mix and match across projects:

| Feature | Installs |
| --- | --- |
| `ghcr.io/flora131/atomic/claude:1` | Atomic + Claude Code |
| `ghcr.io/flora131/atomic/opencode:1` | Atomic + OpenCode |
| `ghcr.io/flora131/atomic/copilot:1` | Atomic + Copilot CLI |

### Specialized Sub-Agents

Atomic doesn't use one general-purpose agent for everything. It dispatches **purpose-built sub-agents**, each with scoped context, tools, and termination conditions:

| Sub-Agent | Purpose |
| --- | --- |
| `planner` | Decompose specs into structured task lists with dependency tracking |
| `worker` | Implement single focused tasks (multiple workers run in parallel) |
| `reviewer` | Audit implementations against specs and best practices |
| `fixer` | Generate corrective tasks from review feedback |
| `orchestrator` | Coordinate complex multi-step workflows |
| `codebase-analyzer` | Analyze implementation details of specific components |
| `codebase-locator` | Locate files, directories, and components |
| `codebase-pattern-finder` | Find similar implementations and usage examples |
| `codebase-online-researcher` | Research using web sources and DeepWiki |
| `codebase-research-analyzer` | Deep dive on research topics |
| `codebase-research-locator` | Find documents in `research/` directory |
| `debugger` | Debug errors, test failures, and unexpected behavior |

**Why specialize?**

LLMs have a core architectural limitation: the more context they hold, the harder it becomes to attend to the right information at the right time. A single agent juggling a spec, dozens of files, tool outputs, and its own reasoning chain will lose track of details, repeat work, or hallucinate connections between unrelated code. This isn't a solvable prompt-engineering problem — it's how attention mechanisms work.

Specialized sub-agents turn this limitation into an advantage:

- **Context isolation** — Each sub-agent gets a fresh, minimal context window scoped to exactly one job. A `codebase-locator` doesn't carry file contents; a `worker` doesn't carry the full spec. This keeps each agent reasoning over a small, high-signal context.
- **Tool scoping** — Agents only see tools relevant to their role. A `reviewer` has read-only analysis tools and cannot edit files. A `worker` has edit tools but cannot spawn other workers. This eliminates entire categories of mistakes.
- **Parallel execution** — Independent sub-agents run concurrently. While one worker implements a database migration, another writes the API handler, and a third generates tests — all in separate context windows, all at the same time.
- **Composability** — Sub-agents can be combined into workflows, chained in DAGs, or dispatched ad-hoc. The same `reviewer` agent used by Ralph is the one invoked when you ask for a code review in chat.

The difference is measurable: a specialized `codebase-analyzer` reading three files produces more accurate analysis than a generalist agent that has already consumed 50,000 tokens of search results, tool calls, and prior reasoning. Specialization isn't a nice-to-have — it's how you get reliable output from LLMs on real-world codebases.

Use `/agents` in any chat session to see all available sub-agents.

### 19 Built-in Skills

Skills are structured capability modules that give agents best practices and workflows for specific tasks. Atomic ships with the following skills:

| Category | Skill | Description |
| --- | --- | --- |
| **Development** | `create-spec` | Create detailed execution plans from research documents |
| | `research-codebase` | Analyze codebase with parallel sub-agents and document findings |
| | `explain-code` | Explain code functionality in detail using DeepWiki |
| | `workflow-creator` | Create multi-agent workflows using the `defineWorkflow()` DSL |
| | `init` | Generate `CLAUDE.md` and `AGENTS.md` by exploring the codebase |
| **Code Quality** | `testing-anti-patterns` | Identify and prevent testing anti-patterns when writing tests |
| | `prompt-engineer` | Create, improve, and optimize prompts using best practices |
| | `frontend-design` | Create distinctive, production-grade frontend interfaces |
| **Documents** | `pdf` | Read, create, edit, split, merge, and OCR PDF files |
| | `xlsx` | Create, read, edit, and fix spreadsheet files (`.xlsx`, `.csv`, `.tsv`) |
| | `docx` | Create, read, edit, and manipulate Word (`.docx`) documents |
| | `pptx` | Create, read, edit, and manipulate PowerPoint (`.pptx`) slide decks |
| | `liteparse` | Parse and convert unstructured files (PDF, DOCX, PPTX, images) locally |
| **Git** | `gh-commit` | Create well-formatted commits using conventional commit format |
| | `gh-create-pr` | Commit unstaged changes, push, and submit a pull request |
| **Sapling / Phabricator** | `sl-commit` | Create well-formatted Sapling commits with conventional commit format |
| | `sl-submit-diff` | Submit Sapling commits as Phabricator diffs for code review |
| **Automation** | `playwright-cli` | Automate browser interactions for testing, screenshots, and data extraction |
| **Meta** | `skill-creator` | Create, modify, evaluate, and benchmark your own skills |

Skills are auto-invoked when relevant — `testing-anti-patterns` activates before any test is written, `playwright-cli` activates for browser automation tasks.

### Interactive TUI

Atomic provides a rich terminal interface built on [OpenTUI](https://github.com/anomalyco/opentui):

- **@Mentions** — Reference files with autocomplete
- **Agent activity tree** — Watch parallel sub-agents execute in real-time
- **Task list tracking** — See Ralph's progress through your task list
- **Streaming messages** — Chat-style interface with live token streaming
- **Model selector** — Interactive picker with reasoning effort controls
- **Theme support** — Dark and light themes via `--theme` flag or `/theme` command
- **Verbose mode** — Toggle to see agent activity, tool calls, and token usage

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open transcript view |
| `Ctrl+C` | Interrupt current operation |
| `Shift+Enter` | Insert newline |

---

## Architecture

**You own the decisions. Agents own the execution.**

Every feature follows this cycle. Specs and research become persistent context for future sessions. You review at two critical points: after research (did the agent understand the codebase?) and after the spec (is the plan correct?).

```
Research → Specs → Execution → Outcomes → Specs (persistent context)
                ↑                                    ↓
                └────────────────────────────────────┘
```

### Why Research → Plan → Implement → Verify Works

Most failures in AI-assisted coding come from the same root cause: **the agent didn't have enough context before it started writing code**. An agent that jumps straight to implementation is guessing at architecture, conventions, and constraints — and the further it gets, the more expensive it is to correct course. This is true regardless of model capability.

Atomic's architecture is built around a four-phase cycle that plays to how LLMs actually work best:

**1. Research** — Before touching any code, the agent builds a factual understanding of the codebase. Specialized research sub-agents fan out in parallel: locating relevant files, analyzing implementations, querying external documentation. The output is a structured research document — not a plan, not code, just facts. This gives the human a checkpoint: *did the agent actually understand the codebase?* If the research is wrong, you catch it here instead of after 500 lines of incorrect implementation.

**2. Plan (Spec)** — The agent produces a technical specification grounded in the research. This is the most important human review point. A spec is a contract: it defines what will be built, what files will be touched, what the expected behavior is. Specs are cheap to revise; implementations are expensive to rewrite. By forcing a planning phase, Atomic ensures the agent commits to a coherent strategy before writing any code.

**3. Implement** — With a validated spec, the planner decomposes work into discrete tasks with dependency tracking. Worker sub-agents execute tasks in parallel, each in its own context window, each focused on a single unit of work. This is where specialization pays off — a worker implementing a database migration doesn't need to hold the full API spec in context. It just needs its task, the relevant files, and the tools to edit them.

**4. Verify** — A reviewer sub-agent audits the implementation against the original spec. If issues are found, a fixer generates corrective tasks that re-enter the worker loop. This catches errors before they compound — a misnamed field caught during review is a one-line fix; the same error caught by a user in production is a multi-file cascade.

**Why this matters for LLMs specifically:**

LLMs are stateless — they don't retain memory between turns beyond what's in the context window. Without structure, a long coding session becomes a degrading context window where early decisions get pushed out and the agent loses coherence. Atomic's phased approach solves this by externalizing state: research documents persist to disk, specs become files, task lists live in a SQLite database, and review feedback generates new tasks. Each phase produces artifacts that the next phase consumes, so no single agent needs to hold the entire problem in its context window.

This is also why the cycle is iterative. Research and specs become persistent context for future sessions — every investigation compounds. The agent that implements your next feature starts with richer context than the one that implemented the first, without anyone having to re-explain the codebase.

[![Architecture](assets/architecture.svg)](assets/architecture.svg)

---

## Commands Reference

### CLI Commands

| Command | Description |
| --- | --- |
| `atomic init` | Interactive project setup |
| `atomic chat` | Start TUI chat with a coding agent |
| `atomic config set <k> <v>` | Set configuration values |
| `atomic workflow verify` | Validate workflow DAG structure |
| `atomic update` | Self-update (binary installs only) |
| `atomic uninstall` | Remove installation (binary installs only) |

#### `atomic chat` Flags

| Flag | Default | Description |
| --- | --- | --- |
| `-a, --agent <name>` | (required) | Agent: `claude`, `opencode`, `copilot` |
| `-t, --theme <name>` | `"dark"` | UI theme: `dark`, `light` |
| `-m, --model <name>` | (none) | Model override |
| `[prompt...]` | (none) | Initial prompt |

### Slash Commands

| Command | Arguments | Description |
| --- | --- | --- |
| `/help` | | Show available commands |
| `/clear` | | Clear messages and reset session |
| `/compact` | | Compact context to reduce token usage |
| `/model` | `[model\|list\|select]` | View/switch model |
| `/mcp` | `[enable\|disable]` | Toggle MCP servers |
| `/theme` | `[dark\|light]` | Toggle theme |
| `/agents` | | List discovered sub-agents |
| `/exit` | | Exit chat |
| `/init` | | Generate `CLAUDE.md` and `AGENTS.md` |
| `/research-codebase` | `"<question>"` | Analyze codebase and document findings |
| `/create-spec` | `"<research-path>"` | Generate technical specification |
| `/explain-code` | `"<path>"` | Explain code in detail |
| `/gh-commit` | | Create a Git commit |
| `/gh-create-pr` | | Commit, push, and open a PR |
| `/sl-commit` | | Create a Sapling commit |
| `/sl-submit-diff` | | Submit to Phabricator |
| `/ralph` | `"<prompt>"` | Run autonomous implementation |

---

## Configuration

### `.atomic/settings.json`

Created automatically during `atomic init`. Resolution order:

1. Local: `.atomic/settings.json`
2. Global: `~/.atomic/settings.json`

```json
{
  "version": 1,
  "scm": "github",
  "model": {
    "claude": "sonnet",
    "copilot": "gpt-4o"
  },
  "reasoningEffort": {
    "claude": "high"
  },
  "lastUpdated": "2026-02-12T12:00:00.000Z"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `version` | number | Config schema version (currently `1`) |
| `scm` | string | Source control: `github` or `sapling` |
| `model` | object | Default model per agent (e.g. `"claude": "opus"`) |
| `reasoningEffort` | object | Reasoning effort per agent (e.g. `"claude": "high"`) |
| `lastUpdated` | string | ISO 8601 timestamp |

You can also set the model per session via CLI flag or interactively during chat:

```bash
# CLI flag (single session only)
atomic chat -a claude -m opus

# Interactive selector (persists to global settings)
/model select
```

The `/model select` command opens an interactive picker that also lets you set reasoning effort for models that support it.

### Agent-Specific Files

| Agent | Folder | Skills | Context File |
| --- | --- | --- | --- |
| Claude Code | `.claude/` | `.claude/skills/` | `CLAUDE.md` |
| OpenCode | `.opencode/` | `.opencode/skills/` | `AGENTS.md` |
| GitHub Copilot | `.github/` | `.github/skills/` | `AGENTS.md` |

---

## Installation Options

<details>
<summary>Install a specific version</summary>

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash -s -- v1.0.0
# or with VERSION env var:
VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Version v1.0.0"
# or with VERSION env var:
$env:VERSION='v1.0.0'; irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

</details>

<details>
<summary>Install a prerelease version</summary>

> **Warning:** Prerelease versions may contain breaking changes or bugs. Use for testing only.

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash -s -- --prerelease
# or with VERSION env var:
VERSION=prerelease curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Prerelease"
# or with VERSION env var:
$env:VERSION='prerelease'; irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

</details>

<details>
<summary>Authenticated downloads (CI / enterprise)</summary>

Set `GITHUB_TOKEN` to use authenticated GitHub API requests, which avoids rate limits in CI/CD or enterprise environments:

**macOS / Linux:**

```bash
GITHUB_TOKEN=ghp_... curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
$env:GITHUB_TOKEN='ghp_...'; irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

</details>

<details>
<summary>Custom install directory</summary>

**macOS / Linux:**

```bash
ATOMIC_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
$env:ATOMIC_INSTALL_DIR = "C:\tools"; irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

</details>

<details>
<summary>Devcontainer examples</summary>

**Atomic + Claude in a Rust project:**

```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/rust:latest",
  "features": {
    "ghcr.io/flora131/atomic/claude:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  }
}
```

**Atomic + Copilot in a Python project:**

```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/python:3.12",
  "features": {
    "ghcr.io/flora131/atomic/copilot:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "remoteEnv": {
    "GH_TOKEN": "${localEnv:GH_TOKEN}"
  }
}
```

**Atomic + OpenCode in a Go project:**

```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/go:1.22",
  "features": {
    "ghcr.io/flora131/atomic/opencode:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  }
}
```

</details>

<details>
<summary>Source control selection</summary>

During `atomic init`, you'll select your source control system:

| SCM Type | CLI Tool | Code Review | Use Case |
| --- | --- | --- | --- |
| GitHub / Git | `git` | Pull Requests | Most projects |
| Sapling + Phabricator | `sl` | Phabricator Diffs | Stacked workflows |

**Sapling + Phabricator:** Ensure `.arcconfig` exists in your repo root. Use `/sl-commit` and `/sl-submit-diff`.

**Windows note:** Sapling templates use the full path `& 'C:\Program Files\Sapling\sl.exe'` to avoid conflicts with PowerShell's `sl` alias.

</details>

---

## Updating & Uninstalling

### Update

```bash
atomic update
```

### Uninstall

```bash
atomic uninstall              # Interactive uninstall
atomic uninstall --dry-run    # Preview what will be removed
atomic uninstall --keep-config # Keep config, remove binary only
atomic uninstall --yes        # Skip confirmation
```

<details>
<summary>Manual uninstall</summary>

**macOS / Linux:**

```bash
rm -f ~/.local/bin/atomic
rm -rf ~/.local/share/atomic
rm -rf ~/.atomic/.claude ~/.atomic/.opencode ~/.atomic/.copilot
```

**Windows PowerShell:**

```powershell
Remove-Item "$env:USERPROFILE\.local\bin\atomic.exe" -Force
Remove-Item "$env:LOCALAPPDATA\atomic" -Recurse -Force
Remove-Item "$env:USERPROFILE\.atomic\.claude" -Recurse -Force
Remove-Item "$env:USERPROFILE\.atomic\.opencode" -Recurse -Force
Remove-Item "$env:USERPROFILE\.atomic\.copilot" -Recurse -Force
```

</details>

<details>
<summary>Clean up project config files</summary>

> **Warning:** This deletes all project-specific settings, skills, and agents configured by Atomic.

**macOS / Linux:**

```bash
rm -rf .claude/ CLAUDE.md        # Claude Code
rm -rf .opencode/ AGENTS.md      # OpenCode
rm -f .github/copilot-instructions.md  # Copilot
```

**Windows PowerShell:**

```powershell
Remove-Item -Path ".claude" -Recurse -Force; Remove-Item "CLAUDE.md" -Force
Remove-Item -Path ".opencode" -Recurse -Force; Remove-Item "AGENTS.md" -Force
Remove-Item -Path ".github\copilot-instructions.md" -Force
```

</details>

---

## Telemetry

Atomic collects anonymous usage telemetry to improve the product. Telemtry is opt-in.

**Collected:** Command names, agent type, success/failure status, session metrics.
**Never collected:** Prompts, file paths, code, IP addresses, PII.

### Opt Out After

```bash
atomic config set telemetry false
# or
export ATOMIC_DISABLE_TELEMETRY=1
```

<details>
<summary>More telemetry details</summary>

**Privacy features:**

- Anonymous machine-derived ID
- Local JSONL logging before any remote transmission
- Auto-disabled in CI environments (`CI=true`)
- First-run consent during `atomic init`

**Local log paths:**

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\atomic\telemetry\` |
| macOS | `~/Library/Application Support/atomic/telemetry/` |
| Linux | `~/.local/share/atomic/telemetry/` |

**Re-enable:**

```bash
atomic config set telemetry true
unset ATOMIC_DISABLE_TELEMETRY
```

**Windows PowerShell opt-out:**

```powershell
$env:ATOMIC_DISABLE_TELEMETRY = "1"
# Or permanently:
[Environment]::SetEnvironmentVariable("ATOMIC_DISABLE_TELEMETRY", "1", "User")
```

**Programmatic:**

```typescript
import { loadTelemetryConfig, isTelemetryEnabled } from "@bastani/atomic";

if (isTelemetryEnabled()) {
  const config = loadTelemetryConfig();
  console.log(config.enabled, config.localLogPath);
}
```

</details>

---

## Troubleshooting

<details>
<summary>Git identity error</summary>

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

</details>

<details>
<summary>Windows command resolution</summary>

If agents fail to spawn on Windows, ensure the agent CLI is in your PATH. Atomic uses `Bun.which()` which handles `.cmd`, `.exe`, and `.bat` extensions automatically.

</details>

<details>
<summary>Generating CLAUDE.md / AGENTS.md</summary>

`atomic init` does **not** create these files. Run `/init` inside a chat session to generate them.

</details>

<details>
<summary>Sub-agent tree stuck on "Initializing..."</summary>

1. Update to the latest release (`atomic update`) and retry
2. Check for terminal progress events in verbose mode
3. Press `Ctrl+F` twice to terminate stuck background agents, then resend your prompt
4. If the issue persists, capture reproduction steps and [open an issue](https://github.com/flora131/atomic/issues)

</details>

<details>
<summary>Shift+Enter not inserting newline</summary>

- **VS Code terminal:** Keep `terminal.integrated.enableKittyKeyboardProtocol` enabled
- **GNOME Terminal, xterm, Alacritty, WezTerm, iTerm2:** `modifyOtherKeys` mode is enabled automatically
- **Universal fallback:** Use `Ctrl+J` for newline
- **Last resort:** End line with `\` and press Enter

</details>

---

## FAQ

<details>
<summary>How does Atomic differ from Spec-Kit?</summary>

[Spec Kit](https://github.com/github/spec-kit) is GitHub's toolkit for "Spec-Driven Development." Both improve AI-assisted development, but solve different problems:

| Aspect | Spec-Kit | Atomic |
| --- | --- | --- |
| **Focus** | Greenfield projects | Large existing codebases + greenfield |
| **First Step** | Define project principles | Analyze existing architecture |
| **Context** | Per-feature specs | Research → Specs → Execution → Outcomes |
| **Agents** | Single agent with shell scripts | 12+ specialized sub-agents across 3 SDKs |
| **Workflows** | Not available | DAG-based pipelines with branching, loops, HITL |
| **Human Review** | Implicit | Explicit checkpoints |
| **Debugging** | Not addressed | Dedicated debugging workflow |
| **Autonomous** | Not available | Ralph for multi-hour execution |
| **Isolation** | Not addressed | Devcontainer features for safe execution |

</details>

<details>
<summary>How does Atomic differ from DeerFlow?</summary>

[DeerFlow](https://github.com/bytedance/deer-flow) is ByteDance's agent harness built on LangGraph/LangChain. Both are multi-agent orchestrators, but take different approaches:

| Aspect | DeerFlow | Atomic |
| --- | --- | --- |
| **Runtime** | Python (LangGraph) | TypeScript (Bun) |
| **Agent SDKs** | OpenAI-compatible API | Claude Code + OpenCode + Copilot CLI SDKs natively |
| **Focus** | General-purpose agent tasks | Coding-specific: research, spec, implement, review |
| **Workflows** | LangGraph state machines | Type-safe chainable DSL with `.compile()` verification |
| **Execution** | Sandbox containers | Devcontainer features + git worktrees |
| **Interface** | Web UI | Terminal TUI with agent activity tree |
| **Autonomous** | Not available | Ralph for multi-hour coding sessions |

</details>

---

## Contributing

See [DEV_SETUP.md](DEV_SETUP.md) for development setup, testing guidelines, and contribution workflow.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

## Credits

- [Superpowers](https://github.com/obra/superpowers)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Ralph Wiggum Method](https://ghuntley.com/ralph/)
- [OpenAI Codex Cookbook](https://github.com/openai/openai-cookbook)
- [HumanLayer](https://github.com/humanlayer/humanlayer)
