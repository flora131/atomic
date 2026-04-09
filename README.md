# Atomic

<p align="center">
  <img src="assets/atomic.png" alt="Atomic" width="800">
</p>

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/flora131/atomic)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](./package.json)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun&logoColor=black)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Atomic is an open-source **multi-agent harness** that orchestrates **Claude Code**, **OpenCode**, and **GitHub Copilot CLI** through a unified interface — with a **workflow SDK**, **containerized execution**, **deep codebase research**, and **autonomous multi-hour coding sessions**.

> One CLI. Three agent SDKs. Research it, spec it, ship it — then wake up to completed code ready for review.

---

## Table of Contents

- [Atomic](#atomic)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
    - [Prerequisites](#prerequisites)
    - [1. Install](#1-install)
    - [2. Initialize Your Project](#2-initialize-your-project)
    - [3. Generate Context Files](#3-generate-context-files)
    - [4. Ship Features](#4-ship-features)
  - [Video Overview](#video-overview)
  - [Core Features](#core-features)
    - [Multi-Agent SDK Support](#multi-agent-sdk-support)
    - [Workflow SDK — Build Your Own Harness](#workflow-sdk--build-your-own-harness)
      - [Builder API](#builder-api)
      - [Session Context (`ctx`)](#session-context-ctx)
      - [Session Options (`SessionRunOptions`)](#session-options-sessionrunoptions)
      - [Saving Transcripts](#saving-transcripts)
      - [Provider Helpers](#provider-helpers)
      - [Key Rules](#key-rules)
    - [Deep Codebase Research](#deep-codebase-research)
    - [Autonomous Execution (Ralph)](#autonomous-execution-ralph)
    - [Containerized Execution](#containerized-execution)
    - [Specialized Sub-Agents](#specialized-sub-agents)
    - [Built-in Skills](#built-in-skills)
    - [Workflow Orchestrator Panel](#workflow-orchestrator-panel)
  - [Architecture](#architecture)
    - [Why Research → Plan → Implement → Verify Works](#why-research--plan--implement--verify-works)
  - [Commands Reference](#commands-reference)
    - [CLI Commands](#cli-commands)
      - [Global Flags](#global-flags)
      - [`atomic init` Flags](#atomic-init-flags)
      - [`atomic chat` Flags](#atomic-chat-flags)
      - [`atomic workflow` Flags](#atomic-workflow-flags)
    - [Atomic-Provided Skills (invokable from any agent chat)](#atomic-provided-skills-invokable-from-any-agent-chat)
  - [Configuration](#configuration)
    - [`.atomic/settings.json`](#atomicsettingsjson)
    - [Agent-Specific Files](#agent-specific-files)
  - [Installation Options](#installation-options)
  - [Updating \& Uninstalling](#updating--uninstalling)
    - [Update](#update)
    - [Uninstall](#uninstall)
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

Atomic is distributed as a single npm package that exposes both the CLI binary and the Workflow SDK. You have three install paths depending on your environment.

**Option A — Devcontainer (recommended for safe autonomous execution):**

> [!TIP]
> Devcontainers isolate the coding agent from your host system, reducing the risk of destructive actions like unintended file deletions or misapplied shell commands. This is the safest way to run Atomic, especially for multi-hour autonomous sessions with Ralph.
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

| Feature              | Reference                            | Agent                                                |
| -------------------- | ------------------------------------ | ---------------------------------------------------- |
| Atomic + Claude Code | `ghcr.io/flora131/atomic/claude:1`   | [Claude Code](https://claude.ai)                     |
| Atomic + OpenCode    | `ghcr.io/flora131/atomic/opencode:1` | [OpenCode](https://opencode.ai)                      |
| Atomic + Copilot CLI | `ghcr.io/flora131/atomic/copilot:1`  | [Copilot CLI](https://github.com/github/copilot-cli) |

Each feature installs the Atomic CLI from npm, all shared dependencies (bun, playwright-cli), agent-specific configurations (agents, skills), and the agent CLI itself. Features are versioned in sync with Atomic CLI releases.

**Option B — Bun global install (simplest for local use):**

If you already have [Bun](https://bun.sh) installed, a single command is enough:

```bash
bun install -g @bastani/atomic
```

This installs the `atomic` binary on your PATH. `bun update -g @bastani/atomic` upgrades to the latest release.

**Option C — Bootstrap script (installs bun + atomic in one step):**

For machines without Bun, the bootstrap scripts install Node (via fnm), Bun, and Atomic together:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
# or with wget:
wget -qO- https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

Windows PowerShell 7+:

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

# Implement autonomously (run from a separate terminal)
atomic workflow -n ralph -a <claude|opencode|copilot> "<prompt-or-spec-path>"

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

| Agent              | SDK                              | Command                   |
| ------------------ | -------------------------------- | ------------------------- |
| Claude Code        | `@anthropic-ai/claude-agent-sdk` | `atomic chat -a claude`   |
| OpenCode           | `@opencode-ai/sdk`               | `atomic chat -a opencode` |
| GitHub Copilot CLI | `@github/copilot-sdk`            | `atomic chat -a copilot`  |

Each agent gets its own configuration directory (`.claude/`, `.opencode/`, `.github/`), skills, and context files — all managed by Atomic. Write a workflow once, run it on any agent.

### Workflow SDK — Build Your Own Harness

Every team has a process — triage bugs this way, ship features that way, review PRs with these checks. Most of it lives in a wiki nobody reads or in one senior engineer's head. The **Workflow SDK** (`@bastani/atomic/workflows`) lets you encode that process as TypeScript — spawn agent sessions dynamically with native control flow (`for`, `if`, `Promise.all()`), and watch them appear in a live graph as they execute.

Drop a `.ts` file in `.atomic/workflows/<name>/<agent>/index.ts` and run it:

```bash
atomic workflow -n hello -a claude "describe this project"
```

<details>
<summary>See an example of the workflow definition</summary>

```ts
// .atomic/workflows/hello/claude/index.ts
import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "hello",
  description: "Two-session Claude demo: describe → summarize",
})
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask Claude to describe the project" },
      async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({ paneId: s.paneId, prompt: s.userPrompt });
        s.save(s.sessionId);
      },
    );

    await ctx.session(
      { name: "summarize", description: "Summarize the previous session's output" },
      async (s) => {
        const research = await s.transcript(describe);
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({
          paneId: s.paneId,
          prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
        });
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

</details>

**Key capabilities:**

| Capability                   | Description                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| **Dynamic session spawning** | Call `ctx.session()` to spawn sessions at runtime — each gets its own tmux window and graph node |
| **Native TypeScript control flow** | Use `for`, `if/else`, `Promise.all()`, `try/catch` — no framework DSL needed |
| **Session return values**    | Session callbacks can return data: `const h = await ctx.session(...); h.result`      |
| **Transcript passing**       | Access prior session output via handle (`s.transcript(handle)`) or name (`s.transcript("name")`) |
| **Nested sub-sessions**      | Call `s.session()` inside a session callback to spawn child sessions — visible as nested nodes in the graph |
| **Dependency tracking**      | Use `dependsOn: ["name"]` to declare session ordering — the runtime waits and the graph shows the edges |
| **Provider-agnostic**        | Write raw SDK code for Claude, Copilot, or OpenCode inside each session callback     |
| **Live graph visualization** | Sessions appear in the TUI graph as they're spawned — loops and conditionals are visible in real time |

Drop a `.ts` file in `.atomic/workflows/<name>/<agent>/` (project-local) or `~/.atomic/workflows/` (global). You can also ask Atomic to create workflows for you:

```
Use your workflow-creator skill to create a workflow that plans, implements, and reviews a feature.
```

<details>
<summary>Full Workflow SDK Reference</summary>

#### Builder API

| Method                                  | Purpose                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `defineWorkflow({ name, description })` | Entry point — returns a `WorkflowBuilder`                         |
| `.run(async (ctx) => { ... })`          | Set the workflow's entry point — `ctx` is a `WorkflowContext`     |
| `.compile()`                            | **Required** — terminal method that seals the workflow definition |

#### WorkflowContext (`ctx`) — top-level orchestrator

| Property                | Type                      | Description                                                    |
| ----------------------- | ------------------------- | -------------------------------------------------------------- |
| `ctx.userPrompt`        | `string`                  | Original user prompt from the CLI invocation                   |
| `ctx.agent`             | `AgentType`               | Which agent is running (`"claude"`, `"copilot"`, `"opencode"`) |
| `ctx.session(opts, fn)` | `Promise<SessionHandle<T>>` | Spawn a session — returns handle with `name`, `id`, `result` |
| `ctx.transcript(ref)`   | `Promise<Transcript>`     | Get a completed session's transcript (`{ path, content }`)     |
| `ctx.getMessages(ref)`  | `Promise<SavedMessage[]>` | Get a completed session's raw native messages                  |

#### SessionContext (`s`) — inside each session callback

| Property                | Type                      | Description                                                    |
| ----------------------- | ------------------------- | -------------------------------------------------------------- |
| `s.serverUrl`           | `string`                  | The agent's server URL                                         |
| `s.userPrompt`          | `string`                  | Original user prompt from the CLI invocation                   |
| `s.agent`               | `AgentType`               | Which agent is running                                         |
| `s.paneId`              | `string`                  | tmux pane ID for this session                                  |
| `s.sessionId`           | `string`                  | Session UUID                                                   |
| `s.sessionDir`          | `string`                  | Path to this session's storage directory on disk               |
| `s.save(messages)`      | `SaveTranscript`          | Save this session's output for subsequent sessions             |
| `s.transcript(ref)`     | `Promise<Transcript>`     | Get a completed session's transcript                           |
| `s.getMessages(ref)`    | `Promise<SavedMessage[]>` | Get a completed session's raw native messages                  |
| `s.session(opts, fn)`   | `Promise<SessionHandle<T>>` | Spawn a nested sub-session (child in the graph)              |

#### Session Options (`SessionRunOptions`)

| Property      | Type       | Description                                                                   |
| ------------- | ---------- | ----------------------------------------------------------------------------- |
| `name`        | `string`   | Unique session name within the workflow run                                   |
| `description` | `string?`  | Human-readable description shown in the graph                                 |
| `dependsOn`   | `string[]?`| Names of sessions that must complete before this one starts (creates graph edges) |

`dependsOn` is useful when spawning sessions with `Promise.all()` — it lets the runtime enforce ordering while still allowing parallel spawning of independent sessions:

```ts
await Promise.all([
  ctx.session({ name: "migrate-db" }, async (s) => { /* ... */ }),
  ctx.session({ name: "seed-data", dependsOn: ["migrate-db"] }, async (s) => { /* ... */ }),
  ctx.session({ name: "gen-types", dependsOn: ["migrate-db"] }, async (s) => { /* ... */ }),
]);
```

#### Saving Transcripts

Each provider saves transcripts differently:

| Provider     | How to Save                                                        |
| ------------ | ------------------------------------------------------------------ |
| **Claude**   | `s.save(s.sessionId)` — auto-reads via `getSessionMessages()`     |
| **Copilot**  | `s.save(await session.getMessages())` — pass `SessionEvent[]`     |
| **OpenCode** | `s.save(result.data!)` — pass the full `{ info, parts }` response |

#### Provider Helpers

| Export                            | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `createClaudeSession(options)`    | Start a Claude TUI in a tmux pane                   |
| `claudeQuery(options)`            | Send a prompt to Claude and wait for the response   |
| `clearClaudeSession(paneId)`      | Free memory for a killed/finished Claude session    |
| `validateClaudeWorkflow()`        | Validate a Claude workflow source before run        |
| `validateCopilotWorkflow()`       | Validate a Copilot workflow source before run       |
| `validateOpenCodeWorkflow()`      | Validate an OpenCode workflow source before run     |

`createClaudeSession` accepts:

| Option            | Type       | Default                                               | Description                        |
| ----------------- | ---------- | ----------------------------------------------------- | ---------------------------------- |
| `paneId`          | `string`   | —                                                     | tmux pane ID (required)            |
| `chatFlags`       | `string[]` | `["--dangerously-skip-permissions"]` | CLI flags passed to `claude`       |
| `readyTimeoutMs`  | `number`   | `30000`                                               | Timeout waiting for TUI readiness  |

`claudeQuery` accepts:

| Option            | Type     | Default  | Description                                      |
| ----------------- | -------- | -------- | ------------------------------------------------ |
| `paneId`          | `string` | —        | tmux pane ID (required)                           |
| `prompt`          | `string` | —        | The prompt to send (required)                     |
| `timeoutMs`       | `number` | `300000` | Response timeout (5 min)                          |
| `pollIntervalMs`  | `number` | `2000`   | Polling interval for output stabilization         |
| `submitPresses`   | `number` | `1`      | C-m presses per submit round                      |
| `maxSubmitRounds` | `number` | `6`      | Max retry rounds for delivery confirmation        |
| `readyTimeoutMs`  | `number` | `30000`  | Pane readiness timeout before sending             |

Returns `{ output: string; delivered: boolean }` — `delivered` confirms the prompt was accepted by the agent.

#### Key Rules

1. Every workflow file must use `export default` with `.run()` and `.compile()`
2. Session names must be unique within a workflow run
3. `transcript()` / `getMessages()` only access completed sessions (callback returned + saves flushed)
4. Each session runs in its own tmux window with the chosen agent
5. Workflows are organized per-workflow: `.atomic/workflows/<name>/<agent>/index.ts`

Workflow files need no `package.json` or `node_modules` of their own — the Atomic loader rewrites `@bastani/atomic/*` and atomic's transitive deps (`@github/copilot-sdk`, `@opencode-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, `zod`, etc.) to absolute paths inside the installed atomic package at load time. Drop a `.ts` file and it runs.

For the authoring walkthrough with worked examples, ask Atomic to use the `workflow-creator` skill or read the skill reference at `.agents/skills/workflow-creator/`.

</details>

### Deep Codebase Research

The `/research-codebase` command dispatches **specialized sub-agents in parallel** to analyze your codebase:

- Understand how authentication flows work in an unfamiliar codebase
- Track down root causes by analyzing code paths across dozens of files
- Search through docs, READMEs, and inline documentation
- Query external documentation via [DeepWiki MCP](https://deepwiki.com) integration
- Get up to speed on a new project in minutes instead of hours

**Research sub-agents:**

| Sub-Agent                    | Model  | Purpose                                                                                   |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `codebase-locator`           | Haiku  | Locate files, directories, and components relevant to the research topic                  |
| `codebase-analyzer`          | Sonnet | Analyze implementation details, trace data flow, and explain technical workings           |
| `codebase-pattern-finder`    | Haiku  | Find similar implementations, usage examples, and existing patterns to model after        |
| `codebase-online-researcher` | Sonnet | Fetch up-to-date information from the web and repository-specific knowledge from DeepWiki |
| `codebase-research-locator`  | Haiku  | Discover relevant documents in `research/` and `specs/` directories                       |
| `codebase-research-analyzer` | Sonnet | Extract high-value insights, decisions, and technical details from research documents     |

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

Each agent spawns sub-agents that query DeepWiki, pull external documentation, and cross-reference with your codebase. Then run `/create-spec` on each research doc, spin up git worktrees, and run `atomic workflow -n ralph` in each — wake up to three complete implementations on separate branches.

> Works identically with `atomic chat -a opencode` and `atomic chat -a copilot`.

Research outputs persist in your `research/` directory and specs persist in your `specs/` directory — both become context for future sessions, so every investigation and every specification compounds.

### Autonomous Execution (Ralph)

<p align="center">
  <img src="assets/ralph-wiggum.jpg" alt="Ralph Wiggum" width="600">
</p>

The [Ralph Wiggum Method](https://ghuntley.com/ralph/) enables **multi-hour autonomous coding sessions**. After approving your spec, let Ralph work in the background while you focus on other tasks.

**How Ralph works:**

1. **Task Decomposition** — A `planner` sub-agent breaks your spec into a structured task list with dependency tracking, stored in a SQLite database with WAL mode for parallel access
2. **Orchestration** — An `orchestrator` sub-agent retrieves the task list, validates the dependency graph, and dispatches `worker` sub-agents for ready tasks with concurrent execution of independent tasks
3. **Review & Debug** — A `reviewer` sub-agent audits the implementation with structured JSON output; if actionable findings exist (P0–P2 severity), a `debugger` sub-agent investigates root causes and produces a markdown report that feeds back to the planner on the next iteration

**Loop configuration:** Ralph runs up to **10 iterations** and exits early after **2 consecutive clean reviews** (zero actionable findings). P3 (minor) findings are filtered as non-actionable.

```bash
# From a prompt
atomic workflow -n ralph -a <claude|opencode|copilot> "Build a REST API for user management"

# From a spec file
atomic workflow -n ralph -a claude "specs/YYYY-MM-DD-my-feature.md"
```

**Best practice:** Run Ralph in a separate [git worktree](https://git-scm.com/docs/git-worktree) to isolate autonomous execution:

```bash
git worktree add ../my-project-ralph feature-branch
cd ../my-project-ralph
atomic workflow -n ralph -a claude "Build the auth module"
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

| Feature                              | Installs             |
| ------------------------------------ | -------------------- |
| `ghcr.io/flora131/atomic/claude:1`   | Atomic + Claude Code |
| `ghcr.io/flora131/atomic/opencode:1` | Atomic + OpenCode    |
| `ghcr.io/flora131/atomic/copilot:1`  | Atomic + Copilot CLI |

### Specialized Sub-Agents

Atomic doesn't use one general-purpose agent for everything. It dispatches **purpose-built sub-agents**, each with scoped context, tools, and termination conditions:

| Sub-Agent                    | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `planner`                    | Decompose specs into structured task lists with dependency tracking    |
| `worker`                     | Implement single focused tasks (multiple workers run in parallel)      |
| `reviewer`                   | Audit implementations against specs and best practices                 |
| `code-simplifier`            | Simplify and refine code for clarity, consistency, and maintainability |
| `orchestrator`               | Coordinate complex multi-step workflows                                |
| `codebase-analyzer`          | Analyze implementation details of specific components                  |
| `codebase-locator`           | Locate files, directories, and components                              |
| `codebase-pattern-finder`    | Find similar implementations and usage examples                        |
| `codebase-online-researcher` | Research using web sources and DeepWiki                                |
| `codebase-research-analyzer` | Deep dive on research topics                                           |
| `codebase-research-locator`  | Find documents in `research/` directory                                |
| `debugger`                   | Debug errors, test failures, and unexpected behavior                   |

**Why specialize?**

LLMs have a core architectural limitation: the more context they hold, the harder it becomes to attend to the right information at the right time. A single agent juggling a spec, dozens of files, tool outputs, and its own reasoning chain will lose track of details, repeat work, or hallucinate connections between unrelated code. This isn't a solvable prompt-engineering problem — it's how attention mechanisms work.

Specialized sub-agents turn this limitation into an advantage:

- **Context isolation** — Each sub-agent gets a fresh, minimal context window scoped to exactly one job. A `codebase-locator` doesn't carry file contents; a `worker` doesn't carry the full spec. This keeps each agent reasoning over a small, high-signal context.
- **Tool scoping** — Agents only see tools relevant to their role. A `reviewer` has read-only analysis tools and cannot edit files. A `worker` has edit tools but cannot spawn other workers. This eliminates entire categories of mistakes.
- **Parallel execution** — Independent sub-agents run concurrently. While one worker implements a database migration, another writes the API handler, and a third generates tests — all in separate context windows, all at the same time.
- **Composability** — Sub-agents can be combined into workflows or dispatched ad-hoc. The same `reviewer` agent used by Ralph is the one invoked when you ask for a code review in chat.

The difference is measurable: a specialized `codebase-analyzer` reading three files produces more accurate analysis than a generalist agent that has already consumed 50,000 tokens of search results, tool calls, and prior reasoning. Specialization isn't a nice-to-have — it's how you get reliable output from LLMs on real-world codebases.

Use `/agents` in any chat session to see all available sub-agents.

### Built-in Skills

Skills are structured capability modules that give agents best practices and reusable workflows for specific tasks. Atomic ships 58 skills across eight categories; each lives at `.agents/skills/<name>/SKILL.md` and is auto-invoked when the agent detects a relevant trigger.

**Development workflows:**

| Skill                     | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| `init`                    | Generate `CLAUDE.md` and `AGENTS.md` by exploring the codebase              |
| `research-codebase`       | Analyze codebase with parallel sub-agents and document findings             |
| `create-spec`             | Create detailed execution plans from research documents                     |
| `workflow-creator`        | Create multi-agent workflows using the session-based `defineWorkflow()` API |
| `explain-code`            | Explain code functionality in detail using DeepWiki                         |
| `find-skills`             | Discover and install agent skills from the community                        |
| `test-driven-development` | Write tests first; includes a testing anti-patterns guide                   |
| `prompt-engineer`         | Create, improve, and optimize prompts using best practices                  |

**Context engineering** — practical skills for working within (and around) LLM context limits:

| Skill                  | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| `context-fundamentals` | How context windows work; attention mechanics; progressive disclosure |
| `context-degradation`  | Diagnose lost-in-middle, poisoning, distraction failures in long runs |
| `context-compression`  | Summarize transcripts at session boundaries; preserve actionable info |
| `context-optimization` | KV-cache optimization, observation masking, context budgeting         |
| `filesystem-context`   | Offload context to files; file-based agent coordination               |
| `memory-systems`       | Cross-session knowledge retention; Mem0 / Zep / Letta comparisons     |
| `multi-agent-patterns` | Supervisor, swarm, handoff patterns for multi-agent systems           |
| `tool-design`          | Design clear tool contracts; reduce agent-tool friction               |
| `hosted-agents`        | Background agents in sandboxed VMs; warm pools; Modal sandboxes       |
| `project-development`  | Validate task-model fit before building; cost estimation              |
| `bdi-mental-states`    | Belief-desire-intention models for explainable agent reasoning        |

**TypeScript & runtime:**

| Skill                       | Description                                                             |
| --------------------------- | ----------------------------------------------------------------------- |
| `typescript-expert`         | Type-level programming, perf optimization, migrations                   |
| `typescript-advanced-types` | Generics, conditional types, mapped types, template literals            |
| `typescript-react-reviewer` | Expert review for TypeScript + React 19 applications                    |
| `bun`                       | Build, test, deploy with Bun (runtime, package manager, bundler, tests) |
| `opentui`                   | Build terminal UIs with OpenTUI (core, React, Solid reconcilers)        |

**Frontend design & UI polish** — used by `frontend-design` and invoked individually for targeted refinement:

| Skill                                          | Description                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `frontend-design`                              | Create distinctive, production-grade frontend interfaces            |
| `teach-impeccable`                             | One-time setup that gathers design context for a project            |
| `polish`                                       | Final quality pass on alignment, spacing, consistency               |
| `critique`                                     | UX evaluation with quantitative scoring and persona testing         |
| `audit`                                        | Accessibility, performance, theming, responsive, anti-pattern audit |
| `normalize`                                    | Realign UI to match design system standards                         |
| `extract`                                      | Consolidate reusable components and design tokens into your system  |
| `arrange` / `typeset` / `colorize`             | Layout, typography, and color refinement                            |
| `adapt`                                        | Responsive design: breakpoints, fluid layouts, touch targets        |
| `animate` / `delight`                          | Add motion, micro-interactions, and personality                     |
| `clarify`                                      | Improve UX copy, error messages, microcopy, labels                  |
| `distill` / `quieter` / `bolder` / `overdrive` | Simplify, tone down, amplify, or push designs to their limit        |
| `harden`                                       | Error handling, i18n, overflow, edge-case resilience                |
| `optimize`                                     | Diagnose and fix loading, rendering, animation, bundle-size issues  |
| `onboard`                                      | Design onboarding flows, empty states, first-run experiences        |

**Evaluation:**

| Skill                 | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `evaluation`          | Multi-dimensional evaluation, LLM-as-judge, quality gates           |
| `advanced-evaluation` | Pairwise comparison, position-bias mitigation, evaluation pipelines |

**Documents & parsing:**

| Skill       | Description                                                             |
| ----------- | ----------------------------------------------------------------------- |
| `pdf`       | Read, create, edit, split, merge, and OCR PDF files                     |
| `xlsx`      | Create, read, edit, and fix spreadsheet files (`.xlsx`, `.csv`, `.tsv`) |
| `docx`      | Create, read, edit, and manipulate Word (`.docx`) documents             |
| `pptx`      | Create, read, edit, and manipulate PowerPoint (`.pptx`) slide decks     |
| `liteparse` | Parse and convert unstructured files (PDF, DOCX, PPTX, images) locally  |

**Git / Sapling / automation:**

| Skill            | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `gh-commit`      | Conventional-commit Git commits                          |
| `gh-create-pr`   | Commit unstaged changes, push, and submit a pull request |
| `sl-commit`      | Conventional-commit Sapling commits                      |
| `sl-submit-diff` | Submit Sapling commits as Phabricator diffs              |
| `playwright-cli` | Automate browser interactions, tests, screenshots        |

**Meta:**

| Skill           | Description                                             |
| --------------- | ------------------------------------------------------- |
| `skill-creator` | Create, modify, evaluate, and benchmark your own skills |

Skills are auto-invoked when relevant — `test-driven-development` activates before any test is written, `playwright-cli` activates for browser automation tasks, and the context-engineering skills activate whenever you're designing a workflow that'll push context limits. Run `ls .agents/skills/` for the complete, current list on disk.

### Workflow Orchestrator Panel

During `atomic workflow` execution, Atomic renders a live orchestrator panel built on [OpenTUI](https://github.com/anomalyco/opentui) on top of the workflow's tmux session graph. It shows:

- **Session graph** — Nodes for each `.session()` call with status (pending, running, completed, failed) and edges for sequential / parallel dependencies
- **Task list tracking** — Ralph's decomposed task list with dependency arrows, updated in real time as workers complete tasks
- **Pane previews** — Thumbnail of each tmux pane so you can see what every agent is doing without switching contexts
- **Transcript passing visibility** — Highlights `s.save()` / `s.transcript()` handoffs as they happen between sessions

During `atomic chat`, there is no Atomic-owned TUI — `atomic chat -a <agent>` spawns the native agent CLI inside a tmux/psmux session, so all chat features (streaming, `@` mentions, `/slash-commands`, model selection, theme switching, keyboard shortcuts) come from the agent CLI itself. Atomic's role in chat mode is to handle config sync, tmux session management, and argument passthrough.

| Context                                | Who provides the UI                                         |
| -------------------------------------- | ----------------------------------------------------------- |
| `atomic workflow -n <name> -a <agent>` | Atomic (orchestrator panel + tmux session graph)            |
| `atomic chat -a <agent>`               | The native agent CLI (Claude Code / OpenCode / Copilot CLI) |

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

**4. Verify** — A reviewer sub-agent audits the implementation against the original spec. If issues are found, a debugger generates a report that feeds back to the planner on the next iteration. This catches errors before they compound — a misnamed field caught during review is a one-line fix; the same error caught by a user in production is a multi-file cascade.

**Why this matters for LLMs specifically:**

LLMs are stateless — they don't retain memory between turns beyond what's in the context window. Without structure, a long coding session becomes a degrading context window where early decisions get pushed out and the agent loses coherence. Atomic's phased approach solves this by externalizing state: research documents persist to disk, specs become files, task lists live in a SQLite database, and review feedback generates new tasks. Each phase produces artifacts that the next phase consumes, so no single agent needs to hold the entire problem in its context window.

This is also why the cycle is iterative. Research and specs become persistent context for future sessions — every investigation compounds. The agent that implements your next feature starts with richer context than the one that implemented the first, without anyone having to re-explain the codebase.

[![Architecture](assets/architecture.svg)](assets/architecture.svg)

---

## Commands Reference

### CLI Commands

| Command                     | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| `atomic init`               | Interactive project setup (agent selection, SCM choice, config sync)  |
| `atomic chat`               | Spawn the native agent CLI inside a tmux/psmux session                |
| `atomic workflow`           | Run a multi-session agent workflow with the Atomic orchestrator panel |
| `atomic config set <k> <v>` | Set configuration values (currently supports `telemetry`)             |

#### Global Flags

These flags are available on all commands:

| Flag            | Description                                  |
| --------------- | -------------------------------------------- |
| `-y, --yes`     | Auto-confirm all prompts (non-interactive)   |
| `--no-banner`   | Skip ASCII banner display                    |
| `-v, --version` | Show version number                          |

#### `atomic init` Flags

| Flag                 | Description                                    |
| -------------------- | ---------------------------------------------- |
| `-a, --agent <name>` | Pre-select agent: `claude`, `opencode`, `copilot` |
| `-s, --scm <name>`   | Pre-select SCM: `github`, `sapling`            |

```bash
atomic init                              # Interactive setup
atomic init -a claude -s github          # Pre-select agent and SCM
atomic init --yes                        # Auto-confirm all prompts
```

#### `atomic chat` Flags

| Flag                 | Description                            |
| -------------------- | -------------------------------------- |
| `-a, --agent <name>` | Agent: `claude`, `opencode`, `copilot` |

All other arguments are forwarded directly to the native agent CLI. For example:

```bash
atomic chat -a claude "fix the bug"          # Initial prompt
atomic chat -a copilot --model gpt-5.4       # Custom model
atomic chat -a claude --verbose              # Forward --verbose to claude
```

#### `atomic workflow` Flags

| Flag                 | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `-n, --name <name>`  | Workflow name (matches directory under `.atomic/workflows/<name>/`) |
| `-a, --agent <name>` | Agent: `claude`, `opencode`, `copilot`                              |
| `-l, --list`         | List available workflows                                            |
| `[prompt...]`        | Prompt for the workflow                                             |

### Atomic-Provided Skills (invokable from any agent chat)

Atomic ships skills — not slash commands. Skills are auto-discovered by Claude Code, OpenCode, and Copilot CLI and are invoked either by typing `/<skill-name>` (Claude Code) or by natural-language reference (OpenCode / Copilot CLI). The list below covers the headline workflow skills; see **Built-in Skills** below for the full catalog.

| Skill               | Typical invocation                | Purpose                                                                       |
| ------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `init`              | `/init`                           | Generate `CLAUDE.md` and `AGENTS.md` by exploring the codebase                |
| `research-codebase` | `/research-codebase "<question>"` | Dispatch parallel sub-agents to analyze the codebase and write a research doc |
| `create-spec`       | `/create-spec "<research-path>"`  | Produce a technical spec grounded in a research document                      |
| `explain-code`      | `/explain-code "<path>"`          | Deep-dive explanation of specific code using DeepWiki                         |
| `gh-commit`         | `/gh-commit`                      | Create a conventional-commit Git commit                                       |
| `gh-create-pr`      | `/gh-create-pr`                   | Commit, push, and open a pull request                                         |
| `sl-commit`         | `/sl-commit`                      | Create a Sapling commit                                                       |
| `sl-submit-diff`    | `/sl-submit-diff`                 | Submit a Sapling commit as a Phabricator diff                                 |
| `workflow-creator`  | natural language                  | Generate a multi-agent workflow file in `.atomic/workflows/`                  |

Native slash commands like `/help`, `/clear`, `/compact`, `/model`, `/theme`, `/agents`, `/mcp`, and `/exit` are provided by the underlying agent CLI, not by Atomic — consult the Claude Code / OpenCode / Copilot CLI documentation for those.

---

## Configuration

### `.atomic/settings.json`

Created automatically during `atomic init`. Resolution order:

1. Local: `.atomic/settings.json`
2. Global: `~/.atomic/settings.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/flora131/atomic/main/assets/settings.schema.json",
  "version": 1,
  "scm": "github",
  "lastUpdated": "2026-04-09T12:00:00.000Z",
  "trustedPaths": [
    { "workspacePath": "/home/you/project", "provider": "claude" }
  ]
}
```

| Field          | Type    | Description                                                                                               |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `$schema`      | string  | JSON Schema URL for editor autocomplete                                                                   |
| `version`      | number  | Config schema version (currently `1`)                                                                     |
| `scm`          | string  | Source control: `github` or `sapling`                                                                     |
| `lastUpdated`  | string  | ISO 8601 timestamp of the last update                                                                     |
| `trustedPaths` | array   | Workspaces that have completed provider onboarding via `atomic init`; atomic skips re-prompting for these |

> **Note:** Model selection and reasoning effort are managed by each underlying agent CLI (e.g. Claude Code's `/model`), not by Atomic itself. Atomic's chat command spawns the agent's native TUI — use the agent's own controls to pick a model or adjust reasoning effort.

### Agent-Specific Files

| Agent          | Folder       | Skills                                       | Context File |
| -------------- | ------------ | -------------------------------------------- | ------------ |
| Claude Code    | `.claude/`   | `.claude/skills/` (symlink → `.agents/skills/`) | `CLAUDE.md`  |
| OpenCode       | `.opencode/` | `.agents/skills/`                            | `AGENTS.md`  |
| GitHub Copilot | `.github/`   | `.agents/skills/`                            | `AGENTS.md`  |

> **Note:** All three agents share the same skill set via `.agents/skills/`. Claude Code accesses them through a `.claude/skills/` symlink that points to `.agents/skills/`, so a single skill directory serves all agents.

---

## Installation Options

<details>
<summary>Install a specific version</summary>

```bash
bun install -g @bastani/atomic@0.5.0-4   # replace with desired version
```

List all published versions with `npm view @bastani/atomic versions`.

> Don't have bun yet? Run the bootstrap installer first (it installs bun and the latest atomic), then re-run the command above to switch to your desired version.

</details>

<details>
<summary>Install a prerelease version</summary>

> **Warning:** Prerelease versions may contain breaking changes or bugs. Use for testing only.

Prereleases are published under the `next` dist-tag on npm:

```bash
bun install -g @bastani/atomic@next
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

| SCM Type              | CLI Tool | Code Review       | Use Case          |
| --------------------- | -------- | ----------------- | ----------------- |
| GitHub / Git          | `git`    | Pull Requests     | Most projects     |
| Sapling + Phabricator | `sl`     | Phabricator Diffs | Stacked workflows |

**Sapling + Phabricator:** Ensure `.arcconfig` exists in your repo root. Use `/sl-commit` and `/sl-submit-diff`.

**Windows note:** Sapling templates use the full path `& 'C:\Program Files\Sapling\sl.exe'` to avoid conflicts with PowerShell's `sl` alias.

</details>

---

## Updating & Uninstalling

### Update

Use Bun's package manager directly:

```bash
bun update -g @bastani/atomic    # latest stable
# or for prerelease builds:
bun install -g @bastani/atomic@next
```

The first time you run `atomic` after upgrading, the CLI auto-syncs tooling deps (Node.js/npm) and global skills. No separate command needed.

### Uninstall

```bash
bun remove -g @bastani/atomic
```

That removes the `atomic` binary installed by `bun install -g`. If you used the bootstrap installer (`install.sh` / `install.ps1`) on a machine without Bun, the same `bun remove` command still works once Bun is on your PATH.

<details>
<summary>Clean up project config files</summary>

> **Warning:** This deletes all project-specific settings, skills, and agents configured by Atomic for the current project.

**macOS / Linux:**

```bash
rm -rf .claude/ CLAUDE.md              # Claude Code
rm -rf .opencode/ AGENTS.md            # OpenCode
rm -f .github/copilot-instructions.md  # Copilot CLI
rm -rf .atomic/                        # Atomic local settings + workflows
```

**Windows PowerShell:**

```powershell
Remove-Item -Path ".claude" -Recurse -Force; Remove-Item "CLAUDE.md" -Force
Remove-Item -Path ".opencode" -Recurse -Force; Remove-Item "AGENTS.md" -Force
Remove-Item -Path ".github\copilot-instructions.md" -Force
Remove-Item -Path ".atomic" -Recurse -Force
```

</details>

<details>
<summary>Clean up global config files</summary>

> **Warning:** This deletes Atomic's global settings and cached agent configs. You'll need to re-run `atomic init` in your projects after this.

**macOS / Linux:**

```bash
rm -rf ~/.atomic/
```

**Windows PowerShell:**

```powershell
Remove-Item -Path "$env:USERPROFILE\.atomic" -Recurse -Force
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

---

## FAQ

<details>
<summary>How does Atomic differ from Spec-Kit?</summary>

[Spec Kit](https://github.com/github/spec-kit) is GitHub's toolkit for "Spec-Driven Development." Both improve AI-assisted development, but solve different problems:

| Aspect           | Spec-Kit                        | Atomic                                          |
| ---------------- | ------------------------------- | ----------------------------------------------- |
| **Focus**        | Greenfield projects             | Large existing codebases + greenfield           |
| **First Step**   | Define project principles       | Analyze existing architecture                   |
| **Context**      | Per-feature specs               | Research → Specs → Execution → Outcomes         |
| **Agents**       | Single agent with shell scripts | 12+ specialized sub-agents across 3 SDKs        |
| **Workflows**    | Not available                   | Session-based pipelines with transcript passing |
| **Human Review** | Implicit                        | Explicit checkpoints                            |
| **Debugging**    | Not addressed                   | Dedicated debugging workflow                    |
| **Autonomous**   | Not available                   | Ralph for multi-hour execution                  |
| **Isolation**    | Not addressed                   | Devcontainer features for safe execution        |

</details>

<details>
<summary>How does Atomic differ from DeerFlow?</summary>

[DeerFlow](https://github.com/bytedance/deer-flow) is ByteDance's agent harness built on LangGraph/LangChain. Both are multi-agent orchestrators, but take different approaches:

| Aspect         | DeerFlow                    | Atomic                                             |
| -------------- | --------------------------- | -------------------------------------------------- |
| **Runtime**    | Python (LangGraph)          | TypeScript (Bun)                                   |
| **Agent SDKs** | OpenAI-compatible API       | Claude Code + OpenCode + Copilot CLI SDKs natively |
| **Focus**      | General-purpose agent tasks | Coding-specific: research, spec, implement, review |
| **Workflows**  | LangGraph state machines    | Session-based chainable API with `.compile()`      |
| **Execution**  | Sandbox containers          | Devcontainer features + git worktrees              |
| **Interface**  | Web UI                      | Terminal TUI with agent activity tree              |
| **Autonomous** | Not available               | Ralph for multi-hour coding sessions               |

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
