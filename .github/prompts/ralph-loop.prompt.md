---
description: Start Ralph Wiggum loop in current session
tools: ["search", "execute", "edit", "read"]
model: claude-opus-4-5
---

# Ralph Loop Command

Start a Ralph Wiggum loop - a self-referential AI loop that repeats the same prompt until completion.

## Arguments

$ARGUMENTS

## How to Start

Execute the setup script to initialize the Ralph loop:

```!
if [[ "$(uname)" == MINGW* || "$(uname)" == MSYS* || "$(uname)" == CYGWIN* ]]; then powershell -ExecutionPolicy Bypass -File ./.github/scripts/setup-ralph-loop.ps1 $ARGUMENTS; else ./.github/scripts/setup-ralph-loop.sh $ARGUMENTS; fi
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
# macOS/Linux
./.github/scripts/cancel-ralph.sh

# Windows
powershell -ExecutionPolicy Bypass -File ./.github/scripts/cancel-ralph.ps1
```

## Monitoring

```bash
cat .github/ralph-loop.local.json | jq .      # Check full state
cat .github/logs/ralph-sessions.jsonl | jq -s . # View session history
```

<EXTREMELY_IMPORTANT>
- Implement features incrementally, make small changes each iteration.
  - Only work on the SINGLE highest priority feature at a time.
  - Use the `feature-list.json` file if it is provided to you as a guide otherwise create your own `feature-list.json` based on the prompt.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
</EXTREMELY_IMPORTANT>