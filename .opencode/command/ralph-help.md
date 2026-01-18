---
description: Explain Ralph Wiggum technique and available commands
agent: build
model: anthropic/claude-opus-4-5
---

# Ralph Wiggum Plugin Help

Use the `ralph-help` tool to get detailed documentation about the Ralph Wiggum technique.

## Quick Reference

### What is the Ralph Wiggum Technique?

The Ralph Wiggum technique is an iterative development methodology based on continuous AI loops, pioneered by Geoffrey Huntley.

**Core concept:**
```bash
while :; do
  cat PROMPT.md | opencode --continue
done
```

The same prompt is fed to the AI repeatedly. The "self-referential" aspect comes from the AI seeing its own previous work in files and git history.

### Available Commands

| Command         | Description                                |
| --------------- | ------------------------------------------ |
| `/ralph-loop`   | Start a Ralph loop in your current session |
| `/cancel-ralph` | Cancel an active Ralph loop                |
| `/ralph-help`   | Show this help                             |

### When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement
- Iterative development with self-correction
- Greenfield projects

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria

### Learn More

- Original technique: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator
