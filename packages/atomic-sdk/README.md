# @bastani/atomic-sdk

TypeScript SDK for [atomic](https://github.com/flora131/atomic) — define
and run multi-agent coding workflows from any TypeScript project or
compiled CLI.

## Installation

```bash
bun add @bastani/atomic-sdk
```

The SDK ships its own prebundled CLI dispatcher and does not pull any
per-platform binary packages. No extra step needed for development or
production installs via a package manager.

## Quickstart

```ts
import { defineWorkflow, runWorkflow } from "@bastani/atomic-sdk/workflows";

const workflow = defineWorkflow({
  name: "hello",
  agent: "claude",
  description: "A minimal greeting workflow",
  inputs: [{ name: "who", description: "Name to greet", required: true }],
  run: async ({ inputs, claude }) => {
    await claude.prompt(`Say hello to ${inputs.who}`);
  },
});

await runWorkflow({ workflow, inputs: { who: "World" } });
```

## How `runWorkflow` dispatches the orchestrator

`runWorkflow` spawns the orchestrator pane in a fresh sub-process. The
SDK resolves the dispatcher in two ways:

1. **`host-bun` (default)**: when the SDK ships at a real on-disk path
   (workspace dev or `node_modules` install), the SDK spawns
   `bun <node_modules/@bastani/atomic-sdk/dist/cli.js> _orchestrator-entry …`
   via the host bun. Module resolution from the workflow's project tree
   resolves `@bastani/atomic-sdk` normally.
2. **`override-binary`**: when `pathToAtomicExecutable` is set, the SDK
   spawns that binary directly with the internal sub-command. Atomic's
   own CLI binary handles `_orchestrator-entry` natively; third-party
   compiled CLIs opt in via the `handleSelfDispatch` helper.

The SDK never defaults to `process.execPath`. In a compiled third-party
CLI `process.execPath` is the consumer's binary, not Atomic's, and the
SDK keeps that detail outside its boundary — the consumer chooses.

## Distribution: `bun build --compile`d third-party CLIs

When a consumer compiles their own CLI with `bun build --compile`, the
SDK's bundled cli.js is stored inside the binary's bunfs filesystem and
**cannot** be spawned as a separate process from outside the binary.
The host-bun branch therefore can't fire.

The intended pattern is to route through the consumer's own binary so
that `_orchestrator-entry` self-dispatches via the SDK's
`handleSelfDispatch` interceptor:

```ts
// my-app/src/cli.ts
import { handleSelfDispatch } from "@bastani/atomic-sdk/dispatcher";
await handleSelfDispatch();   // catches argv[2] === "_orchestrator-entry" /
                              // "_cc-debounce" before Commander parses argv

import { Command } from "commander";
import { runWorkflow } from "@bastani/atomic-sdk/workflows";
import workflow from "./workflow.ts";

const program = new Command("my-app");
program.command("greet").action(async () => {
  await runWorkflow({
    workflow,
    inputs: {},
    pathToAtomicExecutable: process.execPath,  // route through this binary
  });
});
await program.parseAsync();
```

Build and ship a single binary:

```bash
bun build --compile --outfile dist/my-app src/cli.ts
./dist/my-app greet
```

When `runWorkflow` spawns the orchestrator pane it runs
`<my-app> _orchestrator-entry <args>`, which re-enters the same
compiled binary. `handleSelfDispatch()` catches the internal
sub-command before Commander, runs the orchestrator, and exits — the
consumer's own command tree never sees those argv tokens.

## `pathToAtomicExecutable` escape hatch

Pass `pathToAtomicExecutable` to `runWorkflow` to bypass the automatic
resolver entirely:

```ts
await runWorkflow({
  workflow,
  inputs: { who: "World" },
  pathToAtomicExecutable: "/usr/local/bin/atomic",
});
```

The value is **binary-only** — bare command names PATH-resolve at exec
time. For example, `"atomic"` resolves whichever `atomic` binary is
first on `PATH` when the workflow session launches:

```ts
await runWorkflow({
  workflow,
  inputs: {},
  pathToAtomicExecutable: "atomic", // resolves via PATH at exec time
});
```

This mirrors the
[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
behavior for `pathToClaudeCodeExecutable`.

Use this option when:

- The consumer ships `atomic` via a separate installer (e.g., Homebrew,
  a company-managed package) and wants the workflow to route through
  that copy.
- The consumer compiles their own CLI and wants the SDK to dispatch
  back to it (`pathToAtomicExecutable: process.execPath` + `handleSelfDispatch`).

## `NoDispatcherError` semantics

When `runWorkflow` cannot locate any dispatcher, it throws
`NoDispatcherError` **before** creating the tmux session — no
side-effects are left behind.

```ts
import { NoDispatcherError } from "@bastani/atomic-sdk/errors";

try {
  await runWorkflow({ workflow, inputs: {} });
} catch (err) {
  if (err instanceof NoDispatcherError) {
    console.error("Could not locate atomic SDK dispatcher.");
    console.error("Searched:", err.searchedFor.join(", "));
  }
}
```

**Surface fields:**

| Field | Type | Description |
| --- | --- | --- |
| `name` | `"NoDispatcherError"` | Error discriminant |
| `searchedFor` | `ReadonlyArray<string>` | Specifiers tried, in order |
| `message` | `string` | Human-readable summary with remediation hint |

**Recommended remediation:**

- For `bun run`: reinstall `@bastani/atomic-sdk` so the SDK's bundled
  cli.js is reachable on disk.
- For `bun build --compile` consumers: import `handleSelfDispatch` and
  pass `pathToAtomicExecutable: process.execPath` (see
  [Distribution](#distribution-bun-build---compiled-third-party-clis)).
- Or supply a path to any binary that handles
  `_orchestrator-entry` / `_cc-debounce` directly.

## API

- `defineWorkflow(definition)` — compile a workflow definition.
- `runWorkflow(options)` — spawn the orchestrator tmux session.
- `attachSession(id)` — attach to an existing workflow session.
- `listSessions()` — list active workflow sessions.

Import paths:

```ts
import { defineWorkflow }       from "@bastani/atomic-sdk/define-workflow";
import { runWorkflow }          from "@bastani/atomic-sdk/workflows";
import { handleSelfDispatch }   from "@bastani/atomic-sdk/dispatcher";
import { NoDispatcherError }    from "@bastani/atomic-sdk/errors";
```

## Examples

See [`examples/`](../../examples/) in the atomic repository:

- [`commander-embed`](../../examples/commander-embed/) — embed a workflow
  inside a parent Commander CLI
- [`review-fix-loop`](../../examples/review-fix-loop/) — bounded
  draft → review → fix loop
- [`multi-workflow`](../../examples/multi-workflow/) — multiple workflows
  in one CLI
