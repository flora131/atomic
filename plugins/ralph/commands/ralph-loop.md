---
description: "Start Ralph Wiggum loop in current session"
model: opus
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh:*)", "Bash(powershell -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.ps1:*)"]
hide-from-slash-command-tool: "true"
---

# Ralph Loop Command

Execute the setup script to initialize the Ralph loop:

```!
if [[ "$(uname)" == MINGW* || "$(uname)" == MSYS* || "$(uname)" == CYGWIN* ]]; then powershell -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.ps1 $ARGUMENTS; else ${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh $ARGUMENTS; fi
```

Please work on the task. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.
