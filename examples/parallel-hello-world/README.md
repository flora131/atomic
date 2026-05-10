# parallel-hello-world

`Promise.all()` fan-out and transcript merge — three stages run concurrently, then a final stage merges their transcripts.

## Run

```bash
bun install
bun run claude-worker.ts   --topic="Bun"
bun run copilot-worker.ts  --topic="Bun"
bun run opencode-worker.ts --topic="Bun"
```

## What's here

- `claude/`, `copilot/`, `opencode/` — workflow definitions per agent
- `<agent>-worker.ts` — Commander entrypoint that calls the shared `runExampleWorkflow` helper, which mounts the Atomic panel for foreground TTY runs

Demonstrates that JavaScript control flow (`Promise.all`, `for`, `if`) is the only orchestration primitive you need.
