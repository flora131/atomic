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
USER_PROMPT="${PROMPT_PARTS[*]:-}"

# Default prompt includes /implement-feature and critical instructions
# Users can fully override by providing their own prompt
DEFAULT_PROMPT="You are tasked with implementing a SINGLE feature from the \`research/feature-list.json\` file.

# Getting up to speed

1. Run \`pwd\` to see the directory you're working in. Only make edits within the current git repository.
2. Read the git logs and progress files (\`research/progress.txt\`) to get up to speed on what was recently worked on.
3. Read the \`research/feature-list.json\` file and choose the highest-priority features that's not yet done to work on.

# Typical Workflow

## Initialization

A typical workflow will start something like this:

\`\`\`
[Assistant] I'll start by getting my bearings and understanding the current state of the project.
[Tool Use] <bash - pwd>
[Tool Use] <read - research/progress.txt>
[Tool Use] <read - research/feature-list.json>
[Assistant] Let me check the git log to see recent work.
[Tool Use] <bash - git log --oneline -20>
[Assistant] Now let me check if there's an init.sh script to restart the servers.
<Starts the development server>
[Assistant] Excellent! Now let me navigate to the application and verify that some fundamental features are still working.
<Tests basic functionality>
[Assistant] Based on my verification testing, I can see that the fundamental functionality is working well. The core chat features, theme switching, conversation loading, and error handling are all functioning correctly. Now let me review the tests.json file more comprehensively to understand what needs to be implemented next.
<Starts work on a new feature>
\`\`\`

## Test-Driven Development

Frequently use unit tests, integration tests, and end-to-end tests to verify your work AFTER you implement the feature. If the codebase has existing tests, run them often to ensure existing functionality is not broken.

### Testing Anti-Patterns

Use your testing-anti-patterns skill to avoid common pitfalls when writing tests.

## Design Principles

### Feature Implementation Guide: Managing Complexity

Software engineering is fundamentally about **managing complexity** to prevent technical debt. When implementing features, prioritize maintainability and testability over cleverness.

**1. Apply Core Principles (The Axioms)**
* **SOLID:** Adhere strictly to these, specifically **Single Responsibility** (a class should have only one reason to change) and **Dependency Inversion** (depend on abstractions/interfaces, not concrete details).
* **Pragmatism:** Follow **KISS** (Keep It Simple) and **YAGNI** (You Aren't Gonna Need It). Do not build generic frameworks for hypothetical future requirements.

**2. Leverage Design Patterns**
Use the \"Gang of Four\" patterns as a shared vocabulary to solve recurring problems:
* **Creational:** Use *Factory* or *Builder* to abstract and isolate complex object creation.
* **Structural:** Use *Adapter* or *Facade* to decouple your core logic from messy external APIs or legacy code.
* **Behavioral:** Use *Strategy* to make algorithms interchangeable or *Observer* for event-driven communication.

**3. Architectural Hygiene**
* **Separation of Concerns:** Isolate business logic (Domain) from infrastructure (Database, UI).
* **Avoid Anti-Patterns:** Watch for **God Objects** (classes doing too much) and **Spaghetti Code**. If you see them, refactor using polymorphism.

**Goal:** Create \"seams\" in your software using interfaces. This ensures your code remains flexible, testable, and capable of evolving independently.

## Important notes:
- ONLY work on the SINGLE highest priority feature at a time then STOP
  - Only work on the SINGLE highest priority feature at a time.
  - Use the \`research/feature-list.json\` file if it is provided to you as a guide otherwise create your own \`feature-list.json\` based on the task.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
- Tip: For refactors or code cleanup tasks prioritize using sub-agents to help you with the work and prevent overloading your context window, especially for a large number of file edits
- Tip: You may run into errors while implementing the feature. ALWAYS delegate to the debugger agent using the Task tool (you can ask it to navigate the web to find best practices for the latest version) and follow the guidelines there to create a debug report
    - AFTER the debug report is generated by the debugger agent follow these steps IN ORDER:
      1. First, add a new feature to \`research/feature-list.json\` with the highest priority to fix the bug and set its \`passes\` field to \`false\`
      2. Second, append the debug report to \`research/progress.txt\` for future reference
      3. Lastly, IMMEDIATELY STOP working on the current feature and EXIT
- You may be tempted to ignore unrelated errors that you introduced or were pre-existing before you started working on the feature. DO NOT IGNORE THEM. If you need to adjust priority, do so by updating the \`research/feature-list.json\` (move the fix to the top) and \`research/progress.txt\` file to reflect the new priorities
- IF at ANY point MORE THAN 60% of your context window is filled, STOP
- AFTER implementing the feature AND verifying its functionality by creating tests, update the \`passes\` field to \`true\` for that feature in \`research/feature-list.json\`
- It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
- Commit progress to git with descriptive commit messages by running the \`/commit\` command using the \`SlashCommand\` tool
- Write summaries of your progress in \`research/progress.txt\`
    - Tip: this can be useful to revert bad code changes and recover working states of the codebase
- Note: you are competing with another coding agent that also implements features. The one who does a better job implementing features will be promoted. Focus on quality, correctness, and thorough testing. The agent who breaks the rules for implementation will be fired."

# Use user prompt if provided, otherwise use default
if [[ -n "$USER_PROMPT" ]]; then
  FULL_PROMPT="$USER_PROMPT"
else
  FULL_PROMPT="$DEFAULT_PROMPT"

  # Verify feature list exists when using default prompt
  if [[ ! -f "$FEATURE_LIST_PATH" ]]; then
    echo "Error: Feature list not found at: $FEATURE_LIST_PATH" >&2
    echo "" >&2
    echo "   The default /implement-feature prompt requires a feature list to work." >&2
    echo "" >&2
    echo "   To fix this, either:" >&2
    echo "     1. Create the feature list: /create-feature-list" >&2
    echo "     2. Specify a different path: --feature-list <path>" >&2
    echo "     3. Use a custom prompt instead" >&2
    exit 1
  fi
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
  --arg prompt "$FULL_PROMPT" \
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
echo "$FULL_PROMPT" > .github/ralph-continue.flag

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

# Output the initial prompt info
if [[ -n "$USER_PROMPT" ]]; then
  echo ""
  echo "Custom prompt: $USER_PROMPT"
else
  echo ""
  echo "Using default prompt:"
  echo "$DEFAULT_PROMPT"
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
