# Custom workflows

Atomic 2 daemon mode supports custom workflows as direct-import source files. Legacy subprocess discovery/dispatch is removed: there is no `hostLocalWorkflows`, `_emit-workflow-meta`, or `_atomic-run` path.

## Configure a workflow

Add a `workflows` entry to either `~/.atomic/settings.json` or `<project>/.atomic/settings.json`:

```jsonc
{
  "workflows": {
    "explain-file": {
      "command": "/absolute/path/to/workflow.ts",
      "agents": ["claude"]
    }
  }
}
```

`command` must point directly to an importable `.ts`, `.tsx`, `.js`, `.mjs`, or `.cjs` workflow source file. `args` are not supported in daemon mode.

## Workflow source shape

Export a compiled workflow definition:

```ts
import { defineWorkflow } from "@bastani/atomic-sdk";

export default defineWorkflow({
  name: "explain-file",
  inputs: [{ name: "path", type: "string", required: true }],
})
  .for("claude")
  .run(async (ctx) => {
    await ctx.stage({ name: "explain" }, {}, {}, async (s) => {
      await s.session.query(`Explain ${ctx.inputs.path}`);
      await s.save(s.sessionId);
    });
  })
  .compile();
```

A single source file may export multiple compiled workflow definitions as named exports; Atomic selects the definition matching the configured agent and the requested workflow name.

## Refresh and inspect

```sh
atomic workflow refresh
atomic workflow list
atomic workflow inputs explain-file -a claude
```

The daemon dispatch path is JSON-RPC `workflow/start` with `{ source, workflowName, agent, inputs }`. The daemon imports `source` and runs the matching compiled definition in-process.
