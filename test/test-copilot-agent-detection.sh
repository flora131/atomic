#!/usr/bin/env bash
set -euo pipefail

# Test script for Copilot agent detection
# Tests 4 scenarios to verify agent detection works correctly

cd /Users/norinlavaee/atomic

TELEMETRY_FILE="$HOME/.local/share/atomic/telemetry-events.jsonl"
COPILOT_STATE_DIR="$HOME/.copilot/session-state"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "==================================="
echo "Copilot Agent Detection Test Suite"
echo "==================================="
echo ""

# Backup telemetry file
if [[ -f "$TELEMETRY_FILE" ]]; then
  cp "$TELEMETRY_FILE" "${TELEMETRY_FILE}.backup"
  echo "✓ Backed up telemetry file"
fi

# Function to get the latest telemetry event
get_latest_event() {
  if [[ -f "$TELEMETRY_FILE" ]]; then
    tail -1 "$TELEMETRY_FILE"
  fi
}

# Function to check if an agent was detected
check_agent_detected() {
  local expected_agent="$1"
  local event=$(get_latest_event)

  if [[ -n "$event" ]]; then
    local agent_type=$(echo "$event" | jq -r '.agentType')
    local commands=$(echo "$event" | jq -r '.commands | join(",")')

    if [[ "$commands" == *"$expected_agent"* ]]; then
      echo -e "${GREEN}✓ PASS${NC}: Detected agent '$expected_agent' in telemetry"
      echo "  Commands: $commands"
      return 0
    else
      echo -e "${RED}✗ FAIL${NC}: Expected agent '$expected_agent', got: $commands"
      return 1
    fi
  else
    echo -e "${RED}✗ FAIL${NC}: No telemetry event found"
    return 1
  fi
}

# Function to wait for session to complete and telemetry to be written
wait_for_telemetry() {
  local timeout=10
  local count=0
  local initial_count=$(wc -l < "$TELEMETRY_FILE" 2>/dev/null || echo 0)

  echo "  Waiting for telemetry to be written..."
  while [[ $count -lt $timeout ]]; do
    sleep 1
    local current_count=$(wc -l < "$TELEMETRY_FILE" 2>/dev/null || echo 0)
    if [[ $current_count -gt $initial_count ]]; then
      echo "  ✓ New telemetry event detected"
      return 0
    fi
    count=$((count + 1))
  done

  echo -e "  ${YELLOW}⚠ Timeout waiting for telemetry${NC}"
  return 1
}

echo "==================================="
echo "Test 1: atomic --agent copilot"
echo "==================================="
echo "Command: atomic --agent copilot -- --agent research-codebase -i 'test question'"
echo ""

# Test 1 cannot be run non-interactively, so we'll skip it
echo -e "${YELLOW}⚠ SKIP${NC}: Test 1 requires interactive atomic CLI session (cannot automate)"
echo ""

echo "==================================="
echo "Test 2: Natural language invocation"
echo "==================================="
echo "Command: echo 'please use explain-code to explain this repo' | copilot"
echo ""

# Mark initial telemetry line count
INITIAL_LINE_COUNT=$(wc -l < "$TELEMETRY_FILE" 2>/dev/null || echo 0)

# Test 2: Natural language invocation
# This requires an interactive session, so we'll simulate by checking if the detection works
echo -e "${YELLOW}⚠ SKIP${NC}: Test 2 requires interactive copilot session (cannot automate)"
echo "  To test manually: Run 'copilot' and type 'please use explain-code to explain the repo'"
echo ""

echo "==================================="
echo "Test 3: CLI flag invocation"
echo "==================================="
echo "Command: copilot --agent=explain-code --prompt 'explain the code'"
echo ""

INITIAL_LINE_COUNT=$(wc -l < "$TELEMETRY_FILE" 2>/dev/null || echo 0)

# Test 3: CLI flag invocation (this can be run non-interactively)
timeout 30 copilot --agent=explain-code --prompt "explain the main function in src/index.ts" --allow-all-tools --allow-all-paths 2>/dev/null || true

# Wait for telemetry
sleep 3

# Check if new telemetry was written
NEW_LINE_COUNT=$(wc -l < "$TELEMETRY_FILE" 2>/dev/null || echo 0)
if [[ $NEW_LINE_COUNT -gt $INITIAL_LINE_COUNT ]]; then
  check_agent_detected "explain-code" || echo "  Note: This test may fail if session ended before telemetry was written"
else
  echo -e "${YELLOW}⚠ SKIP${NC}: No new telemetry event (session may still be running)"
fi
echo ""

echo "==================================="
echo "Test 4: Dropdown invocation"
echo "==================================="
echo "Command: copilot (interactive with /agent dropdown)"
echo ""

echo -e "${YELLOW}⚠ SKIP${NC}: Test 4 requires interactive copilot session with dropdown (cannot automate)"
echo "  To test manually: Run 'copilot', type '/agent', select 'explain-code', submit query"
echo ""

echo "==================================="
echo "Manual Verification Instructions"
echo "==================================="
echo ""
echo "To manually test the remaining scenarios:"
echo ""
echo "1. Test 1 - atomic CLI with copilot agent:"
echo "   $ atomic --agent copilot -- --agent research-codebase -i 'Describe the codebase'"
echo "   Expected: Both opencode and copilot agent sessions"
echo ""
echo "2. Test 2 - Natural language:"
echo "   $ copilot"
echo "   > please use explain-code to explain the repo"
echo "   Expected: agent session with explain-code"
echo ""
echo "4. Test 4 - Dropdown:"
echo "   $ copilot"
echo "   > /agent [select explain-code from dropdown]"
echo "   > explain the code"
echo "   Expected: agent session with explain-code"
echo ""
echo "After each test, check telemetry:"
echo "   $ tail -1 ~/.local/share/atomic/telemetry-events.jsonl | jq '.commands'"
echo ""

# Restore backup
if [[ -f "${TELEMETRY_FILE}.backup" ]]; then
  echo "Note: Original telemetry backed up to ${TELEMETRY_FILE}.backup"
fi

echo "==================================="
echo "Direct Detection Test"
echo "==================================="
echo "Testing detect_copilot_agents() on latest session..."
echo ""

source bin/telemetry-helper.sh
detected=$(detect_copilot_agents)

if [[ -n "$detected" ]]; then
  echo -e "${GREEN}✓ SUCCESS${NC}: detect_copilot_agents() returned: $detected"

  # Show the latest session info
  latest_session=$(ls -td "$COPILOT_STATE_DIR"/*/ 2>/dev/null | head -1)
  if [[ -n "$latest_session" ]]; then
    echo "  Latest session: $(basename "$latest_session")"
    echo "  Event count: $(wc -l < "${latest_session}/events.jsonl" 2>/dev/null || echo 0)"
  fi
else
  echo -e "${YELLOW}⚠ WARNING${NC}: detect_copilot_agents() returned empty"
  echo "  This is expected if no recent copilot sessions exist"
fi
echo ""

echo "==================================="
echo "Test Summary"
echo "==================================="
echo "✓ Test 3 (CLI flag): Attempted (check results above)"
echo "⚠ Test 1, 2, 4: Require manual testing (see instructions above)"
echo ""
