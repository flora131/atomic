#!/usr/bin/env bash

# GitHub Copilot CLI - User Prompt Submitted Hook
#
# This hook fires every time a user submits a prompt during a Copilot session.
# It extracts Atomic slash commands from the prompt and accumulates them
# in a temp file for later telemetry logging at session end.
#
# Reference: Spec Section 5.3.3

set -euo pipefail

# Early exit if jq is not available
if ! command -v jq &>/dev/null; then
  exit 0  # Fail silently without jq
fi

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Temp file to accumulate commands during session
COMMANDS_TEMP_FILE=".github/telemetry-session-commands.tmp"

# Source telemetry helper for command extraction
TELEMETRY_HELPER="$PROJECT_ROOT/bin/telemetry-helper.sh"

# Read hook input from stdin
INPUT=$(cat)

# Parse prompt from input
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

# Early exit if no prompt
if [[ -z "$PROMPT" ]]; then
  exit 0
fi

# Source helper and extract commands
if [[ -f "$TELEMETRY_HELPER" ]]; then
  source "$TELEMETRY_HELPER"

  # Extract commands from this prompt
  COMMANDS=$(extract_commands "$PROMPT")

  # Append to temp file if commands found
  if [[ -n "$COMMANDS" ]]; then
    # Ensure directory exists
    mkdir -p "$(dirname "$COMMANDS_TEMP_FILE")"

    # Append commands (one per line for easy deduplication later)
    echo "$COMMANDS" | tr ',' '\n' >> "$COMMANDS_TEMP_FILE"
  fi
fi

# Hook output is ignored
exit 0
