# commander-embed

Mount an atomic workflow under a parent Commander CLI with the shared `runExampleWorkflow` helper — alongside a plain Commander sibling command. In an interactive terminal, the helper starts the daemon workflow and mounts the Atomic panel so you can see the workflow pane. No re-entry boilerplate: the SDK talks to the Atomic daemon over JSON-RPC.

## Run

```bash
bun install
bun run cli.ts greet --who=Alex
bun run cli.ts status                # plain Commander sibling
bun run cli.ts --help                # all commands
```

## What's here

- `claude/` — the embedded workflow
- `cli.ts` — parent Commander tree with `greet` (workflow) and `status` (plain command)

## Distribution (compiled binaries)

`bun build --compile` works without any boilerplate because workflow starts connect to the Atomic daemon instead of relying on hidden argv self-dispatch.

See `tests/fixtures/sdk-compiled-consumer/` for an end-to-end example with a smoke matrix.
