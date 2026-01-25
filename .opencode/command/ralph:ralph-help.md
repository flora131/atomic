---
description: Explain the Ralph Wiggum technique and available commands
agent: build
model: anthropic/claude-opus-4-5
---

# Ralph Wiggum Plugin Help

Please explain the following to the user:

## What is the Ralph Wiggum Technique?

The Ralph Wiggum technique is an iterative development methodology based on continuous AI loops, pioneered by Geoffrey Huntley.

**Core concept:**
```bash
while :; do
  cat PROMPT.md | opencode --continue
done
```

The same prompt is fed to the AI repeatedly. The "self-referential" aspect comes from the AI seeing its own previous work in the files and git history, not from feeding output back as input.

**Each iteration:**
1. AI receives the SAME prompt
2. Works on the task, modifying files
3. Completes its response
4. Plugin intercepts idle state and feeds the same prompt again
5. AI sees its previous work in the files
6. Iteratively improves until completion

The technique is described as "deterministically bad in an undeterministic world" - failures are predictable, enabling systematic improvement through prompt tuning.

## Available Commands

### /ralph-loop [PROMPT] [OPTIONS]

Start a Ralph loop in your current session.

**Usage:**
```
/ralph-loop                                    (uses /implement-feature, runs until all features pass)
/ralph-loop --max-iterations 20                (uses /implement-feature with iteration limit)
/ralph-loop --feature-list specs/features.json (use custom feature list path)
/ralph-loop "Refactor the cache layer" --max-iterations 20
/ralph-loop "Add tests" --completion-promise "TESTS COMPLETE"
```

**Options:**
- `--max-iterations <n>` - Max iterations before auto-stop (default: 0 for unlimited)
- `--completion-promise <text>` - Promise phrase to signal completion
- `--feature-list <path>` - Path to feature list JSON (default: research/feature-list.json)

**Stopping conditions:**
- `--max-iterations` limit reached
- `--completion-promise` detected in output
- All features in `--feature-list` are passing (when max_iterations = 0)
- Manual cancellation with `/cancel-ralph`

**How it works:**
1. Creates `.opencode/ralph-loop.local.md` state file in project root
2. You work on the task (default: /implement-feature)
3. When you finish responding, the plugin intercepts
4. Same prompt fed back
5. You see your previous work
6. Continues until completion condition met

---

### /cancel-ralph

Cancel an active Ralph loop (removes the loop state file).

**Usage:**
```
/cancel-ralph
```

**How it works:**
- Checks for active loop state file
- Removes `.opencode/ralph-loop.local.md`
- Reports cancellation with iteration count

---

## Key Concepts

### Completion Promises

To signal completion, the AI must output a `<promise>` tag:

```
<promise>TASK COMPLETE</promise>
```

The plugin looks for this specific tag. Without it (or `--max-iterations`), Ralph runs indefinitely.

### Self-Reference Mechanism

The "loop" doesn't mean the AI talks to itself. It means:
- Same prompt repeated
- AI's work persists in files
- Each iteration sees previous attempts
- Builds incrementally toward goal

## Example

### Interactive Bug Fix

```
/ralph-loop "Fix the token refresh logic in auth.ts. Output <promise>FIXED</promise> when all tests pass." --completion-promise "FIXED" --max-iterations 10
```

You'll see Ralph:
- Attempt fixes
- Run tests
- See failures
- Iterate on solution
- In your current session

## When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement
- Iterative development with self-correction
- Greenfield projects

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria
- Debugging production issues (use targeted debugging instead)

## Learn More

- Original technique: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator