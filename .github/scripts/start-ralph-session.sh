#!/usr/bin/env bash

# Ralph Wiggum Session Start Hook
# Detects active Ralph loops and logs session information
# Session start hook

set -euo pipefail

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Read hook input from stdin
INPUT=$(cat)

# Parse input fields
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"')
INITIAL_PROMPT=$(echo "$INPUT" | jq -r '.initialPrompt // empty')

# State file location (using .github convention for GitHub Copilot)
RALPH_STATE_FILE=".github/ralph-loop.local.json"
RALPH_LOG_DIR=".github/logs"

# Ensure log directory exists
mkdir -p "$RALPH_LOG_DIR"

# Log session start
LOG_ENTRY=$(jq -n \
  --arg ts "$TIMESTAMP" \
  --arg cwd "$CWD" \
  --arg source "$SOURCE" \
  --arg prompt "$INITIAL_PROMPT" \
  --arg event "session_start" \
  '{
    timestamp: $ts,
    event: $event,
    cwd: $cwd,
    source: $source,
    initialPrompt: $prompt
  }')

echo "$LOG_ENTRY" >> "$RALPH_LOG_DIR/ralph-sessions.jsonl"

# Check if Ralph loop is active
if [[ -f "$RALPH_STATE_FILE" ]]; then
  # Read current state
  ITERATION=$(jq -r '.iteration // 0' "$RALPH_STATE_FILE")
  MAX_ITERATIONS=$(jq -r '.maxIterations // 0' "$RALPH_STATE_FILE")
  COMPLETION_PROMISE=$(jq -r '.completionPromise // "null"' "$RALPH_STATE_FILE")
  PROMPT=$(jq -r '.prompt // ""' "$RALPH_STATE_FILE")

  # Output status message (visible to agent)
  echo "Ralph loop active - Iteration $ITERATION" >&2

  if [[ "$MAX_ITERATIONS" -gt 0 ]]; then
    echo "  Max iterations: $MAX_ITERATIONS" >&2
  else
    echo "  Max iterations: unlimited" >&2
  fi

  if [[ "$COMPLETION_PROMISE" != "null" ]]; then
    echo "  Completion promise: $COMPLETION_PROMISE" >&2
  fi

  echo "  Prompt: $PROMPT" >&2

  # If this is a resume, increment iteration
  if [[ "$SOURCE" == "resume" ]] || [[ "$SOURCE" == "startup" ]]; then
    NEW_ITERATION=$((ITERATION + 1))

    # Update state file with new iteration
    jq --argjson iter "$NEW_ITERATION" '.iteration = $iter' "$RALPH_STATE_FILE" > "${RALPH_STATE_FILE}.tmp"
    mv "${RALPH_STATE_FILE}.tmp" "$RALPH_STATE_FILE"

    echo "Ralph loop continuing at iteration $NEW_ITERATION" >&2
  fi
fi

# Output is ignored for sessionStart
exit 0
