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
   - Read the file to get the current iteration number from the `iteration:` field in the frontmatter
   - Read the `feature_list_path:` field (default: "research/feature-list.json")
   - Check if the feature list file exists and count passing/total features
   - Delete the file `.opencode/ralph-loop.local.md`
   - Report: "Cancelled Ralph loop at iteration N" with feature progress if available

Execute:
```bash
if [ -f .opencode/ralph-loop.local.md ]; then
  ITERATION=$(grep '^iteration:' .opencode/ralph-loop.local.md | sed 's/iteration: *//')
  FEATURE_LIST_PATH=$(grep '^feature_list_path:' .opencode/ralph-loop.local.md | sed 's/feature_list_path: *//')
  FEATURE_LIST_PATH="${FEATURE_LIST_PATH:-research/feature-list.json}"

  rm .opencode/ralph-loop.local.md

  echo "Cancelled Ralph loop (was at iteration $ITERATION)"

  # Show feature progress if feature list exists
  if [ -f "$FEATURE_LIST_PATH" ]; then
    TOTAL=$(jq 'length' "$FEATURE_LIST_PATH" 2>/dev/null || echo "0")
    PASSING=$(jq '[.[] | select(.passes == true)] | length' "$FEATURE_LIST_PATH" 2>/dev/null || echo "0")
    if [ "$TOTAL" -gt 0 ]; then
      echo "Feature progress: $PASSING / $TOTAL passing"
    fi
  fi
else
  echo "No active Ralph loop found."
fi
```