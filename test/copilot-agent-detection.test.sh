#!/usr/bin/env bash

# Unit tests for Copilot agent detection (Methods 1 & 2)
#
# Tests the simplified detection logic in bin/telemetry-helper.sh:
# - Method 1: Explicit agent_type in task tool calls
# - Method 2: agent_name in tool telemetry
#
# Usage: bash test/copilot-agent-detection.test.sh

set -uo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((TESTS_PASSED++))
  ((TESTS_RUN++))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  echo -e "  ${RED}Expected:${NC} $2"
  echo -e "  ${RED}Got:${NC} $3"
  ((TESTS_FAILED++))
  ((TESTS_RUN++))
}

setup() {
  # Create temporary test directory
  TEST_DIR=$(mktemp -d)
  export HOME="$TEST_DIR"

  # Create mock Copilot state directory
  COPILOT_STATE_DIR="$TEST_DIR/.copilot/session-state"
  mkdir -p "$COPILOT_STATE_DIR"

  # Create mock session directory
  SESSION_DIR="$COPILOT_STATE_DIR/session-$(date +%s)"
  mkdir -p "$SESSION_DIR"

  # Create mock .github/agents directory with test agent files
  mkdir -p .github/agents
  touch .github/agents/commit.md
  touch .github/agents/explain-code.md
  touch .github/agents/create-gh-pr.md
}

cleanup() {
  rm -rf "$TEST_DIR"
}

# Source the telemetry helper script
source "$(dirname "$0")/../bin/telemetry-helper.sh"

# ============================================================================
# Test: Method 1 - Explicit agent_type in task tool calls
# ============================================================================

test_method1_single_agent() {
  setup

  # Create events.jsonl with Method 1 detection
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"commit"}}]}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ "$result" == "commit" ]]; then
    pass "Method 1: Detects single agent from task tool call"
  else
    fail "Method 1: Detects single agent from task tool call" "commit" "$result"
  fi

  cleanup
}

test_method1_multiple_agents() {
  setup

  # Create events.jsonl with multiple agents
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"commit"}}]}}
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"explain-code"}}]}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ "$result" == "commit,explain-code" ]]; then
    pass "Method 1: Detects multiple agents from task tool calls"
  else
    fail "Method 1: Detects multiple agents from task tool calls" "commit,explain-code" "$result"
  fi

  cleanup
}

test_method1_multiple_agents_in_single_message() {
  setup

  # Create events.jsonl with multiple agents in one message
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"commit"}},{"name":"task","arguments":{"agent_type":"create-gh-pr"}}]}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ "$result" == "commit,create-gh-pr" ]]; then
    pass "Method 1: Detects multiple agents in single message"
  else
    fail "Method 1: Detects multiple agents in single message" "commit,create-gh-pr" "$result"
  fi

  cleanup
}

# ============================================================================
# Test: Method 2 - agent_name in tool telemetry
# ============================================================================

test_method2_single_agent() {
  setup

  # Create events.jsonl with Method 2 detection
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"tool.execution_complete","data":{"toolTelemetry":{"properties":{"agent_name":"explain-code"}}}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ "$result" == "explain-code" ]]; then
    pass "Method 2: Detects single agent from tool telemetry"
  else
    fail "Method 2: Detects single agent from tool telemetry" "explain-code" "$result"
  fi

  cleanup
}

test_method2_multiple_agents() {
  setup

  # Create events.jsonl with multiple agents
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"tool.execution_complete","data":{"toolTelemetry":{"properties":{"agent_name":"commit"}}}}
{"type":"tool.execution_complete","data":{"toolTelemetry":{"properties":{"agent_name":"create-gh-pr"}}}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ "$result" == "commit,create-gh-pr" ]]; then
    pass "Method 2: Detects multiple agents from tool telemetry"
  else
    fail "Method 2: Detects multiple agents from tool telemetry" "commit,create-gh-pr" "$result"
  fi

  cleanup
}

# ============================================================================
# Test: Combined Methods
# ============================================================================

test_combined_methods() {
  setup

  # Create events.jsonl using both methods
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"commit"}}]}}
{"type":"tool.execution_complete","data":{"toolTelemetry":{"properties":{"agent_name":"explain-code"}}}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ "$result" == "commit,explain-code" ]]; then
    pass "Combined: Detects agents from both methods"
  else
    fail "Combined: Detects agents from both methods" "commit,explain-code" "$result"
  fi

  cleanup
}

# ============================================================================
# Test: Edge Cases
# ============================================================================

test_empty_events_file() {
  setup

  # Create empty events.jsonl
  touch "$SESSION_DIR/events.jsonl"

  local result
  result=$(detect_copilot_agents)

  if [[ -z "$result" ]]; then
    pass "Edge case: Empty events file returns empty string"
  else
    fail "Edge case: Empty events file returns empty string" "(empty)" "$result"
  fi

  cleanup
}

test_no_agent_events() {
  setup

  # Create events.jsonl with no agent-related events
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"user.message","data":{"content":"hello"}}
{"type":"assistant.message","data":{"content":"hi there"}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ -z "$result" ]]; then
    pass "Edge case: No agent events returns empty string"
  else
    fail "Edge case: No agent events returns empty string" "(empty)" "$result"
  fi

  cleanup
}

test_nonexistent_agent_file() {
  setup

  # Create events.jsonl with agent that doesn't have a file
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"nonexistent-agent"}}]}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ -z "$result" ]]; then
    pass "Edge case: Nonexistent agent file is filtered out"
  else
    fail "Edge case: Nonexistent agent file is filtered out" "(empty)" "$result"
  fi

  cleanup
}

test_no_copilot_directory() {
  # Don't call setup - no Copilot directory exists
  export HOME=$(mktemp -d)

  local result
  result=$(detect_copilot_agents)

  if [[ -z "$result" ]]; then
    pass "Edge case: No Copilot directory returns empty string"
  else
    fail "Edge case: No Copilot directory returns empty string" "(empty)" "$result"
  fi

  rm -rf "$HOME"
}

test_duplicate_agents() {
  setup

  # Create events.jsonl with duplicate agents (for frequency tracking)
  cat > "$SESSION_DIR/events.jsonl" << 'EOF'
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"commit"}}]}}
{"type":"assistant.message","data":{"toolRequests":[{"name":"task","arguments":{"agent_type":"commit"}}]}}
EOF

  local result
  result=$(detect_copilot_agents)

  if [[ "$result" == "commit,commit" ]]; then
    pass "Edge case: Preserves duplicate agents for frequency tracking"
  else
    fail "Edge case: Preserves duplicate agents for frequency tracking" "commit,commit" "$result"
  fi

  cleanup
}

# ============================================================================
# Run Tests
# ============================================================================

echo ""
echo "Running Copilot Agent Detection Unit Tests"
echo "==========================================="
echo ""

# Method 1 tests
test_method1_single_agent
test_method1_multiple_agents
test_method1_multiple_agents_in_single_message

# Method 2 tests
test_method2_single_agent
test_method2_multiple_agents

# Combined tests
test_combined_methods

# Edge case tests
test_empty_events_file
test_no_agent_events
test_nonexistent_agent_file
test_no_copilot_directory
test_duplicate_agents

# Summary
echo ""
echo "==========================================="
echo "Tests run: $TESTS_RUN"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
if [[ $TESTS_FAILED -gt 0 ]]; then
  echo -e "${RED}Failed: $TESTS_FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
