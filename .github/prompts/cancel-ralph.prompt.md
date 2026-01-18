---
description: Cancel active Ralph Wiggum loop
tools: ["execute", "read"]
model: claude-opus-4-5
---

# Cancel Ralph

Cancel an active Ralph Wiggum loop.

## Execute Cancellation

```!
if [[ "$(uname)" == MINGW* || "$(uname)" == MSYS* || "$(uname)" == CYGWIN* ]]; then powershell -ExecutionPolicy Bypass -File ./.github/scripts/cancel-ralph.ps1; else ./.github/scripts/cancel-ralph.sh; fi
```

This will:
- Archive state to `.github/logs/`
- Remove state files (`.github/ralph-loop.local.json`, `.github/ralph-continue.flag`)
- Kill any spawned `gh copilot` processes
