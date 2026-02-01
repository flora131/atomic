/**
 * CLI Integration for Chat UI
 *
 * Entry point for starting the terminal chat interface.
 * Connects ChatApp component to a coding agent client.
 *
 * Reference: Feature 20 - Implement CLI integration for chat UI
 */

import React from "react";
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import { ChatApp, type OnToolStart, type OnToolComplete } from "./chat.tsx";
import { ThemeProvider, darkTheme, type Theme } from "./theme.tsx";
import { initializeCommandsAsync } from "./commands/index.ts";
import type {
  CodingAgentClient,
  SessionConfig,
  Session,
  AgentMessage,
} from "../sdk/types.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for starting the chat UI.
 */
export interface ChatUIConfig {
  /** Session configuration for the agent */
  sessionConfig?: SessionConfig;
  /** Initial theme (defaults to dark) */
  theme?: Theme;
  /** Title for the chat window */
  title?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Application version for header */
  version?: string;
  /** Model name for header */
  model?: string;
  /** Model tier/plan for header */
  tier?: string;
  /** Working directory for header */
  workingDir?: string;
  /** Suggestion text for header */
  suggestion?: string;
}

/**
 * Result returned when the chat UI exits.
 */
export interface ChatUIResult {
  /** Session that was active during the chat */
  session: Session | null;
  /** Number of messages exchanged */
  messageCount: number;
  /** Duration of the chat session in milliseconds */
  duration: number;
}

/**
 * Internal state for managing the chat UI lifecycle.
 */
interface ChatUIState {
  renderer: CliRenderer | null;
  root: Root | null;
  session: Session | null;
  startTime: number;
  messageCount: number;
  cleanupHandlers: (() => void)[];
  /** Registered handler for tool start events */
  toolStartHandler: OnToolStart | null;
  /** Registered handler for tool complete events */
  toolCompleteHandler: OnToolComplete | null;
  /** Tool ID counter for generating unique IDs */
  toolIdCounter: number;
}

// ============================================================================
// CHAT UI IMPLEMENTATION
// ============================================================================

/**
 * Start the terminal chat UI with a coding agent client.
 *
 * Creates a full-screen terminal interface for chatting with an AI agent.
 * Handles message sending, streaming responses, and graceful cleanup.
 *
 * @param client - The coding agent client to use
 * @param config - Optional configuration for the chat UI
 * @returns Promise that resolves when the chat UI exits
 *
 * @example
 * ```typescript
 * import { startChatUI } from "./ui";
 * import { ClaudeAgentClient } from "./sdk/claude-client";
 *
 * const client = new ClaudeAgentClient();
 * await client.start();
 *
 * const result = await startChatUI(client, {
 *   title: "Claude Chat",
 *   sessionConfig: { model: "claude-3-opus" },
 * });
 *
 * console.log(`Chat ended after ${result.messageCount} messages`);
 * ```
 */
export async function startChatUI(
  client: CodingAgentClient,
  config: ChatUIConfig = {}
): Promise<ChatUIResult> {
  const {
    sessionConfig,
    theme = darkTheme,
    title = "Atomic Chat",
    placeholder = "Type a message...",
    version,
    model,
    tier,
    workingDir,
    suggestion,
  } = config;

  // Initialize state
  const state: ChatUIState = {
    renderer: null,
    root: null,
    session: null,
    startTime: Date.now(),
    messageCount: 0,
    cleanupHandlers: [],
    toolStartHandler: null,
    toolCompleteHandler: null,
    toolIdCounter: 0,
  };

  // Create a promise that resolves when the UI exits
  let resolveExit: (result: ChatUIResult) => void;
  const exitPromise = new Promise<ChatUIResult>((resolve) => {
    resolveExit = resolve;
  });

  /**
   * Clean up resources and exit.
   */
  async function cleanup(): Promise<void> {
    // Remove signal handlers
    for (const handler of state.cleanupHandlers) {
      handler();
    }
    state.cleanupHandlers = [];

    // Destroy session if active
    if (state.session) {
      try {
        await state.session.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      state.session = null;
    }

    // Unmount React tree before destroying renderer
    // IMPORTANT: Must unmount before destroy to avoid Yoga crash
    if (state.root) {
      try {
        state.root.unmount();
      } catch {
        // Ignore errors during cleanup
      }
      state.root = null;
    }

    // Destroy the CLI renderer
    if (state.renderer) {
      try {
        state.renderer.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      state.renderer = null;
    }

    // Resolve the exit promise
    const result: ChatUIResult = {
      session: null, // Session already destroyed
      messageCount: state.messageCount,
      duration: Date.now() - state.startTime,
    };

    resolveExit(result);
  }

  /**
   * Handle sending a message to the agent.
   * Note: The actual message sending is handled by handleStreamMessage.
   * This callback is for session initialization and message tracking.
   */
  async function handleSendMessage(_content: string): Promise<void> {
    // Create session if needed (content is used by handleStreamMessage)
    if (!state.session) {
      try {
        state.session = await client.createSession(sessionConfig);
      } catch (error) {
        console.error("Failed to create session:", error);
        return;
      }
    }

    state.messageCount++;
  }

  /**
   * Subscribe to tool.complete events from the client.
   * Tool start comes from stream messages, tool complete comes from events.
   */
  function subscribeToToolCompleteEvents(): () => void {
    // Subscribe to tool.complete events (Claude SDK uses hooks for this)
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolResult?: unknown; success?: boolean; error?: string };
      if (state.toolCompleteHandler) {
        // Use the current tool ID (should match the last tool_use)
        const toolId = `tool_${state.toolIdCounter}`;
        state.toolCompleteHandler(
          toolId,
          data.toolResult,
          data.success ?? true,
          data.error
        );
      }
    });

    return unsubComplete;
  }

  /**
   * Handle streaming a message response from the agent.
   * Handles text, tool_use, and tool_result messages from the stream.
   */
  async function handleStreamMessage(
    content: string,
    onChunk: (chunk: string) => void,
    onComplete: () => void
  ): Promise<void> {
    // Create session if needed and subscribe to tool events
    if (!state.session) {
      try {
        state.session = await client.createSession(sessionConfig);
        // Subscribe to tool complete events (Claude uses hooks for this)
        const unsubscribe = subscribeToToolCompleteEvents();
        state.cleanupHandlers.push(unsubscribe);
      } catch (error) {
        console.error("Failed to create session:", error);
        onComplete();
        return;
      }
    }

    try {
      // Stream the response
      const stream = state.session.stream(content);

      for await (const message of stream) {
        // Handle text content
        if (message.type === "text" && typeof message.content === "string") {
          onChunk(message.content);
        }
        // Handle tool_use content - notify UI of tool invocation
        else if (message.type === "tool_use" && message.content) {
          const toolContent = message.content as { name?: string; input?: Record<string, unknown> };
          if (state.toolStartHandler && toolContent.name) {
            const toolId = `tool_${++state.toolIdCounter}`;
            state.toolStartHandler(
              toolId,
              toolContent.name,
              toolContent.input ?? {}
            );
          }
        }
        // Handle tool_result content - notify UI of tool completion
        else if (message.type === "tool_result") {
          if (state.toolCompleteHandler) {
            const toolId = `tool_${state.toolIdCounter}`;
            state.toolCompleteHandler(
              toolId,
              message.content,
              true
            );
          }
        }
      }

      state.messageCount++;
      onComplete();
    } catch (error) {
      onComplete();
    }
  }

  /**
   * Handle exit request from the chat UI.
   */
  async function handleExit(): Promise<void> {
    await cleanup();
  }

  // Set up signal handlers for cleanup
  const sigintHandler = () => {
    void cleanup();
  };

  const sigtermHandler = () => {
    void cleanup();
  };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  // Store cleanup handlers for later removal
  state.cleanupHandlers.push(() => {
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigtermHandler);
  });

  try {
    // Initialize commands registry before rendering
    // This ensures all slash commands are available when ChatApp mounts
    // Uses async version to support loading workflows from disk
    await initializeCommandsAsync();

    // Create the CLI renderer with:
    // - mouse mode disabled to allow native terminal text selection/copy
    // - useAlternateScreen: false so CLI output persists after exit (inline mode)
    state.renderer = await createCliRenderer({
      useMouse: false,
      useAlternateScreen: false,
    });

    // Create React root
    state.root = createRoot(state.renderer);

    // Render the chat application
    // Handler registration callbacks - ChatApp will call these with its internal handlers
    const registerToolStartHandler = (handler: OnToolStart) => {
      state.toolStartHandler = handler;
    };

    const registerToolCompleteHandler = (handler: OnToolComplete) => {
      state.toolCompleteHandler = handler;
    };

    state.root.render(
      React.createElement(
        ThemeProvider,
        {
          initialTheme: theme,
          children: React.createElement(ChatApp, {
            title,
            placeholder,
            version,
            model,
            tier,
            workingDir,
            suggestion,
            onSendMessage: handleSendMessage,
            onStreamMessage: handleStreamMessage,
            onExit: handleExit,
            registerToolStartHandler,
            registerToolCompleteHandler,
          }),
        }
      )
    );
  } catch (error) {
    // Cleanup on initialization error
    await cleanup();
    throw error;
  }

  return exitPromise;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a chat UI with a mock client for testing/demo purposes.
 * The mock client echoes back messages after a short delay.
 *
 * @param config - Optional configuration for the chat UI
 * @returns Promise that resolves when the chat UI exits
 */
export async function startMockChatUI(
  config: Omit<ChatUIConfig, "sessionConfig"> = {}
): Promise<ChatUIResult> {
  // Create a mock client that echoes messages
  const mockClient: CodingAgentClient = {
    agentType: "claude",

    async createSession(): Promise<Session> {
      const sessionId = `mock_${Date.now()}`;

      return {
        id: sessionId,

        async send(message: string): Promise<AgentMessage> {
          // Simulate a small delay
          await new Promise((resolve) => setTimeout(resolve, 100));

          return {
            type: "text",
            content: `Echo: ${message}`,
            role: "assistant",
          };
        },

        async *stream(message: string): AsyncIterable<AgentMessage> {
          // Simulate streaming by yielding chunks
          const response = `I received your message: "${message}". This is a mock response for testing purposes.`;
          const words = response.split(" ");

          for (const word of words) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            yield {
              type: "text",
              content: word + " ",
              role: "assistant",
            };
          }
        },

        async summarize(): Promise<void> {
          // No-op for mock
        },

        async getContextUsage() {
          return {
            inputTokens: 0,
            outputTokens: 0,
            maxTokens: 100000,
            usagePercentage: 0,
          };
        },

        async destroy(): Promise<void> {
          // No-op for mock
        },
      };
    },

    async resumeSession(): Promise<Session | null> {
      return null;
    },

    on() {
      return () => {};
    },

    registerTool() {
      // No-op for mock
    },

    async start(): Promise<void> {
      // No-op for mock
    },

    async stop(): Promise<void> {
      // No-op for mock
    },

    async getModelDisplayInfo() {
      return { model: "Mock Model", tier: "Mock Tier" };
    },
  };

  return startChatUI(mockClient, config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  ChatApp,
  LoadingIndicator,
  MAX_VISIBLE_MESSAGES,
  type ChatAppProps,
  type ChatMessage,
  type MessageToolCall,
  type WorkflowChatState,
  type OnToolStart,
  type OnToolComplete,
  defaultWorkflowChatState,
} from "./chat.tsx";
export {
  ThemeProvider,
  useTheme,
  useThemeColors,
  darkTheme,
  lightTheme,
  type Theme,
  type ThemeColors,
} from "./theme.tsx";
export {
  default as CodeBlock,
  type CodeBlockProps,
  type ParsedCodeBlock,
  normalizeLanguage,
  extractCodeBlocks,
  hasCodeBlocks,
  extractInlineCode,
} from "./code-block.tsx";

// Hooks module
export {
  useStreamingState,
  type StreamingState,
  type ToolExecutionState,
  type ToolExecutionStatus,
  type ToolExecutionTimestamps,
  type UseStreamingStateReturn,
  createInitialStreamingState,
  generateToolExecutionId,
  getCurrentTimestamp,
  createToolExecution,
  getActiveToolExecutions,
  getCompletedToolExecutions,
  getErroredToolExecutions,
} from "./hooks/index.ts";

// Tools module
export {
  type ToolRenderProps,
  type ToolRenderResult,
  type ToolRenderer,
  readToolRenderer,
  editToolRenderer,
  bashToolRenderer,
  writeToolRenderer,
  globToolRenderer,
  grepToolRenderer,
  defaultToolRenderer,
  TOOL_RENDERERS,
  getToolRenderer,
  getRegisteredToolNames,
  hasCustomRenderer,
  getLanguageFromExtension,
} from "./tools/index.ts";

// Commands module
export {
  // Registry
  CommandRegistry,
  globalRegistry,
  type CommandDefinition,
  type CommandContext,
  type CommandContextState,
  type CommandResult,
  type FeatureProgressState,

  // Built-in commands
  registerBuiltinCommands,

  // Workflow commands
  registerWorkflowCommands,
  type WorkflowMetadata,
  WORKFLOW_DEFINITIONS,
  getWorkflowMetadata,
  createWorkflowByName,

  // Skill commands
  registerSkillCommands,
  type SkillMetadata,
  SKILL_DEFINITIONS,
  getSkillMetadata,
  isRalphSkill,
  getRalphSkills,
  getCoreSkills,

  // Initialization and helpers
  initializeCommands,
  initializeCommandsAsync,
  parseSlashCommand,
  isSlashCommand,
  getCommandPrefix,
} from "./commands/index.ts";

// Components
export {
  Autocomplete,
  navigateUp,
  navigateDown,
  useAutocompleteKeyboard,
  type AutocompleteProps,
  type KeyboardHandlerResult,
  type UseAutocompleteKeyboardOptions,
} from "./components/autocomplete.tsx";

export {
  UserQuestionDialog,
  toggleSelection,
  type UserQuestionDialogProps,
  type UserQuestion,
  type QuestionOption,
  type QuestionAnswer,
} from "./components/user-question-dialog.tsx";

export {
  WorkflowStatusBar,
  getWorkflowIcon,
  formatWorkflowType,
  formatIteration,
  formatFeatureProgress,
  type WorkflowStatusBarProps,
  type FeatureProgress,
} from "./components/workflow-status-bar.tsx";

export {
  ToolResult,
  shouldCollapse,
  getErrorColor,
  type ToolResultProps,
} from "./components/tool-result.tsx";
