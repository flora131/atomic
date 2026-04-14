# Atomic

<p align="center">
  <img src="assets/atomic.png" alt="Atomic" width="800">
</p>

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/flora131/atomic)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](./package.json)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun&logoColor=black)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Atomic is an open-source **TypeScript SDK** for building **any harness you want** around your coding agent — **Claude Code**, **OpenCode**, or **GitHub Copilot CLI**. Chain sessions into pipelines, add human-in-the-loop approval gates, plug in CI and notifications, dispatch **12 specialized sub-agents**, and tap **58 built-in skills** — then ship it as TypeScript your whole team runs.

> Define how your agent works. Start for yourself, scale to your team.

---

## Why Atomic

Coding agents keep getting more capable — better reasoning, larger context windows, more reliable tool use. But a more capable model doesn't reduce the need for structure around it. It **increases** it.

The bottleneck is shifting from "can my agent write this code?" to "can my agent follow my process?" Every team has a process — how code gets reviewed, what checks run before merging, who approves deployments, how production gets monitored. That process lives in wikis nobody reads, in one senior engineer's head, or nowhere at all. A powerful agent without a defined process is just a faster way to ship unreviewed code.

**Harnesses are what turn a capable agent into a reliable part of your engineering workflow.** A harness encodes your process — research, then implement, then review, then run CI, then create a PR, then notify the right person, then wait for approval, then merge. Without one, you're prompting manually and copy-pasting between terminal sessions. With one, you run a single command and the process executes itself.

Better models make harnesses **more** important, not less. The more you can trust an agent to execute complex tasks, the more value you get from defining exactly **what** it should execute, in **what order**, with **what checks** along the way. The harness is the durable layer — models will keep improving underneath it, but your process stays the same.

Atomic gives you the SDK to build that harness:

- **Start for yourself.** Automate the repetitive parts of your own workflow — research a codebase, add monitoring, generate specs. One developer, one afternoon, one TypeScript file.
- **Scale to your team.** Encode your team's review process, deployment gates, and quality checks as TypeScript that every team member runs identically. Your process becomes versioned, testable, and reproducible — not tribal knowledge.
- **Work across agents.** Write a harness once, run it on Claude Code, OpenCode, or Copilot CLI with a flag change. The harness is the constant; the agent is swappable.

### What You Can Build

**Add production monitoring to your codebase.** Build a harness that researches your current observability setup, identifies gaps in metrics, health checks, and alerting, implements the missing pieces, and reviews the changes — all in one run.

```bash
atomic workflow -n add-monitoring -a claude "add Prometheus metrics and health checks to all API endpoints"
```

**Automate your team's review-to-merge pipeline.** Encode your exact process: review code changes → run security scans and linting in parallel → create a PR → notify the team lead on Slack → wait for human approval → merge. The [human-in-the-loop gate](#workflow-sdk--build-your-own-deterministic-harness) pauses execution until the right person approves. New team members inherit the same pipeline on day one.

```bash
atomic workflow -n review-to-merge -a claude
```

**Run parallel UX testing with 50 personas.** Spin up 50 agents — each with a distinct user persona (first-time user, power user, accessibility-dependent user, non-technical stakeholder) — each using [Playwright](#built-in-skills) to navigate your app and report usability issues from their perspective. Batch in groups, aggregate findings, and get feedback at a scale no manual process can match.

```bash
atomic workflow -n ux-personas -a claude
```

Each of these is a `.ts` file using Atomic's [Workflow SDK](#workflow-sdk--build-your-own-deterministic-harness). See [Build a Workflow](#5-build-a-workflow) for a working example, or read the full SDK reference below.

---

## Table of Contents

- [Atomic](#atomic)
  - [Why Atomic](#why-atomic)
    - [What You Can Build](#what-you-can-build)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
    - [Prerequisites](#prerequisites)
    - [1. Install](#1-install)
    - [2. Initialize Your Project](#2-initialize-your-project)
    - [3. Generate Context Files](#3-generate-context-files)
    - [4. Managing Sessions](#4-managing-sessions)
    - [5. Build a Workflow](#5-build-a-workflow)
  - [Core Features](#core-features)
    - [Multi-Agent Support](#multi-agent-support)
    - [Workflow SDK — Build Your Own Deterministic Harness](#workflow-sdk--build-your-own-deterministic-harness)
      - [Builder API](#builder-api)
      - [WorkflowContext (`ctx`) — top-level orchestrator](#workflowcontext-ctx--top-level-orchestrator)
      - [SessionContext (`s`) — inside each session callback](#sessioncontext-s--inside-each-session-callback)
      - [Session Options (`SessionRunOptions`)](#session-options-sessionrunoptions)
      - [Saving Transcripts](#saving-transcripts)
      - [Per-Agent Session APIs](#per-agent-session-apis)
      - [Key Rules](#key-rules)
    - [Deep Codebase Research](#deep-codebase-research)
    - [Autonomous Execution (Ralph)](#autonomous-execution-ralph)
    - [Containerized Execution](#containerized-execution)
    - [Specialized Sub-Agents](#specialized-sub-agents)
    - [Built-in Skills](#built-in-skills)
    - [Workflow Orchestrator Panel](#workflow-orchestrator-panel)
  - [Commands Reference](#commands-reference)
    - [CLI Commands](#cli-commands)
      - [Global Flags](#global-flags)
      - [`atomic init` Flags](#atomic-init-flags)
      - [`atomic session` Subcommands](#atomic-session-subcommands)
      - [`atomic chat` Flags](#atomic-chat-flags)
      - [`atomic workflow` Flags](#atomic-workflow-flags)
      - [`atomic completions` — Shell Completions](#atomic-completions--shell-completions)
    - [Atomic-Provided Skills (invokable from any agent chat)](#atomic-provided-skills-invokable-from-any-agent-chat)
  - [Configuration](#configuration)
    - [`.atomic/settings.json`](#atomicsettingsjson)
    - [Agent-Specific Files](#agent-specific-files)
  - [Installation Options](#installation-options)
    - [Bun (recommended)](#bun-recommended)
    - [Devcontainer (recommended for autonomous agents)](#devcontainer-recommended-for-autonomous-agents)
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
- **[Bun](https://bun.sh/)** runtime installed
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

On first run, Atomic automatically sets up all required tooling (Node.js, tmux, Playwright CLI, config files, skills, and agent configurations). This happens once and takes about a minute.

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

**Option C — Bootstrap script (installs bun + atomic + shell completions in one step):**

For machines without Bun, the bootstrap scripts install Bun, Atomic, and shell completions together:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

Windows PowerShell 7+:

```powershell
irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```


> [!IMPORTANT]
> **Migrating from the old standalone binary?** The old version of Atomic was a standalone binary. It is now distributed as an npm package. To migrate:
>
> 1. Uninstall the old binary: `atomic uninstall`
> 2. Uninstall the old workflows package: `bun uninstall -g @bastani/atomic-workflows`
> 3. Delete the old config directory: `rm -rf ~/.atomic`
> 4. Remove legacy skill directories: `rm -rf ~/.copilot/skills ~/.opencode/skills`
> 5. Re-install using any of the install options above

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

### 4. Managing Sessions

Atomic runs every chat and workflow session inside [tmux](https://github.com/tmux/tmux) on a dedicated socket, isolated from any personal tmux sessions you may have running. Use the built-in `session` commands to manage them:

```bash
# List all running sessions
atomic session list

# List only chat sessions
atomic chat session list

# List only workflow sessions
atomic workflow session list

# Connect to a session by name
atomic session connect <session-name>

# Interactive session picker (fuzzy-search)
atomic session connect
```

Session names follow a predictable pattern:

| Session type | Name format                 | Example                    |
| ------------ | --------------------------- | -------------------------- |
| Chat         | `atomic-chat-<id>`          | `atomic-chat-a1b2c3d4`     |
| Workflow     | `atomic-wf-<workflow>-<id>` | `atomic-wf-ralph-x9y8z7w6` |

> **Tip:** If your terminal disconnects or you accidentally close the window, your session is still alive — just run `atomic session connect <session-name>` to pick up where you left off.

### 5. Build a Workflow

Every team has a process. Atomic lets you encode it as TypeScript — chain agent sessions together, pass transcripts between them, and run the whole thing from the CLI.

Create a workflow project, install the SDK, and add your workflow file:

```bash
bun init && bun add @bastani/atomic
mkdir -p .atomic/workflows/review-to-merge/claude
```

Here's one of the [canonical use cases](#what-you-can-build) — a team pipeline that reviews code, runs checks in parallel, creates a PR, notifies on Slack, waits for human approval, and merges:

```ts
// .atomic/workflows/review-to-merge/claude/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "review-to-merge",
  description: "Review → CI → PR → Notify → Approve → Merge",
})
  .run(async (ctx) => {
    // Step 1: Review the changes
    const review = await ctx.stage(
      { name: "review", description: "Review code changes" },
      {}, {},
      async (s) => {
        await s.session.query(
          "Review all uncommitted changes. Flag issues with correctness, security, and style.",
        );
        s.save(s.sessionId);
      },
    );

    // Step 2: Run security and CI checks in parallel
    await Promise.all([
      ctx.stage({ name: "security-scan" }, {}, {}, async (s) => {
        await s.session.query("Run `bun audit` and scan for leaked secrets or credentials.");
        s.save(s.sessionId);
      }),
      ctx.stage({ name: "ci-checks" }, {}, {}, async (s) => {
        await s.session.query("Run `bun lint` and `bun test`. Report any failures.");
        s.save(s.sessionId);
      }),
    ]);

    // Step 3: Create a PR with the review summary
    await ctx.stage({ name: "create-pr" }, {}, {}, async (s) => {
      const transcript = await s.transcript(review);
      await s.session.query(
        `Read the review at ${transcript.path}. Create a pull request summarizing the changes.`,
      );
      s.save(s.sessionId);
    });

    // Step 4: Notify on Slack, then wait for human approval before merging.
    // Stage callbacks are plain Bun code — fetch(), Bun.spawn(), and any
    // Node API work here alongside agent session queries.
    await ctx.stage({ name: "notify-and-merge" }, {}, {}, async (s) => {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: "#code-review",
          text: "New PR ready for review — please approve in GitHub.",
        }),
      });

      // Human-in-the-loop: AskUserQuestion pauses the session until the
      // user responds. The agent won't merge until approval is given.
      await s.session.query(
        "The team has been notified on Slack. Ask the user to confirm the PR " +
        "is approved, then merge it with `gh pr merge --squash`.",
        { allowedTools: ["Bash", "Read", "AskUserQuestion"] },
      );
      s.save(s.sessionId);
    });
  })
  .compile();
```

Run it:

```bash
atomic workflow -n review-to-merge -a claude
```

This single file demonstrates multi-step pipelines, parallel stages (`Promise.all`), transcript passing between sessions, external API calls (`fetch`), and human-in-the-loop approval — all in plain TypeScript. Swap `-a claude` for `-a opencode` or `-a copilot` to run the same harness on a different agent. See [Workflow SDK — Build Your Own Harness](#workflow-sdk--build-your-own-deterministic-harness) for the full API and more examples.

> **Want something that works out of the box?** Atomic ships with `ralph`, a built-in workflow that plans, implements, reviews, and debugs autonomously — see [Autonomous Execution (Ralph)](#autonomous-execution-ralph).

---

## Core Features

### Multi-Agent Support

Atomic works across **three production coding agents** — switch between them with a flag and your workflows, skills, and sub-agents carry over.

| Agent              | Command                   |
| ------------------ | ------------------------- |
| Claude Code        | `atomic chat -a claude`   |
| OpenCode           | `atomic chat -a opencode` |
| GitHub Copilot CLI | `atomic chat -a copilot`  |

Each agent gets its own configuration directory (`.claude/`, `.opencode/`, `.github/`), skills, and context files — all managed by Atomic. Write a workflow once, run it on any agent.

### Workflow SDK — Build Your Own Deterministic Harness

Every team has a process — triage bugs this way, ship features that way, review PRs with these checks. Most of it lives in a wiki nobody reads or in one senior engineer's head. The **Workflow SDK** (`@bastani/atomic/workflows`) lets you encode that process as TypeScript — spawn agent sessions dynamically with native control flow (`for`, `if`, `Promise.all()`), and watch them appear in a live graph as they execute.

Set up a workflow project (`bun init && bun add @bastani/atomic`), create a `.ts` file in `.atomic/workflows/<name>/<agent>/index.ts`, and run it:

```bash
atomic workflow -n my-workflow -a claude "describe this project"
```

<details>
<summary>Example: Sequential workflow (describe -> summarize)</summary>

```ts
// .atomic/workflows/my-workflow/claude/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "my-workflow",
  description: "Two-session pipeline: describe -> summarize",
})
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";

    const describe = await ctx.stage(
      { name: "describe", description: "Ask Claude to describe the project" },
      {}, {},
      async (s) => {
        await s.session.query(prompt);
        s.save(s.sessionId);
      },
    );

    await ctx.stage(
      { name: "summarize", description: "Summarize the previous session's output" },
      {}, {},
      async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(
          `Read ${research.path} and summarize it in 2-3 bullet points.`,
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

</details>

<details>
<summary>Example: Parallel workflow (describe -> [summarize-a, summarize-b] -> merge)</summary>

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "parallel-demo",
  description: "describe -> [summarize-a, summarize-b] -> merge",
})
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";

    const describe = await ctx.stage(
      { name: "describe" }, {}, {},
      async (s) => {
        await s.session.query(prompt);
        s.save(s.sessionId);
      },
    );

    const [summarizeA, summarizeB] = await Promise.all([
      ctx.stage({ name: "summarize-a" }, {}, {}, async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(`Read ${research.path} and summarize in 2-3 bullet points.`);
        s.save(s.sessionId);
      }),
      ctx.stage({ name: "summarize-b" }, {}, {}, async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(`Read ${research.path} and summarize in a single sentence.`);
        s.save(s.sessionId);
      }),
    ]);

    await ctx.stage({ name: "merge" }, {}, {}, async (s) => {
      const bullets = await s.transcript(summarizeA);
      const oneliner = await s.transcript(summarizeB);
      await s.session.query(
        `Combine:\n\n## Bullets\n${bullets.content}\n\n## One-liner\n${oneliner.content}`,
      );
      s.save(s.sessionId);
    });
  })
  .compile();
```

</details>

<details>
<summary>Example: Structured-input workflow (declared schema + CLI flag validation)</summary>

Declare an `inputs` array on `defineWorkflow` and the CLI materialises one `--<field>=<value>` flag per entry. Required fields, enum membership, and unknown-flag rejection are all validated before any tmux session is spawned. The interactive picker (`atomic workflow -a <agent>`) renders the same schema as a form.

```ts
// .atomic/workflows/gen-spec/claude/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "gen-spec",
  description: "Convert a research doc into an execution spec",
  inputs: [
    {
      name: "research_doc",
      type: "string",
      required: true,
      description: "path to the research doc",
      placeholder: "research/docs/2026-04-11-auth.md",
    },
    {
      name: "focus",
      type: "enum",
      required: true,
      description: "how aggressively to scope the spec",
      values: ["minimal", "standard", "exhaustive"],
      default: "standard",
    },
    {
      name: "notes",
      type: "text",
      description: "extra guidance for the spec writer (optional)",
    },
  ],
})
  .run(async (ctx) => {
    // Read each declared field by name.
    const { research_doc, focus } = ctx.inputs;
    const notes = ctx.inputs.notes ?? "";

    await ctx.stage({ name: "write-spec" }, {}, {}, async (s) => {
      await s.session.query(
        `Read ${research_doc} and produce a ${focus} spec.` +
          (notes ? `\n\nExtra guidance:\n${notes}` : ""),
      );
      s.save(s.sessionId);
    });
  })
  .compile();
```

Run it either way:

```bash
# Named + flags (scriptable; CI-friendly)
atomic workflow -n gen-spec -a claude \
  --research_doc=research/docs/2026-04-11-auth.md \
  --focus=standard

# Picker (fuzzy-search the workflow list, then fill the form)
atomic workflow -a claude
```

</details>

<details>
<summary>Example: Background (headless) stages for parallel data gathering</summary>

Stages can run in **headless mode** (`headless: true`) — they execute the provider SDK in-process instead of spawning a tmux window. Headless stages are invisible in the workflow graph but tracked via a background task counter in the statusline. Use them for parallel data-gathering tasks that don't need a visible TUI.

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "headless-demo",
  description: "seed -> [3 headless background] -> merge",
})
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";

    // Visible stage: generate seed data
    const seed = await ctx.stage(
      { name: "seed", description: "Generate overview" },
      {}, {},
      async (s) => {
        const result = await s.session.query(prompt);
        s.save(s.sessionId);
        return String(result.output ?? "");
      },
    );

    // Three parallel headless stages — invisible in graph, tracked by counter
    const [pros, cons, uses] = await Promise.all([
      ctx.stage({ name: "pros", headless: true }, {}, {}, async (s) => {
        const r = await s.session.query(`List 3 pros:\n\n${seed.result}`);
        s.save(s.sessionId);
        return String(r.output ?? "");
      }),
      ctx.stage({ name: "cons", headless: true }, {}, {}, async (s) => {
        const r = await s.session.query(`List 3 cons:\n\n${seed.result}`);
        s.save(s.sessionId);
        return String(r.output ?? "");
      }),
      ctx.stage({ name: "uses", headless: true }, {}, {}, async (s) => {
        const r = await s.session.query(`List 3 use cases:\n\n${seed.result}`);
        s.save(s.sessionId);
        return String(r.output ?? "");
      }),
    ]);

    // Visible stage: merge background results
    await ctx.stage(
      { name: "merge", description: "Combine results" },
      {}, {},
      async (s) => {
        await s.session.query(
          `Combine:\n\n## Pros\n${pros.result}\n\n## Cons\n${cons.result}\n\n## Uses\n${uses.result}`,
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

The graph shows `seed → merge` — headless stages are transparent to the topology. The callback API (`s.client`, `s.session`, `s.save()`, `s.transcript()`, return values) is identical to interactive stages.

</details>

**Key capabilities:**

| Capability                         | Description                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dynamic session spawning**       | Call `ctx.stage()` to spawn sessions at runtime — each gets its own tmux window and graph node                                                                                   |
| **Native TypeScript control flow** | Use `for`, `if/else`, `Promise.all()`, `try/catch` — no framework DSL needed                                                                                                     |
| **Session return values**          | Session callbacks can return data: `const h = await ctx.stage(...); h.result`                                                                                                    |
| **Transcript passing**             | Access prior session output via handle (`s.transcript(handle)`) or name (`s.transcript("name")`)                                                                                 |
| **Declared input schemas**         | Add an `inputs: [...]` array to `defineWorkflow()` and the CLI materialises `--<field>=<value>` flags with built-in validation (required fields, enum membership, unknown flags) |
| **Interactive picker**             | `atomic workflow -a <agent>` launches a fuzzy-searchable picker that renders each workflow's input schema as a form — no flag-memorisation required                              |
| **Nested sub-sessions**            | Call `s.stage()` inside a session callback to spawn child sessions — visible as nested nodes in the graph                                                                        |
| **Auto-inferred graph**            | Graph topology auto-inferred from `await`/`Promise.all` patterns — no annotations needed                                                                                         |
| **Provider-agnostic**              | Write raw SDK code for Claude, Copilot, or OpenCode inside each session callback                                                                                                 |
| **Live graph visualization**       | Sessions appear in the TUI graph as they're spawned — loops and conditionals are visible in real time                                                                            |
| **Background (headless) stages**   | Set `headless: true` on `ctx.stage()` to run stages in-process without a tmux window — invisible in graph, tracked by statusline counter, identical callback API                 |

**Deterministic execution guarantees:**

Workflows are deterministic by design — the same definition always produces the same execution order with the same data flow, regardless of when or where you run it.

- **Strict step ordering** — Steps execute sequentially. Step 2 never starts until Step 1 finishes. Parallel sessions within a step all complete (or fail fast) before the next step begins.
- **Frozen definitions** — `.compile()` freezes the workflow structure. Once compiled, the step order, session names, and execution graph are immutable.
- **Controlled transcript access** — Sessions can only read transcripts from *completed* upstream sessions. Parallel siblings are blocked from reading each other, eliminating race conditions on shared state.
- **Isolated context windows** — Each session runs in its own tmux pane with a fresh context window. No session inherits stale state from another — data flows only through explicit `ctx.transcript()` and `ctx.getMessages()` calls.
- **Persisted artifacts** — Every session writes its messages, transcript, and metadata to disk. The workflow produces a complete, inspectable execution record you can replay or debug after the fact.

This means you can run the same workflow on different machines, different agents, or at different times and get structurally identical execution — same steps, same data flow, same ordering. The only variance comes from the LLM's responses, not from the harness.

Set up a project (`bun init && bun add @bastani/atomic`), drop a `.ts` file in `.atomic/workflows/<name>/<agent>/index.ts`, and run it. You can also ask Atomic to create workflows for you:

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

| Property                                       | Type                        | Description                                                                                                                                                                             |
| ---------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.inputs`                                   | `Record<string, string>`    | Structured inputs for this run. Free-form workflows store their positional prompt under `ctx.inputs.prompt`; workflows with a declared `inputs` schema store one key per declared field |
| `ctx.agent`                                    | `AgentType`                 | Which agent is running (`"claude"`, `"copilot"`, `"opencode"`)                                                                                                                          |
| `ctx.stage(opts, clientOpts, sessionOpts, fn)` | `Promise<SessionHandle<T>>` | Spawn a session — returns handle with `name`, `id`, `result`                                                                                                                            |
| `ctx.transcript(ref)`                          | `Promise<Transcript>`       | Get a completed session's transcript (`{ path, content }`)                                                                                                                              |
| `ctx.getMessages(ref)`                         | `Promise<SavedMessage[]>`   | Get a completed session's raw native messages                                                                                                                                           |

#### SessionContext (`s`) — inside each session callback

| Property                                     | Type                        | Description                                                                                                                              |
| -------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `s.client`                                   | `ProviderClient<A>`         | Pre-created SDK client (auto-managed by runtime)                                                                                         |
| `s.session`                                  | `ProviderSession<A>`        | Pre-created provider session (auto-managed by runtime)                                                                                   |
| `s.inputs`                                   | `Record<string, string>`    | Same inputs record as `ctx.inputs`, forwarded into every stage so session callbacks can read values without closing over the outer `ctx` |
| `s.agent`                                    | `AgentType`                 | Which agent is running                                                                                                                   |
| `s.paneId`                                   | `string`                    | tmux pane ID for this session                                                                                                            |
| `s.sessionId`                                | `string`                    | Session UUID                                                                                                                             |
| `s.sessionDir`                               | `string`                    | Path to this session's storage directory on disk                                                                                         |
| `s.save(messages)`                           | `SaveTranscript`            | Save this session's output for subsequent sessions                                                                                       |
| `s.transcript(ref)`                          | `Promise<Transcript>`       | Get a completed session's transcript                                                                                                     |
| `s.getMessages(ref)`                         | `Promise<SavedMessage[]>`   | Get a completed session's raw native messages                                                                                            |
| `s.stage(opts, clientOpts, sessionOpts, fn)` | `Promise<SessionHandle<T>>` | Spawn a nested sub-session (child in the graph)                                                                                          |

#### Session Options (`SessionRunOptions`)

| Property      | Type       | Description                                                                                           |
| ------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `name`        | `string`   | Unique session name within the workflow run                                                           |
| `description` | `string?`  | Human-readable description shown in the graph                                                         |
| `headless`    | `boolean?` | When `true`, run in-process without a tmux window — invisible in graph, tracked by background counter |

The runtime auto-infers parent-child edges from execution order: sequential `await` creates a chain, while `Promise.all` creates parallel fan-out/fan-in — no annotations needed.

#### Saving Transcripts

Each provider saves transcripts differently:

| Provider     | How to Save                                                       |
| ------------ | ----------------------------------------------------------------- |
| **Claude**   | `s.save(s.sessionId)` — auto-reads via `getSessionMessages()`     |
| **Copilot**  | `s.save(await session.getMessages())` — pass `SessionEvent[]`     |
| **OpenCode** | `s.save(result.data!)` — pass the full `{ info, parts }` response |

#### Per-Agent Session APIs

The runtime auto-creates `s.client` and `s.session` — use them directly inside the callback:

| Agent        | How to send a prompt                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **Claude**   | `await s.session.query(prompt)`                                                                       |
| **Copilot**  | `await s.session.send({ prompt })`                                                                    |
| **OpenCode** | `await s.client.session.prompt({ sessionID: s.session.id, parts: [{ type: "text", text: prompt }] })` |

#### Key Rules

1. Every workflow file must use `export default` with `.run()` and `.compile()`
2. Session names must be unique within a workflow run
3. `transcript()` / `getMessages()` only access completed sessions (callback returned + saves flushed)
4. Each session runs in its own tmux window with the chosen agent
5. Workflows are organized per-workflow: `.atomic/workflows/<name>/<agent>/index.ts`
6. Set up your workflow project with `bun init && bun add @bastani/atomic` — standard module resolution handles imports
7. Background (headless) stages use the same callback API — `s.client`, `s.session`, `s.save()`, return values all work identically

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

Atomic dispatches **purpose-built sub-agents**, each with scoped context, tools, and termination conditions:

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

- **Session graph** — Nodes for each `.stage()` call with status (pending, running, completed, failed) and edges for sequential / parallel dependencies
- **Task list tracking** — Ralph's decomposed task list with dependency arrows, updated in real time as workers complete tasks
- **Pane previews** — Thumbnail of each tmux pane so you can see what every agent is doing without switching contexts
- **Transcript passing visibility** — Highlights `s.save()` / `s.transcript()` handoffs as they happen between sessions

During `atomic chat`, there is no Atomic-owned TUI — `atomic chat -a <agent>` spawns the native agent CLI inside a tmux/psmux session, so all chat features (streaming, `@` mentions, `/slash-commands`, model selection, theme switching, keyboard shortcuts) come from the agent CLI itself. Atomic's role in chat mode is to handle config sync, tmux session management, and argument passthrough.

| Context                                | Who provides the UI                                         |
| -------------------------------------- | ----------------------------------------------------------- |
| `atomic workflow -n <name> -a <agent>` | Atomic (orchestrator panel + tmux session graph)            |
| `atomic chat -a <agent>`               | The native agent CLI (Claude Code / OpenCode / Copilot CLI) |

---

## Commands Reference

### CLI Commands

| Command                         | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `atomic init`                   | Interactive project setup (agent selection, SCM choice, config sync)  |
| `atomic chat`                   | Spawn the native agent CLI inside a tmux/psmux session                |
| `atomic workflow`               | Run a multi-session agent workflow with the Atomic orchestrator panel |
| `atomic workflow list`          | List available workflows, grouped by source                           |
| `atomic session list`           | List all running sessions on the atomic tmux socket                   |
| `atomic session connect [name]` | Attach to a session (interactive picker when no name given)           |
| `atomic completions <shell>`    | Output shell completion script (bash, zsh, fish, powershell)          |
| `atomic config set <k> <v>`     | Set configuration values (currently supports `telemetry`)             |

#### Global Flags

These flags are available on all commands:

| Flag            | Description                                |
| --------------- | ------------------------------------------ |
| `-y, --yes`     | Auto-confirm all prompts (non-interactive) |
| `--no-banner`   | Skip ASCII banner display                  |
| `-v, --version` | Show version number                        |

#### `atomic init` Flags

| Flag                 | Description                                       |
| -------------------- | ------------------------------------------------- |
| `-a, --agent <name>` | Pre-select agent: `claude`, `opencode`, `copilot` |
| `-s, --scm <name>`   | Pre-select SCM: `github`, `sapling`               |

```bash
atomic init                              # Interactive setup
atomic init -a claude -s github          # Pre-select agent and SCM
atomic init --yes                        # Auto-confirm all prompts
```

#### `atomic session` Subcommands

The `session` command is available at three levels — scoped or global:

| Command                                  | Description                                           |
| ---------------------------------------- | ----------------------------------------------------- |
| `atomic session list`                    | List all running sessions                             |
| `atomic session connect [name]`          | Attach to a session (interactive picker when no name) |
| `atomic chat session list`               | List running chat sessions only                       |
| `atomic chat session connect [name]`     | Attach to a chat session                              |
| `atomic workflow session list`           | List running workflow sessions only                   |
| `atomic workflow session connect [name]` | Attach to a workflow session                          |

Both `list` and `connect` accept `-a <agent>` (repeatable) to filter by agent backend.

```bash
atomic session list                      # All sessions
atomic session list -a claude            # Only Claude sessions
atomic session connect my-session        # Attach by name
atomic session connect                   # Interactive picker
atomic chat session list -a copilot      # Chat sessions for Copilot only
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

| Flag                 | Description                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `-n, --name <name>`  | Workflow name (matches directory under `.atomic/workflows/<name>/`)                               |
| `-a, --agent <name>` | Agent: `claude`, `opencode`, `copilot`                                                            |
| `--<field>=<value>`  | Structured input for workflows that declare an `inputs` schema (also accepts `--<field> <value>`) |
| `[prompt...]`        | Positional prompt for free-form workflows (rejected on workflows with a declared schema)          |

The workflow command supports four invocation shapes:

```bash
# 1. List every workflow available to you, grouped by source
atomic workflow list
atomic workflow list -a claude       # filter by agent

# 2. Launch the interactive picker for an agent (no -n) — fuzzy-search
#    the list, fill the form rendered from the workflow's declared inputs,
#    and confirm with y/n
atomic workflow -a claude

# 3. Run a free-form workflow with a positional prompt
atomic workflow -n ralph -a claude "build a REST API for user management"

# 4. Run a structured-input workflow with one --<field> flag per declared input
atomic workflow -n gen-spec -a claude \
  --research_doc=research/docs/2026-04-11-auth.md \
  --focus=standard
```

Workflows that declare an `inputs: WorkflowInput[]` schema get CLI flag validation for free — missing required fields and invalid enum values are rejected before any tmux session is spawned, with error messages that spell out the expected flag set. Workflows that don't declare a schema still accept a single positional prompt, which the runtime stores under `ctx.inputs.prompt`. **Builtin workflows (like `ralph`) are reserved names** — a local or global workflow with the same name will not shadow a builtin at resolution time.

#### `atomic completions` — Shell Completions

Atomic ships tab-completion for **bash**, **zsh**, **fish**, and **PowerShell**. The `atomic completions <shell>` command prints the completion script to stdout — pipe it into your shell's config to enable.

| Shell      | One-liner (add to your rc file)                                           |
| ---------- | ------------------------------------------------------------------------- |
| Bash       | `eval "$(atomic completions bash)"`  — add to `~/.bashrc`                 |
| Zsh        | `eval "$(atomic completions zsh)"`  — add to `~/.zshrc`                   |
| Fish       | `atomic completions fish > ~/.config/fish/completions/atomic.fish`        |
| PowerShell | `atomic completions powershell \| Invoke-Expression`  — add to `$PROFILE` |

> **Tip:** The bootstrap installer (`install.sh` / `install.ps1`) automatically installs completions for your detected shell.

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

| Field          | Type   | Description                                                                                               |
| -------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `$schema`      | string | JSON Schema URL for editor autocomplete                                                                   |
| `version`      | number | Config schema version (currently `1`)                                                                     |
| `scm`          | string | Source control: `github` or `sapling`                                                                     |
| `lastUpdated`  | string | ISO 8601 timestamp of the last update                                                                     |
| `trustedPaths` | array  | Workspaces that have completed provider onboarding via `atomic init`; atomic skips re-prompting for these |

> **Note:** Model selection and reasoning effort are managed by each underlying agent CLI (e.g. Claude Code's `/model`), not by Atomic itself. Atomic's chat command spawns the agent's native TUI — use the agent's own controls to pick a model or adjust reasoning effort.

### Agent-Specific Files

| Agent          | Folder       | Skills                                          | Context File |
| -------------- | ------------ | ----------------------------------------------- | ------------ |
| Claude Code    | `.claude/`   | `.claude/skills/` (symlink → `.agents/skills/`) | `CLAUDE.md`  |
| OpenCode       | `.opencode/` | `.agents/skills/`                               | `AGENTS.md`  |
| GitHub Copilot | `.github/`   | `.agents/skills/`                               | `AGENTS.md`  |

> **Note:** All three agents share the same skill set via `.agents/skills/`. Claude Code accesses them through a `.claude/skills/` symlink that points to `.agents/skills/`, so a single skill directory serves all agents.

---

## Installation Options

### Bun (recommended)

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

| Feature              | Reference                            | Agent                                                |
| -------------------- | ------------------------------------ | ---------------------------------------------------- |
| Atomic + Claude Code | `ghcr.io/flora131/atomic/claude:1`   | [Claude Code](https://claude.ai)                     |
| Atomic + OpenCode    | `ghcr.io/flora131/atomic/opencode:1` | [OpenCode](https://opencode.ai)                      |
| Atomic + Copilot CLI | `ghcr.io/flora131/atomic/copilot:1`  | [Copilot CLI](https://github.com/github/copilot-cli) |

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

<details>
<summary>Sub-agent tree stuck on "Initializing..."</summary>

1. Update to the latest release (`bun install -g @bastani/atomic`) and retry
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

| Aspect                   | Spec-Kit                                     | Atomic                                                                                              |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Focus**                | Greenfield projects with spec-first workflow | Large existing codebases + greenfield — research-first or spec-first                                |
| **First Step**           | Define project principles and specs          | Analyze existing architecture with parallel research sub-agents                                     |
| **Workflow Definition**  | Shell scripts and markdown templates         | TypeScript Workflow SDK (`defineWorkflow()` → `.run()` → `.compile()`) with deterministic execution |
| **Session Management**   | Single agent session                         | Multi-session pipelines — sequential and parallel — each in isolated context windows                |
| **Data Flow**            | Manual — copy output between steps           | Controlled transcript passing via `ctx.transcript()` and `ctx.getMessages()`                        |
| **Agent Support**        | GitHub Copilot CLI                           | Claude Code + OpenCode + Copilot CLI — switch with a flag                                           |
| **Sub-Agents**           | Single general-purpose agent                 | 12 specialized sub-agents with scoped tools and isolated contexts                                   |
| **Skills**               | Not available                                | 58 built-in skills (development, design, docs, agent architecture)                                  |
| **Autonomous Execution** | Not available                                | Ralph — multi-hour autonomous sessions with plan/implement/review/debug loop                        |
| **Execution Guarantees** | Non-deterministic                            | Deterministic — strict step ordering, frozen definitions, controlled transcript access              |
| **Isolation**            | Not addressed                                | Devcontainer features for containerized execution                                                   |

</details>

<details>
<summary>How does Atomic differ from DeerFlow?</summary>

[DeerFlow](https://github.com/bytedance/deer-flow) is ByteDance's agent harness built on LangGraph/LangChain. Both are multi-agent orchestrators, but take different approaches:

**In short:** DeerFlow is a general-purpose agent orchestrator — it handles research, report generation, and other tasks through a LangGraph DAG with a web UI. Atomic is narrowly focused on coding workflows. The key difference is that Atomic runs on top of production coding agents (Claude Code, OpenCode, Copilot CLI) rather than reimplementing coding tools through a generic API. You get each agent's native file editing, permissions, MCP integrations, and hooks out of the box. Atomic also gives you deterministic execution — same step order, same data flow every run — which matters when you're encoding a team's dev process and need it to be reproducible across people and CI. If you need a general-purpose agent pipeline with a web UI, DeerFlow is the better fit. If you need coding-specific workflows with strict execution guarantees, Atomic is more appropriate.

| Aspect                  | DeerFlow                                        | Atomic                                                                                        |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Runtime**             | Python (LangGraph)                              | TypeScript (Bun)                                                                              |
| **Agent SDKs**          | OpenAI-compatible API                           | Claude Code + OpenCode + Copilot CLI native SDKs — write raw SDK code in each session         |
| **Focus**               | General-purpose agent tasks (research, reports) | Coding-specific: research, spec, implement, review, debug                                     |
| **Workflow Definition** | LangGraph state machines with graph nodes       | TypeScript Workflow SDK — `defineWorkflow()` → `.run()` → `.compile()`                        |
| **Execution Model**     | DAG-based with conditional edges                | Deterministic — strict step ordering, frozen definitions, controlled transcript passing       |
| **Parallelism**         | Via LangGraph branch nodes                      | Native parallel sessions via `Promise.all()` with `ctx.session()` in isolated context windows |
| **Sub-Agents**          | Researcher, coder, reporter nodes               | 12 specialized sub-agents with scoped tools (planner, worker, reviewer, debugger, etc.)       |
| **Skills**              | Not available                                   | 58 built-in skills auto-invoked by context                                                    |
| **Isolation**           | Sandbox containers                              | Devcontainer features + git worktrees                                                         |
| **Interface**           | Web UI (Streamlit)                              | Terminal chat with tmux-based session management                                              |
| **Autonomous**          | Not available                                   | Ralph — bounded iteration with plan/implement/review/debug loop                               |
| **Distribution**        | `pip install` + local server                    | `bun install -g` or devcontainer features                                                     |

</details>

<details>
<summary>How does Atomic differ from Hermes Agent?</summary>

[Hermes Agent](https://github.com/NousResearch/hermes-agent) is Nous Research's general-purpose AI agent with a self-improving learning loop. Both are open-source agent frameworks, but serve different use cases:

**In short:** Hermes Agent is a broad AI assistant that learns and improves across sessions, connects to messaging platforms, and works with any OpenAI-compatible model. Atomic is a coding-specific harness built for engineering teams. It lets you encode your development process as deterministic TypeScript workflows that run identically across team members, machines, and CI pipelines. Instead of reimplementing coding tools from scratch, Atomic inherits production-hardened tool ecosystems from Claude Code, OpenCode, and Copilot CLI — including their permission systems, MCP integrations, and hooks — giving you two independent security boundaries (devcontainer isolation + agent permissions) rather than one. Each workflow session runs in a fresh context window with only distilled transcripts passed forward, so output stays sharp over multi-hour coding tasks instead of degrading through lossy compression. And because skills are developer-authored and version-controlled, they don't drift or accumulate errors the way auto-generated skills can. Choose Hermes if you want a self-improving general-purpose agent with multi-platform messaging; choose Atomic if you want repeatable, auditable coding workflows with strict execution guarantees and production-grade isolation.

| Aspect                    | Hermes Agent                                                                                 | Atomic                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Focus**                 | General-purpose AI assistant (coding, messaging, smart home, research)                       | Coding-specific: multi-session workflows on coding agents                                                                                    |
| **Runtime**               | Python 3.11+ (uv)                                                                            | TypeScript (Bun)                                                                                                                             |
| **Agent SDKs**            | OpenAI-compatible API as universal adapter (200+ models via OpenRouter)                      | Claude Code + OpenCode + Copilot CLI native SDKs — write raw SDK code in each session                                                        |
| **Workflow Definition**   | Cron scheduler + subagent delegation                                                         | TypeScript Workflow SDK — `defineWorkflow()` → `.run()` → `.compile()`                                                                       |
| **Session Management**    | Single conversation loop with context compression                                            | Multi-session pipelines — sequential and parallel — each in isolated context windows                                                         |
| **Data Flow**             | In-context within a single conversation                                                      | Controlled transcript passing via `ctx.transcript()` and `ctx.getMessages()`                                                                 |
| **Self-Improvement**      | Closed learning loop — auto-creates skills from experience, persistent user model via Honcho | Skills authored by developers; memory via CLAUDE.md / AGENTS.md context files                                                                |
| **Sub-Agents**            | `delegate_task` spawns isolated subagents                                                    | 12 specialized sub-agents with scoped tools and model tiers (Opus, Sonnet, Haiku)                                                            |
| **Skills**                | 40+ tools + community Skills Hub (agentskills.io)                                            | 58 built-in skills (development, design, docs, agent architecture)                                                                           |
| **Interface**             | Terminal TUI + multi-platform messaging gateway (Telegram, Discord, Slack, WhatsApp, etc.)   | Terminal chat with tmux-based session management                                                                                             |
| **Isolation**             | Six terminal backends (local, Docker, SSH, Daytona, Singularity, Modal)                      | Devcontainer features + git worktrees                                                                                                        |
| **Autonomous Execution**  | Cron scheduler with inactivity-based timeouts                                                | Ralph — bounded iteration with plan/implement/review/debug loop                                                                              |
| **Execution Guarantees**  | Non-deterministic conversation loop                                                          | Deterministic — strict step ordering, frozen definitions, controlled transcript access                                                       |
| **Team Process Encoding** | Personal assistant — no concept of team-shared workflows                                     | Encode your team's dev process as TypeScript — repeatable across members, projects, and CI                                                   |
| **Coding Agent Tooling**  | Reimplements file/terminal tools from scratch via `model_tools.py`                           | Inherits production-hardened tool ecosystems from Claude Code, OpenCode, and Copilot CLI (file editing, permissions, MCP, hooks)             |
| **Reproducibility**       | Conversation loop produces different execution paths each run                                | Frozen workflow definitions run identically across machines, team members, and CI pipelines                                                  |
| **Context Quality**       | Lossy compression within a single conversation — degrades on long coding tasks               | Fresh context window per session with only distilled transcripts passed forward — stays sharp over multi-hour tasks                          |
| **Skill Authoring**       | Auto-created skills may drift, accumulate errors, or encode bad patterns over time           | Developer-authored, version-controlled skills — intentional and auditable                                                                    |
| **Security Model**        | Command approval + container backends (single boundary)                                      | Devcontainer isolation + coding agent permission systems (Claude Code permissions, Copilot safeguards) — two independent security boundaries |
| **Distribution**          | `uv` / `pip`                                                                                 | `bun install -g` or devcontainer features                                                                                                    |

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
