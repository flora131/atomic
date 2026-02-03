#!/usr/bin/env bun
/**
 * Ralph CLI commands for atomic
 *
 * Usage:
 *   atomic -a claude ralph setup [OPTIONS]   Initialize Ralph loop
 *
 * Note: Hook-based execution (ralphStop) was removed. Graph engine is the only execution mode.
 */

import { createInterface } from "node:readline";

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


// ============================================================================
// Types
// ============================================================================

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
// Setup Command
// ============================================================================

/**
 * Setup the Ralph loop
 *
 * Graph engine is the only execution mode (hook-based execution was removed).
 *
 * @param options - Configuration options for the Ralph loop
 */
export async function ralphSetup(options: RalphSetupOptions): Promise<number> {
  // Graph engine is now the only execution mode
  return executeGraphWorkflow(options);
}


