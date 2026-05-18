# Running and Inspecting Pi Workflows

Use this when the user asks to run, start, kick off, monitor, connect to, attach to, pause, interrupt, resume, or inspect a workflow.

## Discover first

For named workflows, do not guess names or schemas:

```ts
workflow({ action: "list" })
workflow({ action: "get", workflow: "<name>" })
workflow({ action: "inputs", workflow: "<name>" })
```

If required inputs are missing and cannot be inferred, ask the user with `ask_user_question` or a concise free-form question.

## Run named workflows

```ts
workflow({
  action: "run",
  workflow: "deep-research-codebase",
  inputs: { prompt: "map workflow dispatch", max_concurrency: 4 },
})
```

Slash equivalent:

```text
/workflow deep-research-codebase prompt="map workflow dispatch" max_concurrency=4
```

Input overrides are bare `key=value` tokens. Values are JSON-parsed when possible, so `count=3`, `flag=true`, and `prompt="multi word value"` preserve useful types. A whole input object can also be passed as one JSON token.

Named workflow dispatch is always background-oriented: expect a run id and then monitor status. Press F2 or use `/workflow connect <run-id>` to attach to the graph viewer. In the TUI, `/workflow <name>` opens an input picker when the workflow declares inputs and either no arguments were supplied or required inputs are missing; supplied values seed the picker. Pass `--no-picker` to skip that interactive flow.

## Slash command surface

```text
/workflow list
/workflow inputs <name>
/workflow <name> --help
/workflow <name> [key=value ...]
/workflow connect [run-id]
/workflow attach [run-id] [stage-id-or-name]
/workflow pause [run-id] [stage-id-or-name]
/workflow status [run-id]
/workflow status --all
/workflow interrupt <run-id|--all>
/workflow kill <run-id|--all>
/workflow resume <run-id> [stage-id-or-name] [message]
```

Use `connect` for the orchestrator graph. Use `attach` when the user wants to open a chat pane for a specific stage. Use `interrupt`/`pause`/`resume` for resumable live work; `resume` on a non-paused run reopens the saved snapshot/overlay. Use `kill` only when the run should be terminated and removed from live history/status. `/workflow status` lists in-flight runs by default; `/workflow status --all` includes retained ended runs as well.

Human-in-the-loop prompts from `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.select`, and `ctx.ui.editor` surface in the workflow UI/graph viewer, not as ordinary chat modals.

## Direct runs

Use direct workflow-native orchestration for one-off tracked work that does not need a reusable workflow file.

Single tracked task:

```ts
workflow({
  task: { name: "review", task: "Review this patch for API risks." },
  async: true,
  intercom: { delivery: "result" },
})
```

Parallel fan-out:

```ts
workflow({
  tasks: [
    { name: "docs", task: "Review documentation gaps" },
    { name: "risks", task: "Review operational risks" },
  ],
  concurrency: 2,
  outputMode: "file-only",
  async: true,
})
```

Dependent chain:

```ts
workflow({
  task: "Design the workflow SDK migration",
  chain: [
    { name: "research", task: "Research {task}" },
    { name: "plan", task: "Plan from {previous}" },
  ],
  async: true,
})
```

Direct mode supports top-level/default options and per-task options such as `context`, `forkFromSessionFile`, `model`, `fallbackModels`, `thinkingLevel`, `tools`, `noTools`, `customTools`, `mcp`, `output`, `outputMode`, `reads`, `worktree`, `maxOutput`, `artifacts`, `sessionDir`, `cwd`, and `agentDir`. Direct chains also support `chainName`, `chainDir`, and `failFast`; use `chainDir` for shared relative reads/outputs/worktree diffs. For large fan-outs, prefer `outputMode: "file-only"`.

## Monitor/control with the workflow tool

The LLM-callable workflow tool exposes lifecycle controls with the same targeting affordances as the slash commands where a non-interactive tool call makes sense.

```ts
workflow({ action: "status" })
workflow({ action: "status", runId: "<id-or-prefix>" })

// Resumable interruption. Omit runId to target the active run.
workflow({ action: "interrupt" })
workflow({ action: "interrupt", runId: "<id-or-prefix>" })
workflow({ action: "interrupt", all: true })
workflow({ action: "interrupt", runId: "--all" })

// Resume a run, optionally targeting a stage by id, prefix, or name.
workflow({ action: "resume", runId: "<id-or-prefix>" })
workflow({ action: "resume", runId: "<id-or-prefix>", stageId: "review", message: "continue with the approved fix" })

// Destructive termination. Omit runId to target the active run.
workflow({ action: "kill" })
workflow({ action: "kill", runId: "<id-or-prefix>" })
workflow({ action: "kill", all: true })
workflow({ action: "kill", runId: "--all" })
```

Control semantics:

- `runId` accepts full run ids or unique prefixes for `status`, `interrupt`, `resume`, and `kill`.
- `interrupt` and `kill` default to the active run when `runId` is omitted.
- `interrupt` is resumable: it pauses live work when pausable stages exist and keeps the run in live history/status.
- `resume` can target a stage with `stageId`; the target may be a stage id, unique prefix, or stage name. `message` is forwarded to paused work.
- `kill` is destructive: it aborts in-flight work and removes the run from live history/status. Use it only when the user wants the workflow gone.

Use slash commands for graph connect and stage attach because those are interactive TUI surfaces. When a run needs user input or attention, surface that to the user instead of polling silently.

## Intercom

For async direct runs, request result delivery when available:

```ts
workflow({
  tasks: [{ name: "reviewer", task: "Review the patch" }],
  async: true,
  intercom: { delivery: "result" },
})
```

Treat intercom payloads as user-visible workflow output.

## Common mistakes

- Do not fabricate workflow names; list first.
- Do not guess input keys; inspect with `inputs` or `get` first.
- Do not call `create`, `update`, or `delete` on the workflow tool; definitions are code-authored.
- Do not use legacy tool fields like `agent`, `stage`, or run-control `name`.
- Do not expect named workflow runs to block the chat turn; they are background tasks.
- Prefer `outputMode: "file-only"` for large fan-outs.
- Use status/interrupt/resume/kill controls for run lifecycle; inspect workflow output and artifacts for behavior.
- Do not call `kill` when the user asks to interrupt or pause resumably; kill removes the run from live history/status.
