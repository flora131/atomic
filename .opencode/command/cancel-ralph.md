---
description: Cancel active Ralph Wiggum loop
agent: build
model: anthropic/claude-opus-4-5
---

# Cancel Ralph

Cancel an active Ralph Wiggum loop.

## How to Cancel

Use the `cancel-ralph` tool to stop the current loop.

This will:
1. Check if `.opencode/ralph-loop.local.json` exists
2. If found, read the current iteration number
3. Remove the state file
4. Report: "Cancelled Ralph loop (was at iteration N)"

If no active loop is found, it will report: "No active Ralph loop found."
