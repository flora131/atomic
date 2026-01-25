#!/usr/bin/env bash

# Claude Code Stop Hook - Telemetry Tracking
#
# This hook is called when a Claude Code session ends.
# It extracts Atomic slash commands from the session transcript
# and logs an agent_session telemetry event.
#
# Reference: Spec Section 5.3.3

set -euo pipefail

# Get script directory for relative imports
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source the telemetry helper functions
# shellcheck source=../../bin/telemetry-helper.sh
source "$PROJECT_ROOT/bin/telemetry-helper.sh"

# Read hook input from stdin
# Claude Code passes JSON with session information including transcript_path
INPUT=$(cat)

# Parse input fields
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
SESSION_STARTED_AT=$(echo "$INPUT" | jq -r '.session_started_at // empty')

# Early exit if no transcript available
if [[ -z "$TRANSCRIPT_PATH" ]] || [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Read transcript content
TRANSCRIPT=$(cat "$TRANSCRIPT_PATH" 2>/dev/null || echo "")

# Early exit if transcript is empty
if [[ -z "$TRANSCRIPT" ]]; then
  exit 0
fi

# Extract commands from transcript
COMMANDS=$(extract_commands "$TRANSCRIPT")

# Write session event (helper handles telemetry enabled check)
if [[ -n "$COMMANDS" ]]; then
  write_session_event "claude" "$COMMANDS" "$SESSION_STARTED_AT"

  # Spawn upload process
  # Atomic file operations prevent duplicate uploads even if multiple processes spawn
  spawn_upload_process
fi

# Exit successfully (don't block session end)
exit 0
