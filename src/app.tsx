/**
 * CLI Integration for Chat UI
 *
 * Entry point for starting the terminal chat interface.
 * Connects ChatApp component to a coding agent client.
 *
 * Reference: Feature 20 - Implement CLI integration for chat UI
 */

import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import {
  ChatApp,
} from "@/screens/chat-screen.tsx";
import { ThemeProvider, darkTheme, type Theme } from "@/theme/index.tsx";
import { AppErrorBoundary } from "@/components/error-exit-screen.tsx";
import { addDefaultParsers, type FiletypeParserOptions } from "@opentui/core";
import parsersConfig from "../parsers-config.json";
import { initializeCommandsAsync } from "@/commands/tui/index.ts";
import { EventBusProvider } from "@/services/events/event-bus-provider.tsx";
import { AnimationTickProvider } from "@/hooks/use-animation-tick.tsx";
import type {
  CodingAgentClient,
  SessionConfig,
  Session,
} from "@/services/agents/types.ts";
import type { ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import { createChatUIController, createChatUIRuntimeState } from "@/state/runtime/chat-ui-controller.ts";
import { createChatUIModelOperations } from "@/state/runtime/chat-ui-model-operations.ts";
import { createMockChatClient } from "@/state/runtime/chat-ui-mock-client.ts";
import {
  FrameRecorder,
  resolveFrameCaptureInterval,
  getActiveSessionLogDir,
} from "@/services/events/debug-subscriber/index.ts";

/**
 * Configuration for starting the chat UI.
 */
export interface ChatUIConfig {
  /** Session configuration for the agent */
  sessionConfig?: SessionConfig;
  /** Startup discovery plan for provider-aware command registration */
  providerDiscoveryPlan?: ProviderDiscoveryPlan;
  /** Initial theme (defaults to dark) */
  theme?: Theme;
  /** Application version for header */
  version?: string;
  /** Model name for header */
  model?: string;
  /** Model tier/plan for header */
  tier?: string;
  /** Working directory for header */
  workingDir?: string;
  /** Agent type for model operations */
  agentType?: import("@/services/models/index.ts").AgentType;
  /** Initial prompt to auto-submit on session start */
  initialPrompt?: string;
  /** Promise that resolves when client.start() completes (deferred start) */
  clientStartPromise?: Promise<void>;
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
 * import { ClaudeAgentClient } from "./sdk/clients/claude";
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
    providerDiscoveryPlan,
    theme = darkTheme,
    version,
    model,
    tier,
    workingDir,
    agentType,
    initialPrompt,
    clientStartPromise,
  } = config;
  const resolvedAgentType = agentType ?? client.agentType;
  const modelOps = createChatUIModelOperations(
    client,
    resolvedAgentType,
    sessionConfig,
  );
  const { state, debugSub } = await createChatUIRuntimeState({
    resolvedAgentType,
    initialPrompt,
  });

  // Create a promise that resolves when the UI exits
  let resolveExit: (result: ChatUIResult) => void;
  const exitPromise = new Promise<ChatUIResult>((resolve) => {
    resolveExit = resolve;
  });
  const controller = createChatUIController({
    client,
    resolvedAgentType,
    sessionConfig,
    clientStartPromise,
    modelOps,
    state,
    debugSub,
    onExitResolved: ({ messageCount, duration }) => {
      resolveExit({
        session: null,
        messageCount,
        duration,
      });
    },
  });
  controller.registerSignalHandlers();

  try {
    // Initialize commands registry and wait for client startup concurrently.
    // Both are independent: command discovery scans the filesystem while
    // the SDK client connects to its backend.
    await Promise.all([
      initializeCommandsAsync({ providerDiscoveryPlan }),
      clientStartPromise ?? Promise.resolve(),
    ]);

    // Register Tree-sitter parsers before any renderer or <markdown> component
    // triggers syntax highlighting. The client downloads and caches WASM/SCM
    // assets from the URLs in parsers-config.json on first use.
    addDefaultParsers(parsersConfig.parsers as FiletypeParserOptions[]);

    // Create the CLI renderer with:
    // - mouse tracking ENABLED for scroll-wheel support in scrollboxes and
    //   OpenTUI Selection API (mouse-drag to select, auto-copy on release).
    //   For native terminal text selection, hold Shift (Linux/Windows) or
    //   Option (macOS/iTerm2) while clicking — this is a built-in terminal
    //   emulator bypass that works with virtually all modern terminals.
    // - screenMode: "alternate-screen" to prevent scrollbox from corrupting terminal output
    // - exitOnCtrlC: false to allow double-press Ctrl+C behavior
    // - useKittyKeyboard: with disambiguate so Ctrl+C is received as keyboard event
    state.renderer = await createCliRenderer({
      useMouse: true,
      enableMouseMovement: false,
      openConsoleOnError: false,
      screenMode: "alternate-screen",
      exitOnCtrlC: false,
      useKittyKeyboard: { disambiguate: true },
    });

    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[>4;2m");
    }

    // Attach frame recorder when debug logging is active.
    // Frames are only captured while a stream is active to avoid
    // unbounded disk growth when a session sits idle.
    const sessionLogDir = getActiveSessionLogDir();
    if (sessionLogDir) {
      const captureInterval = resolveFrameCaptureInterval();
      if (captureInterval > 0) {
        const frameRecorder = new FrameRecorder({
          sessionLogDir,
          captureInterval,
        });
        await frameRecorder.attach(state.renderer);

        const unsubFrameGate = state.bus.onAll((event) => {
          if (event.type === "stream.session.start") {
            frameRecorder.resume();
          } else if (
            event.type === "stream.session.idle" ||
            event.type === "stream.session.error"
          ) {
            frameRecorder.pause();
          }
        });

        state.cleanupHandlers.push(() => {
          unsubFrameGate();
          frameRecorder.dispose();
        });
      }
    }

    // Create React root
    state.root = createRoot(state.renderer);

    state.root.render(
      React.createElement(
        ThemeProvider,
        {
          initialTheme: theme,
          children: React.createElement(
            AnimationTickProvider,
            null,
            React.createElement(
              EventBusProvider,
              {
                bus: state.bus,
                dispatcher: state.dispatcher,
                children: React.createElement(
                  AppErrorBoundary,
                  {
                    onExit: () => { void controller.cleanup(); },
                    isDark: theme.isDark,
                    children: React.createElement(ChatApp, {
                      version,
                      model,
                      tier,
                      workingDir,
                      agentType: resolvedAgentType,
                      modelOps,
                      initialModelId: sessionConfig?.model,
                      initialReasoningEffort: sessionConfig?.reasoningEffort,
                      getModelDisplayInfo: (hint?: string) => client.getModelDisplayInfo(hint),
                      onSendMessage: controller.handleSendMessage,
                      onStreamMessage: controller.handleStreamMessage,
                      onExit: controller.handleExit,
                      onResetSession: controller.resetSession,
                      onInterrupt: controller.handleInterruptFromUI,
                      onTerminateBackgroundAgents: controller.handleTerminateBackgroundAgentsFromUI,
                      setStreamingState: controller.setStreamingState,
                      getSession: controller.getSession,
                      ensureSession: controller.ensureSession,
                      createSubagentSession: controller.createSubagentSession,
                      registerTool: controller.registerTool,
                      streamWithSession: controller.streamWithSession,
                      initialPrompt,
                      onModelChange: controller.handleModelChange,
                      onSessionMcpServersChange: controller.handleSessionMcpServersChange,
                      onCommandExecutionTelemetry: controller.handleCommandTelemetry,
                      onMessageSubmitTelemetry: controller.handleMessageTelemetry,
                    }),
                  },
                ),
              },
            ),
          ),
        },
      ),
    );
  } catch (error) {
    await controller.cleanup();
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
  const mockClient = createMockChatClient();

  return startChatUI(mockClient, config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  ChatApp,
} from "@/screens/chat-screen.tsx";
export {
  CompletionSummary,
  LoadingIndicator,
  StreamingBullet,
  type ChatAppProps,
  type ChatMessage,
  type WorkflowChatState,
  type OnInterrupt,
  type OnTerminateBackgroundAgents,
  type OnAskUserQuestion,
  defaultWorkflowChatState,
} from "@/state/chat/exports.ts";
export {
  ThemeProvider,
  useTheme,
  useThemeColors,
  darkTheme,
  lightTheme,
  darkThemeAnsi,
  lightThemeAnsi,
  type Theme,
  type ThemeColors,
} from "@/theme/index.tsx";

// Parts module - type exports for rendering system
export { type ToolExecutionStatus } from "@/state/parts/types.ts";

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
  registerAgentToolNames,
} from "@/components/tool-registry/registry/index.ts";

// Commands module
export {
  // Registry
  CommandRegistry,
  globalRegistry,
  type CommandDefinition,
  type CommandContext,
  type CommandContextState,
  type CommandResult,

  // Built-in commands
  registerBuiltinCommands,

  // Workflow commands
  registerWorkflowCommands,
  type WorkflowMetadata,
  getWorkflowMetadata,

  // Initialization and helpers
  initializeCommandsAsync,
  parseSlashCommand,
  isSlashCommand,
  getCommandPrefix,
} from "@/commands/tui/index.ts";

// Components
export {
  Autocomplete,
  useAutocompleteKeyboard,
  type AutocompleteProps,
  type KeyboardHandlerResult,
  type UseAutocompleteKeyboardOptions,
} from "@/components/autocomplete.tsx";

export { navigateUp, navigateDown } from "@/lib/ui/navigation.ts";

export {
  UserQuestionDialog,
  toggleSelection,
  type UserQuestionDialogProps,
} from "@/components/user-question-dialog.tsx";

export type { UserQuestion, QuestionOption, QuestionAnswer } from "@/state/chat/shared/types/hitl.ts";

export {
  ToolResult,
  shouldCollapse,
  type ToolResultProps,
} from "@/components/tool-result.tsx";
