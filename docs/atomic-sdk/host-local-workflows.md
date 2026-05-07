# hostLocalWorkflows

`hostLocalWorkflows` is the single entry point that turns your file into both an atomic-dispatchable workflow host AND a standalone CLI runner. Call it once after `defineWorkflow({...}).compile()` and it:

1. Handles atomic's `_emit-workflow-meta` and `_atomic-run` sub-commands when token-gated.
2. Handles direct CLI invocation — `bun run my-cli.ts [--name <X>] [--<input> <v>]…` runs the workflow without atomic in the loop. With one workflow registered, `--name` is optional.
3. Prints registered workflows + invocation hint when invoked with no flags (`bun run my-cli.ts`), so newcomers see what's available.
4. Registers the supplied workflows into a process-local registry so the orchestrator pane that atomic spawns later can resolve them by `(name, agent)` — no `export default` boilerplate required.

**Opt-out by absence.** Want full argv control or a totally different CLI structure? Don't call `hostLocalWorkflows`. Import `runWorkflow` from `@bastani/atomic-sdk` and dispatch yourself — you'll lose atomic's automatic discovery (`_emit-workflow-meta`) but keep complete flexibility.

## Why explicit?

ESM evaluation is depth-first: a dependency module's body runs **before** its importer's body. If the SDK ran the meta-emit / dispatch handler at module load (top-level `await`), it would execute before the user CLI's `defineWorkflow().compile()` line — draining an empty registry and `process.exit(0)`-ing the user's main(). Explicit `hostLocalWorkflows([wf])` after `compile()` removes that race.

The `_orchestrator-entry` and `_cc-debounce` subs continue to dispatch at module load — they don't depend on user-registered state.

## Usage

```ts
#!/usr/bin/env bun
import { defineWorkflow, hostLocalWorkflows } from "@bastani/atomic-sdk";

const wf = defineWorkflow({
  name: "explain-file",
  description: "Open a Claude pane that walks through a file",
  source: import.meta.path,
  inputs: [
    { name: "path", type: "text", required: true, description: "file to explain" },
  ],
})
  .for("claude")
  .run(async (ctx) => {
    await ctx.stage({ name: "explain" }, {}, {}, async (s) => {
      await s.session.query(`Read ${ctx.inputs.path} and walk me through it.`);
      s.save(s.sessionId);
    });
  })
  .compile();

await hostLocalWorkflows([wf]);

// Your CLI's main() continues here when not invoked by atomic.
```

Register the binary in your atomic settings:

```json
{
  "workflows": {
    "explain-file": {
      "command": "bunx",
      "args": ["@example/my-workflows"],
      "agents": ["claude"]
    }
  }
}
```

## API

```ts
export interface HostLocalWorkflowsOptions {
  argv?: readonly string[]; // defaults to process.argv
  env?: Record<string, string | undefined>; // defaults to process.env
}

export async function hostLocalWorkflows(
  workflows: readonly WorkflowDefinition[],
  options?: HostLocalWorkflowsOptions,
): Promise<void>;
```

## Behavior

`hostLocalWorkflows`:

1. Registers the supplied `workflows` into a process-local registry keyed by `(agent, name)`. The orchestrator pane atomic spawns later re-imports the file and uses this registry to resolve the definition — no `export default` required.
2. Atomic dispatch — inspects `argv` for `_emit-workflow-meta` / `_atomic-run` and validates the dispatch token (`ATOMIC_HOST=1` env + `--dispatch-token=<hex>` argv must match `ATOMIC_DISPATCH_TOKEN` env). When matched:
   - `_emit-workflow-meta`: writes `ATOMIC_WORKFLOW_META: <json>\n` to stdout, exits 0.
   - `_atomic-run`: parses `--name <X> --agent <Y> [--detach] [--<input> <v>]…`, runs via `runWorkflow`, exits 0 on success / 1 on error.
   - When the sub-command is present but the token doesn't validate (a hijack attempt — e.g. `bunx my-pkg _emit-workflow-meta` from a user terminal without `ATOMIC_HOST=1`), returns silently so the consumer's own main() runs.
3. Direct CLI invocation — `bun run script.ts [--name <X>] [--agent <Y>] [--<input> <v>]… [--detach]`. With a single workflow registered, `--name` is optional and the only workflow is auto-targeted. With multiple workflows + flags-but-no-`--name`, exits 1 with a "specify --name" error.
4. Bare invocation (`bun run script.ts` with no flags) — prints registered workflows + invocation hint, exits 0.

## See also

- Settings schema and full custom-workflow guide: [`docs/settings/custom-workflows.md`](../settings/custom-workflows.md).
