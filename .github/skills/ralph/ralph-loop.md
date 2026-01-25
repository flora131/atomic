---
name: ralph-loop
description: Start Ralph Wiggum loop in current session
---

# Ralph Loop Command

Start a Ralph Wiggum loop - a self-referential AI loop that repeats the same prompt until completion.

## Arguments

$ARGUMENTS

## How to Start

Execute the setup script to initialize the Ralph loop:

```!
bun run ./.github/scripts/ralph-loop.ts $ARGUMENTS
```

### Parameters
- `prompt`: The prompt to repeat each iteration (default: /implement-feature)
- `--max-iterations <n>`: Maximum iterations before auto-stop (0 = unlimited)
- `--completion-promise '<text>'`: Promise phrase to signal completion (e.g., 'DONE')
- `--feature-list <path>`: Path to feature list JSON (default: research/feature-list.json)

## Examples

```
/ralph-loop                                    # Uses /implement-feature, runs until all features pass
/ralph-loop --max-iterations 20                # With iteration limit
/ralph-loop "Build a todo API" --completion-promise "DONE" --max-iterations 20
```

## Completion Conditions

The loop stops when:
- `--max-iterations` limit is reached
- `<promise>YOUR_PHRASE</promise>` detected in output (must match `--completion-promise`)
- All features in `--feature-list` are passing (unlimited mode)

CRITICAL: Only output the promise when the statement is completely and unequivocally TRUE.

## Manual Cancellation

```bash
bun run ./.github/scripts/cancel-ralph.ts
```

## Monitoring

```bash
head -20 .github/ralph-loop.local.md          # Check state (YAML frontmatter)
cat .github/logs/ralph-sessions.jsonl | jq -s . # View session history
```
