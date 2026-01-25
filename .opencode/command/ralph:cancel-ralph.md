---
description: Cancel the active Ralph Wiggum loop
agent: build
model: anthropic/claude-opus-4-5
---

# Cancel Ralph Loop

To cancel the Ralph loop, perform these steps:

1. Check if the Ralph state file exists at `.opencode/ralph-loop.local.md`

2. If the file does NOT exist:
   - Report: "No active Ralph loop found."

3. If the file EXISTS:
   - Read the file to get the current iteration number from the `iteration:` field in the YAML frontmatter
   - Read the `feature_list_path:` field (default: "research/feature-list.json")
   - Archive the state file to `.opencode/logs/ralph-loop-cancelled-{timestamp}.md`
   - Delete the file `.opencode/ralph-loop.local.md`
   - Report: "Cancelled Ralph loop at iteration N" with feature progress if available

## State File Format

The state file uses YAML frontmatter format:

```markdown
---
active: true
iteration: 5
max_iterations: 20
completion_promise: "All tests pass"
feature_list_path: research/feature-list.json
started_at: "2026-01-24T10:00:00Z"
---

Your prompt content here.
```

## Execute Cancellation

Parse the YAML frontmatter state file and perform cleanup:

```bash
STATE_FILE=".opencode/ralph-loop.local.md"
LOG_DIR=".opencode/logs"

if [ -f "$STATE_FILE" ]; then
  # Parse iteration from YAML frontmatter
  ITERATION=$(grep '^iteration:' "$STATE_FILE" | sed 's/iteration: *//')
  FEATURE_LIST_PATH=$(grep '^feature_list_path:' "$STATE_FILE" | sed 's/feature_list_path: *//')
  FEATURE_LIST_PATH="${FEATURE_LIST_PATH:-research/feature-list.json}"

  # Ensure log directory exists
  mkdir -p "$LOG_DIR"

  # Archive state file with timestamp
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
  cp "$STATE_FILE" "$LOG_DIR/ralph-loop-cancelled-$TIMESTAMP.md"

  # Remove state file
  rm "$STATE_FILE"

  echo "Cancelled Ralph loop (was at iteration $ITERATION)"
  echo "State archived to: $LOG_DIR/ralph-loop-cancelled-$TIMESTAMP.md"

  # Show feature progress if feature list exists (using grep/awk instead of jq)
  if [ -f "$FEATURE_LIST_PATH" ]; then
    TOTAL=$(grep -c '"description"' "$FEATURE_LIST_PATH" 2>/dev/null || echo "0")
    PASSING=$(grep -c '"passes": true' "$FEATURE_LIST_PATH" 2>/dev/null || echo "0")
    if [ "$TOTAL" -gt 0 ]; then
      echo "Feature progress: $PASSING / $TOTAL passing"
    fi
  fi
else
  echo "No active Ralph loop found."
fi
```

## What This Does

- Archives state to `.opencode/logs/` for history tracking
- Removes state file (`.opencode/ralph-loop.local.md`)
- Reports cancellation status with iteration count
- Shows feature progress (no `jq` dependency required)