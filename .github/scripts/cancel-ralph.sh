#!/usr/bin/env bash

# Cancel Ralph Loop Script
# Removes state file, continue flag, and kills any spawned processes

set -euo pipefail

RALPH_STATE_FILE=".github/ralph-loop.local.json"
RALPH_CONTINUE_FILE=".github/ralph-continue.flag"
RALPH_LOG_DIR=".github/logs"

# Check if Ralph loop is active
if [[ ! -f "$RALPH_STATE_FILE" ]]; then
  echo "No active Ralph loop found."

  # Still try to kill any orphaned processes
  echo "Checking for orphaned Ralph processes..."
  if pkill -f "gh copilot" 2>/dev/null; then
    echo "Killed orphaned gh copilot processes."
  else
    echo "No orphaned processes found."
  fi
  exit 0
fi

# Read current state
ITERATION=$(jq -r '.iteration // 0' "$RALPH_STATE_FILE")
PROMPT=$(jq -r '.prompt // ""' "$RALPH_STATE_FILE")
STARTED_AT=$(jq -r '.startedAt // ""' "$RALPH_STATE_FILE")

# Archive state file
mkdir -p "$RALPH_LOG_DIR"
ARCHIVE_FILE="$RALPH_LOG_DIR/ralph-loop-cancelled-$(date +%Y%m%d-%H%M%S).json"
jq '. + {cancelledAt: now | todate, stopReason: "user_cancelled"}' "$RALPH_STATE_FILE" > "$ARCHIVE_FILE"

# Remove state files
rm -f "$RALPH_STATE_FILE"
rm -f "$RALPH_CONTINUE_FILE"

# Kill any spawned Ralph processes
# This catches:
# - Any pending "sleep && gh copilot" spawns from the hook
# - Any currently running gh copilot sessions from the loop
echo "Stopping spawned processes..."
pkill -f "gh copilot" 2>/dev/null || true

# Also kill any background sleep processes waiting to spawn
pkill -f "sleep.*gh copilot" 2>/dev/null || true

echo "Cancelled Ralph loop (was at iteration $ITERATION)"
echo ""
echo "Details:"
echo "  Started at: $STARTED_AT"
echo "  Prompt: $PROMPT"
echo "  State archived to: $ARCHIVE_FILE"
echo ""
echo "All Ralph processes have been terminated."
