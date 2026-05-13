<h1 align="center">Atomic</h1>

<p align="center"><img width="800" height="450" alt="atomic-promo" src="./assets/atomic-promo.gif" /></p>

<p align="center">
  <b>Turn coding agents into reliable engineering workflows.</b><br>
  An open-source CLI and TypeScript SDK for Claude Code, OpenCode, and GitHub Copilot CLI.
</p>

<p align="center">
  <a href="#get-started"><b>Get started →</b></a>
  &nbsp;·&nbsp;
  <a href="#why-atomic">Why Atomic</a>
  &nbsp;·&nbsp;
  <a href="#key-features">Key features</a>
  &nbsp;·&nbsp;
  <a href="https://docs.bastani.ai/">Docs</a>
</p>

<p align="center">
  <a href="https://docs.bastani.ai/"><img src="https://img.shields.io/badge/docs-atomic-blue" alt="Docs"></a>
  <a href="https://deepwiki.com/flora131/atomic"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun&logoColor=black" alt="Bun"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

## Get started

The easiest way to install Atomic is through the install script.

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows** (PowerShell 5.1+ or 7+)

```powershell
irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

You can also install it with the following commands:

**Using Node.js**

**npm**

```bash
npm install -g @bastani/atomic         # latest stable
npm install -g @bastani/atomic@next    # latest pre-release
```

**Bun**

```bash
bun add -g @bastani/atomic             # latest stable
bun add -g @bastani/atomic@next        # latest pre-release
```

**Onboarding**

Open a chat with the agent you've authenticated:

```bash
atomic chat -a <agent>   # claude | opencode | copilot
```

Inside the chat, run:

```text
/atomic   # guided onboarding — start here
```

`/atomic` tailors the tour to what you're trying to ship — driving a large feature through deterministic, spec-driven development (research → spec → parallel implementation passes), or codifying a recurring engineering job (review-to-merge, migrations, incident triage, release prep) into a reusable workflow your whole team can run identically. The slash command is the fastest onboarding path; if you want the long form, jump to [Key features](#key-features) or the [Workflow SDK](#workflow-sdk) below.

> ⚠️ Workflows run with agent permission checks **disabled** so pipelines don't block on prompts. Once `/atomic` points you at a workflow, we suggest running it inside a [devcontainer](#containerized-execution), VM, or remote dev machine — not your host machine.

<details>
<summary><b>Prerequisites, version pinning, devcontainer, SDK-only</b></summary>

**Prerequisites** — Atomic spawns coding agents inside a tmux session, so the host needs:

- A terminal multiplexer — [tmux](https://github.com/tmux/tmux) (macOS/Linux) or [psmux](https://github.com/psmux/psmux) (Windows). Auto-installed on first `atomic` run via your platform's package manager.
- At least one authenticated coding agent CLI — [Claude Code](https://code.claude.com/docs/en/quickstart), [OpenCode](https://opencode.ai), or [GitHub Copilot CLI](https://github.com/features/copilot/cli). Install and `claude` / `opencode` / `copilot` to authenticate.

**Pin a version:** `bash install.sh 0.4.47` (same trailing-arg form works for `.ps1` and `.cmd`).

**Devcontainer** — recommended for autonomous workflows. Add one feature to `.devcontainer/devcontainer.json`:

| Feature                              | Agent        |
| ------------------------------------ | ------------ |
| `ghcr.io/flora131/atomic/claude:1`   | Claude Code  |
| `ghcr.io/flora131/atomic/opencode:1` | OpenCode     |
| `ghcr.io/flora131/atomic/copilot:1`  | Copilot CLI  |

Templates per agent live in [`.devcontainer/`](./.devcontainer/).

**SDK-only** — skip the global binary, use `defineWorkflow` in your own project:

```bash
bun init -y && bun add @bastani/atomic-sdk @anthropic-ai/claude-agent-sdk
```

You still need tmux/psmux + an authenticated agent CLI at runtime.

</details>

<details>
<summary><b>Upgrading from a previous version</b></summary>

**From 0.6.x or earlier (SDK users):** the SDK moved from `@bastani/atomic` to `@bastani/atomic-sdk`.

```bash
bun remove @bastani/atomic && bun add @bastani/atomic-sdk
```

Update imports: `from "@bastani/atomic/workflows"` → `from "@bastani/atomic-sdk/workflows"`. The CLI keeps the same package name.

For SDK API changes (`createWorkflowCli` removal, `source: import.meta.path`, etc.), see [SDK migration](#migration-from-0x).

</details>

---

## Why Atomic

Coding agents are great inside a single session — they inspect code, edit files, and explain their work. The trouble starts when a task is ambiguous, tied to specific exit criteria, long-running, or anchored in a large codebase. You end up reminding the agent of the process, copying output between sessions, and deciding when a human needs to review.

**Atomic turns that process into code.** A workflow can branch, retry, run stages in parallel, isolate sessions, pass only the right transcript forward, pause for human approval, and run inside a devcontainer so the agent is never loose on your host.

| | |
|---|---|
| **Start with your own process** | Automate the repetitive parts of research, debugging, review, migrations, or PR prep — one TypeScript file, versioned with the repo. |
| **Scale to your team** | Encode review gates, quality checks, and approvals so every teammate runs the same workflow instead of manually steering an agent. |
| **Keep the coding agent** | Atomic adds structure around Claude Code, OpenCode, and Copilot CLI — without rebuilding file editing, tool use, MCP setup, hooks, or context handling. |
| **Own the outer loop** | Workflows, gates, handoffs, and the execution graph are TypeScript you can read, edit, and version — not a black-box harness improvising process. |

> Build the workflow once. Run it across agents, repos, and teams.

---

## Key features

Atomic ships three top-level building blocks: **workflows**, **skills**, and **specialized sub-agents**. Everything else in this README is reference material on top.

### 1. Workflows

Atomic workflows separate orchestration from execution: control flow is deterministic TypeScript — frozen definitions, strict step ordering, and explicit transcript handoffs between stages — while each stage runs a full coding agent with unconstrained tool use and reasoning.

| Workflow                 | What it does                                                                                                                                          | Example input                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ralph`                  | Autonomous plan → orchestrate → simplify → review loop that keeps iterating until two reviewers agree (or `max_loops` hits). For multi-hour unattended coding on a bounded task. | `atomic workflow -n ralph -a claude "Implement the caching layer per research/docs/2026-05-07-caching.md"`                                 |
| `deep-research-codebase` | Parallel research across a large codebase, written to a dated `research/docs/` doc you can hand to future workflows or specs. Token-heavy — reach for it on large migrations or cross-service work. For smaller, single-question research, use the [`/research-codebase`](#2-skills) skill instead. | `atomic workflow -n deep-research-codebase -a copilot "Map every callsite of the legacy auth middleware so we can migrate to session-v2"` |
| `open-claude-design`     | End-to-end design generation: discovers your design system, generates from a prompt, refines with feedback, and exports a handoff directory.          | `atomic workflow -n open-claude-design -a opencode --prompt="Team activity feed" --reference=./mocks/feed.png --output-type=prototype`     |
| _author your own_        | Anything outside the built-ins — review-to-merge, migration, triage, release pipelines. Describe it in natural language and the [`workflow-creator`](#2-skills) skill scaffolds a `defineWorkflow()` file with typed CLI flags. | _"Use the `workflow-creator` skill to scaffold a workflow for `claude` that takes an `--issue=<n>` flag, pulls the GitHub issue, and runs an implementation pass identical to the built-in `ralph` workflow against the described features."_ |

For full input schemas, run `atomic workflow inputs <name> -a <agent>`. SDK details in [Workflow SDK](#workflow-sdk); runnable references in [`examples/`](./examples).

### 2. Skills

Structured capability modules that give agents best practices and reusable workflows. Atomic ships **57 skills** at `.agents/skills/<name>/SKILL.md`. They auto-invoke when the agent detects a relevant trigger, or you can call them directly with `/<skill-name>` (Claude Code) or natural language (OpenCode / Copilot CLI).

**Top skills to know first:**

| Skill               | Invoke with                       | Purpose                                                                          |
| ------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `init`              | `/init`                           | Generate `CLAUDE.md` / `AGENTS.md` by exploring the codebase                     |
| `prompt-engineer`   | natural language                  | Sharpen your research prompts, workflow inputs, or any agent prompt before you run it |
| `research-codebase` | `/research-codebase "<question>"` | Dispatch parallel sub-agents to analyze the codebase and write a research doc    |
| `create-spec`       | `/create-spec "<research-path>"`  | Produce a technical execution spec grounded in a research document               |
| `workflow-creator`  | natural language                  | Generate a multi-agent workflow definition using `defineWorkflow()` + a registry |
| `tdd`               | natural language                  | Red-green-refactor with a built-in testing-anti-patterns guide                   |
| `explain-code`      | `/explain-code "<path>"`          | Deep-dive explanation of specific code using DeepWiki                            |
| `gh-create-pr`      | `/gh-create-pr`                   | Commit, push, and open a GitHub PR (also `/ado-create-pr`, `/sl-submit-diff`)    |
| `playwright-cli`    | natural language                  | Automate browser interactions, tests, screenshots                                |
| `impeccable`        | natural language                  | Create distinctive, production-grade frontend interfaces                         |
| `find-skills`       | natural language                  | Discover and install community skills you don't have yet                         |

<details>
<summary><b>Full catalog</b> — all 57 skills, grouped by category</summary>

**Development workflows:** `init`, `research-codebase`, `create-spec`, `workflow-creator`, `explain-code`, `find-skills`, `tdd`, `prompt-engineer`

**Context engineering:** `context-fundamentals`, `context-degradation`, `context-compression`, `context-optimization`, `filesystem-context`, `memory-systems`, `multi-agent-patterns`, `tool-design`, `hosted-agents`, `project-development`, `bdi-mental-states`

**TypeScript & runtime:** `typescript-expert`, `typescript-advanced-types`, `typescript-react-reviewer`, `bun`, `opentui`

**Frontend design & UI polish:** `impeccable`, `polish`, `critique`, `audit`, `layout`, `typeset`, `colorize`, `adapt`, `animate`, `delight`, `clarify`, `distill`, `quieter`, `bolder`, `overdrive`, `harden`, `optimize`, `arrange`, `extract`, `normalize`, `onboard`, `shape`, `teach-impeccable`, `frontend-design`, `ux-design-virtuoso`

**Evaluation:** `evaluation`, `advanced-evaluation`

**Documents & parsing:** `pdf`, `xlsx`, `docx`, `pptx`, `liteparse`

**Source control & automation:** `gh-commit`, `gh-create-pr`, `ado-commit`, `ado-create-pr`, `sl-commit`, `sl-submit-diff`, `playwright-cli`

**Meta:** `skill-creator`

> **Source-control MCP servers are disabled by default.** Set `scm` in `.atomic/settings.json` (or run `atomic config set scm <provider>`) to `github`, `azure-devops`, or `sapling` to enable the matching MCP server. `sapling` disables both.

Run `ls .agents/skills/` for the live, on-disk list.

</details>

### 3. Specialized sub-agents

Purpose-built agents with scoped context, tools, and termination conditions. Run `/agents` in any chat to list them; they're auto-dispatched by skills and workflows, or invoke directly with `Task(subagent_type="<name>", ...)`.

| Sub-agent                    | Purpose                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `planner`                    | Decompose specs into structured task lists with dependency tracking |
| `worker`                     | Implement single focused tasks (multiple workers run in parallel)   |
| `reviewer`                   | Audit implementations against specs and best practices              |
| `orchestrator`               | Coordinate complex multi-step workflows                             |
| `debugger`                   | Debug errors, test failures, and unexpected behavior                |
| `code-simplifier`            | Simplify and refine code for clarity and maintainability            |
| `codebase-locator`           | Locate files, directories, and components                           |
| `codebase-analyzer`          | Analyze implementation details of specific components               |
| `codebase-pattern-finder`    | Find similar implementations and usage examples                     |
| `codebase-online-researcher` | Research using web sources and DeepWiki                             |
| `codebase-research-locator`  | Find prior research documents in `research/`                        |
| `codebase-research-analyzer` | Deep dive on existing research topics                               |

<details>
<summary><i>Why specialized agents instead of one general agent?</i></summary>

LLMs have an architectural limitation: the more context they hold, the harder it is to attend to the right information. A single agent juggling a spec, dozens of files, tool outputs, and its own reasoning will lose details, repeat work, or hallucinate connections. Specialized sub-agents fix this with **context isolation** (fresh, minimal context per job), **tool scoping** (a `reviewer` can't edit files; a `worker` can't spawn other workers), and **parallel execution** (independent agents run concurrently).

</details>

---

## Documentation

Full documentation lives at **[docs.bastani.ai](https://docs.bastani.ai/)** — the CLI and SDK reference, security model, containerized execution, the workflow panel, session management, configuration, troubleshooting, FAQ, and side-by-side comparisons with Spec-Kit, DeerFlow, and Hermes.

The docs are open source — the same content is browsable on GitHub at [flora131/docs](https://github.com/flora131/docs). Open a PR there to suggest a change.

---

## Contributing

See [DEV_SETUP.md](DEV_SETUP.md) for development setup, testing guidelines, and contribution workflow.

## License

MIT — see [LICENSE](LICENSE).

## Credits

- [Superpowers](https://github.com/obra/superpowers)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Ralph Wiggum Method](https://ghuntley.com/ralph/)
- [OpenAI Codex Cookbook](https://github.com/openai/openai-cookbook)
- [HumanLayer](https://github.com/humanlayer/humanlayer)
- [Impeccable](https://github.com/pbakaus/impeccable)
