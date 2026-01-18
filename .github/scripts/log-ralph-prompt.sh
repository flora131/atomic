#!/usr/bin/env bash

# Ralph Wiggum User Prompt Submitted Hook
# Logs user prompts for debugging and audit
# Reference: gh-copilot-cli-docs/configuration.md - User prompt submitted hook

set -euo pipefail

# Read hook input from stdin (JSON format per gh-copilot-cli-docs/configuration.md)
INPUT=$(cat)

# Parse input fields
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

# State file location
RALPH_STATE_FILE=".github/ralph-loop.local.json"
RALPH_LOG_DIR=".github/logs"

# Ensure log directory exists
mkdir -p "$RALPH_LOG_DIR"

# Get log level from environment (set in hooks.json)
LOG_LEVEL="${RALPH_LOG_LEVEL:-INFO}"

# Log user prompt
LOG_ENTRY=$(jq -n \
  --arg ts "$TIMESTAMP" \
  --arg cwd "$CWD" \
  --arg prompt "$PROMPT" \
  --arg event "user_prompt_submitted" \
  '{
    timestamp: $ts,
    event: $event,
    cwd: $cwd,
    prompt: $prompt
  }')

echo "$LOG_ENTRY" >> "$RALPH_LOG_DIR/ralph-sessions.jsonl"

# If Ralph loop is active, show iteration context
if [[ -f "$RALPH_STATE_FILE" ]]; then
  ITERATION=$(jq -r '.iteration // 0' "$RALPH_STATE_FILE")
  EXPECTED_PROMPT=$(jq -r '.prompt // ""' "$RALPH_STATE_FILE")

  if [[ "$LOG_LEVEL" == "DEBUG" ]]; then
    echo "Ralph loop iteration $ITERATION - Prompt received" >&2
    echo "  Expected: $EXPECTED_PROMPT" >&2
    echo "  Received: $PROMPT" >&2
  fi
fi

# Output is ignored for userPromptSubmitted per gh-copilot-cli-docs/configuration.md
exit 0
