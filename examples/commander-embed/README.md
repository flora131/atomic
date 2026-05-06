# commander-embed

Mount an atomic workflow under a parent Commander CLI by calling `runWorkflow({ workflow, inputs })` inside a Commander action — alongside a plain Commander sibling command. No re-entry boilerplate: the SDK ships its own orchestrator entry script.

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

`bun build --compile` works without any boilerplate. The SDK auto-
defaults `pathToAtomicExecutable` to `process.execPath` in compiled-
binary hosts, and the `@bastani/atomic-sdk/workflows` barrel installs
an argv handler at module-load time so the spawned
`_orchestrator-entry` self-dispatches before Commander parses argv.

See `packages/atomic-sdk/README.md → Distribution` for the canonical
pattern and `tests/fixtures/sdk-compiled-consumer/` for an end-to-end
example with a smoke matrix that runs across all supported platforms.
