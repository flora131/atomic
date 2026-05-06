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

When this example is compiled with `bun build --compile`, the SDK's
bundled cli.js is bunfs-only and the host-bun resolver branch can't
fire. Route the orchestrator through the consumer's own binary by
importing `handleSelfDispatch` at the top of `cli.ts` and passing
`pathToAtomicExecutable: process.execPath` to `runWorkflow`.

See `packages/atomic-sdk/README.md → Distribution` for the canonical
pattern and `tests/fixtures/sdk-compiled-consumer/` for an end-to-end
example with a smoke matrix that runs across all supported platforms.
