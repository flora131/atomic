# Pi Workflow Authoring Reference

Use this when creating or editing user-facing workflow definition files for `@bastani/workflows`.

## Where workflow files live

Atomic/pi discovers workflows from these user-facing locations, in this override order:

1. Configured project files from `.atomic/extensions/workflow/config.json` (`workflows.<name>.path`). Legacy `.pi/...` config paths are also considered.
2. Project-local files in `.atomic/workflows/*.{ts,js,mjs,cjs}`. Legacy `.pi/workflows/` is also checked.
3. Configured global files from `~/.atomic/agent/extensions/workflow/config.json`. Legacy `~/.pi/...` config paths are also considered.
4. User-global files in `~/.atomic/agent/workflows/*.{ts,js,mjs,cjs}`. Legacy `~/.pi/agent/workflows/` is also checked.
5. Package-provided files from installed Atomic/pi packages.
6. Bundled workflows shipped with `@bastani/workflows`.

A workflow module may export one default workflow definition and/or named workflow definitions; discovery checks the default export first, then named exports.

Configured workflow paths live in extension config. Project config relative paths resolve from the project root; global config relative paths resolve under the user agent directory (`<home>/.atomic/agent`). Project entries override global entries with the same key.

```json
{
  "workflows": {
    "team": { "path": "./workflows/team.ts" }
  },
  "defaultConcurrency": 4,
  "maxDepth": 4,
  "persistRuns": true,
  "statusFile": false,
  "resumeInFlight": "ask"
}
```

Runtime config defaults are `defaultConcurrency: 4`, `maxDepth: 4`, `persistRuns: true`, `statusFile: false`, and `resumeInFlight: "ask"`. Invalid JSON or invalid shapes produce `CONFIG_INVALID` diagnostics; missing config files are ignored. When `statusFile` is enabled, the derived status file defaults under `.atomic/workflows/status.json` for the project.

Package-provided workflows can be exposed either explicitly through host package metadata or implicitly through a conventional directory:

```json
{
  "name": "my-atomic-workflows",
  "keywords": ["pi-package"],
  "atomic": {
    "extensions": ["./src/index.ts"],
    "workflows": ["./workflows"]
  }
}
```

- For new Atomic package examples, prefer app-name keys such as `atomic.workflows` and `atomic.extensions` when supported by the host.
- `pi.workflows` and `pi.extensions` remain supported for pi compatibility and existing first-party package metadata.
- If no manifest declares workflows, conventional `workflows/` is auto-discovered. Singular `workflow/` is also accepted.
- App-level config similarly prefers `<appName>Config` (for example `atomicConfig`) where available; legacy `piConfig` is still read as a shim.

In a normal consumer project, import from the package:

```ts
import { defineWorkflow } from "@bastani/workflows";
```

If you are editing an existing workflow file, follow the import style already used nearby.

## Authoring shape

```ts
import { defineWorkflow } from "@bastani/workflows";

export default defineWorkflow("my-workflow")
  .description("Short description shown in workflow listings.")
  .input("prompt", {
    type: "text",
    required: true,
    description: "Task or question for the workflow.",
  })
  .run(async (ctx) => {
    const prompt = String(ctx.inputs.prompt);

    const scout = await ctx.task("scout", {
      prompt: `Map the relevant context for: ${prompt}`,
      context: "fresh",
    });

    const reviews = await ctx.parallel([
      { name: "quality", prompt: "Inspect quality risks using this context: {previous}", previous: scout },
      { name: "runtime", prompt: "Inspect runtime concerns using this context: {previous}", previous: scout },
    ], { concurrency: 2 });

    const final = await ctx.task("synthesis", {
      prompt: "Synthesize findings and recommend next steps.",
      previous: reviews,
    });

    return { summary: final.text, reviewer_count: reviews.length };
  })
  .compile();
```

`prompt` and `task` are aliases for task text. Prefer `prompt` inside authored workflow files because it mirrors the lower-level `stage.prompt(...)`; `task` remains useful in direct tool calls and chain examples.

## Builder facts

- `defineWorkflow(name)` requires a non-empty string name.
- Names normalize for lookup: trim, lowercase, whitespace/underscore to hyphen, remove other punctuation, collapse hyphens.
- `.description(text)` sets the listing text.
- `.input(key, schema)` declares typed user inputs.
- `.run(fn)` defines the workflow body.
- `.compile()` returns the workflow definition for discovery.

## Anti-pattern: no-stage workflows

Do not create workflows whose `run` body only executes deterministic code and returns a value without creating a tracked workflow stage. That shape defeats the purpose of the workflow runtime: there is no graph node to inspect, attach to, interrupt, resume, or render.

Discovery rejects no-stage workflows with an `INVALID_DEFINITION` diagnostic because the workflow graph would be empty (`cachedLayout.length === 0`). To be valid, the run body must call at least one of:

- `ctx.task()`
- `ctx.chain()`
- `ctx.parallel()`
- `ctx.stage()`

If the entire job is deterministic TypeScript with no LLM/session interaction, use a script, custom tool, or extension command instead of a workflow. If deterministic code prepares or post-processes LLM work, keep that code in `.run()` or helpers, but pair it with a nearby tracked stage.

## Inputs

Supported input schema types are:

- `text` / `string`: optional `default: string`
- `number`: optional `default: number`
- `boolean`: optional `default: boolean`
- `select`: required `choices: string[]`, optional `default: string`

All schemas support `description` and `required`. Prefer explicit descriptions because `/workflow inputs <name>`, `/workflow <name> --help`, and the input picker show them to the user. Runtime validation rejects unknown keys, missing required values, type mismatches, and select values outside `choices`; it does not coerce strings like `"3"` to numbers.

## Run context

`ctx.inputs` contains resolved inputs.

Prefer high-level primitives for most workflows because they create tracked graph nodes, provide consistent handoff semantics, and keep definitions easier to read:

- `ctx.task(name, options)` — use for one LLM/session task with workflow tracking. This is the default choice for a single stage.
- `ctx.chain(steps, options?)` — use for dependent sequential tasks where each step consumes previous output.
- `ctx.parallel(steps, options?)` — use for independent branches that can run concurrently; supports shared task/session defaults plus `concurrency` and `failFast`.
- `ctx.ui` — use for human-in-the-loop decisions during the workflow run.

Advanced users and advanced use cases can use `ctx.stage(name, options?)` for finer-grained session control. Reach for it when `ctx.task` is too coarse and you need direct control over the underlying stage session. `StageContext` supports:

- `prompt(text, options?)`, `complete(text, options?)`
- `steer(text)`, `followUp(text)`, `subscribe(listener)`
- session metadata: `sessionId`, `sessionFile`
- model/thinking controls: `setModel`, `setThinkingLevel`, `cycleModel`, `cycleThinkingLevel`
- state access: `agent`, `model`, `thinkingLevel`, `messages`, `isStreaming`
- in-session tree navigation: `navigateTree(targetId, { summarize?, customInstructions?, replaceInstructions?, label? })`
- compaction controls: `compact(customInstructions?)`, `abortCompaction()`
- current operation abort: `abort()`

## Human-in-the-loop UI

`ctx.ui` supports:

- `input(prompt): Promise<string>`
- `confirm(message): Promise<boolean>`
- `select(message, options): Promise<T>`
- `editor(initial?): Promise<string>`

These suspend the workflow until the user responds. In interactive pi/Atomic, prompts appear in the workflow graph/input UI opened by F2 or `/workflow connect <run-id>`, not as modal chat dialogs. Always make the surrounding stage/output clear enough that the user knows what decision they are making.

## Task/session options

Common task/stage options include:

- `prompt` or `task`
- `previous` for handoff context; `{previous}` placeholder inserts it, otherwise context is appended
- `context: "fresh" | "fork"`, `forkFromSessionFile`
- `model`, `fallbackModels`, `thinkingLevel`, `scopedModels`, `modelRegistry`
- `tools`, `noTools`, `customTools`, `mcp: { allow?: string[], deny?: string[] }`
- `output`, `outputMode`, `reads`, `worktree`, `maxOutput`, `artifacts`, `sessionDir`, `cwd`, `agentDir`
- advanced SDK seams when explicitly supplied by host code: `authStorage`, `resourceLoader`, `sessionManager`, `settingsManager`, `sessionStartEvent`

`fallbackModels` retries transient provider/model failures with the primary `model` first, then each fallback, then the current pi-selected model when available. It is for rate limits, quota/auth/provider outages, unavailable models, network timeouts, and 5xx errors — not workflow-code errors, tool failures, validation failures, or cancellations. Use provider-qualified IDs when bare IDs would be ambiguous.

Chain defaults:

- first missing task uses `{task}` from chain options/root direct task
- later missing tasks use `{previous}`
- missing tasks in chain-parallel groups use `{previous}`

## Deterministic code vs stages

A stage should correspond to an LLM/session interaction. Put pure deterministic work directly in `.run()` or helper functions, not in a standalone stage. Examples: parsing, filesystem writes, JSON validation, git queries, and formatting. Pair deterministic parsing/validation with a nearby LLM call when it is part of that stage's output handling.

## Registries and programmatic execution

Use `createRegistry()` when code needs to group definitions explicitly:

```ts
import { createRegistry, defineWorkflow } from "@bastani/workflows";

const alpha = defineWorkflow("alpha")
  .run(async (ctx) => {
    const result = await ctx.task("alpha", { prompt: "Run alpha." });
    return { text: result.text };
  })
  .compile();
const registry = createRegistry().register(alpha);
registry.names();
registry.get("alpha");
```

`@bastani/workflows` is an Atomic/pi package extension. The host loads extension metadata from supported package manifest keys (new app-name keys where available plus pi-compatible metadata used by existing packages). The extension registers the `workflow` tool, `/workflow` command, renderers, widgets, and lifecycle hooks. Use these user-facing surfaces:

- `/workflow <name> key=value ...` inside pi.
- The `workflow` tool for LLM-driven orchestration and direct one-off runs.
- `runWorkflow(definition)` for explicit library/script usage.

Programmatic runner example:

```ts
import { runWorkflow, type WorkflowOptions } from "@bastani/workflows";

const definition = {
  mode: "workflow",
  workflow: "deep-research-codebase",
  inputs: {
    prompt: "map workflow sdk",
    max_partitions: 1,
    max_concurrency: 4,
  },
} as const;

const options: WorkflowOptions = {};

await runWorkflow(definition, options);

await runWorkflow({
  mode: "parallel",
  task: "Audit auth changes",
  tasks: [
    { name: "security", task: "Review security risks" },
    { name: "runtime", task: "Review runtime risks" },
  ],
  concurrency: 2,
  reads: ["research/context.md"],
  output: "research/auth-audit.md",
  outputMode: "inline",
  maxOutput: { lines: 2000 },
  artifacts: true,
});

await runWorkflow({
  mode: "chain",
  task: "Plan a safe release",
  chainName: "release-plan",
  chainDir: ".atomic/workflows/runs/release-plan",
  chain: [
    { name: "research", task: "Research release constraints for {task}" },
    { name: "plan", task: "Create a release plan from {previous}" },
  ],
});
```

The programmatic definition object mirrors the workflow tool for `mode: "workflow"` / `"named"`, `"single"`, `"parallel"`, and `"chain"` runs, including direct options and stage/session options. Direct chains support `chainName` for status/artifact grouping and `chainDir` as a shared directory for relative reads, outputs, and worktree diffs.

Workflow stage sessions follow Atomic SDK directory defaults: resource discovery starts from `.atomic` locations (`~/.atomic/agent`, `<cwd>/.atomic`) and also considers legacy `.pi` locations where the SDK supports multiple config directories. Passing `agentDir` on a stage/task is an explicit user override; passing `resourceLoader` makes that loader responsible for discovery, while `cwd`/`agentDir` still affect session naming and tool path resolution.
