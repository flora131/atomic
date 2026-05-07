# custom-workflow-bunx

Canonical example of a custom atomic workflow distributed via `bunx`. Registers a single Claude workflow, `explain-file`, that takes a path input and opens a Claude pane that walks through the file.

## Setup

Add the binary to your atomic settings:

```json
{
  "workflows": {
    "explain-file": {
      "command": "bunx",
      "args": ["@example/custom-workflow-bunx"],
      "agents": ["claude"]
    }
  }
}
```

On startup atomic spawns `bunx @example/custom-workflow-bunx _emit-workflow-meta --dispatch-token=…` to discover the workflow. Running `atomic workflow -n explain-file -a claude --path src/cli.ts` spawns `bunx @example/custom-workflow-bunx _atomic-run --dispatch-token=… --name explain-file --agent claude --path src/cli.ts`.

See `index.ts` for the `defineWorkflow → compile → hostLocalWorkflows([wf])` pattern. Read `docs/atomic-sdk/host-local-workflows.md` for the full reference.

## Run standalone

`hostLocalWorkflows([wf])` doubles as a CLI runner. With a single workflow registered, the `--name` flag is optional — just pass inputs:

```sh
# Bare — prints registered workflows + invocation hint
bun run ./index.ts

# Foreground (attaches to the orchestrator pane in tmux)
bun run ./index.ts --path src/cli.ts

# Background — returns immediately
bun run ./index.ts --path src/cli.ts --detach
```

When multiple workflows are registered, pass `--name <workflow>` to disambiguate (and `--agent <agent>` when the same name covers multiple agents).

Want full control of argv? Don't call `hostLocalWorkflows`. Import `runWorkflow` from `@bastani/atomic-sdk` and dispatch yourself — you'll trade atomic auto-discovery for full CLI flexibility.
