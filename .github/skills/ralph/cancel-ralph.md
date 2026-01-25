---
name: cancel-ralph
description: Cancel active Ralph Wiggum loop
tools: ["execute", "read"]
model: claude-opus-4-5
---

# Cancel Ralph

Cancel an active Ralph Wiggum loop.

## Execute Cancellation

```!
bun run ./.github/scripts/cancel-ralph.ts
```

This will:
- Archive state to `.github/logs/`
- Remove state files (`.github/ralph-loop.local.md`, `.github/ralph-continue.flag`)
- Kill any spawned `copilot-cli` processes
