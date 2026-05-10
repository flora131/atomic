# hello-world

Minimal single-session workflow with structured inputs (`greeting`, `style`, optional `notes`). The simplest possible shape for a workflow worker.

## Run

```bash
bun install
bun run claude-worker.ts   --greeting="Hello" --style=casual
bun run copilot-worker.ts  --greeting="Hello" --style=casual
bun run opencode-worker.ts --greeting="Hello" --style=casual
```

Or via the package scripts:

```bash
bun run claude   -- --greeting="Hello" --style=casual
bun run copilot  -- --greeting="Hello" --style=casual
bun run opencode -- --greeting="Hello" --style=casual
```

## What's here

- `claude/`, `copilot/`, `opencode/` — one workflow definition per agent
- `<agent>-worker.ts` — Commander entrypoint that wires workflow inputs to `--<flag>` options and calls the shared `runExampleWorkflow` helper, which mounts the Atomic panel for foreground TTY runs

Copy this directory as a starting point — swap the workflow import for your own and you're done.
