<h1 align="center">@bastani/atomic-workflows</h1>

<p align="center">
  <b>Multi-stage workflow authoring and execution for <a href="https://github.com/can1357/oh-my-pi">oh-my-pi</a>.</b><br>
  An oh-my-pi extension — install it, author workflows in TypeScript, run them from chat.
</p>

<p align="center">
  <a href="#install"><b>Install →</b></a>
  &nbsp;·&nbsp;
  <a href="#authoring-api">Authoring API</a>
  &nbsp;·&nbsp;
  <a href="#surfaces">Surfaces</a>
  &nbsp;·&nbsp;
  <a href="#builtin-workflows">Builtins</a>
  &nbsp;·&nbsp;
  <a href="./DEV_SETUP.md">Development</a>
</p>

<p align="center">
  <a href="./package.json"><img src="https://img.shields.io/badge/version-0.0.1-blue" alt="Version 0.0.1"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/Bun-%E2%89%A51.3.7-fbf0df?logo=bun&logoColor=000" alt="Bun ≥ 1.3.7"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

`@bastani/atomic-workflows` brings multi-stage, DAG-driven workflow execution to oh-my-pi. Workflows are plain TypeScript files that export a `WorkflowDefinition`; the DAG is inferred from your `async/await` and `Promise.all` call patterns at runtime — no YAML, no graph config. Each stage runs as an isolated sub-session. A live above-editor widget and on-demand DAG overlay give you real-time progress visibility. Completed runs are persisted to the session store and can be resumed.

The package ships as raw TypeScript (no build step) and is loaded by oh-my-pi directly from source. Workflow stages run through oh-my-pi's in-process SDK `AgentSession` surface, so stage options are forwarded to `createAgentSession()`.

---

## Prerequisites

- **oh-my-pi** — install [oh-my-pi](https://github.com/can1357/oh-my-pi#installation).

## Install

`@bastani/atomic-workflows` is an oh-my-pi extension package. Install from npm:

```bash
omp plugin install @bastani/atomic-workflows
```

oh-my-pi reads the package's `omp` manifest and auto-registers the extension entry at `src/extension/index.ts`. Reload from inside oh-my-pi with `/reload`.

> Not yet published — until v0.0.1 lands on npm, see [DEV_SETUP.md](./DEV_SETUP.md) for the local-path install used while iterating on the extension itself.

### Custom workflow directories

Adding workflow files under `.omp/workflows/` (project scope) or `~/.omp/agent/workflows/` (user scope) makes them discoverable automatically. To register additional discovery paths, edit your oh-my-pi settings (`~/.omp/agent/config.yml` for global, `.omp/settings.json` for project):

```json
{
  "workflows": {
    "team": { "path": "/shared/team/atomic-workflows" }
  }
}
```

Run `/workflows-doctor` from inside oh-my-pi to verify what was discovered and which runtime capabilities are available.

---

## Authoring API

### Example 1 — Single stage

```typescript
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow("summarize-pr")
  .description("Summarize a pull request in one stage.")
  .input("pr_url", {
    type: "text",
    required: true,
    description: "URL of the pull request to summarize.",
  })
  .run(async (ctx) => {
    const summary = await ctx.stage("summarize").prompt(
      `Summarize the pull request at ${String(ctx.inputs.pr_url)} clearly and concisely.`
    );
    return { summary };
  })
  .compile();
```

### Example 2 — Parallel fan-out with `Promise.all`

The `GraphFrontierTracker` infers parallelism from `Promise.all` — the three specialist stages are scheduled concurrently; the aggregator waits for all three (fan-in).

```typescript
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow("parallel-research")
  .description("Scout → three parallel specialists → aggregator.")
  .input("topic", { type: "text", required: true, description: "Research topic." })
  .run(async (ctx) => {
    const { topic } = ctx.inputs as { topic: string };

    const [authReport, dbReport, apiReport] = await Promise.all([
      ctx.stage("auth-specialist").prompt(`Research authentication patterns for: ${topic}`),
      ctx.stage("db-specialist").prompt(`Research database layer for: ${topic}`),
      ctx.stage("api-specialist").prompt(`Research API surface for: ${topic}`),
    ]);

    const summary = await ctx.stage("aggregator").prompt(
      `Synthesize these three specialist reports:\n\n## Auth\n${authReport}\n\n## Database\n${dbReport}\n\n## API\n${apiReport}`
    );
    return { summary };
  })
  .compile();
```

### Example 3 — Human-in-the-loop (HIL)

```typescript
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow("review-and-merge")
  .description("Plan a change, ask for human approval, then execute.")
  .input("task", { type: "text", required: true, description: "What to implement." })
  .run(async (ctx) => {
    const plan = await ctx.stage("planner").prompt(
      `Create a concise implementation plan for: ${String(ctx.inputs.task)}`
    );

    const approved = await ctx.ui.confirm(`Proceed with this plan?\n\n${plan}`);
    if (!approved) return { status: "cancelled" };

    const result = await ctx.stage("implementer").prompt(
      `Execute this plan exactly:\n\n${plan}`
    );
    return { result };
  })
  .compile();
```

### `createRegistry` — grouping workflows

```typescript
import { createRegistry, defineWorkflow } from "@bastani/atomic-workflows";

const alpha = defineWorkflow("alpha").run(async () => {}).compile();
const beta  = defineWorkflow("beta").run(async () => {}).compile();
const gamma = defineWorkflow("gamma").run(async () => {}).compile();

const registry = createRegistry()
  .register(alpha)
  .register(beta)
  .merge(createRegistry().register(gamma));

registry.names();      // ["alpha", "beta", "gamma"]
registry.all();        // WorkflowDefinition[]
registry.get("alpha"); // WorkflowDefinition | undefined
```

### Input types

| Type      | Description        | Extra options                       |
| --------- | ------------------ | ----------------------------------- |
| `text`    | Free-form string   | `default`, `required`               |
| `string`  | Alias for `text`   | `default`, `required`               |
| `number`  | Numeric value      | `default`, `required`, `min`, `max` |
| `boolean` | True/false toggle  | `default`                           |
| `select`  | Enumerated choices | `options: string[]`, `default`      |

---

## Surfaces

### Slash commands

| Command                            | Description                                              |
| ---------------------------------- | -------------------------------------------------------- |
| `/workflow <name> [key=value ...]` | Start a named workflow, passing optional input overrides |
| `/workflow <name> --help`          | Print the workflow's input schema (alias: `-h`)          |
| `/workflow list`                   | List all registered workflows with descriptions          |
| `/workflow status`                 | Show status of active runs                               |
| `/workflow connect [run-id]`       | Attach to a workflow run overlay                         |
| `/workflow kill [run-id\|--all]`   | Stop the active run (or all runs)                        |
| `/workflow resume <run-id>`        | Re-open the overlay for a previously paused/failed run   |
| `/workflow inputs <name>`          | Print the input schema for a workflow                    |
| `/workflows-doctor`                | Diagnose registration, discovery, and peer-dep issues    |

Input overrides are bare `key=value` tokens (no leading `--`). Values are JSON-parsed when possible, so numbers, booleans, and quoted strings work as expected (e.g. `count=3`, `flag=true`, `prompt="multi word value"`). A whole-object override can be passed as a single JSON token (e.g. `{"prompt":"...","count":3}`).

Workflows always run as **background tasks** — the chat editor stays free while a run executes. Press **F2** (or `/workflow connect <run-id>`) to attach to the live graph viewer; HIL prompts (`ctx.ui.input/confirm/select/editor`) surface there, never as modal dialogs over the chat.

### `workflow` tool (LLM-callable)

When `@bastani/atomic-workflows` is installed, the oh-my-pi LLM gains access to the `workflow` tool:

```json
{
  "name": "workflow",
  "description": "Run a defined multi-stage workflow by name.",
  "parameters": {
    "name": "string  — workflow ID or normalized name",
    "inputs": "object (optional) — key/value map of workflow inputs",
    "action": "'run' | 'list' | 'status' | 'kill' | 'resume' | 'inputs'"
  }
}
```

- **`renderCall`** — renders a live DAG chip in the chat scroll as the workflow executes.
- **`renderResult`** — renders a "started in background" banner once dispatch returns; the live DAG continues updating via the widget and graph viewer. Background is the only execution mode — there is no synchronous return path.

### F2 keyboard shortcut

Press **F2** while a workflow is running to open the DAG overlay for the active run.

### CLI flags

The extension registers two CLI flags: `--workflow=<name>` selects the workflow to run, and `--workflow-inputs=<json>` (or `--workflow-inputs-file=<path>`) supplies its inputs. Combine with oh-my-pi's `-p` for non-interactive execution:

```bash
omp -p --workflow=deep-research-codebase \
  --workflow-inputs='{"prompt":"Investigate the auth module","max_partitions":6}'
```

For complex inputs you can store them in a JSON file and pass the path:

```bash
omp -p --workflow=deep-research-codebase --workflow-inputs-file=./inputs.json
```

`--workflow-inputs` is parsed as a single JSON object — keys map to your workflow's declared input names, values are typed (strings, numbers, booleans, arrays, nested objects). Parsed inputs are validated against the workflow's declared input schema before dispatch; a schema mismatch prints the schema and fails fast without running the workflow.

To inspect a workflow's input schema before invoking it:

```bash
omp --workflow=deep-research-codebase --workflow-help
```

Or, from inside oh-my-pi, `/workflow inputs <name>` or `/workflow <name> --help`.

> Why a single JSON flag rather than `--workflow-input-<key>=<value>` per input? The extension registers literal CLI flags only. A single typed JSON value stays expressive for arbitrary input shapes.

---

## Builtin workflows

### `deep-research-codebase`

Scout → parallel specialist stages → aggregator. Ideal for deep investigation of a codebase topic across multiple specialist angles.

```text
/workflow deep-research-codebase prompt="How does session persistence work?"
```

| Input            | Type     | Required | Default | Description                                   |
| ---------------- | -------- | -------- | ------- | --------------------------------------------- |
| `prompt`         | `text`   | ✓        | —       | Research question or topic to investigate.    |
| `max_partitions` | `number` | —        | `4`     | Maximum number of parallel specialist stages. |

### `ralph`

Plan → orchestrate → review loop with optional HIL checkpoints. Named after the [Ralph Wiggum Method](https://ghuntley.com/ralph/).

```text
/workflow ralph prompt="Migrate the database layer to Drizzle ORM"
```

| Input            | Type     | Required | Default | Description                                 |
| ---------------- | -------- | -------- | ------- | ------------------------------------------- |
| `prompt`         | `text`   | ✓        | —       | High-level task or goal to accomplish.      |
| `max_iterations` | `number` | —        | `3`     | Maximum plan → execute → review iterations. |

### `open-claude-design`

Design generation pipeline — produce mockups or interactive prototypes from a natural-language prompt.

```text
/workflow open-claude-design prompt="Design a kanban board" output_type=mockup
```

| Input         | Type     | Required | Default  | Description                                 |
| ------------- | -------- | -------- | -------- | ------------------------------------------- |
| `prompt`      | `text`   | ✓        | —        | Design brief or description.                |
| `reference`   | `text`   | —        | —        | Optional path to a reference image or file. |
| `output_type` | `select` | —        | `mockup` | `mockup` or `prototype`.                    |

---

## Custom workflow discovery

`@bastani/atomic-workflows` automatically discovers workflow files from three locations:

| Location                          | Scope      | Example path                              |
| --------------------------------- | ---------- | ----------------------------------------- |
| `.omp/workflows/*.ts`             | Project    | `.omp/workflows/my-workflow.ts`           |
| `~/.omp/agent/workflows/*.ts`     | User       | `~/.omp/agent/workflows/my-workflow.ts`   |
| `workflows.name.path` in settings | Configured | see `~/.omp/agent/config.yml` example     |

Settings-based discovery (`~/.omp/agent/config.yml` / `.omp/settings.json`):

```json
{
  "workflows": {
    "my-team-workflows": { "path": "/shared/team/atomic-workflows" }
  }
}
```

---

## Host integration

`@bastani/atomic-workflows` targets oh-my-pi directly:

- task delegation is bridged through the built-in `subagent`/task tool surface
- stage sessions use the host-provided `createAgentSession()` SDK
- MCP scope gating uses host event emission when available
- detached-run HIL uses host session naming + event routing when available

Run `/workflows-doctor` from inside oh-my-pi to see exactly which runtime adapter paths are active.

---

## License

MIT — see [LICENSE](LICENSE).

---

**Development:** see [DEV_SETUP.md](./DEV_SETUP.md) for setup, testing, layout, and the local-extension dev loop.
