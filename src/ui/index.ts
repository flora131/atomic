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
import {
  ChatApp,
  type OnTerminateBackgroundAgents,
  type CommandExecutionTelemetry,
  type MessageSubmitTelemetry,
} from "./chat.tsx";
import { ThemeProvider, darkTheme, type Theme } from "./theme.tsx";
import { AppErrorBoundary } from "./components/error-exit-screen.tsx";
import { initializeCommandsAsync, globalRegistry } from "./commands/index.ts";
import { EventBusProvider } from "../events/event-bus-provider.tsx";
import type {
  CodingAgentClient,
  SessionConfig,
  Session,
  AgentMessage,
} from "../sdk/types.ts";
import { UnifiedModelOperations } from "../models/model-operations.ts";
import {
  createTuiTelemetrySessionTracker,
  type TuiTelemetrySessionTracker,
} from "../telemetry/index.ts";
import { EventBus } from "../events/event-bus.ts";
import { BatchDispatcher } from "../events/batch-dispatcher.ts";
import { OpenCodeStreamAdapter } from "../events/adapters/opencode-adapter.ts";
import { ClaudeStreamAdapter } from "../events/adapters/claude-adapter.ts";
import { CopilotStreamAdapter } from "../events/adapters/copilot-adapter.ts";
import type { SDKStreamAdapter } from "../events/adapters/types.ts";
import { registerAgentToolNames } from "./tools/registry.ts";
import { attachDebugSubscriber } from "../events/debug-subscriber.ts";
import { cleanupMcpBridgeScripts } from "../sdk/tools/opencode-mcp-bridge.ts";

/**
 * Build a system prompt section describing all registered capabilities.
 * Includes slash commands, skills, and sub-agents so the model is aware
 * of them and they count toward the system/tools token baseline.
 */
function buildCapabilitiesSystemPrompt(): string {
  const allCommands = globalRegistry.all();
  if (allCommands.length === 0) return "";

  const sections: string[] = [];

  const builtins = allCommands.filter((c) => c.category === "builtin");
  if (builtins.length > 0) {
    const lines = builtins.map((c) => {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      return `  /${c.name}${hint} - ${c.description}`;
    });
    sections.push(`Slash Commands:\n${lines.join("\n")}`);
  }

  const skills = allCommands.filter((c) => c.category === "skill");
  if (skills.length > 0) {
    const lines = skills.map((c) => {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      return `  /${c.name}${hint} - ${c.description}`;
    });
    sections.push(
      `Skills (invoke with /skill-name):\n${lines.join("\n")}\n\n` +
        `Note: Skills listed above are user-invocable via slash commands. ` +
        `To load a skill yourself, use the Skill tool instead of outputting a slash command.`,
    );
  }

  const agents = allCommands.filter((c) => c.category === "agent");
  if (agents.length > 0) {
    const lines = agents.map((c) => {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      return `  /${c.name}${hint} - ${c.description}`;
    });
    sections.push(`Sub-Agents (invoke with /agent-name):\n${lines.join("\n")}`);
  }

  const workflows = allCommands.filter((c) => c.category === "workflow");
  if (workflows.length > 0) {
    const lines = workflows.map((c) => `  /${c.name} - ${c.description}`);
    sections.push(`Workflows:\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

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
  /** Agent type for model operations */
  agentType?: import("../models").AgentType;
  /** Initial prompt to auto-submit on session start */
  initialPrompt?: string;
  /** Whether workflow mode was requested for this chat session */
  workflowEnabled?: boolean;
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
  /** Interrupt counter for double-press exit (shared between signal and UI) */
  interruptCount: number;
  /** Interrupt timeout ID */
  interruptTimeout: ReturnType<typeof setTimeout> | null;
  /** AbortController for the current stream (to interrupt on Escape/Ctrl+C) */
  streamAbortController: AbortController | null;
  /** Whether streaming is currently active */
  isStreaming: boolean;
  /** Session IDs owned by this TUI instance (main + spawned subagent sessions) */
  ownedSessionIds: Set<string>;
  /** Promise lock to prevent concurrent session creation */
  sessionCreationPromise: Promise<void> | null;
  /** Monotonic run counter used to assign ownership to each active stream */
  runCounter: number;
  /** Active stream run owner ID. Null means no run currently owns hook events. */
  currentRunId: number | null;
  /** Native TUI telemetry tracker (null when telemetry is disabled or agent type is unknown) */
  telemetryTracker: TuiTelemetrySessionTracker | null;
  /** Singleton event bus shared across all streams */
  bus: EventBus;
  /** Singleton batch dispatcher for frame-aligned event batching */
  dispatcher: BatchDispatcher;
  /** Whether background agents were terminated via Ctrl+F (pending notification to model) */
  backgroundAgentsTerminated: boolean;
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
    theme = darkTheme,
    title = "Atomic Chat",
    placeholder = "Type a message...",
    version,
    model,
    tier,
    workingDir,
    suggestion,
    agentType,
    initialPrompt,
    workflowEnabled = false,
  } = config;

  // Create model operations for the agent
  const sdkListModels = agentType === 'claude' && 'listSupportedModels' in client
    ? () => (client as import('../sdk/clients/index.ts').ClaudeAgentClient).listSupportedModels()
    : undefined;
  const sdkSetModel = agentType === "opencode" && "setActivePromptModel" in client
    ? async (selectedModel: string) => {
        await (client as import("../sdk/clients/index.ts").OpenCodeClient).setActivePromptModel(selectedModel);
      }
    : agentType && "setActiveSessionModel" in client
      ? async (selectedModel: string, options?: { reasoningEffort?: string }) => {
          await client.setActiveSessionModel?.(selectedModel, options);
        }
      : undefined;
  const modelOps = agentType ? new UnifiedModelOperations(agentType, sdkSetModel, sdkListModels, sessionConfig?.model) : undefined;

  // Initialize singleton event bus and batch dispatcher
  const sharedBus = new EventBus();
  const sharedDispatcher = new BatchDispatcher(sharedBus);

  // Attach file-based debug subscriber when ATOMIC_DEBUG=1
  const debugSub = await attachDebugSubscriber(sharedBus);

  // Initialize state
  const state: ChatUIState = {
    renderer: null,
    root: null,
    session: null,
    startTime: Date.now(),
    messageCount: 0,
    cleanupHandlers: [],
    interruptCount: 0,
    interruptTimeout: null,
    streamAbortController: null,
    isStreaming: false,
    ownedSessionIds: new Set(),
    sessionCreationPromise: null,
    runCounter: 0,
    currentRunId: null,
    telemetryTracker: agentType
      ? createTuiTelemetrySessionTracker({
        agentType,
        workflowEnabled,
        hasInitialPrompt: !!initialPrompt,
      })
      : null,
    bus: sharedBus,
    dispatcher: sharedDispatcher,
    backgroundAgentsTerminated: false,
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
    state.currentRunId = null;
    state.isStreaming = false;

    // Dispose event bus infrastructure
    await debugSub.unsubscribe();
    state.dispatcher.dispose();
    state.bus.clear();

    // Remove generated MCP bridge scripts
    cleanupMcpBridgeScripts();

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
        if (process.stdout.isTTY) {
          try {
            process.stdout.write("\x1b[>4;0m");
          } catch {
            // Ignore errors during cleanup
          }
        }
        state.renderer.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      state.renderer = null;
    }

    // Resolve the exit promise
    const duration = Date.now() - state.startTime;
    state.telemetryTracker?.end({
      durationMs: duration,
      messageCount: state.messageCount,
    });

    const result: ChatUIResult = {
      session: null, // Session already destroyed
      messageCount: state.messageCount,
      duration,
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
    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      return;
    }

    state.messageCount++;
  }


  /**
   * Ensure a session exists, creating one if needed.
   * Uses a promise lock to prevent concurrent session creation
   * when both handleSendMessage and handleStreamMessage fire together.
   */
  async function ensureSession(): Promise<void> {
    if (state.session) return;
    if (state.sessionCreationPromise) {
      await state.sessionCreationPromise;
      return;
    }
    state.sessionCreationPromise = (async () => {
      try {
        // Clear stale tool tracking from any previous session
        state.currentRunId = null;

        // Apply the actively selected model for ALL agent types
        if (modelOps && sessionConfig) {
          const pendingModel = modelOps.getPendingModel();
          const currentModel = await modelOps.getCurrentModel();
          if (pendingModel) {
            sessionConfig.model = pendingModel;
          } else if (currentModel) {
            sessionConfig.model = currentModel;
          }
          // Apply pending reasoning effort (Copilot-specific)
          if (agentType === 'copilot') {
            const pendingEffort = modelOps.getPendingReasoningEffort();
            if (pendingEffort !== undefined) {
              sessionConfig.reasoningEffort = pendingEffort;
            }
          }
        }
        state.session = await client.createSession(sessionConfig);
        state.ownedSessionIds.add(state.session.id);
      } finally {
        state.sessionCreationPromise = null;
      }
    })();
    await state.sessionCreationPromise;
  }

  /**
   * Handle streaming a message response from the agent.
   * Delegates to the appropriate SDK adapter which publishes events to the bus.
   * UI consumption happens via useStreamConsumer hook subscribed to bus events.
   */
  async function handleStreamMessage(
    content: string,
    options?: { agent?: string }
  ): Promise<void> {
    // Single-owner stream model: any new stream handoff resets previous
    // run-owned hook state before creating the next owner.
    state.currentRunId = null;

    // Create session if needed (uses shared lock to prevent dual creation)
    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      return;
    }

    // If background agents were terminated via Ctrl+F, prepend a system
    // notification so the model knows not to reference killed agents.
    let effectiveContent = content;
    if (state.backgroundAgentsTerminated) {
      state.backgroundAgentsTerminated = false;
      effectiveContent =
        "[System: All background agents were terminated by the user (Ctrl+F). " +
        "Do not reference or wait for any previously running background agents.]\n\n" +
        content;
    }

    // Create AbortController for this stream so it can be interrupted
    state.streamAbortController = new AbortController();
    state.currentRunId = ++state.runCounter;
    state.isStreaming = true;

    // Create the appropriate SDK adapter based on agent type
    let adapter: SDKStreamAdapter;

    if (agentType === "opencode") {
      adapter = new OpenCodeStreamAdapter(state.bus, state.session!.id, client);
    } else if (agentType === "claude") {
      adapter = new ClaudeStreamAdapter(state.bus, state.session!.id, client);
    } else {
      adapter = new CopilotStreamAdapter(state.bus, client);
    }

    const runId = state.currentRunId;
    const messageId = crypto.randomUUID();

    // Discover agent names for Copilot adapter + tool registry
    const knownAgentNames = client.getKnownAgentNames?.() ?? [];
    if (knownAgentNames.length > 0) {
      registerAgentToolNames(knownAgentNames);
    }

    try {
      await adapter.startStreaming(state.session!, effectiveContent, {
        runId,
        messageId,
        agent: options?.agent,
        knownAgentNames,
      });

      state.messageCount++;
    } catch (error) {
      // AbortError is expected when user interrupts — finalize cleanly
      if (error instanceof Error && error.name === "AbortError") {
        state.currentRunId = null;
        return;
      }
      state.currentRunId = null;
    } finally {
      adapter.dispose();
      // Clear streaming state
      state.streamAbortController = null;
      state.isStreaming = false;
      state.currentRunId = null;
    }
  }

  /**
   * Handle exit request from the chat UI.
   */
  async function handleExit(): Promise<void> {
    await cleanup();
  }

  /**
   * Handle interrupt request (from signal or UI).
   * If streaming, abort the stream. If idle, use double-press to exit.
   */
  function handleInterrupt(sourceType: "ui" | "signal"): void {
    // If streaming, abort the current operation
    if (state.isStreaming) {
      // Skip duplicate signal interrupts for an already-aborted foreground stream.
      if (state.streamAbortController?.signal.aborted) return;
      // Clear streaming state immediately so tool events from SDK
      // don't flow through and overwrite React state after interrupt
      state.isStreaming = false;
      state.currentRunId = null;

      state.streamAbortController?.abort();
      if (state.session?.abort) {
        void state.session.abort().catch(() => {});
      }
      state.telemetryTracker?.trackInterrupt(sourceType);
      // Reset interrupt state
      state.interruptCount = 0;
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
        state.interruptTimeout = null;
      }
      return;
    }

    // Not streaming: use double-press logic to exit
    state.interruptCount++;
    if (state.interruptCount >= 2) {
      // Double press - exit
      state.interruptCount = 0;
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
        state.interruptTimeout = null;
      }
      void cleanup();
      return;
    }

    // First press - arm timeout for double-press exit
    if (state.interruptTimeout) {
      clearTimeout(state.interruptTimeout);
    }
    state.interruptTimeout = setTimeout(() => {
      state.interruptCount = 0;
      state.interruptTimeout = null;
    }, 1000);
  }

  // Set up signal handlers for cleanup
  // Ctrl+C (SIGINT) uses the unified interrupt handler
  const sigintHandler = () => {
    handleInterrupt("signal");
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
    if (state.interruptTimeout) {
      clearTimeout(state.interruptTimeout);
    }
    // Abort any ongoing stream
    if (state.streamAbortController) {
      state.streamAbortController.abort();
    }
  });

  try {
    // Initialize commands registry before rendering
    // This ensures all slash commands are available when ChatApp mounts
    // Uses async version to support loading workflows from disk
    await initializeCommandsAsync();

    // Enhance session config with capabilities system prompt so the model
    // knows about all available slash commands, skills, and sub-agents.
    // This also ensures they count toward the system/tools token baseline.
    const capabilitiesPrompt = buildCapabilitiesSystemPrompt();
    if (capabilitiesPrompt) {
      const existing = sessionConfig?.systemPrompt ?? "";
      if (sessionConfig) {
        sessionConfig.systemPrompt = existing
          ? `${existing}\n\n${capabilitiesPrompt}`
          : capabilitiesPrompt;
      }
    }

    // Create the CLI renderer with:
    // - mouse mode enabled for scroll wheel support (text selection via OpenTUI Selection API + Ctrl+Shift+C)
    // - useAlternateScreen: true to prevent scrollbox from corrupting terminal output
    // - exitOnCtrlC: false to allow double-press Ctrl+C behavior
    // - useKittyKeyboard: with disambiguate so Ctrl+C is received as keyboard event
    state.renderer = await createCliRenderer({
      useMouse: true,
      enableMouseMovement: false,
      openConsoleOnError: false,
      useAlternateScreen: true,
      exitOnCtrlC: false,
      useKittyKeyboard: { disambiguate: true },
    });

    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[>4;2m");
    }

    // Create React root
    state.root = createRoot(state.renderer);

    // Render the chat application.

    /**
     * Set the streaming state from the UI layer.
     * Used by spawnSubagentParallel to flag that sub-agent sessions are
     * streaming even though the main session is idle.
     */
    const setStreamingState = (isStreaming: boolean) => {
      if (isStreaming) {
        state.isStreaming = true;
        // Bridge-driven sub-agent execution does not go through handleStreamMessage,
        // so we must establish a run owner here to allow hook events.
        if (state.currentRunId === null) {
          state.currentRunId = ++state.runCounter;
        }
        return;
      }

      state.isStreaming = false;
      state.currentRunId = null;
    };

    /**
     * Handle interrupt request from the UI (Escape/Ctrl+C during streaming).
     * This is called by ChatApp when user presses interrupt keys.
     */
    const handleInterruptFromUI = () => {
      handleInterrupt("ui");
    };

    const handleTerminateBackgroundAgentsFromUI: OnTerminateBackgroundAgents = async () => {
      // Prefer the selective abortBackgroundAgents method which targets only
      // background agents. Falls back to full abort for clients that don't
      // implement the selective method yet.
      if (state.session?.abortBackgroundAgents) {
        try {
          await state.session.abortBackgroundAgents();
          // Mark that background agents were terminated so the next user
          // message includes a system notification in the model context.
          state.backgroundAgentsTerminated = true;
          state.telemetryTracker?.trackBackgroundTermination("execute", 1, 1);
        } catch (error) {
          console.error("Failed to abort background agents:", error);
          throw error;
        }
        return;
      }

      // Fallback: abort the entire session (safe because Ctrl+F only fires
      // when NOT streaming, so no foreground work will be affected).
      if (state.session?.abort) {
        try {
          await state.session.abort();
          state.backgroundAgentsTerminated = true;
          state.telemetryTracker?.trackBackgroundTermination("fallback", 1, 1);
        } catch (error) {
          console.error("Failed to abort session during background-agent termination:", error);
          throw error;
        }
        return;
      }

      state.telemetryTracker?.trackBackgroundTermination("noop", 0);
    };

    /**
     * Get the current session for slash commands like /compact.
     */
    const getSession = () => state.session;

    /**
     * Reset the current session (destroy and nullify).
     * A new session will be created automatically on the next message.
     */
    const resetSession = async () => {
      state.currentRunId = null;
      state.isStreaming = false;
      if (state.session) {
        try {
          await state.session.destroy();
        } catch {
          // Session may already be destroyed
        }
        state.session = null;
      }
      state.ownedSessionIds.clear();
    };

    /**
     * Factory for creating independent sub-agent sessions.
     * Delegates to client.createSession() to give each sub-agent its own context.
     */
    const createSubagentSession = async (config?: SessionConfig) => {
      const session = await client.createSession(config);
      state.ownedSessionIds.add(session.id);
      return session;
    };

    /**
     * Handle model change from ChatApp (via /model command or model selector).
     * Updates sessionConfig so that new sessions (e.g., after /clear) use the correct model.
     */
    const handleModelChange = (newModel: string) => {
      if (sessionConfig) {
        sessionConfig.model = newModel;
      }
    };

    /**
     * Update MCP servers for future session creation.
     * Toggle changes from /mcp apply on the next session reset/reconnect.
     */
    const handleSessionMcpServersChange = (servers: SessionConfig["mcpServers"]) => {
      if (sessionConfig) {
        sessionConfig.mcpServers = servers;
      }
    };

    const handleCommandTelemetry = (event: CommandExecutionTelemetry) => {
      state.telemetryTracker?.trackCommandExecution(event);
    };

    const handleMessageTelemetry = (event: MessageSubmitTelemetry) => {
      state.telemetryTracker?.trackMessageSubmit(event);
    };

    state.root.render(
      React.createElement(
        ThemeProvider,
        {
          initialTheme: theme,
          children: React.createElement(
            EventBusProvider,
            {
              bus: state.bus,
              dispatcher: state.dispatcher,
              children: React.createElement(
                AppErrorBoundary,
                {
                  onExit: () => { void cleanup(); },
                  isDark: theme.isDark,
                  children: React.createElement(ChatApp, {
                    title,
                    placeholder,
                    version,
                    model,
                    tier,
                    workingDir,
                    suggestion,
                    agentType,
                    modelOps,
                    initialModelId: sessionConfig?.model,
                    getModelDisplayInfo: (hint?: string) => client.getModelDisplayInfo(hint),
                    onSendMessage: handleSendMessage,
                    onStreamMessage: handleStreamMessage,
                    onExit: handleExit,
                    onResetSession: resetSession,
                    onInterrupt: handleInterruptFromUI,
                    onTerminateBackgroundAgents: handleTerminateBackgroundAgentsFromUI,
                    setStreamingState,
                    getSession,
                    createSubagentSession,
                    initialPrompt,
                    onModelChange: handleModelChange,
                    onSessionMcpServersChange: handleSessionMcpServersChange,
                    onCommandExecutionTelemetry: handleCommandTelemetry,
                    onMessageSubmitTelemetry: handleMessageTelemetry,
                  }),
                }
              ),
            }
          ),
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

        getSystemToolsTokens(): number {
          return 0;
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

    getSystemToolsTokens() {
      return null;
    },
  };

  return startChatUI(mockClient, config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  ChatApp,
  CompletionSummary,
  LoadingIndicator,
  StreamingBullet,
  type ChatAppProps,
  type ChatMessage,
  type MessageToolCall,
  type WorkflowChatState,
  type OnInterrupt,
  type OnTerminateBackgroundAgents,
  type OnAskUserQuestion,
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

// Parts module - type exports for rendering system
export { type ToolExecutionStatus } from "./parts/types.ts";

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
  getWorkflowMetadata,

  // Initialization and helpers
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
  ToolResult,
  shouldCollapse,
  type ToolResultProps,
} from "./components/tool-result.tsx";
