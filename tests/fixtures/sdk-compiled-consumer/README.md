# sdk-compiled-consumer fixture

End-to-end validation that a third-party CLI calling `runWorkflow` from `@bastani/atomic-sdk/workflows` works in both source and `bun build --compile` modes.

Atomic 2 uses the daemon JSON-RPC transport. There is no SDK-bundled CLI dispatcher and no hidden argv self-dispatch in this fixture.

## Files

| Path | Purpose |
| --- | --- |
| `src/cli.ts` | Minimal Commander CLI that calls `runWorkflow` |
| `src/workflow.ts` | Trivial compiled workflow |
| `scripts/smoke.ts` | Smoke matrix for source and compiled execution |

## Smoke matrix

1. `bun install`
2. host-bun: `bun src/cli.ts greet`
3. `bun run compile`
4. compiled: `dist/my-app greet`
5. host-bun re-run to check idempotency
