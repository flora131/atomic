# Agent Setup Recipe

A deterministic recipe for getting a user from "empty terminal" to "first workflow runs" in one session. This is the path to follow whenever the user signals they want to start using the workflow SDK from zero — phrases like *"set me up with the workflow SDK"*, *"I want to write workflows"*, *"bootstrap a workflow project"*, *"how do I get started"*, or any equivalent. If the user already has `@bastani/atomic-sdk` installed and a workflow file exists, jump to step 5.

## Why this recipe exists

Bootstrapping is the highest-friction moment of the SDK because three of the runtime dependencies live outside `bun add`:

- **Bun** — the SDK uses `Bun.spawn` and Bun-specific module resolution. It will not run on Node.
- **A terminal multiplexer** — tmux on macOS/Linux, psmux on Windows. Every `ctx.stage()` runs inside a detachable session on the `atomic` socket.
- **An authenticated agent CLI** — `claude`, `copilot`, or `opencode`. The runtime spawns these at each stage; if the binary is missing or unauthenticated, the first stage will fail with an error the user has no way to interpret.

A user hitting `bun add @bastani/atomic-sdk` in an empty project and then running their workflow will see one of these three blow up 30 seconds in with a stack trace that does not name the missing piece. This recipe checks all three up front and surfaces the missing one as a one-line fix. It also wires the typed errors the SDK throws (`MissingDependencyError`, `SessionNotFoundError`, `WorkflowNotCompiledError`, `InvalidWorkflowError`, `IncompatibleSDKError`) to actionable messages — so when something does fail later, the user sees a sentence, not a stack.

Treat the steps below as a checklist, not a script. Read each step before running anything; tell the user what you found and what you're about to do; only proceed when each precondition is satisfied. Skipping a step "because it probably works" is what makes setup feel flaky.

## Step 1 — Detect what's already there

Run these in parallel and read the output yourself before relaying anything to the user. If a check fails, stop the recipe and surface the fix before moving on:

```bash
bun --version              # Bun
which tmux || where.exe psmux 2>/dev/null   # multiplexer
claude --version 2>/dev/null               # only one of these matters —
opencode --version 2>/dev/null             # the user picks the agent in step 2
copilot --version 2>/dev/null
ls package.json 2>/dev/null                # is this an existing project?
```

| Missing | Fix to recommend |
|---|---|
| Bun | `curl -fsSL https://bun.sh/install \| bash` (macOS/Linux) or `powershell -c "irm bun.sh/install.ps1 \| iex"` (Windows) |
| tmux/psmux | `brew install tmux` / `apt install tmux` / etc. on macOS+Linux; [psmux](https://github.com/psmux/psmux) on Windows |
| Agent CLI | Direct the user to the agent's install/auth page — Claude Code (`code.claude.com/docs`), OpenCode (`opencode.ai`), Copilot CLI (`github.com/features/copilot/cli`) |

Do not attempt the install yourself unless the user has explicitly approved it — `curl | bash` is a remote-exec that warrants confirmation. Print the suggested command and let the user kick it off.

If the user is on a devcontainer with `ghcr.io/flora131/atomic/<agent>:1` in `.devcontainer/devcontainer.json`, all three are already installed and authenticated — skip the prereq checks and tell them so.

## Step 2 — Pick the agent (and confirm intent)

Ask the user which agent they're targeting and whether they want one or multiple. The answer drives steps 4 and 5.

- **One agent** → scaffold one `<agent>.ts` workflow file + one `<agent>-worker.ts` composition root. This is the 90% case; recommend it unless the user pushes back.
- **Multiple agents, same workflow logic** → scaffold one workflow file per agent under `src/workflows/<name>/` plus a single `src/cli.ts` that uses `createRegistry()` to dispatch.
- **Multiple workflows, one agent** → scaffold each workflow under `src/workflows/<name>/` and either ship multiple worker files or use the registry pattern.

Don't guess. Use `AskUserQuestion` (or the equivalent) when intent is unclear — picking wrong here means rewriting 100% of the scaffold.

## Step 3 — Bootstrap the project

If `package.json` already exists, skip `bun init`. Otherwise:

```bash
bun init -y
```

Add the SDK plus only the provider package(s) the user picked:

```bash
bun add @bastani/atomic-sdk
bun add @anthropic-ai/claude-agent-sdk     # only if Claude
bun add @github/copilot-sdk                # only if Copilot
bun add @opencode-ai/sdk                   # only if OpenCode
bun add @commander-js/extra-typings        # for the worker; swap for citty/yargs if the user prefers
```

If the user has `npm install`, `yarn add`, or any non-Bun command on file, gently redirect — the SDK will not work under Node, full stop.

## Step 4 — Scaffold the workflow file

Drop into `src/workflows/<name>/<agent>.ts`. The convention is one directory per workflow, one file per agent — this keeps `src/workflows/<name>/helpers/` available for SDK-agnostic logic when the user does want cross-agent support later. The naming matters because every reference doc and every agent looking at the codebase finds files the same way.

Always include `source: import.meta.path` — the runtime re-imports the module from this path inside the orchestrator child process. Forget it and the workflow loads fine but `runWorkflow` blows up at spawn time with `InvalidWorkflowError`.

### Claude template

```ts
// src/workflows/<name>/claude.ts
import { defineWorkflow } from "@bastani/atomic-sdk/workflows";

export default defineWorkflow({
  name: "<workflow-name>",
  source: import.meta.path,
  description: "<one-line description>",
  inputs: [
    { name: "prompt", type: "text", required: true, description: "what the user supplies" },
  ],
})
  .for("claude")
  .run(async (ctx) => {
    await ctx.stage({ name: "step-1" }, {}, {}, async (s) => {
      await s.session.query(ctx.inputs.prompt ?? "");
      s.save(s.sessionId);
    });
  })
  .compile();
```

### Copilot template

```ts
.for("copilot")
.run(async (ctx) => {
  await ctx.stage({ name: "step-1" }, {}, {}, async (s) => {
    await s.session.send({ prompt: ctx.inputs.prompt ?? "" });
    s.save(await s.session.getMessages());
  });
})
.compile();
```

### OpenCode template

```ts
.for("opencode")
.run(async (ctx) => {
  await ctx.stage({ name: "step-1" }, {}, { title: "step-1" }, async (s) => {
    const result = await s.client.session.prompt({
      sessionID: s.session.id,
      parts: [{ type: "text", text: ctx.inputs.prompt ?? "" }],
    });
    s.save(result.data!);
  });
})
.compile();
```

The `s.save(...)` call shape differs per agent on purpose — see `getting-started.md` "Saving Transcripts" for the per-provider rationale.

## Step 5 — Scaffold the composition root

The SDK ships pure primitives, not a CLI wrapper. The user composes them into whatever CLI library they prefer. Default to Commander unless they say otherwise.

### Single workflow worker

```ts
// src/<agent>-worker.ts
import { Command } from "@commander-js/extra-typings";
import {
  getInputSchema,
  runWorkflow,
  MissingDependencyError,
  SessionNotFoundError,
} from "@bastani/atomic-sdk/workflows";
import workflow from "./workflows/<name>/<agent>.ts";

const program = new Command();
for (const input of getInputSchema(workflow)) {
  program.option(`--${input.name} <value>`, input.description ?? "");
}
program.action(async (rawOpts) => {
  try {
    await runWorkflow({ workflow, inputs: rawOpts as Record<string, string> });
  } catch (err) {
    if (err instanceof MissingDependencyError) {
      console.error(`Missing dependency: ${err.dependency}. Install it and rerun.`);
      process.exit(1);
    }
    throw err;
  }
});
await program.parseAsync();
```

The typed-error catch is small but it pays for itself the first time `tmux` is missing — the user gets one actionable line instead of an SDK stack trace. Add more `instanceof` branches as the surface grows (see Step 8).

### Multi-workflow CLI

When the user picks "multiple workflows, one CLI", swap the worker for a registry-driven composition root:

```ts
// src/cli.ts
import { Command } from "@commander-js/extra-typings";
import {
  createRegistry,
  getInputSchema,
  getName,
  listWorkflows,
  runWorkflow,
} from "@bastani/atomic-sdk/workflows";
import flowA from "./workflows/<name-a>/<agent>.ts";
import flowB from "./workflows/<name-b>/<agent>.ts";

const registry = createRegistry().register(flowA).register(flowB);
const program = new Command("my-app");
for (const wf of listWorkflows(registry)) {
  const sub = program.command(getName(wf)).description(wf.description);
  for (const input of getInputSchema(wf)) {
    sub.option(`--${input.name} <value>`, input.description ?? "");
  }
  sub.action(async (rawOpts) => {
    await runWorkflow({ workflow: wf, inputs: rawOpts as Record<string, string> });
  });
}
await program.parseAsync();
```

Every `(agent, name)` key must be unique across the registry — registering a duplicate throws immediately at startup, which is intentional. Agents reading the codebase rely on stable keys.

## Step 6 — Add a `typecheck` script

The biggest payoff for catching mistakes early is `bunx tsc --noEmit`. Wire it into `package.json`:

```jsonc
{
  "scripts": {
    "typecheck": "bunx tsc --noEmit"
  }
}
```

Then run it once before any execution:

```bash
bun run typecheck
```

If this fails, fix the errors before moving on — typecheck failures here usually mean a missing `.compile()`, a mistyped `.for(...)` agent, or an `inputs` field accessed but never declared. All three become silent runtime errors otherwise.

## Step 7 — Smoke test

Run the workflow attached the first time so the user can watch a tmux pane spawn and see Claude/Copilot/OpenCode actually respond:

```bash
bun run src/<agent>-worker.ts --prompt "Reply with the single word 'ok'"
```

Three things to verify:

1. **The pane appears** — tmux opens, the agent welcome banner renders, the prompt fires. If the pane never opens, the multiplexer check from Step 1 was wrong.
2. **The agent replies** — within ~30s the agent prints back `ok`. If it sits idle, the agent CLI is probably not authenticated; rerun `claude` / `opencode` / `copilot` and complete the auth flow.
3. **The session ends cleanly** — `s.save(...)` flushes, the orchestrator exits, the user lands back on their shell. If the orchestrator hangs, see `failure-modes.md`.

After the attached run works, demonstrate the detached path:

```bash
bun run src/<agent>-worker.ts --prompt "..." # then in your worker, set detach: true once the user wants it
```

For a worker that supports both, expose `--detach` as a Commander flag and pass `detach: true` to `runWorkflow`. Sessions started detached show up in `atomic session list` (and via `listSessions({ scope: "workflow" })` from your own CLI) — they keep running on the shared `atomic` tmux socket regardless of the terminal.

## Step 8 — Failure recovery (typed errors)

The SDK throws typed errors from `@bastani/atomic-sdk` so callers can pattern-match without parsing message text. When you wire user-facing CLIs, add `instanceof` branches for the ones that need a friendly message:

| Error | When | Friendly message |
|---|---|---|
| `MissingDependencyError` | tmux / psmux / bun is not on `PATH` at runtime | `Missing dependency: <dep>. Install it (see prereqs) and rerun.` |
| `SessionNotFoundError` | `attachSession`/`nextWindow`/`previousWindow`/`gotoOrchestrator` called with an id that's not on the atomic socket | `session not found: <id>. Run "atomic session list" or list via listSessions() to see what's running.` |
| `WorkflowNotCompiledError` | The dev forgot `.compile()` at the end of `defineWorkflow(...)` | The error message itself is the fix — surface as-is. |
| `InvalidWorkflowError` | The imported file's default export isn't a `WorkflowDefinition` | Ditto — surface the message; it tells the dev to add `defineWorkflow(...).compile()`. |
| `IncompatibleSDKError` | The workflow declares `minSDKVersion` newer than the `@bastani/atomic-sdk` version in the project | Tell the user to run `bun update @bastani/atomic-sdk` in the workflow's project or relax the workflow's `minSDKVersion`. Import the class from `@bastani/atomic-sdk/errors` (it's not exported from the `/workflows` barrel). |

Don't catch errors you don't know how to render — let them throw. A blanket `catch (err) { console.error(err) }` defeats the typed surface.

## Step 9 — Hand off

Once the smoke test passes, the user owns the project. Tell them:

- **Where the workflow lives** — `src/workflows/<name>/<agent>.ts`. Edits there change the pipeline shape.
- **Where the entry point lives** — `src/<agent>-worker.ts` (or `src/cli.ts` for the registry shape). Edits there change the user-facing flag surface.
- **How to monitor** — `atomic session list` for a system-wide view, `atomic workflow status <id>` for one run, or wire `listSessions` / `getSessionStatus` into their own CLI's subcommands. The pane-navigation primitives (`nextWindow`, `previousWindow`, `gotoOrchestrator`, `detachSession`) drive tmux directly without taking over the user's terminal — import them from the **root** `@bastani/atomic-sdk` barrel (not `/workflows`); see `examples/pane-navigation/` for a reference driver CLI.
- **What to read next** — `references/getting-started.md` for the SDK exports table, `references/control-flow.md` for loops/parallel/headless, `references/state-and-data-flow.md` for `s.save`/`s.transcript` patterns, `references/failure-modes.md` before shipping any multi-stage workflow.

If the user is now stuck on workflow design rather than setup ("how do I do a review-fix loop?", "what's the right shape for parallel research?"), pivot to the authoring guidance in `SKILL.md` §"Authoring Process" and the `Design Advisory Skills` table. Setup is done.
