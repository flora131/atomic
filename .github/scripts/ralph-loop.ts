#!/usr/bin/env bun

/**
 * Ralph Loop Setup Script - TypeScript Version
 *
 * Creates state file for Ralph loop with GitHub Copilot hooks.
 * Converted from: .github/scripts/setup-ralph-loop.sh
 *
 * Usage: bun run .github/scripts/ralph-loop.ts [PROMPT...] [OPTIONS]
 *
 * Reference implementations:
 * - YAML frontmatter: .opencode/plugin/ralph.ts:119-189
 * - Imports pattern: .claude/hooks/telemetry-stop.ts:1-16
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================================
// CONSTANTS
// ============================================================================

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_CONTINUE_FILE = ".github/ralph-continue.flag";
const DEFAULT_FEATURE_LIST_PATH = "research/feature-list.json";

// Default prompt - keep in sync with .opencode/plugin/ralph.ts
const DEFAULT_PROMPT = `You are tasked with implementing a SINGLE feature from the \`research/feature-list.json\` file.

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
Use the "Gang of Four" patterns as a shared vocabulary to solve recurring problems:
* **Creational:** Use *Factory* or *Builder* to abstract and isolate complex object creation.
* **Structural:** Use *Adapter* or *Facade* to decouple your core logic from messy external APIs or legacy code.
* **Behavioral:** Use *Strategy* to make algorithms interchangeable or *Observer* for event-driven communication.

**3. Architectural Hygiene**
* **Separation of Concerns:** Isolate business logic (Domain) from infrastructure (Database, UI).
* **Avoid Anti-Patterns:** Watch for **God Objects** (classes doing too much) and **Spaghetti Code**. If you see them, refactor using polymorphism.

**Goal:** Create "seams" in your software using interfaces. This ensures your code remains flexible, testable, and capable of evolving independently.

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
- Note: you are competing with another coding agent that also implements features. The one who does a better job implementing features will be promoted. Focus on quality, correctness, and thorough testing. The agent who breaks the rules for implementation will be fired.`;

// ============================================================================
// HELP TEXT
// ============================================================================

const HELP_TEXT = `Ralph Loop - Interactive self-referential development loop for GitHub Copilot

USAGE:
  bun run .github/scripts/ralph-loop.ts [PROMPT...] [OPTIONS]

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
  bun run .github/scripts/ralph-loop.ts                       (uses /implement-feature, runs until all features pass)
  bun run .github/scripts/ralph-loop.ts --max-iterations 20   (uses /implement-feature with iteration limit)
  bun run .github/scripts/ralph-loop.ts "Build a todo API" --completion-promise 'DONE' --max-iterations 20

STOPPING:
  Loop exits when any of these conditions are met:
  - --max-iterations limit reached
  - --completion-promise detected in output
  - All features in --feature-list are passing (when max_iterations = 0)

MONITORING:
  # View current state:
  cat .github/ralph-loop.local.md

  # Check if should continue:
  cat .github/ralph-continue.flag
`;

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

interface ParsedArgs {
  prompt: string[];
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  showHelp: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    prompt: [],
    maxIterations: 0,
    completionPromise: null,
    featureListPath: DEFAULT_FEATURE_LIST_PATH,
    showHelp: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      result.showHelp = true;
      i++;
    } else if (arg === "--max-iterations") {
      if (i + 1 >= args.length) {
        console.error("Error: --max-iterations requires a number argument");
        process.exit(1);
      }
      const value = args[i + 1];
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        console.error(`Error: --max-iterations must be a positive integer or 0, got: ${value}`);
        process.exit(1);
      }
      result.maxIterations = parsed;
      i += 2;
    } else if (arg === "--completion-promise") {
      if (i + 1 >= args.length) {
        console.error("Error: --completion-promise requires a text argument");
        process.exit(1);
      }
      result.completionPromise = args[i + 1];
      i += 2;
    } else if (arg === "--feature-list") {
      if (i + 1 >= args.length) {
        console.error("Error: --feature-list requires a path argument");
        process.exit(1);
      }
      result.featureListPath = args[i + 1];
      i += 2;
    } else {
      // Non-option argument - collect as prompt part
      result.prompt.push(arg);
      i++;
    }
  }

  return result;
}

// ============================================================================
// YAML FRONTMATTER WRITING
// Reference: .opencode/plugin/ralph.ts:170-189
// ============================================================================

interface RalphState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  startedAt: string;
  prompt: string;
}

function writeRalphState(state: RalphState): void {
  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
---

${state.prompt}
`;

  writeFileSync(RALPH_STATE_FILE, content, "utf-8");
}

// ============================================================================
// MAIN
// ============================================================================

function main(): void {
  // Parse CLI arguments (skip first two: bun and script path)
  const args = parseArgs(process.argv.slice(2));

  // Handle help
  if (args.showHelp) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Determine prompt
  const userPrompt = args.prompt.join(" ");
  let fullPrompt: string;

  if (userPrompt) {
    fullPrompt = userPrompt;
  } else {
    fullPrompt = DEFAULT_PROMPT;

    // Verify feature list exists when using default prompt
    if (!existsSync(args.featureListPath)) {
      console.error(`Error: Feature list not found at: ${args.featureListPath}`);
      console.error("");
      console.error("   The default /implement-feature prompt requires a feature list to work.");
      console.error("");
      console.error("   To fix this, either:");
      console.error("     1. Create the feature list: /create-feature-list");
      console.error("     2. Specify a different path: --feature-list <path>");
      console.error("     3. Use a custom prompt instead");
      process.exit(1);
    }
  }

  // Create .github directory if needed
  const stateDir = ".github";
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  // Build and write state
  const state: RalphState = {
    active: true,
    iteration: 1,
    maxIterations: args.maxIterations,
    completionPromise: args.completionPromise,
    featureListPath: args.featureListPath,
    startedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    prompt: fullPrompt,
  };

  writeRalphState(state);

  // Create continue flag for orchestrator
  writeFileSync(RALPH_CONTINUE_FILE, fullPrompt, "utf-8");

  // Output setup message
  const maxIterDisplay = args.maxIterations > 0 ? String(args.maxIterations) : "unlimited";
  const completionPromiseDisplay = args.completionPromise
    ? `${args.completionPromise} (ONLY output when TRUE!)`
    : "none (runs forever)";

  console.log(`Ralph loop activated for GitHub Copilot!

Iteration: 1
Max iterations: ${maxIterDisplay}
Completion promise: ${completionPromiseDisplay}
Feature list: ${args.featureListPath}

State file: ${RALPH_STATE_FILE}
Continue flag: ${RALPH_CONTINUE_FILE}

NOTE: GitHub Copilot hooks track state but cannot block session exit.
For full Ralph loop behavior, use an external orchestrator:

  while [ -f .github/ralph-continue.flag ]; do
    PROMPT=$(cat .github/ralph-continue.flag)
    echo "$PROMPT" | copilot --allow-all-tools --allow-all-paths
  done
`);

  // Output the initial prompt info
  if (userPrompt) {
    console.log(`\nCustom prompt: ${userPrompt}`);
  } else {
    console.log(`\nUsing default prompt:
${DEFAULT_PROMPT}`);
  }

  // Display completion promise requirements if set
  if (args.completionPromise) {
    console.log(`
===========================================
CRITICAL - Ralph Loop Completion Promise
===========================================

To complete this loop, output this EXACT text:
  <promise>${args.completionPromise}</promise>

STRICT REQUIREMENTS:
  - Use <promise> XML tags EXACTLY as shown
  - The statement MUST be completely TRUE
  - Do NOT output false statements to exit
===========================================`);
  }
}

main();
