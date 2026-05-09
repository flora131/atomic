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

1. **`host-bun` (default in `bun run` mode)**: when the SDK ships at a
   real on-disk path (workspace dev or `node_modules` install), the SDK
   spawns
   `bun <node_modules/@bastani/atomic-sdk/dist/cli.js> _orchestrator-entry …`
   via the host bun. Module resolution from the workflow's project tree
   resolves `@bastani/atomic-sdk` normally.
2. **`override-binary` (default in compiled-binary mode)**: when
   `pathToAtomicExecutable` is set — or the SDK auto-detects a
   compiled-binary host and defaults it to `process.execPath` — the SDK
   spawns that binary directly with the internal sub-command. The SDK's
   `@bastani/atomic-sdk/workflows` barrel installs a top-level argv
   handler at module-load time, so the spawned binary self-dispatches
   `_orchestrator-entry` automatically before its own CLI parser sees
   argv. **No consumer boilerplate required.**

## Distribution: `bun build --compile`d third-party CLIs

Compiling your CLI works out of the box — `runWorkflow` auto-defaults
`pathToAtomicExecutable` to `process.execPath` in compiled-binary
hosts, and the SDK barrel intercepts the spawned `_orchestrator-entry`
argv at module load.

```ts
// my-app/src/cli.ts — no SDK boilerplate
import { Command } from "commander";
import { runWorkflow } from "@bastani/atomic-sdk/workflows";
import workflow from "./workflow.ts";

const program = new Command("my-app");
program.command("greet").action(async () => {
  await runWorkflow({ workflow, inputs: {} });
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
compiled binary. The SDK's argv side-effect catches the sub-command
before Commander parses argv, runs the orchestrator, and exits — your
own command tree never sees those argv tokens.

## Compiled-binary hosts with disk-resident capsules

If your host CLI is built with `bun build --compile` and ships workflow
capsules to disk (e.g. `~/.<host>/workflows/<wf>.mjs`) for later dynamic
import, externalize `@opentui/core` from your capsule build so its
platform-native loader resolves against the host's already-loaded module
instead of walking parent directories from the capsule on disk:

```ts
await Bun.build({
  entrypoints: ["./workflows/my-wf.ts"],
  format: "esm",
  target: "bun",
  external: [
    "@opentui/core",
    // platform-native variants — all entries from
    // @opentui/core/package.json#optionalDependencies
    "@opentui/core-darwin-x64",
    "@opentui/core-darwin-arm64",
    "@opentui/core-linux-x64",
    "@opentui/core-linux-arm64",
    "@opentui/core-win32-x64",
    "@opentui/core-win32-arm64",
  ],
  outdir: "./dist/workflows",
});
```

This uses Bun's built-in [`external`](https://bun.com/docs/bundler) option
— the same pattern OpenTUI's own packages use in their build scripts.
`"@opentui/core"` covers the bare specifier and all subpaths
(`@opentui/core/testing`, etc.) via Bun's subpath inheritance; the
platform-native packages must be enumerated because Bun's `external` only
treats `*` as a wildcard.

You do **not** need to externalize if your host bundles workflows directly
into the binary via `hostLocalWorkflows([...])` — `bun build --compile`
already handles that static graph correctly.

The capsule ends up containing bare `@opentui/core*` specifiers. The SDK's
`_orchestrator-entry` subprocess registers the host's already-loaded
`@opentui/core` via `ensureRuntimePluginSupport` before importing the
capsule, so the bare specifiers resolve to the host's instance.

#### Idempotency contract

`ensureRuntimePluginSupport` is registered exactly once per `_orchestrator-entry` process. The SDK guards the call by reading `globalThis.__opentuiCoreRuntimePluginSupportInstalled__` — the same global key OpenTUI writes during install. When a capsule built with `@opentui/core*` externalized is dynamic-imported under `_orchestrator-entry` argv, its bundled copy of `auto-dispatch.ts` re-runs its top-level await in the same process; the sentinel is already set, so the second registration is skipped. This avoids OpenTUI's identity assertion `OpenTUI Core runtime plugin support is already installed with a different core runtime module.`, which would otherwise crash the orchestrator-entry subprocess.

Set `ATOMIC_DEBUG=1` to surface the install path on stderr:

- `[atomic-sdk:runtime-plugin] registered core loader (orchestrator-entry)` — first install in this process.
- `[atomic-sdk:runtime-plugin] skipped install (already present)` — bundled-capsule re-entry, sentinel already set.

## `pathToAtomicExecutable` escape hatch

Pass `pathToAtomicExecutable` explicitly to override the resolver and
route through a specific binary:

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
- You're pinning a specific atomic build for reproducibility.
- You want to override the SDK's compiled-host auto-default with a
  different binary.

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
- For `bun build --compile` consumers: usually shouldn't fire — the SDK
  auto-defaults `pathToAtomicExecutable` to `process.execPath`. Only
  reachable if you explicitly passed an empty override.
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
