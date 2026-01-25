#!/usr/bin/env bun

// Ralph Loop Setup Script
// Creates state file for in-session Ralph loop

import { mkdir } from "node:fs/promises";

const HELP_TEXT = `Ralph Loop - Interactive self-referential development loop

USAGE:
  /ralph-loop [PROMPT...] [OPTIONS]

ARGUMENTS:
  PROMPT...    Initial prompt to start the loop (optional)

OPTIONS:
  --max-iterations <n>           Maximum iterations before auto-stop (default: unlimited)
  --completion-promise '<text>'  Promise phrase (USE QUOTES for multi-word)
  --feature-list <path>          Path to feature list JSON (default: research/feature-list.json)
  -h, --help                     Show this help message

DESCRIPTION:
  Starts a Ralph Wiggum loop in your CURRENT session. The stop hook prevents
  exit and feeds your output back as input until completion or iteration limit.

  To signal completion, you must output: <promise>YOUR_PHRASE</promise>

  Use this for:
  - Interactive iteration where you want to see progress
  - Tasks requiring self-correction and refinement
  - Learning how Ralph works

EXAMPLES:
  /ralph-loop                       (uses /implement-feature, runs until all features pass)
  /ralph-loop --max-iterations 20   (uses /implement-feature with iteration limit)
  /ralph-loop Build a todo API --completion-promise 'DONE' --max-iterations 20
  /ralph-loop Refactor cache layer  (custom prompt, runs forever)

STOPPING:
  Loop exits when any of these conditions are met:
  - --max-iterations limit reached
  - --completion-promise detected in output
  - All features in --feature-list are passing (when max_iterations = 0)

MONITORING:
  # View current iteration:
  grep '^iteration:' .claude/ralph-loop.local.md

  # View full state:
  head -10 .claude/ralph-loop.local.md`;

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

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const promptParts: string[] = [];
  let maxIterations = 0;
  let completionPromise = "null";
  let featureListPath = "research/feature-list.json";

  // Parse options and positional arguments
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "-h" || arg === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg === "--max-iterations") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("❌ Error: --max-iterations requires a number argument");
        console.error("");
        console.error("   Valid examples:");
        console.error("     --max-iterations 10");
        console.error("     --max-iterations 50");
        console.error("     --max-iterations 0  (unlimited)");
        console.error("");
        console.error("   You provided: --max-iterations (with no number)");
        process.exit(1);
      }
      if (!/^\d+$/.test(nextArg)) {
        console.error(
          `❌ Error: --max-iterations must be a positive integer or 0, got: ${nextArg}`
        );
        console.error("");
        console.error("   Valid examples:");
        console.error("     --max-iterations 10");
        console.error("     --max-iterations 50");
        console.error("     --max-iterations 0  (unlimited)");
        console.error("");
        console.error("   Invalid: decimals (10.5), negative numbers (-5), text");
        process.exit(1);
      }
      maxIterations = parseInt(nextArg, 10);
      i += 2;
    } else if (arg === "--completion-promise") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("❌ Error: --completion-promise requires a text argument");
        console.error("");
        console.error("   Valid examples:");
        console.error("     --completion-promise 'DONE'");
        console.error("     --completion-promise 'TASK COMPLETE'");
        console.error("     --completion-promise 'All tests passing'");
        console.error("");
        console.error("   You provided: --completion-promise (with no text)");
        console.error("");
        console.error("   Note: Multi-word promises must be quoted!");
        process.exit(1);
      }
      completionPromise = nextArg;
      i += 2;
    } else if (arg === "--feature-list") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("❌ Error: --feature-list requires a path argument");
        console.error("");
        console.error("   Valid examples:");
        console.error("     --feature-list research/feature-list.json");
        console.error("     --feature-list features.json");
        console.error("");
        console.error("   You provided: --feature-list (with no path)");
        process.exit(1);
      }
      featureListPath = nextArg;
      i += 2;
    } else {
      // Non-option argument - collect all as prompt parts
      promptParts.push(arg);
      i++;
    }
  }

  // Join all prompt parts with spaces
  const userPrompt = promptParts.join(" ");

  // Use user prompt if provided, otherwise use default
  let fullPrompt: string;
  if (userPrompt) {
    fullPrompt = userPrompt;
  } else {
    fullPrompt = DEFAULT_PROMPT;

    // Verify feature list exists when using default prompt
    const featureListExists = await Bun.file(featureListPath).exists();
    if (!featureListExists) {
      console.error(`❌ Error: Feature list not found at: ${featureListPath}`);
      console.error("");
      console.error(
        "   The default /implement-feature prompt requires a feature list to work."
      );
      console.error("");
      console.error("   To fix this, either:");
      console.error("     1. Create the feature list: /create-feature-list");
      console.error("     2. Specify a different path: --feature-list <path>");
      console.error("     3. Use a custom prompt instead");
      process.exit(1);
    }
  }

  // Create state file for stop hook (markdown with YAML frontmatter)
  await mkdir(".claude", { recursive: true });

  // Quote completion promise for YAML if it contains special chars or is not null
  let completionPromiseYaml: string;
  if (completionPromise && completionPromise !== "null") {
    completionPromiseYaml = `"${completionPromise}"`;
  } else {
    completionPromiseYaml = "null";
  }

  // Get current UTC timestamp
  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const stateFileContent = `---
active: true
iteration: 1
max_iterations: ${maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${featureListPath}
started_at: "${startedAt}"
---

${fullPrompt}
`;

  await Bun.write(".claude/ralph-loop.local.md", stateFileContent);

  // Output setup message
  const maxIterationsDisplay =
    maxIterations > 0 ? String(maxIterations) : "unlimited";
  let completionPromiseDisplay: string;
  if (completionPromise !== "null") {
    completionPromiseDisplay = `${completionPromise} (ONLY output when TRUE - do not lie!)`;
  } else {
    completionPromiseDisplay = "none (runs forever)";
  }

  console.log(`🔄 Ralph loop activated in this session!

Iteration: 1
Max iterations: ${maxIterationsDisplay}
Completion promise: ${completionPromiseDisplay}

The stop hook is now active. When you try to exit, the SAME PROMPT will be
fed back to you. You'll see your previous work in files, creating a
self-referential loop where you iteratively improve on the same task.

To monitor: head -10 .claude/ralph-loop.local.md

⚠️  WARNING: This loop cannot be stopped manually! It will run indefinitely
    unless you set --max-iterations or --completion-promise or --feature-list.

🔄`);

  // Output the initial prompt info
  if (userPrompt) {
    console.log("");
    console.log(`Custom prompt: ${userPrompt}`);
  } else {
    console.log("");
    console.log("Using default prompt:");
    console.log(DEFAULT_PROMPT);
  }

  // Display completion promise requirements if set
  if (completionPromise !== "null") {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("CRITICAL - Ralph Loop Completion Promise");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log("To complete this loop, output this EXACT text:");
    console.log(`  <promise>${completionPromise}</promise>`);
    console.log("");
    console.log("STRICT REQUIREMENTS (DO NOT VIOLATE):");
    console.log("  ✓ Use <promise> XML tags EXACTLY as shown above");
    console.log("  ✓ The statement MUST be completely and unequivocally TRUE");
    console.log("  ✓ Do NOT output false statements to exit the loop");
    console.log("  ✓ Do NOT lie even if you think you should exit");
    console.log("");
    console.log("IMPORTANT - Do not circumvent the loop:");
    console.log("  Even if you believe you're stuck, the task is impossible,");
    console.log("  or you've been running too long - you MUST NOT output a");
    console.log("  false promise statement. The loop is designed to continue");
    console.log("  until the promise is GENUINELY TRUE. Trust the process.");
    console.log("");
    console.log("  If the loop should stop, the promise statement will become");
    console.log("  true naturally. Do not force it by lying.");
    console.log("═══════════════════════════════════════════════════════════");
  }
}

main();
