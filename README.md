# Atomic

<p align="center">
  <img src="assets/atomic.png" alt="Atomic" width="800">
</p>

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/flora131/atomic)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](./package.json)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun&logoColor=black)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**An open-source TypeScript SDK for building harnesses around your coding agent** — Claude Code, OpenCode, or GitHub Copilot CLI. Chain agent sessions into deterministic pipelines, add human-in-the-loop approval gates, dispatch **12 specialized sub-agents**, and tap **55 built-in skills** — then ship it as TypeScript your whole team runs.

> Define how your agent works. Start for yourself, scale to your team.

---

## Quick Start

Install, generate context, try Ralph, then write your own workflow — four steps, a few minutes.

### Prerequisites

- **At least one coding agent** installed and logged in:
  - [Claude Code](https://code.claude.com/docs/en/quickstart) — run `claude` and authenticate
  - [OpenCode](https://opencode.ai) — run `opencode` and authenticate
  - [GitHub Copilot CLI](https://github.com/features/copilot/cli) — run `copilot` and authenticate
- **Windows:** PowerShell 7+ ([install guide](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows))

### 1. Install

The bootstrap script installs [Bun](https://bun.sh/), Atomic, and shell completions in one step:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash

# Windows (PowerShell 7+)
irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

Upgrade later with `bun update -g @bastani/atomic`.

<details>
<summary><b>Alternative: Already have Bun? Install directly from npm</b></summary>

```bash
bun install -g @bastani/atomic
```

This skips the Bun install step but doesn't set up shell completions — run `atomic completions <shell>` separately if you want them (see [Commands Reference](#atomic-completions--shell-completions)).

**Prerelease builds:** `bun install -g @bastani/atomic@next` (may contain breaking changes).

</details>

<details>
<summary><b>Authenticated downloads (CI / enterprise)</b></summary>

Set `GITHUB_TOKEN` to avoid GitHub API rate limits when running the bootstrap script in CI:

```bash
# macOS / Linux
GITHUB_TOKEN=ghp_... curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash

# Windows PowerShell
$env:GITHUB_TOKEN='ghp_...'; irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

</details>

<details>
<summary><b>Alternative: Devcontainer (recommended for autonomous workflows)</b></summary>

> Devcontainers isolate the agent from your host, limiting the blast radius of destructive actions. This is the safest way to run workflows.

Add one feature to `.devcontainer/devcontainer.json`:

| Feature                              | Agent                |
| ------------------------------------ | -------------------- |
| `ghcr.io/flora131/atomic/claude:1`   | Atomic + Claude Code |
| `ghcr.io/flora131/atomic/opencode:1` | Atomic + OpenCode    |
| `ghcr.io/flora131/atomic/copilot:1`  | Atomic + Copilot CLI |

Full `.devcontainer.json` templates per agent live in [`.devcontainer/`](./.devcontainer/). Each feature installs Atomic, bun, playwright-cli, agent configs, and the agent CLI itself. First run takes ~1 minute to warm up.

Minimal example (Claude + Rust):

```jsonc
{
  "image": "mcr.microsoft.com/devcontainers/rust:latest",
  "features": {
    "ghcr.io/devcontainers/features/common-utils": {},
    "ghcr.io/flora131/atomic/claude:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  }
}
```

Use the [Dev Containers VS Code extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) or the [Dev Container CLI](https://github.com/devcontainers/cli#dev-container-cli) to start the container.

</details>

<details>
<summary><b>Migrating from the old standalone binary?</b></summary>

Atomic used to ship as a standalone binary. It's now an npm package. One-time migration:

```bash
atomic uninstall
bun uninstall -g @bastani/atomic-workflows
rm -rf ~/.atomic ~/.copilot/skills ~/.opencode/skills
bun install -g @bastani/atomic
```

</details>

### 2. Generate context files

```bash
atomic chat -a <claude|opencode|copilot>
```

Then type `/init`. Atomic explores your codebase with sub-agents and writes `CLAUDE.md` / `AGENTS.md` so every future session starts with the right context.

### 3. Try Ralph (autonomous coding)

Ralph plans, implements, reviews, and debugs a task on its own — up to 10 iterations, exiting after 2 consecutive clean reviews.

```bash
atomic workflow -n ralph -a claude "Build a REST API for user management"
```

> ⚠️ Workflows run with agent permission checks **disabled** so pipelines don't block on prompts. Run them in a [devcontainer](#containerized-execution) or [git worktree](https://git-scm.com/docs/git-worktree), not on your host. See [Security](#security-workflow-permissions-model).

### 4. Build your own workflow

Every team has a process — code review, CI checks, PR creation, approval, merge. Encode it as TypeScript once; everyone runs the same pipeline.

```bash
bun init && bun add @bastani/atomic
mkdir -p .atomic/workflows/review-to-merge/claude
```

Create `.atomic/workflows/review-to-merge/claude/index.ts`:

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "review-to-merge",
  description: "Review → CI → PR → Notify → Approve → Merge",
}).for<"claude">()
  .run(async (ctx) => {
    // 1. Review
    const review = await ctx.stage({ name: "review" }, {}, {}, async (s) => {
      await s.session.query("Review uncommitted changes for correctness, security, style.");
      s.save(s.sessionId);
    });

    // 2. Run security + CI in parallel
    await Promise.all([
      ctx.stage({ name: "security-scan" }, {}, {}, async (s) => {
        await s.session.query("Run `bun audit` and scan for leaked secrets.");
        s.save(s.sessionId);
      }),
      ctx.stage({ name: "ci-checks" }, {}, {}, async (s) => {
        await s.session.query("Run `bun lint` and `bun test`. Report failures.");
        s.save(s.sessionId);
      }),
    ]);

    // 3. Open PR, then notify Slack + wait for human approval
    await ctx.stage({ name: "notify-and-merge" }, {}, {}, async (s) => {
      const t = await s.transcript(review);
      await s.session.query(`Read ${t.path}. Open a PR summarizing the changes.`);

      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` },
        body: JSON.stringify({ channel: "#code-review", text: "PR ready — please approve." }),
      });

      // Human-in-the-loop: pauses until the user responds
      await s.session.query(
        "Ask the user to confirm approval, then merge with `gh pr merge --squash`.",
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

Swap `-a claude` for `-a opencode` or `-a copilot` — same harness, different agent. See [Workflow SDK](#workflow-sdk--build-your-own-deterministic-harness) for parallel stages, input schemas, headless stages, and the full API reference.

### Managing sessions

Every chat and workflow runs inside an isolated [tmux](https://github.com/tmux/tmux) session on a dedicated socket (your personal tmux is untouched). If your terminal disconnects, your session keeps running — reconnect anytime.

```bash
atomic session list              # all sessions
atomic session connect           # interactive fuzzy picker
atomic session connect <name>    # by name
atomic session kill <name>       # kill one (or all, with confirmation)
```

Session names follow `atomic-chat-<id>` or `atomic-wf-<workflow>-<id>`. Scope with `atomic chat session …` or `atomic workflow session …`.

---

## Why Atomic

Better models make harnesses **more** important, not less. The more you trust an agent to execute complex tasks, the more value you get from defining exactly **what** it should execute, in **what order**, with **what checks** along the way. The harness is the durable layer — models keep improving underneath it, but your process stays the same.

- **Start for yourself.** Automate the repetitive parts of your own workflow — research a codebase, add monitoring, generate specs. One TypeScript file, one afternoon.
- **Scale to your team.** Encode your team's review process, deployment gates, and quality checks as TypeScript every member runs identically — versioned, testable, reproducible.
- **Work across agents.** Write a harness once, run it on Claude Code, OpenCode, or Copilot CLI with a flag change.

### Example use cases

**Add production monitoring.** Research observability gaps, implement missing metrics and health checks, review the changes.

```bash
atomic workflow -n add-monitoring -a claude "add Prometheus metrics and health checks to all API endpoints"
```

**Parallel UX testing with 50 personas.** Spin up 50 agents, each with a distinct persona (power user, accessibility-dependent, non-technical stakeholder), each using [Playwright](#built-in-skills) to test your app.

```bash
atomic workflow -n ux-personas -a claude
```

**Review-to-merge pipeline.** The workflow from [step 4](#4-build-your-own-workflow) above — reviews code, runs CI in parallel, opens a PR, notifies Slack, waits for approval, merges.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Why Atomic](#why-atomic)
- [Security: Workflow Permissions Model](#security-workflow-permissions-model)
- [Core Features](#core-features)
  - [Multi-Agent Support](#multi-agent-support)
  - [Workflow SDK](#workflow-sdk--build-your-own-deterministic-harness)
  - [Research Codebase](#research-codebase)
  - [Autonomous Execution (Ralph)](#autonomous-execution-ralph)
  - [Deep Research Codebase](#deep-research-codebase)
  - [Containerized Execution](#containerized-execution)
  - [Specialized Sub-Agents](#specialized-sub-agents)
  - [Built-in Skills](#built-in-skills)
  - [Workflow Orchestrator Panel](#workflow-orchestrator-panel)
- [Commands Reference](#commands-reference)
- [Configuration](#configuration)
- [Updating & Uninstalling](#updating--uninstalling)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

---

## Security: Workflow Permissions Model

> [!CAUTION]
> **Atomic workflows run coding agents with all permission checks disabled.** The agent can read, write, and delete files, execute arbitrary shell commands, and make network requests without prompting. This is required for unattended pipelines. **Run workflows in a [devcontainer](#containerized-execution), not on your host machine.**

| Agent                  | How permissions are bypassed                                         | Key flags / settings                                                  |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Claude Code**        | CLI flag disables the interactive permission prompt entirely         | `--dangerously-skip-permissions`                                      |
| **GitHub Copilot CLI** | CLI flag enables auto-execution; SDK auto-approves all tool requests | `--yolo`, `COPILOT_ALLOW_ALL=true`, `onPermissionRequest: approveAll` |
| **OpenCode**           | Permissions handled programmatically through the event stream        | Permission requests auto-replied via SSE events                       |

Defaults live in `src/services/config/definitions.ts` and `src/sdk/runtime/executor.ts`. Override per-project via `ProviderOverrides` in `.atomic/settings.json` — `chatFlags` replaces defaults entirely; `envVars` are merged.

---

## Core Features

### Multi-Agent Support

Atomic works across **three production coding agents** — switch with a flag and your workflows, skills, and sub-agents carry over.

| Agent              | Command                   |
| ------------------ | ------------------------- |
| Claude Code        | `atomic chat -a claude`   |
| OpenCode           | `atomic chat -a opencode` |
| GitHub Copilot CLI | `atomic chat -a copilot`  |

Each agent gets its own configuration directory (`.claude/`, `.opencode/`, `.github/`), skills, and context files — all managed by Atomic.

### Workflow SDK — Build Your Own Deterministic Harness

The Workflow SDK (`@bastani/atomic/workflows`) lets you encode your team's process as TypeScript — spawn agent sessions dynamically with native control flow (`for`, `if`, `Promise.all()`), and watch them appear in a live graph as they execute.

Set up a workflow project (`bun init && bun add @bastani/atomic`), create `.atomic/workflows/<name>/<agent>/index.ts`, and run it:

```bash
atomic workflow -n my-workflow -a claude "describe this project"
```

See [step 4 of Quick Start](#4-build-your-own-workflow) for a complete review-to-merge example. More examples and the full API reference below.

<details>
<summary><b>Example: Sequential workflow (describe → summarize)</b></summary>

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "my-workflow",
  description: "Two-session pipeline: describe -> summarize",
  inputs: [{ name: "prompt", type: "text", required: true, description: "task prompt" }],
}).for<"claude">()
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
        await s.session.query(`Read ${research.path} and summarize in 2-3 bullets.`);
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

</details>

<details>
<summary><b>Example: Parallel workflow (describe → [summarize-a, summarize-b] → merge)</b></summary>

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "parallel-demo",
  description: "describe -> [summarize-a, summarize-b] -> merge",
  inputs: [{ name: "prompt", type: "text", required: true, description: "task prompt" }],
}).for<"claude">()
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";

    const describe = await ctx.stage({ name: "describe" }, {}, {}, async (s) => {
      await s.session.query(prompt);
      s.save(s.sessionId);
    });

    const [summarizeA, summarizeB] = await Promise.all([
      ctx.stage({ name: "summarize-a" }, {}, {}, async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(`Read ${research.path} and summarize in 2-3 bullets.`);
        s.save(s.sessionId);
      }),
      ctx.stage({ name: "summarize-b" }, {}, {}, async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(`Read ${research.path} and summarize in one sentence.`);
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
<summary><b>Example: Structured-input workflow (declared schema + CLI flag validation)</b></summary>

Declare `inputs` on `defineWorkflow` and the CLI materialises one `--<field>=<value>` flag per entry. Required fields, enum membership, and unknown-flag rejection are validated before any tmux session spawns. The interactive picker renders the same schema as a form.

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
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
}).for<"claude">()
  .run(async (ctx) => {
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

Run it:

```bash
# Named + flags (scriptable; CI-friendly)
atomic workflow -n gen-spec -a claude \
  --research_doc=research/docs/2026-04-11-auth.md \
  --focus=standard

# Picker (fuzzy-search workflows, fill the form)
atomic workflow -a claude
```

</details>

<details>
<summary><b>Example: Headless (background) stages for parallel data gathering</b></summary>

Stages can run headlessly (`headless: true`) — they execute the provider SDK in-process instead of spawning a tmux window. Headless stages are invisible in the graph but tracked via a background counter in the statusline.

```ts
import { defineWorkflow, extractAssistantText } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "headless-demo",
  description: "seed -> [3 headless background] -> merge",
  inputs: [{ name: "prompt", type: "text", required: true, description: "task prompt" }],
}).for<"claude">()
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";

    const seed = await ctx.stage(
      { name: "seed", description: "Generate overview" }, {}, {},
      async (s) => {
        const result = await s.session.query(prompt);
        s.save(s.sessionId);
        return extractAssistantText(result, 0);
      },
    );

    const [pros, cons, uses] = await Promise.all([
      ctx.stage({ name: "pros", headless: true }, {}, {}, async (s) => {
        const r = await s.session.query(`List 3 pros:\n\n${seed.result}`);
        s.save(s.sessionId);
        return extractAssistantText(r, 0);
      }),
      ctx.stage({ name: "cons", headless: true }, {}, {}, async (s) => {
        const r = await s.session.query(`List 3 cons:\n\n${seed.result}`);
        s.save(s.sessionId);
        return extractAssistantText(r, 0);
      }),
      ctx.stage({ name: "uses", headless: true }, {}, {}, async (s) => {
        const r = await s.session.query(`List 3 use cases:\n\n${seed.result}`);
        s.save(s.sessionId);
        return extractAssistantText(r, 0);
      }),
    ]);

    await ctx.stage(
      { name: "merge", description: "Combine results" }, {}, {},
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
| **Dynamic session spawning**       | `ctx.stage()` spawns sessions at runtime — each gets its own tmux window and graph node                                                                                          |
| **Native TypeScript control flow** | Use `for`, `if/else`, `Promise.all()`, `try/catch` — no framework DSL                                                                                                            |
| **Session return values**          | Session callbacks can return data: `const h = await ctx.stage(...); h.result`                                                                                                    |
| **Transcript passing**             | Access prior output via handle (`s.transcript(handle)`) or name (`s.transcript("name")`)                                                                                         |
| **Declared input schemas**         | Add an `inputs: [...]` array and the CLI materialises `--<field>=<value>` flags with built-in validation                                                                         |
| **Interactive picker**             | `atomic workflow -a <agent>` renders input schemas as forms — no flag memorisation                                                                                               |
| **Nested sub-sessions**            | `s.stage()` inside a callback spawns child sessions — visible as nested graph nodes                                                                                              |
| **Auto-inferred graph**            | Topology derived from `await` / `Promise.all` patterns — no annotations                                                                                                          |
| **Provider-agnostic**              | Write raw SDK code for Claude, Copilot, or OpenCode inside each callback                                                                                                         |
| **Live graph visualization**       | Sessions appear in the TUI graph as they spawn — loops and conditionals visible in real time                                                                                     |
| **Background (headless) stages**   | `headless: true` runs in-process without a tmux window — invisible in graph, tracked by statusline counter, identical callback API                                               |

**Deterministic execution guarantees:**

Workflows are deterministic by design — the same definition produces the same execution order with the same data flow, anywhere.

- **Strict step ordering** — Step 2 never starts until Step 1 finishes. Parallel sessions complete (or fail fast) before the next step begins.
- **Frozen definitions** — `.compile()` freezes the workflow. Once compiled, step order, session names, and the execution graph are immutable.
- **Controlled transcript access** — Sessions only read transcripts from *completed* upstream sessions; parallel siblings can't read each other.
- **Isolated context windows** — Each session runs in its own tmux pane with a fresh context. Data flows only through explicit `ctx.transcript()` / `ctx.getMessages()` calls.
- **Persisted artifacts** — Every session writes messages, transcript, and metadata to disk — a complete, inspectable execution record.

Variance comes only from the LLM's responses, not from the harness.

> Ask Atomic to build workflows for you: `Use your workflow-creator skill to create a workflow that plans, implements, and reviews a feature.`

<details>
<summary><b>Full Workflow SDK Reference</b></summary>

#### Builder API

| Method                                  | Purpose                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `defineWorkflow({ name, description })` | Entry point — returns a `WorkflowBuilder`                         |
| `.run(async (ctx) => { ... })`          | Set the workflow's entry point — `ctx` is a `WorkflowContext`     |
| `.compile()`                            | **Required** — terminal method that seals the workflow definition |

#### WorkflowContext (`ctx`) — top-level orchestrator

| Property                                       | Type                        | Description                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.inputs`                                   | `{ [K in N]?: string }`     | Typed inputs for this run — only declared field names are valid keys. Accessing an undeclared field is a compile-time error. Workflows that need a prompt must declare it in their `inputs` schema |
| `ctx.agent`                                    | `AgentType`                 | Which agent is running (`"claude"`, `"copilot"`, `"opencode"`)                                                                                                                                     |
| `ctx.stage(opts, clientOpts, sessionOpts, fn)` | `Promise<SessionHandle<T>>` | Spawn a session — returns handle with `name`, `id`, `result`                                                                                                                                       |
| `ctx.transcript(ref)`                          | `Promise<Transcript>`       | Get a completed session's transcript (`{ path, content }`)                                                                                                                                         |
| `ctx.getMessages(ref)`                         | `Promise<SavedMessage[]>`   | Get a completed session's raw native messages                                                                                                                                                      |

#### SessionContext (`s`) — inside each session callback

| Property                                     | Type                        | Description                                                                                                                             |
| -------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `s.client`                                   | `ProviderClient<A>`         | Pre-created SDK client (auto-managed by runtime)                                                                                        |
| `s.session`                                  | `ProviderSession<A>`        | Pre-created provider session (auto-managed by runtime)                                                                                  |
| `s.inputs`                                   | `{ [K in N]?: string }`     | Same typed inputs as `ctx.inputs`, forwarded into every stage so callbacks can read values without closing over the outer `ctx`         |
| `s.agent`                                    | `AgentType`                 | Which agent is running                                                                                                                  |
| `s.paneId`                                   | `string`                    | tmux pane ID for this session                                                                                                           |
| `s.sessionId`                                | `string`                    | Session UUID                                                                                                                            |
| `s.sessionDir`                               | `string`                    | Path to this session's storage directory on disk                                                                                        |
| `s.save(messages)`                           | `SaveTranscript`            | Save this session's output for subsequent sessions                                                                                      |
| `s.transcript(ref)`                          | `Promise<Transcript>`       | Get a completed session's transcript                                                                                                    |
| `s.getMessages(ref)`                         | `Promise<SavedMessage[]>`   | Get a completed session's raw native messages                                                                                           |
| `s.stage(opts, clientOpts, sessionOpts, fn)` | `Promise<SessionHandle<T>>` | Spawn a nested sub-session (child in the graph)                                                                                         |

#### Session Options (`SessionRunOptions`)

| Property      | Type       | Description                                                                                           |
| ------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `name`        | `string`   | Unique session name within the workflow run                                                           |
| `description` | `string?`  | Human-readable description shown in the graph                                                         |
| `headless`    | `boolean?` | When `true`, run in-process without a tmux window — invisible in graph, tracked by background counter |

The runtime auto-infers parent-child edges from execution order: sequential `await` creates a chain, `Promise.all` creates parallel fan-out/fan-in — no annotations needed.

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

1. Every workflow file must `export default` a builder with `.run()` and `.compile()`
2. Session names must be unique within a workflow run
3. `transcript()` / `getMessages()` only access completed sessions (callback returned + saves flushed)
4. Each session runs in its own tmux window with the chosen agent
5. Workflows are organized as `.atomic/workflows/<name>/<agent>/index.ts`
6. Set up your workflow project with `bun init && bun add @bastani/atomic`
7. Background (headless) stages use the same callback API — `s.client`, `s.session`, `s.save()`, return values all work identically

For the authoring walkthrough ask Atomic to use the `workflow-creator` skill or read `.agents/skills/workflow-creator/`.

> [!TIP]
> When the Workflow SDK is updated, ask the `workflow-creator` skill to migrate your workflows to the latest patterns: _"Update this workflow to use the latest SDK patterns."_

</details>

### Research Codebase

The `/research-codebase` command dispatches **specialized sub-agents in parallel** to analyze your codebase — understand auth flows, trace root causes, query docs, and hit external sources via [DeepWiki MCP](https://deepwiki.com). Get up to speed on a new project in minutes instead of hours.

| Sub-Agent                    | Model  | Purpose                                                                                   |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `codebase-locator`           | Haiku  | Locate files, directories, and components relevant to the research topic                  |
| `codebase-analyzer`          | Sonnet | Analyze implementation details, trace data flow, explain technical workings               |
| `codebase-pattern-finder`    | Haiku  | Find similar implementations, usage examples, and existing patterns to model after        |
| `codebase-online-researcher` | Sonnet | Fetch up-to-date information from the web and repository knowledge from DeepWiki          |
| `codebase-research-locator`  | Haiku  | Discover relevant documents in `research/` and `specs/` directories                       |
| `codebase-research-analyzer` | Sonnet | Extract high-value insights, decisions, and technical details from research documents     |

**Run parallel research sessions** to compare approaches:

```bash
# Terminal 1: LangChain approach
atomic chat -a claude "/research-codebase Research GraphRAG using LangChain's graph retrieval."

# Terminal 2: Microsoft GraphRAG
atomic chat -a claude "/research-codebase Research GraphRAG using microsoft/graphrag."

# Terminal 3: LlamaIndex approach
atomic chat -a claude "/research-codebase Research GraphRAG using LlamaIndex's property graph."
```

Then run `/create-spec` on each output, spin up git worktrees, and run `atomic workflow -n ralph` in each — wake up to three complete implementations on separate branches. Research persists in `research/` and specs in `specs/`, so every investigation compounds into future context.

<details>
<summary><i>Why specialized research agents instead of one general-purpose agent?</i></summary>

A single agent asked to "research the auth system" tries to search, read, analyze, and summarize within one context window. As that window fills with file contents, search results, and intermediate reasoning, synthesis degrades — this is a fundamental constraint of transformer attention, not a prompt-engineering problem.

Atomic dispatches purpose-built sub-agents: a `codebase-locator` only finds relevant files, a `codebase-analyzer` only reads and analyzes implementations, a `codebase-online-researcher` only queries external docs. Each operates in its own context with only the tools it needs; the parent receives distilled findings. The result: faster research, higher-quality findings, less hallucination.

</details>

### Autonomous Execution (Ralph)

<p align="center">
  <img src="assets/ralph-wiggum.jpg" alt="Ralph Wiggum" width="600">
</p>

The [Ralph Method](https://ghuntley.com/ralph/) enables **multi-hour autonomous coding sessions**. Approve your spec, let Ralph work in the background, focus on other things.

**How Ralph works:**

1. **Task Decomposition** — A `planner` sub-agent breaks your spec into a task list with dependency tracking, stored in SQLite (WAL mode for parallel access).
2. **Orchestration** — An `orchestrator` retrieves the task list, validates the dependency graph, and dispatches `worker` sub-agents for ready tasks.
3. **Review & Debug** — A `reviewer` audits the implementation with structured JSON output; if P0–P2 findings exist, a `debugger` investigates root causes and feeds back to the planner on the next iteration.

**Loop config:** Up to **10 iterations**. Exits early after **2 consecutive clean reviews** (zero actionable findings). P3 (minor) findings are non-actionable.

```bash
# From a prompt
atomic workflow -n ralph -a <claude|opencode|copilot> "Build a REST API for user management"

# From a spec file
atomic workflow -n ralph -a claude "specs/YYYY-MM-DD-my-feature.md"
```

**Best practice:** run Ralph in a [git worktree](https://git-scm.com/docs/git-worktree) so autonomous changes stay isolated from your working tree:

```bash
git worktree add ../my-project-ralph feature-branch
cd ../my-project-ralph
atomic workflow -n ralph -a claude "Build the auth module"
```

### Deep Research Codebase

Atomic ships a `deep-research-codebase` workflow that performs **multi-agent parallel research** across your codebase — a full pipeline, not a single-shot command.

1. **Scout** — One agent scans the codebase structure and writes an architectural orientation.
2. **History** — A parallel agent surfaces prior research from `research/docs/`.
3. **Explorers** — Multiple parallel agents (count scaled by LOC) each investigate a partition.
4. **Aggregator** — A final agent synthesizes all explorer reports + history into a dated research doc at `research/docs/YYYY-MM-DD-<slug>.md`.

```bash
atomic workflow -n deep-research-codebase -a claude "How does the authentication system work?"
```

The output is a permanent research artifact that future runs, specs, and workflows can reference.

### Containerized Execution

Atomic ships as **devcontainer features** that bundle the CLI, agent, and all dependencies into isolated containers — the recommended way to run autonomous agents safely.

**Why containerize?**

- Agents run `rm`, `git reset --hard`, and arbitrary shell commands — containers limit blast radius
- Reproducible environments across team members and CI
- Pre-installed dependencies: bun, playwright-cli, agent CLI, GitHub CLI
- Features versioned in sync with Atomic releases

| Feature                              | Installs             |
| ------------------------------------ | -------------------- |
| `ghcr.io/flora131/atomic/claude:1`   | Atomic + Claude Code |
| `ghcr.io/flora131/atomic/opencode:1` | Atomic + OpenCode    |
| `ghcr.io/flora131/atomic/copilot:1`  | Atomic + Copilot CLI |

See [Quick Start → Devcontainer](#1-install) for a working `.devcontainer.json` and the [`.devcontainer/`](./.devcontainer/) directory for per-agent templates.

### Specialized Sub-Agents

Atomic dispatches **purpose-built sub-agents**, each with scoped context, tools, and termination conditions:

| Sub-Agent                    | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `planner`                    | Decompose specs into structured task lists with dependency tracking    |
| `worker`                     | Implement single focused tasks (multiple workers run in parallel)      |
| `reviewer`                   | Audit implementations against specs and best practices                 |
| `code-simplifier`            | Simplify and refine code for clarity, consistency, maintainability     |
| `orchestrator`               | Coordinate complex multi-step workflows                                |
| `codebase-analyzer`          | Analyze implementation details of specific components                  |
| `codebase-locator`           | Locate files, directories, and components                              |
| `codebase-pattern-finder`    | Find similar implementations and usage examples                        |
| `codebase-online-researcher` | Research using web sources and DeepWiki                                |
| `codebase-research-analyzer` | Deep dive on research topics                                           |
| `codebase-research-locator`  | Find documents in `research/` directory                                |
| `debugger`                   | Debug errors, test failures, and unexpected behavior                   |

<details>
<summary><i>Why specialize instead of using one general-purpose agent?</i></summary>

LLMs have an architectural limitation: the more context they hold, the harder it becomes to attend to the right information. A single agent juggling a spec, dozens of files, tool outputs, and its own reasoning will lose details, repeat work, or hallucinate connections. This isn't solvable via prompt engineering — it's how attention mechanisms work.

Specialized sub-agents turn the limitation into an advantage:

- **Context isolation** — Fresh, minimal context scoped to one job. A `codebase-locator` doesn't carry file contents; a `worker` doesn't carry the full spec.
- **Tool scoping** — Agents only see tools relevant to their role. A `reviewer` has read-only tools and can't edit files; a `worker` has edit tools but can't spawn other workers.
- **Parallel execution** — Independent sub-agents run concurrently. One worker writes the migration, another writes the handler, a third generates tests — all at once.
- **Composability** — Sub-agents combine into workflows or dispatch ad-hoc. The same `reviewer` used by Ralph is the one invoked when you ask for a code review in chat.

A specialized `codebase-analyzer` reading three files produces more accurate output than a generalist that has already consumed 50,000 tokens of search results and prior reasoning.

</details>

Use `/agents` in any chat session to see all available sub-agents.

### Built-in Skills

Skills are structured capability modules that give agents best practices and reusable workflows. Atomic ships **55 skills** across eight categories; each lives at `.agents/skills/<name>/SKILL.md` and is auto-invoked when the agent detects a relevant trigger.

<details>
<summary><b>Development workflows</b></summary>

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

</details>

<details>
<summary><b>Context engineering</b> — working within (and around) LLM context limits</summary>

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

</details>

<details>
<summary><b>TypeScript & runtime</b></summary>

| Skill                       | Description                                                             |
| --------------------------- | ----------------------------------------------------------------------- |
| `typescript-expert`         | Type-level programming, perf optimization, migrations                   |
| `typescript-advanced-types` | Generics, conditional types, mapped types, template literals            |
| `typescript-react-reviewer` | Expert review for TypeScript + React 19 applications                    |
| `bun`                       | Build, test, deploy with Bun (runtime, package manager, bundler, tests) |
| `opentui`                   | Build terminal UIs with OpenTUI (core, React, Solid reconcilers)        |

</details>

<details>
<summary><b>Frontend design & UI polish</b> — used by `impeccable` and invoked individually for targeted refinement</summary>

| Skill                                          | Description                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `impeccable`                                   | Create distinctive, production-grade frontend interfaces                       |
| `polish`                                       | Final quality pass on alignment, spacing, consistency                          |
| `critique`                                     | UX evaluation with quantitative scoring and persona testing                    |
| `audit`                                        | Accessibility, performance, theming, responsive, anti-pattern audit            |
| `layout` / `typeset` / `colorize`              | Layout, typography, and color refinement                                       |
| `adapt`                                        | Responsive design: breakpoints, fluid layouts, touch targets                   |
| `animate` / `delight`                          | Add motion, micro-interactions, and personality                                |
| `clarify`                                      | Improve UX copy, error messages, microcopy, labels                             |
| `distill` / `quieter` / `bolder` / `overdrive` | Simplify, tone down, amplify, or push designs to their limit                   |
| `harden`                                       | Error handling, onboarding, empty states, i18n, overflow, edge-case resilience |
| `optimize`                                     | Diagnose and fix loading, rendering, animation, bundle-size issues             |

</details>

<details>
<summary><b>Evaluation, documents, git, meta</b></summary>

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

</details>

Skills are auto-invoked when relevant. Run `ls .agents/skills/` for the complete, current list on disk.

### Workflow Orchestrator Panel

During `atomic workflow` execution, Atomic renders a live orchestrator panel built on [OpenTUI](https://github.com/anomalyco/opentui) over the workflow's tmux session graph. It shows:

- **Session graph** — Nodes per `.stage()` with status (pending / running / completed / failed) and edges for sequential / parallel dependencies
- **Task list tracking** — Ralph's decomposed task list with dependency arrows, updated in real time
- **Pane previews** — Thumbnail of each tmux pane so you can see every agent without context-switching
- **Transcript passing visibility** — Highlights `s.save()` / `s.transcript()` handoffs as they happen

During `atomic chat`, there is no Atomic-owned TUI — `atomic chat -a <agent>` spawns the native agent CLI inside a tmux session, so chat features (streaming, `@` mentions, `/slash-commands`, model selection, theme, keyboard shortcuts) come from the agent CLI itself. Atomic handles config sync, tmux session management, and argument passthrough.

| Context                                | UI provider                                                 |
| -------------------------------------- | ----------------------------------------------------------- |
| `atomic workflow -n <name> -a <agent>` | Atomic (orchestrator panel + tmux session graph)            |
| `atomic chat -a <agent>`               | The native agent CLI (Claude Code / OpenCode / Copilot CLI) |

---

## Commands Reference

### CLI Commands

| Command                         | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `atomic chat`                   | Spawn the native agent CLI inside a tmux session                      |
| `atomic workflow`               | Run a multi-session workflow with the Atomic orchestrator panel       |
| `atomic workflow list`          | List available workflows, grouped by source                           |
| `atomic session list`           | List all running sessions on the atomic tmux socket                   |
| `atomic session connect [name]` | Attach to a session (interactive picker when no name given)           |
| `atomic session kill [name]`    | Kill a session by name, or all sessions when no name is given         |
| `atomic completions <shell>`    | Output shell completion script (bash, zsh, fish, powershell)          |
| `atomic config set <k> <v>`     | Set configuration values (currently supports `telemetry`)             |

#### Global Flags

| Flag            | Description                                |
| --------------- | ------------------------------------------ |
| `-y, --yes`     | Auto-confirm all prompts (non-interactive) |
| `--no-banner`   | Skip ASCII banner display                  |
| `-v, --version` | Show version number                        |

#### `atomic session` Subcommands

Available at three levels — scoped or global:

| Command                                  | Description                                           |
| ---------------------------------------- | ----------------------------------------------------- |
| `atomic session list`                    | List all running sessions                             |
| `atomic session connect [name]`          | Attach to a session (interactive picker when no name) |
| `atomic session kill [name]`             | Kill a session, or all sessions when no name is given |
| `atomic chat session list`               | List running chat sessions only                       |
| `atomic chat session connect [name]`     | Attach to a chat session                              |
| `atomic chat session kill [name]`        | Kill a chat session, or all chat sessions             |
| `atomic workflow session list`           | List running workflow sessions only                   |
| `atomic workflow session connect [name]` | Attach to a workflow session                          |
| `atomic workflow session kill [name]`    | Kill a workflow session, or all workflow sessions     |

`list`, `connect`, and `kill` accept `-a <agent>` (repeatable) to filter by agent. `kill` prompts for confirmation.

```bash
atomic session list                      # all sessions
atomic session list -a claude            # only Claude sessions
atomic session connect my-session        # attach by name
atomic session connect                   # interactive picker
atomic chat session list -a copilot      # chat sessions for Copilot only
atomic session kill my-session           # kill one session by name
atomic session kill                      # kill all sessions (with confirmation)
atomic workflow session kill -a claude   # kill all Claude workflow sessions
```

#### `atomic chat` Flags

| Flag                 | Description                            |
| -------------------- | -------------------------------------- |
| `-a, --agent <name>` | Agent: `claude`, `opencode`, `copilot` |

All other arguments are forwarded directly to the native agent CLI:

```bash
atomic chat -a claude "fix the bug"          # initial prompt
atomic chat -a copilot --model gpt-5.4       # custom model
atomic chat -a claude --verbose              # forward --verbose to claude
```

#### `atomic workflow` Flags

| Flag                 | Description                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `-n, --name <name>`  | Workflow name (matches directory under `.atomic/workflows/<name>/`)                               |
| `-a, --agent <name>` | Agent: `claude`, `opencode`, `copilot`                                                            |
| `--<field>=<value>`  | Structured input for workflows that declare an `inputs` schema (also accepts `--<field> <value>`) |
| `[prompt...]`        | Positional prompt — requires the workflow to declare a `prompt` input                             |

Four invocation shapes:

```bash
# 1. List every workflow available, grouped by source
atomic workflow list
atomic workflow list -a claude       # filter by agent

# 2. Launch the interactive picker (no -n) — fuzzy-search, fill the form, confirm with y/n
atomic workflow -a claude

# 3. Run with a positional prompt (workflow must declare a "prompt" input)
atomic workflow -n ralph -a claude "build a REST API for user management"

# 4. Run a structured-input workflow with one --<field> flag per declared input
atomic workflow -n gen-spec -a claude \
  --research_doc=research/docs/2026-04-11-auth.md \
  --focus=standard
```

Workflows that declare `inputs: WorkflowInput[]` get CLI flag validation for free. **Builtin workflows (e.g. `ralph`) are reserved** — a local/global workflow with the same name will not shadow a builtin.

#### `atomic completions` — Shell Completions

Atomic ships tab-completion for **bash**, **zsh**, **fish**, and **PowerShell**. Cache the script once so new shells don't re-spawn the atomic binary on startup.

<details>
<summary><b>Bash / Zsh / Fish / PowerShell setup</b></summary>

**Bash**

```bash
mkdir -p ~/.atomic/completions
atomic completions bash > ~/.atomic/completions/atomic.bash
echo '[ -f "$HOME/.atomic/completions/atomic.bash" ] && source "$HOME/.atomic/completions/atomic.bash"' >> ~/.bashrc
```

**Zsh**

```zsh
mkdir -p ~/.atomic/completions
atomic completions zsh > ~/.atomic/completions/atomic.zsh
echo '[ -f "$HOME/.atomic/completions/atomic.zsh" ] && source "$HOME/.atomic/completions/atomic.zsh"' >> ~/.zshrc
```

**Fish**

```fish
atomic completions fish > ~/.config/fish/completions/atomic.fish
```

**PowerShell**

```powershell
$cache = Join-Path $HOME '.atomic\completions\atomic.ps1'
New-Item -ItemType Directory -Force -Path (Split-Path $cache) | Out-Null
atomic completions powershell | Out-File -FilePath $cache -Encoding utf8
Add-Content $PROFILE "`nif (Test-Path `"$cache`") { . `"$cache`" }"
```

</details>

> The bootstrap installer (`install.sh` / `install.ps1`) sets this up automatically and migrates older `eval "$(atomic completions …)"` snippets to the cached form.

### Atomic-Provided Skills (invokable from any agent chat)

Atomic ships skills — not slash commands. Skills are auto-discovered by Claude Code, OpenCode, and Copilot CLI, invoked by typing `/<skill-name>` (Claude Code) or by natural-language reference (OpenCode / Copilot CLI).

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

Native slash commands (`/help`, `/clear`, `/compact`, `/model`, `/theme`, `/agents`, `/mcp`, `/exit`) come from the underlying agent CLI, not Atomic.

---

## Configuration

### `.atomic/settings.json`

Resolution order:

1. Local: `.atomic/settings.json`
2. Global: `~/.atomic/settings.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/flora131/atomic/main/assets/settings.schema.json",
  "version": 1,
  "scm": "github",
  "lastUpdated": "2026-04-09T12:00:00.000Z"
}
```

| Field         | Type   | Description                               |
| ------------- | ------ | ----------------------------------------- |
| `$schema`     | string | JSON Schema URL for editor autocomplete   |
| `version`     | number | Config schema version (currently `1`)     |
| `scm`         | string | Source control: `github` or `sapling`     |
| `lastUpdated` | string | ISO 8601 timestamp of the last update     |

> Model selection and reasoning effort are managed by each underlying agent CLI (e.g. Claude Code's `/model`), not Atomic. Atomic's chat command spawns the agent's native TUI — use the agent's own controls.

### Agent-Specific Files

| Agent          | Folder       | Skills                                          | Context File |
| -------------- | ------------ | ----------------------------------------------- | ------------ |
| Claude Code    | `.claude/`   | `.claude/skills/` (symlink → `.agents/skills/`) | `CLAUDE.md`  |
| OpenCode       | `.opencode/` | `.agents/skills/`                               | `AGENTS.md`  |
| GitHub Copilot | `.github/`   | `.agents/skills/`                               | `AGENTS.md`  |

All three agents share the same skill set via `.agents/skills/`. Claude Code accesses them through a `.claude/skills/` symlink.

---

## Updating & Uninstalling

### Update

```bash
bun update -g @bastani/atomic      # latest stable
bun install -g @bastani/atomic@next # prerelease
```

The first `atomic` run after upgrading auto-syncs tooling deps and global skills — no separate command needed.

### Uninstall

```bash
bun remove -g @bastani/atomic
```

<details>
<summary><b>Also remove global config and cached agent configs</b></summary>

```bash
# macOS / Linux
rm -rf ~/.atomic/

# Windows PowerShell
Remove-Item -Path "$env:USERPROFILE\.atomic" -Recurse -Force
```

</details>

---

## Troubleshooting

<details>
<summary><b>Git identity error</b></summary>

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

</details>

<details>
<summary><b>Windows: agents fail to spawn</b></summary>

Ensure the agent CLI is in your PATH. Atomic uses `Bun.which()`, which handles `.cmd`, `.exe`, and `.bat` extensions automatically.

</details>

---

## FAQ

<details>
<summary><b>How does Atomic differ from Spec-Kit?</b></summary>

[Spec Kit](https://github.com/github/spec-kit) is GitHub's toolkit for "Spec-Driven Development." Both improve AI-assisted development, but solve different problems:

**In short:** Spec-Kit works well for greenfield projects where you start from a spec and use a single Copilot session to generate code. Atomic is built for the harder case — large existing codebases where you need to research what's already there before changing anything. Atomic gives you multi-session pipelines with isolated context windows, deterministic execution, and support for Claude Code, OpenCode, and Copilot CLI instead of just one agent.

| Aspect                   | Spec-Kit                                     | Atomic                                                                                              |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Focus**                | Greenfield projects with spec-first workflow | Large existing codebases + greenfield — research-first or spec-first                                |
| **First Step**           | Define project principles and specs          | Analyze existing architecture with parallel research sub-agents                                     |
| **Workflow Definition**  | Shell scripts and markdown templates         | TypeScript Workflow SDK (`defineWorkflow()` → `.run()` → `.compile()`) with deterministic execution |
| **Session Management**   | Single agent session                         | Multi-session pipelines — sequential and parallel — each in isolated context windows                |
| **Data Flow**            | Manual — copy output between steps           | Controlled transcript passing via `ctx.transcript()` and `ctx.getMessages()`                        |
| **Agent Support**        | GitHub Copilot CLI                           | Claude Code + OpenCode + Copilot CLI — switch with a flag                                           |
| **Sub-Agents**           | Single general-purpose agent                 | 12 specialized sub-agents with scoped tools and isolated contexts                                   |
| **Skills**               | Not available                                | 55 built-in skills (development, design, docs, agent architecture)                                  |
| **Autonomous Execution** | Not available                                | Ralph — multi-hour autonomous sessions with plan/implement/review/debug loop                        |
| **Execution Guarantees** | Non-deterministic                            | Deterministic — strict step ordering, frozen definitions, controlled transcript access              |
| **Isolation**            | Not addressed                                | Devcontainer features for containerized execution                                                   |

</details>

<details>
<summary><b>How does Atomic differ from DeerFlow?</b></summary>

[DeerFlow](https://github.com/bytedance/deer-flow) is ByteDance's agent harness built on LangGraph/LangChain. Both are multi-agent orchestrators, but take different approaches:

**In short:** DeerFlow is a general-purpose agent orchestrator with a web UI. Atomic is narrowly focused on coding workflows. The key difference is that Atomic runs on top of production coding agents (Claude Code, OpenCode, Copilot CLI) rather than reimplementing coding tools through a generic API — you get each agent's native file editing, permissions, MCP integrations, and hooks out of the box. Atomic also gives you deterministic execution, which matters when encoding a team's dev process.

| Aspect                  | DeerFlow                                        | Atomic                                                                                        |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Runtime**             | Python (LangGraph)                              | TypeScript (Bun)                                                                              |
| **Agent SDKs**          | OpenAI-compatible API                           | Claude Code + OpenCode + Copilot CLI native SDKs — write raw SDK code in each session         |
| **Focus**               | General-purpose agent tasks (research, reports) | Coding-specific: research, spec, implement, review, debug                                     |
| **Workflow Definition** | LangGraph state machines with graph nodes       | TypeScript Workflow SDK — `defineWorkflow()` → `.run()` → `.compile()`                        |
| **Execution Model**     | DAG-based with conditional edges                | Deterministic — strict step ordering, frozen definitions, controlled transcript passing       |
| **Parallelism**         | Via LangGraph branch nodes                      | Native parallel sessions via `Promise.all()` with `ctx.session()` in isolated context windows |
| **Sub-Agents**          | Researcher, coder, reporter nodes               | 12 specialized sub-agents with scoped tools (planner, worker, reviewer, debugger, etc.)       |
| **Skills**              | Not available                                   | 55 built-in skills auto-invoked by context                                                    |
| **Isolation**           | Sandbox containers                              | Devcontainer features + git worktrees                                                         |
| **Interface**           | Web UI (Streamlit)                              | Terminal chat with tmux-based session management                                              |
| **Autonomous**          | Not available                                   | Ralph — bounded iteration with plan/implement/review/debug loop                               |
| **Distribution**        | `pip install` + local server                    | `bun install -g` or devcontainer features                                                     |

</details>

<details>
<summary><b>How does Atomic differ from Hermes Agent?</b></summary>

[Hermes Agent](https://github.com/NousResearch/hermes-agent) is Nous Research's general-purpose AI agent with a self-improving learning loop. Both are open-source agent frameworks, but serve different use cases:

**In short:** Hermes is a broad AI assistant that learns across sessions and connects to messaging platforms. Atomic is a coding-specific harness for engineering teams. It lets you encode your development process as deterministic TypeScript workflows that run identically across team members, machines, and CI. Atomic inherits production-hardened tools from Claude Code, OpenCode, and Copilot CLI — including their permission systems, MCP integrations, and hooks — giving you two independent security boundaries (devcontainer isolation + agent permissions). Fresh context per session keeps output sharp over multi-hour tasks. Developer-authored skills don't drift the way auto-generated ones can.

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
| **Skills**                | 40+ tools + community Skills Hub (agentskills.io)                                            | 55 built-in skills (development, design, docs, agent architecture)                                                                           |
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
