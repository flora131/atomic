#!/usr/bin/env bash

# Ralph Loop Setup Script
# Creates state file for Ralph loop with GitHub Copilot hooks

set -euo pipefail

# Parse arguments
PROMPT_PARTS=()
MAX_ITERATIONS=0
COMPLETION_PROMISE="null"
FEATURE_LIST_PATH="research/feature-list.json"

# Parse options and positional arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      cat << 'HELP_EOF'
Ralph Loop - Interactive self-referential development loop for GitHub Copilot

USAGE:
  /ralph-loop [PROMPT...] [OPTIONS]

ARGUMENTS:
  PROMPT...    Initial prompt to start the loop (default: /implement-feature)

OPTIONS:
  --max-iterations <n>           Maximum iterations before auto-stop (default: unlimited)
  --completion-promise '<text>'  Promise phrase (USE QUOTES for multi-word)
  --feature-list <path>          Path to feature list JSON (default: research/feature-list.json)
  -h, --help                     Show this help message

DESCRIPTION:
  Starts a Ralph Wiggum loop using GitHub Copilot hooks. The sessionEnd hook
  tracks iterations and signals completion to an external orchestrator.

  NOTE: Unlike Claude Code, GitHub Copilot hooks cannot block session exit.
  Use an external loop for full Ralph behavior:
    while [ -f .github/ralph-continue.flag ]; do
      PROMPT=$(cat .github/ralph-continue.flag)
      echo "$PROMPT" | copilot --allow-all-tools --allow-all-paths
    done

  To signal completion, output: <promise>YOUR_PHRASE</promise>

EXAMPLES:
  /ralph-loop                       (uses /implement-feature, runs until all features pass)
  /ralph-loop --max-iterations 20   (uses /implement-feature with iteration limit)
  /ralph-loop "Build a todo API" --completion-promise 'DONE' --max-iterations 20

STOPPING:
  Loop exits when any of these conditions are met:
  - --max-iterations limit reached
  - --completion-promise detected in output
  - All features in --feature-list are passing (when max_iterations = 0)

MONITORING:
  # View current state:
  cat .github/ralph-loop.local.json | jq .

  # Check if should continue:
  cat .github/ralph-continue.flag
HELP_EOF
      exit 0
      ;;
    --max-iterations)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --max-iterations requires a number argument" >&2
        exit 1
      fi
      if ! [[ "$2" =~ ^[0-9]+$ ]]; then
        echo "Error: --max-iterations must be a positive integer or 0, got: $2" >&2
        exit 1
      fi
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --completion-promise)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --completion-promise requires a text argument" >&2
        exit 1
      fi
      COMPLETION_PROMISE="$2"
      shift 2
      ;;
    --feature-list)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --feature-list requires a path argument" >&2
        exit 1
      fi
      FEATURE_LIST_PATH="$2"
      shift 2
      ;;
    *)
      # Non-option argument - collect all as prompt parts
      PROMPT_PARTS+=("$1")
      shift
      ;;
  esac
done

# Join all prompt parts with spaces
PROMPT="${PROMPT_PARTS[*]:-}"

# Default to /implement-feature if no prompt provided
if [[ -z "$PROMPT" ]]; then
  PROMPT="/implement-feature"
fi

# If using /implement-feature, verify feature list exists
if [[ "$PROMPT" == "/implement-feature" ]] && [[ ! -f "$FEATURE_LIST_PATH" ]]; then
  echo "Error: Feature list not found at: $FEATURE_LIST_PATH" >&2
  echo "" >&2
  echo "   The /implement-feature prompt requires a feature list to work." >&2
  echo "" >&2
  echo "   To fix this, either:" >&2
  echo "     1. Create the feature list: /create-feature-list" >&2
  echo "     2. Specify a different path: --feature-list <path>" >&2
  echo "     3. Use a custom prompt instead" >&2
  exit 1
fi

# Create state file (JSON format for GitHub Copilot hooks)
mkdir -p .github

# Build state JSON
jq -n \
  --argjson active true \
  --argjson iter 1 \
  --argjson maxIter "$MAX_ITERATIONS" \
  --arg promise "$COMPLETION_PROMISE" \
  --arg featurePath "$FEATURE_LIST_PATH" \
  --arg prompt "$PROMPT" \
  --arg startedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    active: $active,
    iteration: $iter,
    maxIterations: $maxIter,
    completionPromise: $promise,
    featureListPath: $featurePath,
    prompt: $prompt,
    startedAt: $startedAt
  }' > .github/ralph-loop.local.json

# Create continue flag for orchestrator
echo "$PROMPT" > .github/ralph-continue.flag

# Output setup message
cat <<EOF
Ralph loop activated for GitHub Copilot!

Iteration: 1
Max iterations: $(if [[ $MAX_ITERATIONS -gt 0 ]]; then echo $MAX_ITERATIONS; else echo "unlimited"; fi)
Completion promise: $(if [[ "$COMPLETION_PROMISE" != "null" ]]; then echo "$COMPLETION_PROMISE (ONLY output when TRUE!)"; else echo "none (runs forever)"; fi)
Feature list: $FEATURE_LIST_PATH

State file: .github/ralph-loop.local.json
Continue flag: .github/ralph-continue.flag

NOTE: GitHub Copilot hooks track state but cannot block session exit.
For full Ralph loop behavior, use an external orchestrator:

  while [ -f .github/ralph-continue.flag ]; do
    PROMPT=\$(cat .github/ralph-continue.flag)
    echo "\$PROMPT" | copilot --allow-all-tools --allow-all-paths
  done

EOF

# Output the initial prompt
if [[ -n "$PROMPT" ]]; then
  echo ""
  echo "$PROMPT"
fi

# Display completion promise requirements if set
if [[ "$COMPLETION_PROMISE" != "null" ]]; then
  echo ""
  echo "==========================================="
  echo "CRITICAL - Ralph Loop Completion Promise"
  echo "==========================================="
  echo ""
  echo "To complete this loop, output this EXACT text:"
  echo "  <promise>$COMPLETION_PROMISE</promise>"
  echo ""
  echo "STRICT REQUIREMENTS:"
  echo "  - Use <promise> XML tags EXACTLY as shown"
  echo "  - The statement MUST be completely TRUE"
  echo "  - Do NOT output false statements to exit"
  echo "==========================================="
fi
