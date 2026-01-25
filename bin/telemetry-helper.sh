#!/usr/bin/env bash

# Telemetry Helper Script for Agent Hooks
#
# Provides functions for writing agent session telemetry events.
# Source this script from agent-specific hooks.
#
# Usage:
#   source "$(dirname "$0")/telemetry-helper.sh"
#   write_session_event "claude" "/commit,/create-gh-pr" "2024-01-15T10:30:00Z"
#
# Reference: Spec Section 5.3.3
#
# IMPORTANT: Code Duplication
# This script duplicates logic from TypeScript modules in src/utils/telemetry/
# This is INTENTIONAL - bash hooks cannot practically import TypeScript at runtime.
# When modifying telemetry logic, update both locations:
#   - TypeScript source of truth: src/utils/telemetry/
#   - Bash implementation: bin/telemetry-helper.sh

# Early exit if jq is not available
if ! command -v jq &>/dev/null; then
  exit 0  # Fail silently without jq
fi

# Atomic commands to track
# Source of truth: src/utils/telemetry/constants.ts
# Keep synchronized when adding/removing commands
ATOMIC_COMMANDS=(
  "/research-codebase"
  "/create-spec"
  "/create-feature-list"
  "/implement-feature"
  "/commit"
  "/create-gh-pr"
  "/explain-code"
  "/ralph-loop"
  "/ralph:ralph-loop"
  "/cancel-ralph"
  "/ralph:cancel-ralph"
  "/ralph-help"
  "/ralph:help"
)

# Get the telemetry data directory
# Source of truth: src/utils/config-path.ts getBinaryDataDir()
# Keep synchronized when changing data directory paths
get_telemetry_data_dir() {
  if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    # Windows
    local app_data="${LOCALAPPDATA:-$USERPROFILE/AppData/Local}"
    echo "$app_data/atomic"
  else
    # Unix (macOS/Linux)
    local xdg_data="${XDG_DATA_HOME:-$HOME/.local/share}"
    echo "$xdg_data/atomic"
  fi
}

# Get the telemetry events file path
# Arguments: $1 = agent type ("claude", "opencode", "copilot")
get_events_file_path() {
  local agent_type="$1"
  echo "$(get_telemetry_data_dir)/telemetry-events-${agent_type}.jsonl"
}

# Get the telemetry.json state file path
get_telemetry_state_path() {
  echo "$(get_telemetry_data_dir)/telemetry.json"
}

# Check if telemetry is enabled
# Source of truth: src/utils/telemetry/telemetry.ts isTelemetryEnabled()
# Keep synchronized when changing opt-out logic
# Returns 0 (true) if enabled, 1 (false) if disabled
is_telemetry_enabled() {
  # Check environment variables first (quick exit)
  if [[ "${ATOMIC_TELEMETRY:-}" == "0" ]]; then
    return 1
  fi

  if [[ "${DO_NOT_TRACK:-}" == "1" ]]; then
    return 1
  fi

  # Check telemetry.json state file
  local state_file
  state_file="$(get_telemetry_state_path)"

  if [[ ! -f "$state_file" ]]; then
    # No state file = telemetry not configured, assume disabled
    return 1
  fi

  # Check enabled and consentGiven fields in state file
  local enabled consent_given
  enabled=$(jq -r '.enabled // false' "$state_file" 2>/dev/null)
  consent_given=$(jq -r '.consentGiven // false' "$state_file" 2>/dev/null)

  if [[ "$enabled" == "true" ]] && [[ "$consent_given" == "true" ]]; then
    return 0
  else
    return 1
  fi
}

# Get anonymous ID from telemetry state
get_anonymous_id() {
  local state_file
  state_file="$(get_telemetry_state_path)"

  if [[ -f "$state_file" ]]; then
    jq -r '.anonymousId // empty' "$state_file" 2>/dev/null
  fi
}

# Get Atomic version from state file (if available) or use "unknown"
get_atomic_version() {
  # Try to get version by running atomic --version
  # Strip "atomic v" prefix to match TypeScript VERSION format
  # Fall back to "unknown" if not available
  if command -v atomic &>/dev/null; then
    atomic --version 2>/dev/null | sed 's/^atomic v//' || echo "unknown"
  else
    echo "unknown"
  fi
}

# Extract Atomic commands from JSONL transcript
# CRITICAL: Only extracts from string content in user messages (user-typed commands)
# Array content in user messages means skill instructions were loaded - we ignore these
# Usage: extract_commands "transcript JSONL content"
# Output: comma-separated list of found commands
extract_commands() {
  local transcript="$1"
  local found_commands=()

  # Process each line (JSONL format - one JSON object per line)
  while IFS= read -r line; do
    # Skip empty lines
    [[ -z "$line" ]] && continue

    # Extract type from JSON (skip if not user message)
    local msg_type
    msg_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
    [[ "$msg_type" != "user" ]] && continue

    # Check content type - only process string content (user-typed commands)
    # Array content = skill instructions loaded, which contain command references we should ignore
    local content_type
    content_type=$(echo "$line" | jq -r '.message.content | type' 2>/dev/null)
    [[ "$content_type" != "string" ]] && continue

    # Extract text content from user message (string content only)
    local text
    text=$(echo "$line" | jq -r '.message.content // empty' 2>/dev/null)
    [[ -z "$text" ]] && continue

    # Find all commands in this user message
    for cmd in "${ATOMIC_COMMANDS[@]}"; do
      # Escape special regex characters
      local escaped_cmd
      escaped_cmd=$(printf '%s' "$cmd" | sed 's/[.*+?^${}()|[\]\\]/\\&/g')

      # Count occurrences (for usage frequency tracking)
      local count
      count=$(echo "$text" | grep -oE "(^|[[:space:]]|[^[:alnum:]/_-])${escaped_cmd}([[:space:]]|$|[^[:alnum:]_-])" | wc -l | tr -d ' ')

      # Add command once for each occurrence
      for ((i=0; i<count; i++)); do
        found_commands+=("$cmd")
      done
    done
  done <<< "$transcript"

  # Return commands (comma-separated, preserving duplicates for frequency tracking)
  printf '%s\n' "${found_commands[@]}" | tr '\n' ',' | sed 's/,$//'
}

# ============================================================================
# COPILOT AGENT DETECTION
# ============================================================================

# Detect agents from Copilot session events.jsonl
# Parses the most recent session's events to find agent invocations
#
# Detection Methods:
# - Method 1: Explicit agent_type in task tool calls (natural language invocations)
# - Method 2: agent_name in tool telemetry (when agents complete execution)
#
# Note: We do NOT attempt to detect agents from dropdown/CLI invocations by parsing
# transformedContent, as this approach is unreliable and not worth maintaining.
#
# Returns: comma-separated list of detected agent names (preserving duplicates)
detect_copilot_agents() {
  local copilot_state_dir="$HOME/.copilot/session-state"

  # Early exit if Copilot state directory doesn't exist
  if [[ ! -d "$copilot_state_dir" ]]; then
    return
  fi

  # Find the most recent session directory
  local latest_session
  latest_session=$(ls -td "$copilot_state_dir"/*/ 2>/dev/null | head -1)

  if [[ -z "$latest_session" ]]; then
    return
  fi

  local events_file="$latest_session/events.jsonl"

  if [[ ! -f "$events_file" ]]; then
    return
  fi

  local found_agents=()

  # Parse events.jsonl line by line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Check event type
    local event_type
    event_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)

    # Method 1: Check assistant.message for task tool calls with agent_type
    # This handles natural language invocations like "use explain-code to..."
    if [[ "$event_type" == "assistant.message" ]]; then
      # Extract agent_type from task tool calls
      local agent_types
      agent_types=$(echo "$line" | jq -r '.data.toolRequests[]? | select(.name == "task") | .arguments.agent_type // empty' 2>/dev/null)

      for agent_name in $agent_types; do
        if [[ -n "$agent_name" ]] && [[ -f ".github/agents/${agent_name}.md" ]]; then
          found_agents+=("$agent_name")
        fi
      done
    fi

    # Method 2: Check tool.execution_complete for agent_name in telemetry
    # This captures agents when they finish execution (works for all invocation methods)
    if [[ "$event_type" == "tool.execution_complete" ]]; then
      local tool_agent_name
      tool_agent_name=$(echo "$line" | jq -r '.data.toolTelemetry.properties.agent_name // empty' 2>/dev/null)

      if [[ -n "$tool_agent_name" ]] && [[ -f ".github/agents/${tool_agent_name}.md" ]]; then
        found_agents+=("$tool_agent_name")
      fi
    fi

  done < "$events_file"

  # Return comma-separated list (preserving duplicates for frequency tracking)
  if [[ ${#found_agents[@]} -gt 0 ]]; then
    printf '%s\n' "${found_agents[@]}" | tr '\n' ',' | sed 's/,$//'
  fi
}

# Generate a UUID v4
generate_uuid() {
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  else
    # Fallback: use /dev/urandom
    od -x /dev/urandom | head -1 | awk '{OFS="-"; print $2$3,$4,$5,$6,$7$8$9}'
  fi
}

# Get current timestamp in ISO 8601 format
get_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Get current platform
get_platform() {
  case "$OSTYPE" in
    darwin*)  echo "darwin" ;;
    linux*)   echo "linux" ;;
    msys*|cygwin*|win32*) echo "win32" ;;
    *)        echo "unknown" ;;
  esac
}

# Write an agent session event to the telemetry events file
# Source of truth: src/utils/telemetry/telemetry-file-io.ts appendEvent()
# Keep synchronized when changing event structure or file writing logic
#
# Arguments:
#   $1 - agentType: "claude", "opencode", or "copilot"
#   $2 - commands: comma-separated list of commands (e.g., "/commit,/create-gh-pr")
#
# Returns: 0 on success, 1 on failure
write_session_event() {
  local agent_type="$1"
  local commands_str="$2"

  # Early return if telemetry disabled
  if ! is_telemetry_enabled; then
    return 0
  fi

  # Early return if no commands
  if [[ -z "$commands_str" ]]; then
    return 0
  fi

  # Get required fields
  local anonymous_id
  anonymous_id="$(get_anonymous_id)"

  if [[ -z "$anonymous_id" ]]; then
    # No anonymous ID = telemetry not properly configured
    return 1
  fi

  local event_id session_id timestamp platform atomic_version
  event_id="$(generate_uuid)"
  session_id="$event_id"
  timestamp="$(get_timestamp)"
  platform="$(get_platform)"
  atomic_version="$(get_atomic_version)"

  # Convert commands to JSON array
  local commands_json
  commands_json=$(echo "$commands_str" | tr ',' '\n' | jq -R . | jq -s .)

  local command_count
  command_count=$(echo "$commands_json" | jq 'length')

  # Build event JSON
  local event_json
  event_json=$(jq -nc \
    --arg anonymousId "$anonymous_id" \
    --arg eventId "$event_id" \
    --arg sessionId "$session_id" \
    --arg eventType "agent_session" \
    --arg timestamp "$timestamp" \
    --arg agentType "$agent_type" \
    --argjson commands "$commands_json" \
    --argjson commandCount "$command_count" \
    --arg platform "$platform" \
    --arg atomicVersion "$atomic_version" \
    --arg source "session_hook" \
    '{
      anonymousId: $anonymousId,
      eventId: $eventId,
      sessionId: $sessionId,
      eventType: $eventType,
      timestamp: $timestamp,
      agentType: $agentType,
      commands: $commands,
      commandCount: $commandCount,
      platform: $platform,
      atomicVersion: $atomicVersion,
      source: $source
    }')

  # Get events file path and ensure directory exists
  local events_file
  events_file="$(get_events_file_path "$agent_type")"
  local events_dir
  events_dir="$(dirname "$events_file")"

  mkdir -p "$events_dir"

  # Append event to JSONL file
  echo "$event_json" >> "$events_file"

  return 0
}

# Spawn background upload process
# Usage: spawn_upload_process
spawn_upload_process() {
  if command -v atomic &>/dev/null; then
    nohup atomic --upload-telemetry > /dev/null 2>&1 &
  fi
}
