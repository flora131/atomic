# Atomic

<p align="center">
  <img src="assets/atomic.png" alt="Atomic" width="800">
</p>

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/flora131/atomic)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](./package.json)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun&logoColor=black)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Atomic is an open-source **agent harness framework** that lets you build, compose, and run **multi-session coding workflows** on top of **Claude Code**, **OpenCode**, and **GitHub Copilot CLI** — with **58 built-in skills**, **12 specialized sub-agents**, and **containerized execution**.

> Build any agent harness you want. Define workflows as TypeScript. Run them on any coding agent.

---

## Why Atomic

Building harnesses and workflows around coding agents is harder than it should be. Teams hit the same walls:

- **No way to chain agent sessions.** You can prompt an agent, but there's no standard way to feed one session's output into the next — research into planning, planning into implementation, implementation into review. Teams resort to copy-pasting between terminals.
- **Context degrades in long sessions.** A single agent asked to research, plan, implement, and review in one session produces increasingly unreliable output as its context window fills up. There's no built-in mechanism to isolate concerns across sessions.
- **Agent-specific configuration is fragmented.** Claude Code, OpenCode, and Copilot CLI each have their own config directories, skill formats, and agent definitions. Building a workflow that works across agents means maintaining three separate configurations.
- **Team processes live in wikis, not in code.** Every team has a process — triage bugs this way, ship features that way, review PRs with these checks. But those processes are prose in a wiki, not executable code that an agent can follow.
- **Autonomous execution is unsafe without isolation.** Agents run shell commands, delete files, and execute arbitrary code. Running them autonomously on your host system is a risk most teams won't take.
- **Specialized work requires specialized agents.** A single general-purpose agent juggling file search, code analysis, web research, and implementation will lose track of details. There's no framework for dispatching purpose-built sub-agents with scoped tools and isolated context windows.
- **Agent workflows aren't deterministic.** Even when you do chain sessions together, there's no guarantee they'll execute in the same order, pass data the same way, or produce an inspectable record. Without strict ordering and controlled data flow, workflows become unpredictable — hard to debug, impossible to reproduce.

Atomic solves these by giving you a **Workflow SDK** to define multi-session pipelines as TypeScript with **deterministic execution** — strict step ordering, frozen definitions, and controlled transcript passing — plus **12 specialized sub-agents** that keep context windows small and focused, and **containerized execution** via devcontainer features that isolate agents from your host system. Write a workflow once, run it on Claude Code, OpenCode, or Copilot CLI with a flag change.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Core Features](#core-features)
  - [Workflow SDK — Build Your Own Harness](#workflow-sdk--build-your-own-harness)
  - [Multi-Agent SDK Support](#multi-agent-sdk-support)
  - [Deep Codebase Research](#deep-codebase-research)
  - [Autonomous Execution (Ralph)](#autonomous-execution-ralph)
  - [Containerized Execution](#containerized-execution)
  - [Specialized Sub-Agents](#specialized-sub-agents)
  - [Built-in Skills](#built-in-skills)
  - [Interactive Chat](#interactive-chat)
- [Commands Reference](#commands-reference)
- [Configuration](#configuration)
- [Installation Options](#installation-options)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

---

## Quick Start

### Prerequisites

- **macOS, Linux, or Windows** (PowerShell 7+ required on Windows — [install guide](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows))
- **[Bun](https://bun.sh/)** runtime installed
- **At least one coding agent installed and logged in:**
  - [Claude Code](https://code.claude.com/docs/en/quickstart) — run `claude` and complete authentication
  - [OpenCode](https://opencode.ai) — run `opencode` and complete authentication
  - [GitHub Copilot CLI](https://github.com/features/copilot/cli) — run `copilot` and complete authentication

### 1. Install

```bash
bun install -g @bastani/atomic
```

On first run, Atomic automatically sets up all required tooling (Node.js, tmux, Playwright CLI, config files, skills, and agent configurations). This happens once and takes about a minute.

<details>
<summary>Migrating from v0.4.x (Binary) to v0.5.x (npm)?</summary>

Atomic has moved from a standalone binary distribution to an **npm package**. The new version gives you the Workflow SDK, 58 skills, and 12 sub-agents as a single installable package.

#### Migration Steps

**1. Uninstall the old binary:**

```bash
atomic uninstall
```

**2. Remove the old Workflow SDK global package:**

```bash
bun uninstall -g @bastani/atomic-workflows
```

**3. Delete the old configuration directory:**

```bash
rm -rf ~/.atomic
```

**4. Install the new version:**

```bash
bun install -g @bastani/atomic
```

**5. Re-initialize your project:**

```bash
cd your-project
atomic init
```

> On first run after install, Atomic automatically syncs all agent configurations, skills, workflows, and tooling. This replaces the old `atomic update` command — updates now happen lazily on CLI startup when a version mismatch is detected.

#### What Changed

| Aspect | v0.4.x (Binary) | v0.5.x (npm) |
| --- | --- | --- |
| **Distribution** | Pre-compiled binary via `install.sh` | npm package via `bun install -g` |
| **Updates** | `atomic update` command | Reinstall via `bun install -g @bastani/atomic` + auto-sync on first run |
| **Uninstall** | `atomic uninstall` | `bun uninstall -g @bastani/atomic` |
| **Workflow SDK** | Separate `@bastani/atomic-workflows` global package | Bundled with CLI as workspace package |
| **Config sync** | Manual via install scripts | Automatic on first run after upgrade |

</details>

### 2. Initialize Your Project

```bash
cd your-project
atomic init
```

Select your coding agent and source control system when prompted. The CLI configures your project automatically.

### 3. Generate Context Files

Start a chat session and run `/init` to generate `CLAUDE.md` and `AGENTS.md`:

```bash
atomic chat -a <claude|opencode|copilot>
```

```
/init
```

This explores your codebase using sub-agents and generates documentation that gives coding agents the context they need.

### 4. Build a Workflow

Every team has a process. Atomic lets you encode it as TypeScript — chain agent sessions together, pass transcripts between them, and run the whole thing from the CLI.

Drop a `.ts` file in `.atomic/workflows/<name>/<agent>/index.ts` and run it:

```bash
atomic workflow -n my-workflow -a claude "add user avatars to the profile page"
```

Here's a workflow that researches a codebase, implements a feature, and reviews the result — three sessions, each in its own context window:

```ts
// .atomic/workflows/my-workflow/claude/index.ts
import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "my-workflow",
  description: "Research -> Implement -> Review",
})
  .session({
    name: "research",
    description: "Analyze the codebase for the requested change",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `/research-codebase ${ctx.userPrompt}`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "implement",
    description: "Implement the feature based on research findings",
    run: async (ctx) => {
      const research = await ctx.transcript("research");
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Read ${research.path} and implement the changes described. Run tests to verify.`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "review",
    description: "Review the implementation for correctness",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: "Review all uncommitted changes. Flag any issues with correctness, tests, or style.",
      });
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
```

This is just one example. Add a spec phase, parallelize independent sessions, swap in a different agent — the workflow is yours to define. See [Workflow SDK — Build Your Own Harness](#workflow-sdk--build-your-own-harness) for the full API and more examples.

> **Want something that works out of the box?** Atomic ships with `ralph`, a built-in workflow that plans, implements, reviews, and debugs autonomously — see [Autonomous Execution (Ralph)](#autonomous-execution-ralph).

---

## Core Features

### Workflow SDK — Build Your Own Harness

Every team has a process — triage bugs this way, ship features that way, review PRs with these checks. The **Workflow SDK** (`@bastani/atomic-workflows`) lets you encode that process as a chain of named sessions with raw provider SDK code — then run it from the CLI.

Drop a `.ts` file in `.atomic/workflows/<name>/<agent>/index.ts` and run it:

```bash
atomic workflow -n hello -a claude "describe this project"
```

<details>
<summary>Example: Sequential workflow (describe -> summarize)</summary>

```ts
// .atomic/workflows/hello/claude/index.ts
import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "hello",
  description: "Two-session Claude demo: describe -> summarize",
})
  .session({
    name: "describe",
    description: "Ask Claude to describe the project",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: ctx.userPrompt,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "summarize",
    description: "Summarize the previous session's output",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      const research = await ctx.transcript("describe");

      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
```

</details>

<details>
<summary>Example: Parallel workflow (describe -> [summarize-a, summarize-b] -> merge)</summary>

```ts
// .atomic/workflows/hello-parallel/claude/index.ts
import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "hello-parallel",
  description: "Parallel Claude demo: describe -> [summarize-a, summarize-b] -> merge",
})
  .session({
    name: "describe",
    description: "Ask Claude to describe the project",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({ paneId: ctx.paneId, prompt: ctx.userPrompt });
      ctx.save(ctx.sessionId);
    },
  })
  .session([
    {
      name: "summarize-a",
      description: "Summarize the description as bullet points",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");
        await createClaudeSession({ paneId: ctx.paneId });
        await claudeQuery({
          paneId: ctx.paneId,
          prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
        });
        ctx.save(ctx.sessionId);
      },
    },
    {
      name: "summarize-b",
      description: "Summarize the description as a one-liner",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");
        await createClaudeSession({ paneId: ctx.paneId });
        await claudeQuery({
          paneId: ctx.paneId,
          prompt: `Read ${research.path} and summarize it in a single sentence.`,
        });
        ctx.save(ctx.sessionId);
      },
    },
  ])
  .session({
    name: "merge",
    description: "Merge both summaries into a final output",
    run: async (ctx) => {
      const bullets = await ctx.transcript("summarize-a");
      const oneliner = await ctx.transcript("summarize-b");
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: [
          "Combine the following two summaries into one concise paragraph:",
          "",
          "## Bullet points",
          bullets.content,
          "",
          "## One-liner",
          oneliner.content,
        ].join("\n"),
      });
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
```

</details>

**Key capabilities:**

| Capability | Description |
| --- | --- |
| **Sequential sessions** | Chain `.session()` calls that execute in order, each in its own tmux pane |
| **Parallel sessions** | Pass an array of sessions to `.session([...])` for concurrent execution |
| **Transcript passing** | Access previous session output via `ctx.transcript(name)` or `ctx.getMessages(name)` |
| **Provider-agnostic** | Write raw SDK code for Claude, Copilot, or OpenCode inside each session's `run()` |
| **tmux-based execution** | Each session runs in its own tmux pane for isolation and observability |
| **Native SDK access** | Use `createClaudeSession`, `claudeQuery`, Copilot SDK, or OpenCode SDK directly |

**Deterministic execution guarantees:**

Workflows are deterministic by design — the same definition always produces the same execution order with the same data flow, regardless of when or where you run it.

- **Strict step ordering** — Steps execute sequentially. Step 2 never starts until Step 1 finishes. Parallel sessions within a step all complete (or fail fast) before the next step begins.
- **Frozen definitions** — `.compile()` freezes the workflow structure. Once compiled, the step order, session names, and execution graph are immutable.
- **Controlled transcript access** — Sessions can only read transcripts from *completed* upstream sessions. Parallel siblings are blocked from reading each other, eliminating race conditions on shared state.
- **Isolated context windows** — Each session runs in its own tmux pane with a fresh context window. No session inherits stale state from another — data flows only through explicit `ctx.transcript()` and `ctx.getMessages()` calls.
- **Persisted artifacts** — Every session writes its messages, transcript, and metadata to disk. The workflow produces a complete, inspectable execution record you can replay or debug after the fact.

This means you can run the same workflow on different machines, different agents, or at different times and get structurally identical execution — same steps, same data flow, same ordering. The only variance comes from the LLM's responses, not from the harness.

Drop a `.ts` file in `.atomic/workflows/<name>/<agent>/` (project-local) or `~/.atomic/workflows/` (global). You can also ask Atomic to create workflows for you:

```
Use your workflow-creator skill to create a workflow that plans, implements, and reviews a feature.
```

<details>
<summary>Full Workflow SDK Reference</summary>

#### Builder API

| Method | Purpose |
| --- | --- |
| `defineWorkflow({ name, description })` | Entry point — returns a `WorkflowBuilder` |
| `.session({ name, description?, run })` | Add a named session (sequential execution) |
| `.session([{ name, run }, ...])` | Add parallel sessions (concurrent execution) |
| `.compile()` | **Required** — terminal method that seals the workflow definition |

#### Session Context (`ctx`)

| Property | Type | Description |
| --- | --- | --- |
| `ctx.userPrompt` | `string` | Original user prompt from the CLI invocation |
| `ctx.agent` | `AgentType` | Which agent is running (`"claude"`, `"copilot"`, `"opencode"`) |
| `ctx.serverUrl` | `string` | The agent's server URL |
| `ctx.paneId` | `string` | tmux pane ID for this session |
| `ctx.sessionId` | `string` | Session UUID |
| `ctx.sessionDir` | `string` | Path to this session's storage directory on disk |
| `ctx.transcript(name)` | `Promise<Transcript>` | Get a previous session's transcript (`{ path, content }`) |
| `ctx.getMessages(name)` | `Promise<SavedMessage[]>` | Get a previous session's raw native messages |
| `ctx.save(messages)` | `SaveTranscript` | Save this session's output for subsequent sessions |

#### Saving Transcripts

Each provider saves transcripts differently:

| Provider | How to Save |
| --- | --- |
| **Claude** | `ctx.save(ctx.sessionId)` — auto-reads via `getSessionMessages()` |
| **Copilot** | `ctx.save(await session.getMessages())` — pass `SessionEvent[]` |
| **OpenCode** | `ctx.save(result.data)` — pass the full `{ info, parts }` response |

#### Provider Helpers

| Export | Purpose |
| --- | --- |
| `createClaudeSession({ paneId })` | Start a Claude TUI in a tmux pane |
| `claudeQuery({ paneId, prompt })` | Send a prompt to Claude and wait for the response |
| `clearClaudeSession({ paneId })` | Clear the current Claude session |

#### Key Rules

1. Every workflow file must use `export default` with `.compile()` at the end
2. Session names must be unique within a workflow
3. Sessions execute sequentially in the order they are defined (unless passed as an array for parallel execution)
4. Each session runs in its own tmux pane with the chosen agent
5. Workflows are organized per-workflow: `.atomic/workflows/<name>/<agent>/index.ts`

For complete documentation, see the [Workflow SDK package](packages/workflow-sdk/).

</details>

### Multi-Agent SDK Support

Atomic unifies **three production agent SDKs** behind a single interface. Switch between agents with a flag — your workflows, skills, and sub-agents work across all of them.

| Agent | SDK | Command |
| --- | --- | --- |
| Claude Code | `@anthropic-ai/claude-agent-sdk` | `atomic chat -a claude` |
| OpenCode | `@opencode-ai/sdk` | `atomic chat -a opencode` |
| GitHub Copilot CLI | `@github/copilot-sdk` | `atomic chat -a copilot` |

Each agent gets its own configuration directory (`.claude/`, `.opencode/`, `.github/`), skills, and context files — all managed by Atomic. Write a workflow once, run it on any agent.

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
2. **Worker Loop** — An `orchestrator` sub-agent dispatches `worker` sub-agents for ready tasks, executing with concurrent execution of independent tasks
3. **Review & Debug** — A `reviewer` sub-agent audits the implementation; if issues are found, a `debugger` sub-agent generates a report that feeds back to the planner on the next iteration
4. **Bounded Iteration** — The loop runs up to 10 iterations and terminates early after 2 consecutive clean reviewer passes

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

| Feature | Installs |
| --- | --- |
| `ghcr.io/flora131/atomic/claude:1` | Atomic + Claude Code |
| `ghcr.io/flora131/atomic/opencode:1` | Atomic + OpenCode |
| `ghcr.io/flora131/atomic/copilot:1` | Atomic + Copilot CLI |

### Specialized Sub-Agents

Atomic dispatches **purpose-built sub-agents**, each with scoped context, tools, and termination conditions:

| Sub-Agent | Model | Purpose |
| --- | --- | --- |
| `planner` | Opus | Decompose specs into structured task lists with dependency tracking |
| `worker` | Sonnet | Implement single focused tasks (multiple workers run in parallel) |
| `reviewer` | Opus | Audit implementations against specs and best practices |
| `debugger` | Opus | Debug errors, test failures, and unexpected behavior |
| `orchestrator` | Opus | Coordinate complex multi-step workflows |
| `code-simplifier` | Opus | Simplify and refine code for clarity, consistency, and maintainability |
| `codebase-analyzer` | Sonnet | Analyze implementation details of specific components |
| `codebase-locator` | Haiku | Locate files, directories, and components |
| `codebase-pattern-finder` | Haiku | Find similar implementations and usage examples |
| `codebase-online-researcher` | Sonnet | Research using web sources and DeepWiki |
| `codebase-research-analyzer` | Sonnet | Deep dive on research topics and extract insights |
| `codebase-research-locator` | Haiku | Find documents in `research/` and `specs/` directories |

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

Skills are structured capability modules that give agents best practices and workflows for specific tasks. Atomic ships with **58 built-in skills**:

| Category | Skill | Description |
| --- | --- | --- |
| **Development** | `create-spec` | Create detailed execution plans from research documents |
| | `research-codebase` | Analyze codebase with parallel sub-agents and document findings |
| | `explain-code` | Explain code functionality in detail using DeepWiki |
| | `workflow-creator` | Create multi-agent workflows using the session-based `defineWorkflow()` API |
| | `init` | Generate `CLAUDE.md` and `AGENTS.md` by exploring the codebase |
| | `find-skills` | Discover and install agent skills from the community |
| | `test-driven-development` | Write tests first, then implement — includes testing anti-patterns guide |
| | `prompt-engineer` | Create, improve, and optimize prompts using best practices |
| | `skill-creator` | Create, modify, evaluate, and benchmark your own skills |
| | `playwright-cli` | Automate browser interactions for testing, screenshots, and data extraction |
| **TypeScript & Code Quality** | `typescript-expert` | Deep TypeScript knowledge: type-level programming, performance, monorepos |
| | `typescript-advanced-types` | Generics, conditional types, mapped types, template literals, utility types |
| | `typescript-react-reviewer` | Expert code reviewer for TypeScript + React 19 applications |
| | `bun` | Bun runtime: scripts, packages, bundling, testing |
| | `opentui` | Terminal user interfaces: components, layout, keyboard handling, animations |
| **Frontend Design** | `frontend-design` | Create distinctive, production-grade frontend interfaces |
| | `animate` | Purposeful animations, micro-interactions, and motion effects |
| | `adapt` | Responsive design across screen sizes, devices, and platforms |
| | `arrange` | Layout, spacing, and visual rhythm improvements |
| | `audit` | Accessibility, performance, theming, and anti-pattern checks |
| | `bolder` | Amplify safe designs to make them more visually interesting |
| | `clarify` | Improve UX copy, error messages, microcopy, and labels |
| | `colorize` | Add strategic color to monochromatic interfaces |
| | `critique` | UX evaluation with quantitative scoring and persona-based testing |
| | `delight` | Add moments of joy and personality to interfaces |
| | `distill` | Strip designs to their essence |
| | `extract` | Extract reusable components and design tokens |
| | `harden` | Error handling, i18n support, edge case management |
| | `normalize` | Audit and realign UI to design system standards |
| | `onboard` | Onboarding flows, empty states, first-run experiences |
| | `optimize` | UI performance: loading speed, rendering, bundle size |
| | `overdrive` | Technically ambitious implementations: shaders, spring physics, 60fps |
| | `polish` | Final quality pass: alignment, spacing, consistency |
| | `quieter` | Tone down overstimulating designs |
| | `teach-impeccable` | One-time setup for persistent design guidelines |
| | `typeset` | Typography: font choices, hierarchy, sizing, readability |
| **Documents** | `pdf` | Read, create, edit, split, merge, and OCR PDF files |
| | `xlsx` | Create, read, edit, and fix spreadsheet files (`.xlsx`, `.csv`, `.tsv`) |
| | `docx` | Create, read, edit, and manipulate Word (`.docx`) documents |
| | `pptx` | Create, read, edit, and manipulate PowerPoint (`.pptx`) slide decks |
| | `liteparse` | Parse and convert unstructured files (PDF, DOCX, PPTX, images) locally |
| **Git** | `gh-commit` | Create well-formatted commits using conventional commit format |
| | `gh-create-pr` | Commit unstaged changes, push, and submit a pull request |
| **Sapling / Phabricator** | `sl-commit` | Create well-formatted Sapling commits with conventional commit format |
| | `sl-submit-diff` | Submit Sapling commits as Phabricator diffs for code review |
| **Agent Architecture** | `multi-agent-patterns` | Supervisor patterns, swarm architecture, agent coordination |
| | `context-fundamentals` | Context engineering: components, attention mechanics, progressive disclosure |
| | `context-degradation` | Diagnose and mitigate context failures in agent systems |
| | `context-compression` | Compress conversation history and reduce token usage |
| | `context-optimization` | Extend effective capacity of context windows |
| | `filesystem-context` | Offload context to files for dynamic discovery |
| | `tool-design` | Design agent tools, reduce tool complexity, implement MCP tools |
| | `memory-systems` | Agent memory architecture and persistent state management |
| | `hosted-agents` | Background agents, sandboxed VMs, agent infrastructure |
| | `bdi-mental-states` | BDI (Belief-Desire-Intention) architecture for cognitive agents |
| | `evaluation` | Build test frameworks and quality gates for agent systems |
| | `advanced-evaluation` | LLM-as-judge patterns, evaluation rubrics, bias mitigation |
| | `project-development` | LLM project structure, batch pipelines, cost estimation |
Skills are auto-invoked when relevant — `test-driven-development` activates before any test is written, `playwright-cli` activates for browser automation tasks.

### Interactive Chat

Atomic wraps each coding agent in a tmux-based chat session:

```bash
atomic chat -a claude          # Start Claude Code
atomic chat -a opencode        # Start OpenCode
atomic chat -a copilot         # Start Copilot CLI
```

All arguments after `-a <agent>` are forwarded directly to the native agent CLI:

```bash
atomic chat -a claude "fix the bug"          # Initial prompt
atomic chat -a copilot --model gpt-4o        # Custom model
atomic chat -a claude --verbose              # Forward --verbose to claude
```

---

## Commands Reference

### CLI Commands

| Command | Description |
| --- | --- |
| `atomic init` | Interactive project setup — select agent and SCM |
| `atomic chat` | Start a chat session with a coding agent |
| `atomic workflow` | Run a multi-session agent workflow |
| `atomic config set <k> <v>` | Set configuration values |

#### `atomic chat` Flags

| Flag | Description |
| --- | --- |
| `-a, --agent <name>` | Agent: `claude`, `opencode`, `copilot` |

All other arguments are forwarded directly to the native agent CLI.

#### `atomic workflow` Flags

| Flag | Description |
| --- | --- |
| `-n, --name <name>` | Workflow name (matches directory under `.atomic/workflows/<name>/`) |
| `-a, --agent <name>` | Agent: `claude`, `opencode`, `copilot` |
| `-l, --list` | List available workflows |
| `[prompt...]` | Prompt for the workflow |

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
| OpenCode | `.opencode/` | `.agents/skills/` (shared) | `AGENTS.md` |
| GitHub Copilot | `.github/` | `.agents/skills/` (shared) | `AGENTS.md` |

> **Note:** OpenCode and Copilot CLI share skills via the `.agents/skills/` directory to avoid duplication. Claude Code uses its own `.claude/skills/` directory.

---

## Installation Options

### npm / Bun (recommended)

```bash
bun install -g @bastani/atomic
```

### Devcontainer (recommended for autonomous agents)

> [!TIP]
> Devcontainers isolate the coding agent from your host system, reducing the risk of destructive actions like unintended file deletions or misapplied shell commands. This makes them the safest way to run Atomic.
>
> Use the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) for VS Code or [DevPod](https://devpod.sh) to spawn and manage your devcontainers.

Add a single feature to your `.devcontainer/devcontainer.json`:

```
your-project/
+-- .devcontainer/
|   +-- devcontainer.json   <-- add the feature here
+-- src/
+-- ...
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

<details>
<summary>Standalone binary (macOS / Linux)</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
# or with wget:
wget -qO- https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

</details>

<details>
<summary>Standalone binary (Windows PowerShell)</summary>

```powershell
irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

</details>

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

1. Update to the latest release and retry
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

**In short:** Spec-Kit works well for greenfield projects where you start from a spec and use a single Copilot session to generate code. Atomic is built for the harder case — large existing codebases where you need to research what's already there before changing anything. It gives you multi-session pipelines with isolated context windows (so the agent doesn't degrade over long tasks), deterministic execution, and support for Claude Code, OpenCode, and Copilot CLI instead of just one agent. If you're starting a new project from scratch with Copilot, Spec-Kit is simpler. If you're working on an established codebase and need chained sessions, parallel research, or autonomous execution, that's what Atomic is for.

| Aspect | Spec-Kit | Atomic |
| --- | --- | --- |
| **Focus** | Greenfield projects with spec-first workflow | Large existing codebases + greenfield — research-first or spec-first |
| **First Step** | Define project principles and specs | Analyze existing architecture with parallel research sub-agents |
| **Workflow Definition** | Shell scripts and markdown templates | TypeScript Workflow SDK (`defineWorkflow()` → `.compile()`) with deterministic execution |
| **Session Management** | Single agent session | Multi-session pipelines — sequential and parallel — each in isolated context windows |
| **Data Flow** | Manual — copy output between steps | Controlled transcript passing via `ctx.transcript()` and `ctx.getMessages()` |
| **Agent Support** | GitHub Copilot CLI | Claude Code + OpenCode + Copilot CLI — switch with a flag |
| **Sub-Agents** | Single general-purpose agent | 12 specialized sub-agents with scoped tools and isolated contexts |
| **Skills** | Not available | 58 built-in skills (development, design, docs, agent architecture) |
| **Autonomous Execution** | Not available | Ralph — multi-hour autonomous sessions with plan/implement/review/debug loop |
| **Execution Guarantees** | Non-deterministic | Deterministic — strict step ordering, frozen definitions, controlled transcript access |
| **Isolation** | Not addressed | Devcontainer features for containerized execution |

</details>

<details>
<summary>How does Atomic differ from DeerFlow?</summary>

[DeerFlow](https://github.com/bytedance/deer-flow) is ByteDance's agent harness built on LangGraph/LangChain. Both are multi-agent orchestrators, but take different approaches:

**In short:** DeerFlow is a general-purpose agent orchestrator — it handles research, report generation, and other tasks through a LangGraph DAG with a web UI. Atomic is narrowly focused on coding workflows. The key difference is that Atomic runs on top of production coding agents (Claude Code, OpenCode, Copilot CLI) rather than reimplementing coding tools through a generic API. You get each agent's native file editing, permissions, MCP integrations, and hooks out of the box. Atomic also gives you deterministic execution — same step order, same data flow every run — which matters when you're encoding a team's dev process and need it to be reproducible across people and CI. If you need a general-purpose agent pipeline with a web UI, DeerFlow is the better fit. If you need coding-specific workflows with strict execution guarantees, Atomic is more appropriate.

| Aspect | DeerFlow | Atomic |
| --- | --- | --- |
| **Runtime** | Python (LangGraph) | TypeScript (Bun) |
| **Agent SDKs** | OpenAI-compatible API | Claude Code + OpenCode + Copilot CLI native SDKs — write raw SDK code in each session |
| **Focus** | General-purpose agent tasks (research, reports) | Coding-specific: research, spec, implement, review, debug |
| **Workflow Definition** | LangGraph state machines with graph nodes | TypeScript Workflow SDK — `defineWorkflow()` → `.session()` → `.compile()` |
| **Execution Model** | DAG-based with conditional edges | Deterministic — strict step ordering, frozen definitions, controlled transcript passing |
| **Parallelism** | Via LangGraph branch nodes | Native parallel sessions (`.session([...])`) with isolated context windows |
| **Sub-Agents** | Researcher, coder, reporter nodes | 12 specialized sub-agents with scoped tools (planner, worker, reviewer, debugger, etc.) |
| **Skills** | Not available | 58 built-in skills auto-invoked by context |
| **Isolation** | Sandbox containers | Devcontainer features + git worktrees |
| **Interface** | Web UI (Streamlit) | Terminal chat with tmux-based session management |
| **Autonomous** | Not available | Ralph — bounded iteration with plan/implement/review/debug loop |
| **Distribution** | `pip install` + local server | `bun install -g` or devcontainer features |

</details>

<details>
<summary>How does Atomic differ from Hermes Agent?</summary>

[Hermes Agent](https://github.com/NousResearch/hermes-agent) is Nous Research's general-purpose AI agent with a self-improving learning loop. Both are open-source agent frameworks, but serve different use cases:

**In short:** Hermes Agent is a broad AI assistant that learns and improves across sessions, connects to messaging platforms, and works with any OpenAI-compatible model. Atomic is a coding-specific harness built for engineering teams. It lets you encode your development process as deterministic TypeScript workflows that run identically across team members, machines, and CI pipelines. Instead of reimplementing coding tools from scratch, Atomic inherits production-hardened tool ecosystems from Claude Code, OpenCode, and Copilot CLI — including their permission systems, MCP integrations, and hooks — giving you two independent security boundaries (devcontainer isolation + agent permissions) rather than one. Each workflow session runs in a fresh context window with only distilled transcripts passed forward, so output stays sharp over multi-hour coding tasks instead of degrading through lossy compression. And because skills are developer-authored and version-controlled, they don't drift or accumulate errors the way auto-generated skills can. Choose Hermes if you want a self-improving general-purpose agent with multi-platform messaging; choose Atomic if you want repeatable, auditable coding workflows with strict execution guarantees and production-grade isolation.

| Aspect | Hermes Agent | Atomic |
| --- | --- | --- |
| **Focus** | General-purpose AI assistant (coding, messaging, smart home, research) | Coding-specific: multi-session workflows on coding agents |
| **Runtime** | Python 3.11+ (uv) | TypeScript (Bun) |
| **Agent SDKs** | OpenAI-compatible API as universal adapter (200+ models via OpenRouter) | Claude Code + OpenCode + Copilot CLI native SDKs — write raw SDK code in each session |
| **Workflow Definition** | Cron scheduler + subagent delegation | TypeScript Workflow SDK — `defineWorkflow()` → `.session()` → `.compile()` |
| **Session Management** | Single conversation loop with context compression | Multi-session pipelines — sequential and parallel — each in isolated context windows |
| **Data Flow** | In-context within a single conversation | Controlled transcript passing via `ctx.transcript()` and `ctx.getMessages()` |
| **Self-Improvement** | Closed learning loop — auto-creates skills from experience, persistent user model via Honcho | Skills authored by developers; memory via CLAUDE.md / AGENTS.md context files |
| **Sub-Agents** | `delegate_task` spawns isolated subagents | 12 specialized sub-agents with scoped tools and model tiers (Opus, Sonnet, Haiku) |
| **Skills** | 40+ tools + community Skills Hub (agentskills.io) | 58 built-in skills (development, design, docs, agent architecture) |
| **Interface** | Terminal TUI + multi-platform messaging gateway (Telegram, Discord, Slack, WhatsApp, etc.) | Terminal chat with tmux-based session management |
| **Isolation** | Six terminal backends (local, Docker, SSH, Daytona, Singularity, Modal) | Devcontainer features + git worktrees |
| **Autonomous Execution** | Cron scheduler with inactivity-based timeouts | Ralph — bounded iteration with plan/implement/review/debug loop |
| **Execution Guarantees** | Non-deterministic conversation loop | Deterministic — strict step ordering, frozen definitions, controlled transcript access |
| **Team Process Encoding** | Personal assistant — no concept of team-shared workflows | Encode your team's dev process as TypeScript — repeatable across members, projects, and CI |
| **Coding Agent Tooling** | Reimplements file/terminal tools from scratch via `model_tools.py` | Inherits production-hardened tool ecosystems from Claude Code, OpenCode, and Copilot CLI (file editing, permissions, MCP, hooks) |
| **Reproducibility** | Conversation loop produces different execution paths each run | Frozen workflow definitions run identically across machines, team members, and CI pipelines |
| **Context Quality** | Lossy compression within a single conversation — degrades on long coding tasks | Fresh context window per session with only distilled transcripts passed forward — stays sharp over multi-hour tasks |
| **Skill Authoring** | Auto-created skills may drift, accumulate errors, or encode bad patterns over time | Developer-authored, version-controlled skills — intentional and auditable |
| **Security Model** | Command approval + container backends (single boundary) | Devcontainer isolation + coding agent permission systems (Claude Code permissions, Copilot safeguards) — two independent security boundaries |
| **Distribution** | `uv` / `pip` | `bun install -g` or devcontainer features |

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
- [Impeccable](https://github.com/pbakaus/impeccable)
