#!/usr/bin/env bun
/**
 * Chat CLI command for atomic
 *
 * Integrates the OpenTUI chat interface with graph workflows and SDK clients.
 *
 * Usage:
 *   atomic chat                      Start chat with default agent (claude)
 *   atomic chat -a <agent>           Start chat with specified agent
 *   atomic chat --workflow           Enable graph workflow mode
 *   atomic chat --theme <name>       Use specified theme (dark/light)
 *
 * Reference: Feature 30 - Integrate OpenTUI chat interface with graph workflows
 */

import type { AgentType } from "../utils/telemetry/types.ts";
import type { CodingAgentClient, Session, AgentMessage } from "../sdk/types.ts";
import type { AtomicWorkflowState } from "../graph/annotation.ts";
import type { StepResult } from "../graph/compiled.ts";

// SDK client imports
import { createClaudeAgentClient } from "../sdk/claude-client.ts";
import { createOpenCodeClient } from "../sdk/opencode-client.ts";
import { createCopilotClient } from "../sdk/copilot-client.ts";

// Chat UI imports
import {
  startChatUI,
  darkTheme,
  lightTheme,
  type ChatUIConfig,
  type Theme,
} from "../ui/index.ts";

// Graph workflow imports
import {
  createAtomicWorkflow,
  createAtomicState,
  ATOMIC_NODE_IDS,
} from "../workflows/atomic.ts";
import { streamGraph } from "../graph/compiled.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the chat command.
 */
export interface ChatCommandOptions {
  /** Agent type to use (claude, opencode, copilot) */
  agentType?: AgentType;
  /** Enable graph workflow mode */
  workflow?: boolean;
  /** Theme to use (dark/light) */
  theme?: "dark" | "light";
  /** Session configuration options */
  model?: string;
  /** Maximum iterations for workflow mode */
  maxIterations?: number;
}

/**
 * Internal state for workflow-enabled chat.
 */
interface WorkflowChatState {
  /** Current workflow state */
  workflowState: AtomicWorkflowState | null;
  /** Whether waiting for spec approval */
  awaitingApproval: boolean;
  /** Callback to provide approval input */
  approvalCallback: ((input: string) => void) | null;
  /** Accumulated progress messages */
  progressMessages: string[];
}

// ============================================================================
// Client Factory
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
 * Get the display name for an agent type.
 */
function getAgentDisplayName(agentType: AgentType): string {
  const names: Record<AgentType, string> = {
    claude: "Claude",
    opencode: "OpenCode",
    copilot: "Copilot",
  };
  return names[agentType] ?? agentType;
}

/**
 * Get theme from name.
 */
function getTheme(themeName: "dark" | "light"): Theme {
  return themeName === "light" ? lightTheme : darkTheme;
}

// ============================================================================
// Workflow Progress Helpers
// ============================================================================

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
 * Format a workflow step result as a chat message.
 */
function formatStepProgress(stepResult: StepResult<AtomicWorkflowState>): string {
  const { nodeId, status, state } = stepResult;
  const nodeName = getNodeDisplayName(nodeId);
  const statusEmoji = getStatusEmoji(status);

  let message = `${statusEmoji} **${nodeName}** (iteration ${state.iteration})`;

  // Add feature progress if available
  if (state.featureList.length > 0) {
    const passingCount = state.featureList.filter((f) => f.passes).length;
    const totalCount = state.featureList.length;
    message += `\n   Features: ${passingCount}/${totalCount} passing`;
  }

  return message;
}

/**
 * Get an emoji indicator for execution status.
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case "running":
      return "[Running]";
    case "paused":
      return "[Paused]";
    case "completed":
      return "[Done]";
    case "failed":
      return "[Error]";
    case "cancelled":
      return "[Cancelled]";
    default:
      return "[>]";
  }
}

// ============================================================================
// Slash Command Handling
// ============================================================================

/**
 * Check if a message is a slash command.
 */
function isSlashCommand(message: string): boolean {
  return message.startsWith("/");
}

/**
 * Parse a slash command.
 */
function parseSlashCommand(message: string): { command: string; args: string } {
  const trimmed = message.slice(1).trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.toLowerCase(), args: "" };
  }
  return {
    command: trimmed.slice(0, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

/**
 * Handle the /theme slash command.
 *
 * @returns Theme change message or null if invalid
 */
function handleThemeCommand(args: string): { newTheme: "dark" | "light"; message: string } | null {
  const themeName = args.toLowerCase();
  if (themeName === "dark" || themeName === "light") {
    return {
      newTheme: themeName,
      message: `Theme switched to ${themeName} mode.`,
    };
  }
  return null;
}

// ============================================================================
// Chat Command Implementation
// ============================================================================

/**
 * Start the chat interface with the specified options.
 *
 * @param options - Chat command configuration options
 * @returns Exit code (0 for success)
 */
export async function chatCommand(options: ChatCommandOptions = {}): Promise<number> {
  const {
    agentType = "claude",
    workflow = false,
    theme = "dark",
    model,
    maxIterations = 100,
  } = options;

  const agentName = getAgentDisplayName(agentType);

  console.log(`Starting ${agentName} chat interface...`);
  if (workflow) {
    console.log("Graph workflow mode enabled.");
  }
  console.log("");

  // Create the SDK client
  const client = createClientForAgentType(agentType);

  try {
    await client.start();

    // Get model info from the client (after start to ensure connection)
    // Pass the model from CLI options if provided for accurate display
    const modelDisplayInfo = await client.getModelDisplayInfo(model);

    // Build chat UI configuration
    const chatConfig: ChatUIConfig = {
      sessionConfig: {
        model,
      },
      theme: getTheme(theme),
      title: workflow ? `Atomic Workflow - ${agentName}` : `Atomic Chat - ${agentName}`,
      placeholder: workflow
        ? "Type a message or /workflow to start..."
        : "Type a message...",
      version: "0.4.4",
      model: model ?? modelDisplayInfo.model,
      tier: modelDisplayInfo.tier,
      workingDir: process.cwd(),
      suggestion: 'Try "fix typecheck errors"',
    };

    if (workflow) {
      // Start workflow-enabled chat
      const result = await startWorkflowChat(client, chatConfig, {
        agentType,
        maxIterations,
      });
      return result;
    } else {
      // Start standard chat
      const result = await startChatUI(client, chatConfig);
      console.log(`\nChat ended. ${result.messageCount} messages exchanged.`);
      return 0;
    }
  } catch (error) {
    console.error("Chat error:", error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await client.stop();
  }
}

/**
 * Start a workflow-enabled chat session.
 *
 * @param client - The SDK client to use
 * @param config - Chat UI configuration
 * @param workflowOptions - Workflow-specific options
 * @returns Exit code
 */
async function startWorkflowChat(
  client: CodingAgentClient,
  config: ChatUIConfig,
  workflowOptions: {
    agentType: AgentType;
    maxIterations: number;
  }
): Promise<number> {
  const { agentType, maxIterations } = workflowOptions;

  // Workflow state tracking
  const workflowState: WorkflowChatState = {
    workflowState: null,
    awaitingApproval: false,
    approvalCallback: null,
    progressMessages: [],
  };

  // Create a wrapper client that intercepts messages for workflow handling
  const workflowClient: CodingAgentClient = {
    agentType: client.agentType,

    async createSession(sessionConfig) {
      const session = await client.createSession(sessionConfig);
      return wrapSessionWithWorkflow(session, workflowState, {
        agentType,
        maxIterations,
      });
    },

    async resumeSession(sessionId) {
      const session = await client.resumeSession(sessionId);
      if (!session) return null;
      return wrapSessionWithWorkflow(session, workflowState, {
        agentType,
        maxIterations,
      });
    },

    on: client.on.bind(client),
    registerTool: client.registerTool.bind(client),
    start: client.start.bind(client),
    stop: client.stop.bind(client),
    getModelDisplayInfo: client.getModelDisplayInfo.bind(client),
  };

  const result = await startChatUI(workflowClient, config);
  console.log(`\nWorkflow chat ended. ${result.messageCount} messages exchanged.`);
  return 0;
}

/**
 * Wrap a session with workflow handling.
 */
function wrapSessionWithWorkflow(
  session: Session,
  state: WorkflowChatState,
  options: {
    agentType: AgentType;
    maxIterations: number;
  }
): Session {
  return {
    id: session.id,

    async send(message: string): Promise<AgentMessage> {
      // Handle slash commands
      if (isSlashCommand(message)) {
        const { command } = parseSlashCommand(message);

        if (command === "workflow" || command === "start") {
          // Start workflow execution
          return {
            type: "text",
            content: "Starting workflow execution... Use /status to check progress.",
            role: "assistant",
          };
        }

        if (command === "reject" && state.awaitingApproval && state.approvalCallback) {
          state.approvalCallback("reject");
          state.awaitingApproval = false;
          state.approvalCallback = null;
          return {
            type: "text",
            content: "Specification rejected. Returning to revision phase...",
            role: "assistant",
          };
        }

        if (command === "status") {
          if (state.workflowState) {
            const { featureList, iteration, specApproved, prUrl } = state.workflowState;
            const passingCount = featureList.filter((f) => f.passes).length;
            const totalCount = featureList.length;
            let statusMessage = `**Workflow Status**\n`;
            statusMessage += `- Iteration: ${iteration}\n`;
            statusMessage += `- Spec Approved: ${specApproved ? "Yes" : "No"}\n`;
            statusMessage += `- Features: ${passingCount}/${totalCount} passing\n`;
            if (prUrl) {
              statusMessage += `- PR URL: ${prUrl}`;
            }
            return {
              type: "text",
              content: statusMessage,
              role: "assistant",
            };
          }
          return {
            type: "text",
            content: "No workflow running. Use /workflow to start.",
            role: "assistant",
          };
        }

        if (command === "help") {
          return {
            type: "text",
            content: `**Available Commands**
/workflow - Start the Atomic workflow
/status - Show workflow status
/reject - Reject and request revisions
/theme <dark|light> - Switch theme
/help - Show this help message`,
            role: "assistant",
          };
        }
      }

      // Handle manual continuation if awaiting approval
      // Spec approval is now manual before workflow start; any input continues the workflow
      if (state.awaitingApproval && state.approvalCallback) {
        // Check if user explicitly rejects with /reject or "reject"
        const isRejection = message.toLowerCase().includes("reject");
        state.approvalCallback(isRejection ? "reject" : "continue");
        state.awaitingApproval = false;
        state.approvalCallback = null;
        return {
          type: "text",
          content: isRejection
            ? "Specification rejected. Returning to revision phase..."
            : "Continuing workflow...",
          role: "assistant",
        };
      }

      // Forward to underlying session
      return session.send(message);
    },

    stream(message: string): AsyncIterable<AgentMessage> {
      // For streaming, check for slash commands first
      if (isSlashCommand(message)) {
        const { command } = parseSlashCommand(message);

        if (command === "workflow" || command === "start") {
          // Start workflow and stream progress
          return streamWorkflowExecution(state, options);
        }
      }

      // Forward to underlying session for regular streaming
      return session.stream(message);
    },

    summarize: session.summarize.bind(session),
    getContextUsage: session.getContextUsage.bind(session),
    destroy: session.destroy.bind(session),
  };
}

/**
 * Stream workflow execution as chat messages.
 */
async function* streamWorkflowExecution(
  state: WorkflowChatState,
  options: {
    agentType: AgentType;
    maxIterations: number;
  }
): AsyncGenerator<AgentMessage> {
  const { maxIterations } = options;

  yield {
    type: "text",
    content: "Starting Atomic workflow execution...\n",
    role: "assistant",
  };

  // Create the workflow
  const workflowConfig = {
    maxIterations,
    checkpointing: false, // Disable for chat mode
    autoApproveSpec: false,
  };

  const workflow = createAtomicWorkflow(workflowConfig);
  const initialState = createAtomicState();

  try {
    // Stream execution
    for await (const stepResult of streamGraph(workflow, { initialState })) {
      state.workflowState = stepResult.state;

      // Format and yield progress
      const progressMessage = formatStepProgress(stepResult);
      yield {
        type: "text",
        content: progressMessage + "\n",
        role: "assistant",
      };

      // Handle human_input_required signal (paused status)
      if (stepResult.status === "paused") {
        yield {
          type: "text",
          content: "\n---\n**Specification Review Required**\n",
          role: "assistant",
        };

        if (stepResult.state.specDoc) {
          yield {
            type: "text",
            content: "```\n" + stepResult.state.specDoc + "\n```\n",
            role: "assistant",
          };
        }

        yield {
          type: "text",
          content: "\nType `/reject <feedback>` to request revisions or continue manually.\n",
          role: "assistant",
        };

        // Set up approval waiting
        state.awaitingApproval = true;

        // Note: In a real implementation, we'd need to pause here and wait
        // for user input. For now, we just mark the state and the next
        // user message will be interpreted as approval/rejection.
        return;
      }

      // Handle completion
      if (stepResult.status === "completed") {
        yield {
          type: "text",
          content: "\n**Workflow completed successfully!**\n",
          role: "assistant",
        };

        if (stepResult.state.prUrl) {
          yield {
            type: "text",
            content: `Pull Request URL: ${stepResult.state.prUrl}\n`,
            role: "assistant",
          };
        }

        const { featureList } = stepResult.state;
        if (featureList.length > 0) {
          const passingCount = featureList.filter((f) => f.passes).length;
          yield {
            type: "text",
            content: `Final Status: ${passingCount}/${featureList.length} features passing\n`,
            role: "assistant",
          };
        }

        return;
      }

      // Handle failure
      if (stepResult.status === "failed") {
        yield {
          type: "text",
          content: "\n**Workflow execution failed**\n",
          role: "assistant",
        };

        if (stepResult.error) {
          const errorMessage =
            stepResult.error.error instanceof Error
              ? stepResult.error.error.message
              : String(stepResult.error.error);
          yield {
            type: "text",
            content: `Error: ${errorMessage}\n`,
            role: "assistant",
          };
        }

        return;
      }
    }
  } catch (error) {
    yield {
      type: "text",
      content: `\nWorkflow error: ${error instanceof Error ? error.message : String(error)}\n`,
      role: "assistant",
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  createClientForAgentType,
  getAgentDisplayName,
  getTheme,
  isSlashCommand,
  parseSlashCommand,
  handleThemeCommand,
  getNodeDisplayName,
  formatStepProgress,
  getStatusEmoji,
};
