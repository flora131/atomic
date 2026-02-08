#!/usr/bin/env bun
/**
 * Ralph CLI commands for atomic
 *
 * Usage:
 *   atomic ralph [OPTIONS]   Run Ralph workflow
 *
 * Ralph sessions are stored in .ralph/sessions/{session_id}/ with:
 * - session.json: Session state and metadata
 * - feature-list.json: Features for this session
 * - progress.txt: Human-readable progress log
 * - checkpoints/: Workflow state checkpoints
 */

import { createInterface } from "node:readline";

// Graph workflow imports
import {
  createRalphWorkflow,
  RALPH_NODE_IDS,
  type CreateRalphWorkflowConfig,
} from "../workflows/ralph/workflow.ts";
import { streamGraph, type StepResult } from "../graph/compiled.ts";
import { withGraphTelemetry } from "../telemetry/graph-integration.ts";
import {
  createRalphWorkflowState,
  type RalphWorkflowState,
} from "../graph/nodes/ralph-nodes.ts";

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
 */
export interface RalphSetupOptions {
  /**
   * Maximum iterations before auto-stop.
   * Default: 0 (unlimited iterations)
   */
  maxIterations?: number;

  /**
   * Agent type for execution.
   * Default: 'claude'
   */
  agentType?: AgentType;

  /**
   * Enable checkpointing for workflow resumption.
   * Default: true
   */
  checkpointing?: boolean;

  /**
   * Run in yolo mode (no feature list, freestyle).
   * Default: false
   */
  yolo?: boolean;

  /**
   * User prompt for yolo mode.
   */
  userPrompt?: string;

  /**
   * Initial prompt parts for the Ralph loop.
   */
  prompt?: string[];

  /**
   * Promise phrase to signal completion.
   */
  completionPromise?: string;

  /**
   * Path to feature list JSON file.
   */
  featureList?: string;
}

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
function displayStepProgress(stepResult: StepResult<RalphWorkflowState>): void {
  const { nodeId, status, state } = stepResult;
  const nodeName = getNodeDisplayName(nodeId);
  const statusEmoji = getStatusEmoji(status);

  console.log(` ${statusEmoji} ${nodeName} (iteration ${state.iteration})`);

  // Display feature progress if available
  if (state.features.length > 0) {
    const passingCount = state.features.filter((f) => f.status === "passing").length;
    const totalCount = state.features.length;
    console.log(`  Features: ${passingCount}/${totalCount} passing`);
  }
}

/**
 * Get a human-readable display name for a node ID.
 */
function getNodeDisplayName(nodeId: string): string {
  const nodeNames: Record<string, string> = {
    [RALPH_NODE_IDS.INIT_SESSION]: "Initializing session",
    [RALPH_NODE_IDS.CLEAR_CONTEXT]: "Clearing context",
    [RALPH_NODE_IDS.IMPLEMENT_FEATURE]: "Implementing feature",
    [RALPH_NODE_IDS.CHECK_COMPLETION]: "Checking completion",
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
    maxIterations = 0,
    agentType = "claude",
    checkpointing = true,
    yolo = false,
    userPrompt,
  } = options;

  console.log("🚀 Starting Ralph workflow...\n");
  console.log(`Agent type: ${agentType}`);
  console.log(`Max iterations: ${maxIterations === 0 ? "unlimited" : maxIterations}`);
  console.log(`Checkpointing: ${checkpointing ? "enabled" : "disabled"}`);
  console.log(`Mode: ${yolo ? "yolo (freestyle)" : "feature-list"}`);
  console.log("");

  // Create the SDK client
  const client = createClientForAgentType(agentType);
  await client.start();

  try {
    // Configure the workflow
    const workflowConfig: CreateRalphWorkflowConfig = {
      maxIterations,
      checkpointing,
      yolo,
      userPrompt,
      graphConfig: withGraphTelemetry({
        metadata: {
          agentType,
        },
      }),
    };

    // Create the workflow
    const workflow = createRalphWorkflow(workflowConfig);

    // Initialize state
    const initialState = createRalphWorkflowState();

    const divider = "─".repeat(45);
    console.log(`\n${divider}`);
    console.log(` Workflow Execution Started`);
    console.log(`${divider}\n`);

    // Stream execution and handle events
    for await (const stepResult of streamGraph(workflow, { initialState })) {
      displayStepProgress(stepResult);

      // Handle human_input_required signal (paused status)
      if (stepResult.status === "paused") {
        console.log(`\n${divider}`);
        console.log(` Workflow Paused`);
        console.log(`${divider}\n`);

        // Prompt for continuation
        const response = await promptUserInput(
          "Press Enter to continue or 'q' to quit: "
        );

        if (response.toLowerCase() === "q") {
          console.log("\n🚫 Workflow cancelled by user.\n");
          return 1;
        }

        console.log("\n▶️ Continuing workflow...\n");
      }

      // Handle completion
      if (stepResult.status === "completed") {
        console.log(`\n${divider}`);
        console.log(` Workflow Completed`);
        console.log(`${divider}`);

        // Display final feature status
        const { features } = stepResult.state;
        if (features.length > 0) {
          const passingCount = features.filter((f) => f.status === "passing").length;
          const totalCount = features.length;
          console.log(`\n 📊 Final Feature Status: ${passingCount}/${totalCount} passing\n`);

          if (passingCount < totalCount) {
            console.log(" Pending Features:");
            for (const feature of features.filter((f) => f.status !== "passing")) {
              console.log(`  - ${feature.description}`);
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
          console.error(`  Error: ${errorMessage}`);
          console.error(`  Node: ${stepResult.error.nodeId}`);
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
 * Run the Ralph workflow.
 *
 * @param options - Configuration options for the Ralph workflow
 */
export async function ralphSetup(options: RalphSetupOptions): Promise<number> {
  // Validate feature list path exists before entering interactive workflow
  if (options.featureList) {
    const { existsSync } = await import("fs");
    if (!existsSync(options.featureList)) {
      console.error(`Feature list not found: ${options.featureList}`);
      return 1;
    }
  }

  return executeGraphWorkflow(options);
}
