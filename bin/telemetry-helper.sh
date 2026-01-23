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

# Atomic commands to track (must match constants.ts)
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
# Follows same logic as config-path.ts getBinaryDataDir()
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
get_events_file_path() {
  echo "$(get_telemetry_data_dir)/telemetry-events.jsonl"
}

# Get the telemetry.json state file path
get_telemetry_state_path() {
  echo "$(get_telemetry_data_dir)/telemetry.json"
}

# Check if telemetry is enabled
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
  # Fall back to "unknown" if not available
  if command -v atomic &>/dev/null; then
    atomic --version 2>/dev/null || echo "unknown"
  else
    echo "unknown"
  fi
}

# Extract Atomic commands from transcript text
# Usage: extract_commands "transcript text containing /commit and /create-gh-pr"
# Output: comma-separated list of found commands
extract_commands() {
  local transcript="$1"
  local found_commands=()

  for cmd in "${ATOMIC_COMMANDS[@]}"; do
    # Escape special regex characters
    local escaped_cmd
    escaped_cmd=$(printf '%s' "$cmd" | sed 's/[.*+?^${}()|[\]\\]/\\&/g')

    # Check if command exists in transcript (word boundary matching)
    if echo "$transcript" | grep -qE "(^|[[:space:]]|[^[:alnum:]/_-])${escaped_cmd}([[:space:]]|$|[^[:alnum:]_-])"; then
      found_commands+=("$cmd")
    fi
  done

  # Return unique commands (comma-separated)
  printf '%s\n' "${found_commands[@]}" | sort -u | tr '\n' ',' | sed 's/,$//'
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
  event_json=$(jq -n \
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
  events_file="$(get_events_file_path)"
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
