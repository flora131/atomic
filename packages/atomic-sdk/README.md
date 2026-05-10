# @bastani/atomic-sdk

TypeScript SDK for Atomic — define and run multi-agent coding workflows from TypeScript projects and compiled CLIs.

## Installation

```bash
bun add @bastani/atomic-sdk
```

Atomic 2 dispatch is daemon-first. `runWorkflow` ensures the Atomic daemon is running, connects over JSON-RPC, and sends `workflow/start` with `{ source, workflowName, agent, inputs }`.

## Quickstart

```ts
import { closeDaemonConnection, defineWorkflow, runWorkflow } from "@bastani/atomic-sdk/workflows";

const workflow = defineWorkflow({
  name: "hello",
  description: "A minimal greeting workflow",
  inputs: [{ name: "who", type: "string", required: true }],
})
  .for("claude")
  .run(async (ctx) => {
    await ctx.stage({ name: "greet" }, {}, {}, async (s) => {
      await s.session.query(`Say hello to ${ctx.inputs.who}`);
      await s.save(s.sessionId);
    });
  })
  .compile();

const result = await runWorkflow({ workflow, inputs: { who: "World" } });
closeDaemonConnection(result.daemon);
```

## Dispatch model

There is no SDK-bundled CLI dispatcher, no argv self-dispatch, and no `hostLocalWorkflows` helper. The old hidden subcommands (`_orchestrator-entry`, `_emit-workflow-meta`, `_atomic-run`, `_cc-debounce`) are removed.

`runWorkflow`:

1. Resolves or starts the Atomic daemon (`atomic --ui-server`).
2. Opens a JSON-RPC connection.
3. Sends `workflow/start` with the compiled workflow's source path, name, agent, and validated inputs.
4. In foreground mode, waits for `run/ended`; in detached mode, returns after start acknowledgement.

`runWorkflow` returns the live daemon connection so advanced callers can subscribe to notifications. One-shot CLIs should call `closeDaemonConnection(result.daemon)` before exiting.

## Compiled CLIs

`bun build --compile` works without special boilerplate because the compiled app remains a JSON-RPC client of the daemon:

```ts
import { Command } from "commander";
import { closeDaemonConnection, runWorkflow } from "@bastani/atomic-sdk/workflows";
import workflow from "./workflow.ts";

const program = new Command("my-app");
program.command("greet").action(async () => {
  const result = await runWorkflow({ workflow, inputs: {} });
  closeDaemonConnection(result.daemon);
});
await program.parseAsync();
```

## `pathToAtomicExecutable`

Pass `pathToAtomicExecutable` to control which Atomic binary is used when the SDK needs to spawn the daemon:

```ts
const result = await runWorkflow({
  workflow,
  inputs: { who: "World" },
  pathToAtomicExecutable: "/usr/local/bin/atomic",
});
closeDaemonConnection(result.daemon);
```

## API

- `defineWorkflow(options).for(agent).run(fn).compile()` — compile a workflow definition.
- `runWorkflow(options)` — run a compiled workflow through daemon JSON-RPC.
- `closeDaemonConnection(connection)` — close the returned daemon connection when a one-shot CLI is done.
- `listSessions()`, `getSession()`, `stopSession()`, `attachSession()` — daemon-backed session primitives.

Import paths:

```ts
import { defineWorkflow } from "@bastani/atomic-sdk/define-workflow";
import { closeDaemonConnection, runWorkflow } from "@bastani/atomic-sdk/workflows";
```

## Examples

See [`examples/`](../../examples/) in the Atomic repository.
