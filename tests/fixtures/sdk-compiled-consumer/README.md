# sdk-compiled-consumer fixture

End-to-end validation that a third-party CLI calling `runWorkflow` from
`@bastani/atomic-sdk/workflows` works under both **`bun run`** and
**`bun build --compile`** distribution shapes.

## Why this exists

`runWorkflow` spawns the orchestrator pane in a fresh sub-process. The
SDK resolves a dispatcher in two ways:

1. **`host-bun`** (default when the SDK ships at a real on-disk path):
   spawn `bun <node_modules/@bastani/atomic-sdk/dist/cli.js> _orchestrator-entry …`.
2. **`override-binary`** (`pathToAtomicExecutable` set): spawn that
   binary directly. The SDK auto-defaults to `process.execPath` in
   compiled-binary hosts so the consumer's own binary self-dispatches
   the internal sub-command — no consumer boilerplate required.

The fixture validates both branches end-to-end on every supported
platform.

## Layout

| File | Role |
|---|---|
| `src/cli.ts` | Minimal Commander CLI. No SDK boilerplate — the SDK barrel intercepts argv at module-load time. |
| `src/workflow.ts` | Trivial `defineWorkflow` — single echo step |
| `scripts/smoke.ts` | Six-step smoke matrix runner |

## Smoke matrix

```sh
bun tests/fixtures/sdk-compiled-consumer/scripts/smoke.ts [--skip-steps 4,5] [--verbose]
```

| Step | Action | Assertion |
|---|---|---|
| 1 | `bun install` | Exit 0 |
| 2 | host-bun: `bun src/cli.ts greet --who=smoke-host` | stdout `workflow:launched`; stderr `kind=host-bun` |
| 3 | `bun run compile` (`bun build --compile`) | `dist/my-app` exists |
| 4 | compiled: `dist/my-app greet --who=smoke-compiled` | stdout `workflow:launched`; stderr `kind=override-binary` |
| 5 | compiled w/ `ATOMIC_DISABLE_DEFAULT_EXEC=1` (no dispatcher) | exit ≠ 0; stderr `NoDispatcherError`; tmux session NOT created |
| 6 | host-bun re-run | stdout `workflow:launched` (idempotency) |

Steps 2, 4, 6 require tmux on PATH (Linux/macOS) or psmux (Windows).

## How the compiled path works

```ts
// src/cli.ts — no SDK boilerplate at the top
import { Command } from "@commander-js/extra-typings";
import { runWorkflow } from "@bastani/atomic-sdk/workflows";
import { greetWorkflow } from "./workflow.ts";

const program = new Command("my-app");
program.command("greet").action(async (opts) => {
  await runWorkflow({
    workflow: greetWorkflow,
    inputs: { who: opts.who },
    detach: true,
    // pathToAtomicExecutable left unset — SDK auto-defaults to
    // process.execPath in compiled-binary hosts.
  });
  console.log("workflow:launched");
});

await program.parseAsync();
```

When `runWorkflow` spawns the orchestrator pane, the launcher script
runs `<my-app> _orchestrator-entry <name> <agent> <inputsB64> <source>`
which re-enters the same compiled binary. The SDK's
`@bastani/atomic-sdk/workflows` barrel installs a top-level argv
handler that catches the internal sub-command at module-load time —
before Commander parses argv — runs the orchestrator, and exits.

## Cross-platform CI

The fixture is exercised by `.github/workflows/sdk-fixture-smoke.yml` on
every PR touching `packages/atomic-sdk/**`, `packages/atomic/**`, or the
fixture itself. Matrix:

| Platform | Arch | Runner | Notes |
|---|---|---|---|
| Linux | x64 (glibc) | `ubuntu-latest` | |
| Linux | x64 (musl) | `ubuntu-latest` + `oven/bun:alpine` container | |
| Linux | arm64 (glibc) | `ubuntu-24.04-arm` | |
| macOS | arm64 | `macos-latest` (Apple Silicon) | |
| macOS | x64 | `macos-26-intel` | |
| Windows | x64 | `windows-latest` | |

Linux arm64 musl and Windows arm64 are blocked on missing GitHub-hosted
runners; tracked in `.github/workflows/sdk-fixture-smoke.yml` as TODOs.
