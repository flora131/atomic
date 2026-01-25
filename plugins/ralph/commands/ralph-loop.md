---
description: "Start Ralph Loop in current session"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT] [--feature-list PATH]"
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/run.cmd:*)"]
hide-from-slash-command-tool: "true"
model: opus
---

# Ralph Loop Command

Execute the setup script to initialize the Ralph loop:

```!
bun run "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.ts" $ARGUMENTS
```

Please work on the task. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.