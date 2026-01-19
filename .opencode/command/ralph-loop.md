---
description: Start Ralph Wiggum loop in current session
agent: build
model: anthropic/claude-opus-4-5
---

# Ralph Loop Command

Start a Ralph Wiggum loop - a self-referential AI loop that repeats the same prompt until completion.

## Arguments

$ARGUMENTS

## How to Start

Use the `ralph-loop` tool with the following parameters:
- `prompt`: The prompt to repeat each iteration (default: /implement-feature)
- `max_iterations`: Maximum iterations before auto-stop (0 = unlimited)
- `completion_promise`: Promise phrase to signal completion (e.g., 'DONE')
- `feature_list`: Path to feature list JSON (default: research/feature-list.json)

## Examples

```
/ralph-loop                                    # Uses /implement-feature, runs until all features pass
/ralph-loop --max-iterations 20                # With iteration limit
/ralph-loop "Build a todo API" --completion-promise "DONE" --max-iterations 20
```

## How It Works

1. Creates state file at `.opencode/ralph-loop.local.json`
2. You work on the task
3. When session goes idle, plugin detects it
4. Same prompt fed back via `session.promptAsync`
5. You see your previous work in files
6. Continues until:
   - Max iterations reached
   - `<promise>PHRASE</promise>` detected in output
   - All features in feature list are passing (when max_iterations = 0)

## Stopping the Loop

To signal completion, output: `<promise>YOUR_PHRASE</promise>`

CRITICAL: Only output the promise when the statement is completely and unequivocally TRUE. Do not lie to exit the loop.

## Monitoring

Check current iteration:
```bash
cat .opencode/ralph-loop.local.json | jq '.iteration'
```