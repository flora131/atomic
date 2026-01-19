---
description: "Start Ralph Wiggum loop in current session"
model: opus
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/run.cmd:*)"]
hide-from-slash-command-tool: "true"
hooks:
  Stop:
    - hooks:
        - type: command
          command: "${CLAUDE_PLUGIN_ROOT}/run.cmd hooks/stop-hook.sh"
---

# Ralph Loop Command

Execute the setup script to initialize the Ralph loop:

```!
${CLAUDE_PLUGIN_ROOT}/run.cmd scripts/setup-ralph-loop.sh $ARGUMENTS
```

Please work on the task. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.
