#!/usr/bin/env bun
/**
 * Ralph CLI commands for atomic
 *
 * Usage:
 *   atomic -a claude ralph setup [OPTIONS]   Initialize Ralph loop
 *   atomic -a claude ralph stop              Stop hook handler (called by hooks)
 */

import { mkdir, unlink, readFile, writeFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { withLock } from "../utils/file-lock.ts";
import type {
  HookJSONOutput,
  StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";

// Graph workflow imports
import {
  createAtomicWorkflow,
  createAtomicState,
  ATOMIC_NODE_IDS,
  type AtomicWorkflowConfig,
} from "../workflows/atomic.ts";
import { streamGraph, type StepResult } from "../graph/compiled.ts";
import { withGraphTelemetry } from "../telemetry/graph-integration.ts";
import type { AtomicWorkflowState } from "../graph/annotation.ts";

// SDK client imports
import { createClaudeAgentClient } from "../sdk/claude-client.ts";
import { createOpenCodeClient } from "../sdk/opencode-client.ts";
import { createCopilotClient } from "../sdk/copilot-client.ts";
import type { CodingAgentClient } from "../sdk/types.ts";
import type { AgentType } from "../utils/telemetry/types.ts";

// Configuration imports
import { isGraphEngineEnabled } from "../config/ralph.ts";

// ============================================================================
// Types
// ============================================================================

interface TranscriptMessage {
  role: string;
  message: {
    content: Array<{ type: string; text?: string }>;
  };
}

interface FeatureItem {
  passes?: boolean;
}

/**
 * Options for the ralphSetup() function
 *
 * This interface provides type-safe options for configuring the Ralph loop,
 * replacing the previous args array parsing approach.
 */
export interface RalphSetupOptions {
  /**
   * Initial prompt parts to start the loop.
   * Multiple parts will be joined with spaces.
   * If empty/undefined, uses the default /implement-feature prompt.
   */
  prompt: string[];

  /**
   * Maximum iterations before auto-stop.
   * Default: 0 (unlimited iterations)
   */
  maxIterations?: number;

  /**
   * Promise phrase that signals loop completion.
   * Agent must output <promise>TEXT</promise> to exit.
   * Default: undefined (no completion promise set)
   */
  completionPromise?: string;

  /**
   * Path to feature list JSON file.
   * Used by default prompt to track feature implementation progress.
   * Default: 'research/feature-list.json'
   */
  featureList?: string;

  /**
   * Agent type for graph-based execution.
   * Used when ATOMIC_USE_GRAPH_ENGINE=true.
   * Default: 'claude'
   */
  agentType?: AgentType;

  /**
   * Enable checkpointing for graph-based execution.
   * Default: true
   */
  checkpointing?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const RALPH_STATE_FILE = ".claude/ralph-loop.local.md";

const DEFAULT_PROMPT = `You are tasked with implementing a SINGLE feature from the \`research/feature-list.json\` file.

# Getting up to speed
1. IMPORTANT: If you sense your context window is more than 60% full, run the \`/compact\` command with your \`SlashCommand\` tool.
2. Run \`pwd\` to see the directory you're working in. Only make edits within the current git repository.
3. Read the git logs and progress files (\`research/progress.txt\`) to get up to speed on what was recently worked on.
4. Read the \`research/feature-list.json\` file and choose the highest-priority features that's not yet done to work on.

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

## Sub-Agent Delegation

When implementing complex features or refactoring large codebases, consider delegating work to sub-agents. This helps manage your context window and allows parallel progress on multiple files.

1. Identify complex tasks that can be isolated (e.g., refactoring a module, implementing a feature).
2. Create a sub-agent with a clear prompt and specific file targets.
3. Monitor the sub-agent's progress and integrate their changes back into your main workflow.

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
// Graph Engine Utilities
// ============================================================================

/**
 * Create an SDK client based on agent type.
 *
 * @param agentType - The type of agent to create a client for
 * @returns A CodingAgentClient instance
 */
function createClientForAgentType(agentType: AgentType): CodingAgentClient {
  switch (agentType) {
    case "claude":
      return createClaudeAgentClient();
    case "opencode":
      return createOpenCodeClient();
    case "copilot":
      return createCopilotClient();
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

/**
 * Prompt the user for input via readline.
 *
 * @param question - The prompt to display
 * @returns The user's input
 */
async function promptUserInput(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Display a progress update for a graph execution step.
 *
 * @param stepResult - The step result from graph execution
 */
function displayStepProgress(stepResult: StepResult<AtomicWorkflowState>): void {
  const { nodeId, status, state } = stepResult;
  const nodeName = getNodeDisplayName(nodeId);
  const statusEmoji = getStatusEmoji(status);

  console.log(`${statusEmoji} ${nodeName} (iteration ${state.iteration})`);

  // Display feature progress if available
  if (state.featureList.length > 0) {
    const passingCount = state.featureList.filter((f) => f.passes).length;
    const totalCount = state.featureList.length;
    console.log(`   Features: ${passingCount}/${totalCount} passing`);
  }
}

/**
 * Get a human-readable display name for a node ID.
 */
function getNodeDisplayName(nodeId: string): string {
  const nodeNames: Record<string, string> = {
    [ATOMIC_NODE_IDS.RESEARCH]: "Researching codebase",
    [ATOMIC_NODE_IDS.CREATE_SPEC]: "Creating specification",
    [ATOMIC_NODE_IDS.REVIEW_SPEC]: "Reviewing specification",
    [ATOMIC_NODE_IDS.WAIT_FOR_APPROVAL]: "Waiting for approval",
    [ATOMIC_NODE_IDS.CHECK_APPROVAL]: "Checking approval status",
    [ATOMIC_NODE_IDS.CREATE_FEATURE_LIST]: "Creating feature list",
    [ATOMIC_NODE_IDS.SELECT_FEATURE]: "Selecting next feature",
    [ATOMIC_NODE_IDS.IMPLEMENT_FEATURE]: "Implementing feature",
    [ATOMIC_NODE_IDS.CHECK_FEATURES]: "Checking feature status",
    [ATOMIC_NODE_IDS.CREATE_PR]: "Creating pull request",
  };
  return nodeNames[nodeId] ?? nodeId;
}

/**
 * Get an emoji indicator for execution status.
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case "running":
      return "🔄";
    case "paused":
      return "⏸️";
    case "completed":
      return "✅";
    case "failed":
      return "❌";
    case "cancelled":
      return "🚫";
    default:
      return "▶️";
  }
}

/**
 * Execute the Ralph workflow using the graph engine.
 *
 * @param options - The setup options
 * @returns Exit code (0 for success, non-zero for failure)
 */
async function executeGraphWorkflow(options: RalphSetupOptions): Promise<number> {
  const {
    maxIterations = 100,
    agentType = "claude",
    checkpointing = true,
    featureList: featureListPath = "research/feature-list.json",
  } = options;

  console.log("🚀 Starting graph-based workflow execution...\n");
  console.log(`Agent type: ${agentType}`);
  console.log(`Max iterations: ${maxIterations}`);
  console.log(`Checkpointing: ${checkpointing ? "enabled" : "disabled"}`);
  console.log("");

  // Create the SDK client
  const client = createClientForAgentType(agentType);
  await client.start();

  try {
    // Configure the workflow
    const workflowConfig: AtomicWorkflowConfig = {
      maxIterations,
      checkpointing,
      checkpointDir: "research/checkpoints",
      autoApproveSpec: false, // Require human approval
      graphConfig: withGraphTelemetry({
        metadata: {
          agentType,
          featureListPath,
        },
      }),
    };

    // Create the workflow
    const workflow = createAtomicWorkflow(workflowConfig);

    // Initialize state
    const initialState = createAtomicState();

    console.log("═══════════════════════════════════════════════════════════");
    console.log("Workflow Execution Started");
    console.log("═══════════════════════════════════════════════════════════\n");

    // Stream execution and handle events
    for await (const stepResult of streamGraph(workflow, { initialState })) {
      displayStepProgress(stepResult);

      // Handle human_input_required signal (paused status)
      if (stepResult.status === "paused") {
        console.log("\n═══════════════════════════════════════════════════════════");
        console.log("Human Input Required");
        console.log("═══════════════════════════════════════════════════════════\n");

        // Show the spec for review
        if (stepResult.state.specDoc) {
          console.log("Specification for Review:");
          console.log("─────────────────────────────────────────────────────────────");
          console.log(stepResult.state.specDoc);
          console.log("─────────────────────────────────────────────────────────────\n");
        }

        // Prompt for approval
        const response = await promptUserInput(
          "Type 'approve' to proceed or 'reject' to request revisions: "
        );

        const approved = response.toLowerCase().includes("approve");

        if (approved) {
          console.log("\n✅ Specification approved. Continuing workflow...\n");
        } else {
          console.log("\n🔄 Specification rejected. Returning to revision phase...\n");
        }

        // Resume execution with the approval result
        // The graph will handle routing based on the specApproved state
        // For now, we need to continue with updated state
        // The workflow handles this via the checkApprovalNode
      }

      // Handle completion
      if (stepResult.status === "completed") {
        console.log("\n═══════════════════════════════════════════════════════════");
        console.log("Workflow Completed");
        console.log("═══════════════════════════════════════════════════════════\n");

        // Display PR URL if available
        if (stepResult.state.prUrl) {
          console.log(`🔗 Pull Request URL: ${stepResult.state.prUrl}`);
        }

        // Display final feature status
        const { featureList } = stepResult.state;
        if (featureList.length > 0) {
          const passingCount = featureList.filter((f) => f.passes).length;
          const totalCount = featureList.length;
          console.log(`📊 Final Feature Status: ${passingCount}/${totalCount} passing`);

          if (passingCount < totalCount) {
            console.log("\nPending Features:");
            for (const feature of featureList.filter((f) => !f.passes)) {
              console.log(`   - ${feature.description}`);
            }
          }
        }

        return 0;
      }

      // Handle failure
      if (stepResult.status === "failed") {
        console.error("\n❌ Workflow execution failed");
        if (stepResult.error) {
          const errorMessage =
            stepResult.error.error instanceof Error
              ? stepResult.error.error.message
              : String(stepResult.error.error);
          console.error(`   Error: ${errorMessage}`);
          console.error(`   Node: ${stepResult.error.nodeId}`);
        }
        return 1;
      }

      // Handle cancellation
      if (stepResult.status === "cancelled") {
        console.log("\n🚫 Workflow execution cancelled");
        return 1;
      }
    }

    return 0;
  } finally {
    // Clean up the client
    await client.stop();
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Read stdin asynchronously
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Parse markdown frontmatter (YAML between ---) and extract values
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return {};

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

/**
 * Extract prompt text (everything after the closing ---)
 */
function extractPromptText(content: string): string {
  const lines = content.split(/\r?\n/);
  let dashCount = 0;
  const promptLines: string[] = [];

  for (const line of lines) {
    if (line === "---") {
      dashCount++;
      continue;
    }
    if (dashCount >= 2) {
      promptLines.push(line);
    }
  }

  return promptLines.join("\n");
}

/**
 * Check if all features are passing.
 * Uses file locking to prevent read during concurrent write.
 */
async function testAllFeaturesPassing(
  featureListPath: string,
): Promise<boolean> {
  try {
    return await withLock(featureListPath, async () => {
      const content = await readFile(featureListPath, "utf-8");
      const features: FeatureItem[] = JSON.parse(content);

      const totalFeatures = features.length;
      if (totalFeatures === 0) {
        console.error("ERROR: research/feature-list.json is empty.");
        return false;
      }

      const passingFeatures = features.filter((f) => f.passes === true).length;
      const failingFeatures = totalFeatures - passingFeatures;

      console.error(
        `Feature Progress: ${passingFeatures} / ${totalFeatures} passing (${failingFeatures} remaining)`,
      );

      return failingFeatures === 0;
    }, { timeoutMs: 5000 });
  } catch (lockError) {
    // If lock acquisition fails, try without lock
    console.error(`Warning: Could not acquire lock for ${featureListPath}: ${lockError instanceof Error ? lockError.message : String(lockError)}`);
    try {
      const content = await readFile(featureListPath, "utf-8");
      const features: FeatureItem[] = JSON.parse(content);
      return features.filter((f) => f.passes === true).length === features.length;
    } catch {
      console.error("ERROR: Failed to parse research/feature-list.json");
      return false;
    }
  }
}

/**
 * Extract text from <promise> tags
 */
function extractPromiseText(text: string): string {
  const match = text.match(/<promise>([\s\S]*?)<\/promise>/);
  if (!match || !match[1]) return "";
  return match[1].trim().replace(/\s+/g, " ");
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Stop Command
// ============================================================================

/**
 * Handle the stop hook - called when Claude tries to exit
 */
export async function ralphStop(): Promise<number> {
  // Step 1: Read stdin
  const hookInputRaw = await readStdin();
  let hookInput: StopHookInput;
  try {
    hookInput = JSON.parse(hookInputRaw);
  } catch {
    return 0;
  }

  // Step 2: Check if ralph-loop is active
  if (!(await fileExists(RALPH_STATE_FILE))) {
    return 0;
  }

  // Step 3: Read and parse state file
  const stateContent = await readFile(RALPH_STATE_FILE, "utf-8");
  const frontmatter = parseFrontmatter(stateContent);

  const iterationStr = frontmatter["iteration"] || "";
  const maxIterationsStr = frontmatter["max_iterations"] || "";
  const completionPromise = frontmatter["completion_promise"] || "";
  const featureListPath =
    frontmatter["feature_list_path"] || "research/feature-list.json";

  // Step 4: Validate numeric fields
  if (!/^\d+$/.test(iterationStr)) {
    console.error("⚠️  Ralph loop: State file corrupted");
    console.error(
      `   Problem: 'iteration' field is not a valid number (got: '${iterationStr}')`,
    );
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  if (!/^\d+$/.test(maxIterationsStr)) {
    console.error("⚠️  Ralph loop: State file corrupted");
    console.error(
      `   Problem: 'max_iterations' field is not a valid number (got: '${maxIterationsStr}')`,
    );
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  const iteration = parseInt(iterationStr, 10);
  const maxIterations = parseInt(maxIterationsStr, 10);

  // Step 5: Check if max iterations reached
  if (maxIterations > 0 && iteration >= maxIterations) {
    console.error(`🛑 Ralph loop: Max iterations (${maxIterations}) reached.`);
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  // Step 6: Check if all features are passing (only when max_iterations = 0, i.e., infinite mode)
  const featureFileExists = await fileExists(featureListPath);
  if (
    maxIterations === 0 &&
    featureFileExists &&
    (await testAllFeaturesPassing(featureListPath))
  ) {
    console.error("✅ All features passing! Exiting loop.");
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  // Step 7: Get transcript path and read last assistant message
  const transcriptPath = hookInput.transcript_path;

  if (!(await fileExists(transcriptPath))) {
    console.error("⚠️  Ralph loop: Transcript file not found");
    console.error(`   Expected: ${transcriptPath}`);
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  const transcriptContent = await readFile(transcriptPath, "utf-8");
  const lines = transcriptContent
    .split(/\r?\n/)
    .filter((line: string) => line.trim());

  // Find all assistant messages by searching for the substring
  const assistantLines = lines.filter((line: string) => {
    return line.includes('"role":"assistant"');
  });

  if (assistantLines.length === 0) {
    console.error("⚠️  Ralph loop: No assistant messages found in transcript");
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  // Extract last assistant message
  const lastLine = assistantLines[assistantLines.length - 1]!;
  let lastOutput = "";

  try {
    const parsed: TranscriptMessage = JSON.parse(lastLine);
    const textContents = parsed.message.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!);
    lastOutput = textContents.join("\n");
  } catch {
    console.error("⚠️  Ralph loop: Failed to parse assistant message JSON");
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  if (!lastOutput) {
    console.error(
      "⚠️  Ralph loop: Assistant message contained no text content",
    );
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  // Step 8: Check for completion promise (only if set)
  if (completionPromise && completionPromise !== "null") {
    const promiseText = extractPromiseText(lastOutput);

    if (promiseText && promiseText === completionPromise) {
      console.error(
        `✅ Ralph loop: Detected <promise>${completionPromise}</promise>`,
      );
      await unlink(RALPH_STATE_FILE);
      return 0;
    }
  }

  // Step 9: Not complete - continue loop with SAME PROMPT
  const nextIteration = iteration + 1;

  // Extract prompt (everything after the closing ---)
  const promptText = extractPromptText(stateContent);

  if (!promptText) {
    console.error("⚠️  Ralph loop: State file corrupted or incomplete");
    console.error("   Problem: No prompt text found");
    await unlink(RALPH_STATE_FILE);
    return 0;
  }

  // Step 10: Update iteration in frontmatter with file locking
  const updatedContent = stateContent.replace(
    /^iteration: .*/m,
    `iteration: ${nextIteration}`,
  );
  try {
    await withLock(RALPH_STATE_FILE, async () => {
      await writeFile(RALPH_STATE_FILE, updatedContent);
    }, { timeoutMs: 5000 });
  } catch {
    // Fallback: write without lock if lock acquisition fails
    await writeFile(RALPH_STATE_FILE, updatedContent);
  }

  // Step 11: Build system message with iteration count and completion promise info
  let systemMsg: string;
  if (completionPromise && completionPromise !== "null") {
    systemMsg = `🔄 Ralph iteration ${nextIteration} | To stop: output <promise>${completionPromise}</promise> (ONLY when statement is TRUE - do not lie to exit!)`;
  } else {
    systemMsg = `🔄 Ralph iteration ${nextIteration} | No completion promise set - loop runs indefinitely`;
  }

  // Output JSON to block the stop and feed prompt back
  const output: HookJSONOutput = {
    decision: "block",
    reason: promptText,
    systemMessage: systemMsg,
  };

  console.log(JSON.stringify(output));
  return 0;
}

// ============================================================================
// Setup Command
// ============================================================================

/**
 * Setup the Ralph loop
 *
 * @param options - Configuration options for the Ralph loop
 */
export async function ralphSetup(options: RalphSetupOptions): Promise<number> {
  // Check for graph engine feature flag (see src/config/ralph.ts)
  if (isGraphEngineEnabled()) {
    console.log("🔧 Graph engine mode enabled via ATOMIC_USE_GRAPH_ENGINE\n");
    return executeGraphWorkflow(options);
  }

  // Destructure options with defaults
  const {
    prompt,
    maxIterations = 0,
    completionPromise,
    featureList: featureListPath = "research/feature-list.json",
  } = options;

  // Join all prompt parts with spaces
  const userPrompt = prompt.join(" ");

  // Use user prompt if provided, otherwise use default
  let fullPrompt: string;
  if (userPrompt) {
    fullPrompt = userPrompt;
  } else {
    fullPrompt = DEFAULT_PROMPT;

    // Verify feature list exists when using default prompt
    const featureListExists = await fileExists(featureListPath);
    if (!featureListExists) {
      console.error(`❌ Error: Feature list not found at: ${featureListPath}`);
      console.error("");
      console.error(
        "   The default /implement-feature prompt requires a feature list to work.",
      );
      console.error("");
      console.error("   To fix this, either:");
      console.error("     1. Create the feature list: /create-feature-list");
      console.error("     2. Specify a different path: --feature-list <path>");
      console.error("     3. Use a custom prompt instead");
      return 1;
    }
  }

  // Create state file for stop hook (markdown with YAML frontmatter)
  await mkdir(".claude", { recursive: true });

  // Quote completion promise for YAML if it contains special chars or is defined
  let completionPromiseYaml: string;
  if (completionPromise !== undefined) {
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

  // Write state file with locking
  try {
    await withLock(RALPH_STATE_FILE, async () => {
      await writeFile(RALPH_STATE_FILE, stateFileContent);
    }, { timeoutMs: 5000 });
  } catch {
    // Fallback: write without lock if lock acquisition fails
    await writeFile(RALPH_STATE_FILE, stateFileContent);
  }

  // Output setup message
  const maxIterationsDisplay =
    maxIterations > 0 ? String(maxIterations) : "unlimited";
  let completionPromiseDisplay: string;
  if (completionPromise !== undefined) {
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
  if (completionPromise !== undefined) {
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

  return 0;
}


