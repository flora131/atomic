#!/usr/bin/env bash

# Ralph Wiggum Session End Hook (Self-Restarting)
# Tracks iterations, checks completion conditions, spawns next session automatically
# Session end hook
#
# This hook implements a self-restarting pattern: when the session ends,
# it spawns a new detached gh copilot session to continue the loop.
# No external orchestrator required!

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Parse input fields
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
REASON=$(echo "$INPUT" | jq -r '.reason // "unknown"')

# State file location
RALPH_STATE_FILE=".github/ralph-loop.local.json"
RALPH_LOG_DIR=".github/logs"
RALPH_CONTINUE_FILE=".github/ralph-continue.flag"

# Ensure log directory exists
mkdir -p "$RALPH_LOG_DIR"

# Log session end
LOG_ENTRY=$(jq -n \
  --arg ts "$TIMESTAMP" \
  --arg cwd "$CWD" \
  --arg reason "$REASON" \
  --arg event "session_end" \
  '{
    timestamp: $ts,
    event: $event,
    cwd: $cwd,
    reason: $reason
  }')

echo "$LOG_ENTRY" >> "$RALPH_LOG_DIR/ralph-sessions.jsonl"

# Check if Ralph loop is active
if [[ ! -f "$RALPH_STATE_FILE" ]]; then
  # No active loop - clean exit
  rm -f "$RALPH_CONTINUE_FILE"
  exit 0
fi

# Read current state
STATE=$(cat "$RALPH_STATE_FILE")
ITERATION=$(echo "$STATE" | jq -r '.iteration // 0')
MAX_ITERATIONS=$(echo "$STATE" | jq -r '.maxIterations // 0')
COMPLETION_PROMISE=$(echo "$STATE" | jq -r '.completionPromise // "null"')
FEATURE_LIST_PATH=$(echo "$STATE" | jq -r '.featureListPath // "research/feature-list.json"')
PROMPT=$(echo "$STATE" | jq -r '.prompt // ""')
LAST_OUTPUT_FILE=$(echo "$STATE" | jq -r '.lastOutputFile // ""')

# Function to check if all features are passing
check_features_passing() {
  local path="$1"

  if [[ ! -f "$path" ]]; then
    return 1
  fi

  local total_features passing_features failing_features

  total_features=$(jq 'length' "$path" 2>/dev/null)
  if [[ $? -ne 0 || -z "$total_features" || "$total_features" -eq 0 ]]; then
    return 1
  fi

  passing_features=$(jq '[.[] | select(.passes == true)] | length' "$path" 2>/dev/null)
  failing_features=$((total_features - passing_features))

  echo "Feature Progress: $passing_features / $total_features passing ($failing_features remaining)" >&2

  if [[ "$failing_features" -eq 0 ]]; then
    return 0
  else
    return 1
  fi
}

# Function to check for completion promise in last output
check_completion_promise() {
  local promise="$1"
  local output_file="$2"

  if [[ "$promise" == "null" ]] || [[ -z "$promise" ]]; then
    return 1
  fi

  if [[ ! -f "$output_file" ]]; then
    return 1
  fi

  # Extract text from <promise> tags
  local promise_text
  promise_text=$(perl -0777 -pe 's/.*?<promise>(.*?)<\/promise>.*/$1/s; s/^\s+|\s+$//g; s/\s+/ /g' "$output_file" 2>/dev/null || echo "")

  if [[ -n "$promise_text" ]] && [[ "$promise_text" = "$promise" ]]; then
    echo "Detected completion promise: <promise>$promise</promise>" >&2
    return 0
  fi

  return 1
}

# Check completion conditions
SHOULD_CONTINUE=true
STOP_REASON=""

# Check 1: Max iterations reached
if [[ $MAX_ITERATIONS -gt 0 ]] && [[ $ITERATION -ge $MAX_ITERATIONS ]]; then
  SHOULD_CONTINUE=false
  STOP_REASON="max_iterations_reached"
  echo "Ralph loop: Max iterations ($MAX_ITERATIONS) reached." >&2
fi

# Check 2: All features passing (only in unlimited mode)
if [[ "$SHOULD_CONTINUE" == "true" ]] && [[ "$MAX_ITERATIONS" -eq 0 ]]; then
  if check_features_passing "$FEATURE_LIST_PATH"; then
    SHOULD_CONTINUE=false
    STOP_REASON="all_features_passing"
    echo "Ralph loop: All features passing! Loop complete." >&2
  fi
fi

# Check 3: Completion promise detected
if [[ "$SHOULD_CONTINUE" == "true" ]] && [[ -n "$LAST_OUTPUT_FILE" ]]; then
  if check_completion_promise "$COMPLETION_PROMISE" "$LAST_OUTPUT_FILE"; then
    SHOULD_CONTINUE=false
    STOP_REASON="completion_promise_detected"
    echo "Ralph loop: Completion promise detected! Loop complete." >&2
  fi
fi

# Update state and spawn next session (or complete)
if [[ "$SHOULD_CONTINUE" == "true" ]]; then
  # Increment iteration for next run
  NEXT_ITERATION=$((ITERATION + 1))

  # Update state file
  echo "$STATE" | jq --argjson iter "$NEXT_ITERATION" '.iteration = $iter' > "${RALPH_STATE_FILE}.tmp"
  mv "${RALPH_STATE_FILE}.tmp" "$RALPH_STATE_FILE"

  # Keep continue flag for status checking (optional)
  echo "$PROMPT" > "$RALPH_CONTINUE_FILE"

  echo "Ralph loop: Iteration $ITERATION complete. Spawning iteration $NEXT_ITERATION..." >&2

  # Get current working directory for the spawned process
  CURRENT_DIR="$(pwd)"

  # Escape prompt for shell (replace single quotes)
  ESCAPED_PROMPT="${PROMPT//\'/\'\\\'\'}"

  # Spawn new gh copilot session in background (detached, survives hook exit)
  # - nohup: prevents SIGHUP when parent exits
  # - sleep 2: brief delay to let current session fully close
  # - Redirects to log file for debugging
  nohup bash -c "
    sleep 2
    cd '$CURRENT_DIR'
    echo '$ESCAPED_PROMPT' | gh copilot --allow-all-tools --allow-all-paths
  " > "$RALPH_LOG_DIR/ralph-spawn-$NEXT_ITERATION.log" 2>&1 &

  echo "Ralph loop: Spawned background process for iteration $NEXT_ITERATION" >&2
else
  # Loop complete - clean up
  rm -f "$RALPH_CONTINUE_FILE"

  # Archive state file
  ARCHIVE_FILE="$RALPH_LOG_DIR/ralph-loop-$(date +%Y%m%d-%H%M%S).json"
  echo "$STATE" | jq --arg reason "$STOP_REASON" '. + {completedAt: now | todate, stopReason: $reason}' > "$ARCHIVE_FILE"

  # Remove active state
  rm -f "$RALPH_STATE_FILE"

  echo "Ralph loop completed. Reason: $STOP_REASON" >&2
  echo "State archived to: $ARCHIVE_FILE" >&2
fi

# Log completion status
LOG_ENTRY=$(jq -n \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson iter "$ITERATION" \
  --argjson cont "$([[ "$SHOULD_CONTINUE" == "true" ]] && echo "true" || echo "false")" \
  --arg reason "$STOP_REASON" \
  --arg event "ralph_iteration_end" \
  '{
    timestamp: $ts,
    event: $event,
    iteration: $iter,
    shouldContinue: $cont,
    stopReason: $reason
  }')

echo "$LOG_ENTRY" >> "$RALPH_LOG_DIR/ralph-sessions.jsonl"

# Output is ignored for sessionEnd
exit 0
