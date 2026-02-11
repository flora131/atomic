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
import { ChatApp, type OnToolStart, type OnToolComplete, type OnSkillInvoked, type OnPermissionRequest as ChatOnPermissionRequest, type OnInterrupt, type OnAskUserQuestion } from "./chat.tsx";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import { ThemeProvider, darkTheme, type Theme } from "./theme.tsx";
import { AppErrorBoundary } from "./components/error-exit-screen.tsx";
import { initializeCommandsAsync, globalRegistry } from "./commands/index.ts";
import type {
  CodingAgentClient,
  SessionConfig,
  Session,
  AgentMessage,
} from "../sdk/types.ts";
import { UnifiedModelOperations } from "../models/model-operations.ts";

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
    sections.push(`Skills (invoke with /skill-name):\n${lines.join("\n")}`);
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
 * Handler for permission/HITL requests
 */
export type OnPermissionRequest = (
  requestId: string,
  toolName: string,
  question: string,
  options: Array<{ label: string; value: string; description?: string }>,
  respond: (answer: string | string[]) => void,
  header?: string
) => void;

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
  /** Registered handler for skill invoked events */
  skillInvokedHandler: OnSkillInvoked | null;
  /** Registered handler for permission/HITL requests */
  permissionRequestHandler: OnPermissionRequest | null;
  /** Registered handler for askUserQuestion events from workflow graphs */
  askUserQuestionHandler: OnAskUserQuestion | null;
  /** Tool ID counter for generating unique IDs */
  toolIdCounter: number;
  /** Interrupt counter for double-press exit (shared between signal and UI) */
  interruptCount: number;
  /** Interrupt timeout ID */
  interruptTimeout: ReturnType<typeof setTimeout> | null;
  /** Ctrl+C press state for double-press exit (deprecated, kept for signal handler compat) */
  ctrlCPressed: boolean;
  /** Ctrl+C timeout ID (deprecated, kept for signal handler compat) */
  ctrlCTimeout: ReturnType<typeof setTimeout> | null;
  /** Callback to show Ctrl+C warning in UI */
  showCtrlCWarning: ((show: boolean) => void) | null;
  /** Whether tool events are being received via hooks (to avoid duplicates from stream) */
  toolEventsViaHooks: boolean;
  /** Set of active tool IDs (for deduplication of duplicate events) */
  activeToolIds: Set<string>;
  /** AbortController for the current stream (to interrupt on Escape/Ctrl+C) */
  streamAbortController: AbortController | null;
  /** Whether streaming is currently active */
  isStreaming: boolean;
  /** Registered handler for parallel agent updates (from ChatApp's setParallelAgents) */
  parallelAgentHandler: ((agents: ParallelAgent[]) => void) | null;
  /** Current list of parallel agents tracked from SDK events */
  parallelAgents: ParallelAgent[];
  /** Promise lock to prevent concurrent session creation */
  sessionCreationPromise: Promise<void> | null;
}

/**
 * Wraps an AsyncIterable so that each `iterator.next()` call races against an
 * AbortSignal. This ensures that abort takes effect immediately even while the
 * iterator is blocked waiting on the network (e.g. Claude extended thinking,
 * OpenCode 30s timeout, Copilot infinite wait).
 */
async function* abortableAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  signal: AbortSignal
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      },
      { once: true }
    );
  });
  try {
    while (true) {
      const result = await Promise.race([iterator.next(), abortPromise]);
      if (result.done) break;
      yield result.value;
    }
  } finally {
    // Fire-and-forget: don't block abort propagation on iterator cleanup
    // (SDK stream teardown may involve network I/O)
    void iterator.return?.();
  }
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
    agentType,
    initialPrompt,
  } = config;

  // Create model operations for the agent
  const sdkListModels = agentType === 'claude' && 'listSupportedModels' in client
    ? () => (client as import('../sdk/claude-client.ts').ClaudeAgentClient).listSupportedModels()
    : undefined;
  const sdkSetModel = agentType === 'opencode' && 'setActivePromptModel' in client
    ? async (model: string) => {
        await (client as import('../sdk/opencode-client.ts').OpenCodeClient).setActivePromptModel(model);
      }
    : undefined;
  const modelOps = agentType ? new UnifiedModelOperations(agentType, sdkSetModel, sdkListModels) : undefined;

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
    skillInvokedHandler: null,
    permissionRequestHandler: null,
    askUserQuestionHandler: null,
    toolIdCounter: 0,
    interruptCount: 0,
    interruptTimeout: null,
    ctrlCPressed: false,
    ctrlCTimeout: null,
    showCtrlCWarning: null,
    toolEventsViaHooks: false,
    activeToolIds: new Set(),
    streamAbortController: null,
    isStreaming: false,
    parallelAgentHandler: null,
    parallelAgents: [],
    sessionCreationPromise: null,
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
    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      return;
    }

    state.messageCount++;
  }

  /**
   * Subscribe to tool events from the client.
   * Handles both tool.start and tool.complete events from all SDK types.
   * This is necessary for SDKs like OpenCode that emit tool events via SSE
   * rather than through the message stream.
   */
  function subscribeToToolEvents(): () => void {
    // Map tool names to IDs for SDKs that don't provide IDs
    const toolNameToId = new Map<string, string>();

    // Mark that we're receiving tool events via hooks
    // This prevents duplicate tool events from stream processing
    state.toolEventsViaHooks = true;

    // Track tool name → stack of tool IDs (for concurrent same-name tools)
    const toolNameToIds = new Map<string, string[]>();

    // Queue of task descriptions from Task tool calls, consumed by subagent.start
    const pendingTaskPrompts: string[] = [];

    // Tool IDs attributed to running subagents — their tool.complete events
    // should also be suppressed from the main conversation UI
    const subagentToolIds = new Set<string>();

    // Subscribe to tool.start events
    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolInput?: unknown };
      if (state.toolStartHandler && data.toolName) {
        const toolId = `tool_${++state.toolIdCounter}`;

        // Check for duplicate events (same toolId already tracked)
        if (state.activeToolIds.has(toolId)) {
          return; // Skip duplicate event
        }
        state.activeToolIds.add(toolId);

        // Track name → ID stack (allows concurrent same-name tools)
        const ids = toolNameToIds.get(data.toolName) ?? [];
        ids.push(toolId);
        toolNameToIds.set(data.toolName, ids);
        toolNameToId.set(data.toolName, toolId);

        // Capture Task tool prompts for subagent.start correlation
        if (data.toolName === "Task" && data.toolInput) {
          const input = data.toolInput as Record<string, unknown>;
          const prompt = (input.prompt as string) ?? (input.description as string) ?? "";
          if (prompt) {
            pendingTaskPrompts.push(prompt);
          }
        }

        // Propagate tool progress to running subagents in the parallel agents tree.
        // SDK events (subagent.start / subagent.complete) don't carry intermediate
        // tool-use updates, so we bridge that gap here by attributing each tool.start
        // to the most recently started running subagent.
        // When a tool is attributed to a subagent, skip the main tool UI to avoid
        // showing subagent-internal tools as top-level conversation entries.
        let attributedToSubagent = false;
        if (state.isStreaming && state.parallelAgentHandler && state.parallelAgents.length > 0) {
          const runningAgent = [...state.parallelAgents]
            .reverse()
            .find((a) => a.status === "running");
          if (runningAgent) {
            const updatedToolUses = (runningAgent.toolUses ?? 0) + 1;
            state.parallelAgents = state.parallelAgents.map((a) =>
              a.id === runningAgent.id
                ? { ...a, currentTool: data.toolName!, toolUses: updatedToolUses }
                : a
            );
            state.parallelAgentHandler(state.parallelAgents);
            attributedToSubagent = true;
          }
        }

        // Only show in main conversation if not attributed to a subagent
        if (attributedToSubagent) {
          subagentToolIds.add(toolId);
          return;
        }

        state.toolStartHandler(
          toolId,
          data.toolName,
          (data.toolInput as Record<string, unknown>) ?? {}
        );
      }
    });

    // Subscribe to tool.complete events
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolResult?: unknown; success?: boolean; error?: string; toolInput?: Record<string, unknown> };
      if (state.toolCompleteHandler) {
        // Find the matching tool ID from the stack (FIFO order)
        let toolId: string;
        if (data.toolName) {
          const ids = toolNameToIds.get(data.toolName);
          toolId = ids?.shift() ?? toolNameToId.get(data.toolName) ?? `tool_${state.toolIdCounter}`;
          if (ids && ids.length === 0) {
            toolNameToIds.delete(data.toolName);
            toolNameToId.delete(data.toolName);
          } else if (ids && ids.length > 0) {
            toolNameToId.set(data.toolName, ids[0] as string);
          }
        } else {
          toolId = `tool_${state.toolIdCounter}`;
        }

        // Skip tool.complete for tools already attributed to a subagent
        if (subagentToolIds.has(toolId)) {
          subagentToolIds.delete(toolId);
          state.activeToolIds.delete(toolId);
          return;
        }

        state.toolCompleteHandler(
          toolId,
          data.toolResult,
          data.success ?? true,
          data.error,
          data.toolInput // Pass input to update if it wasn't available at start
        );

        // Clean up tracking
        state.activeToolIds.delete(toolId);
      }
    });

    // Subscribe to skill.invoked events
    const unsubSkill = client.on("skill.invoked", (event) => {
      const data = event.data as { skillName?: string; skillPath?: string };
      if (state.skillInvokedHandler && data.skillName) {
        state.skillInvokedHandler(data.skillName, data.skillPath);
      }
    });

    // Subscribe to permission.requested events for HITL
    const unsubPermission = client.on("permission.requested", (event) => {
      const data = event.data as {
        requestId?: string;
        toolName?: string;
        question?: string;
        header?: string;
        options?: Array<{ label: string; value: string; description?: string }>;
        respond?: (answer: string | string[]) => void;
      };

      if (state.permissionRequestHandler && data.question && data.respond) {
        state.permissionRequestHandler(
          data.requestId ?? `perm_${Date.now()}`,
          data.toolName ?? "Unknown Tool",
          data.question,
          data.options ?? [],
          data.respond,
          data.header
        );
      }
    });

    // Subscribe to human_input_required events from workflow graphs (askUserNode)
    const unsubHumanInput = client.on("human_input_required", (event) => {
      const data = event.data as {
        requestId?: string;
        question?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        nodeId?: string;
        respond?: (answer: string | string[]) => void;
      };

      if (state.askUserQuestionHandler && data.question && data.requestId && data.nodeId) {
        state.askUserQuestionHandler({
          requestId: data.requestId,
          question: data.question,
          header: data.header,
          options: data.options,
          nodeId: data.nodeId,
        });
      }
    });

    // Subscribe to subagent.start events to update ParallelAgentsTree
    const unsubSubagentStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        task?: string;
      };

      // Skip if stream already ended — late events should not revive cleared agents
      if (!state.isStreaming) return;

      if (state.parallelAgentHandler && data.subagentId) {
        // Use task from event data, or dequeue a pending Task tool prompt
        const task = data.task
          || pendingTaskPrompts.shift()
          || data.subagentType
          || "Sub-agent";
        const agentTypeName = data.subagentType ?? "agent";
        const newAgent: ParallelAgent = {
          id: data.subagentId,
          name: agentTypeName,
          task,
          status: "running",
          startedAt: event.timestamp ?? new Date().toISOString(),
          // Set initial currentTool so the agent shows activity immediately
          // instead of just "Initializing..." until tool events arrive
          currentTool: `Running ${agentTypeName}…`,
        };
        state.parallelAgents = [...state.parallelAgents, newAgent];
        state.parallelAgentHandler(state.parallelAgents);
      }
    });

    // Subscribe to subagent.complete events to update ParallelAgentsTree
    const unsubSubagentComplete = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: unknown;
      };

      // Skip if stream already ended and no agents are pending
      if (!state.isStreaming) return;

      if (state.parallelAgentHandler && data.subagentId) {
        const status = data.success !== false ? "completed" : "error";
        state.parallelAgents = state.parallelAgents.map((a) =>
          a.id === data.subagentId
            ? {
                ...a,
                status,
                // Clear currentTool so getSubStatusText falls through to
                // the status-based default ("Done" / error message)
                currentTool: undefined,
                result: data.result ? String(data.result) : undefined,
                durationMs: Date.now() - new Date(a.startedAt).getTime(),
              }
            : a
        );
        state.parallelAgentHandler(state.parallelAgents);

        // If the stream text has ended (no abort controller) and all agents
        // are now done, clean up streaming state so subsequent messages can
        // start fresh.
        if (!state.streamAbortController) {
          const allDone = !state.parallelAgents.some(
            (a) => a.status === "running" || a.status === "pending"
          );
          if (allDone) {
            state.parallelAgents = [];
            state.isStreaming = false;
          }
        }
      }
    });

    return () => {
      unsubStart();
      unsubComplete();
      unsubSkill();
      unsubPermission();
      unsubHumanInput();
      unsubSubagentStart();
      unsubSubagentComplete();
    };
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
        // Subscribe to tool events BEFORE creating the session
        const unsubscribe = subscribeToToolEvents();
        state.cleanupHandlers.push(unsubscribe);

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
      } finally {
        state.sessionCreationPromise = null;
      }
    })();
    await state.sessionCreationPromise;
  }

  /**
   * Handle streaming a message response from the agent.
   * Handles text, tool_use, and tool_result messages from the stream.
   * Supports interruption via AbortController (Escape/Ctrl+C during streaming).
   */
  async function handleStreamMessage(
    content: string,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onMeta?: (meta: { outputTokens: number; thinkingMs: number; thinkingText: string }) => void
  ): Promise<void> {
    // Create session if needed (uses shared lock to prevent dual creation)
    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      onComplete();
      return;
    }

    // Create AbortController for this stream so it can be interrupted
    state.streamAbortController = new AbortController();
    state.isStreaming = true;

    try {
      // Stream the response, wrapped so abort takes effect immediately
      // even while iterator.next() is blocked on the network
      const stream = state.session!.stream(content);
      const abortableStream = abortableAsyncIterable(
        stream,
        state.streamAbortController.signal
      );

      let sdkOutputTokens = 0;
      let thinkingMs = 0;
      let thinkingStartLocal: number | null = null;
      let thinkingText = "";

      for await (const message of abortableStream) {
        // Handle text content
        if (message.type === "text" && typeof message.content === "string") {
          // Accumulate thinking duration when transitioning away from thinking
          if (thinkingStartLocal !== null) {
            thinkingMs = thinkingMs + (Date.now() - thinkingStartLocal);
            thinkingStartLocal = null;
          }

          if (message.content.length > 0) {
            onChunk(message.content);
          }

          // Use SDK-reported token counts when present
          const stats = message.metadata?.streamingStats as
            | { outputTokens?: number; thinkingMs?: number }
            | undefined;
          if (stats?.thinkingMs != null) {
            thinkingMs = stats.thinkingMs;
          }
          if (stats?.outputTokens && stats.outputTokens > 0) {
            sdkOutputTokens = stats.outputTokens;
          }

          onMeta?.({ outputTokens: sdkOutputTokens, thinkingMs, thinkingText });
        }
        // Handle thinking metadata from SDK
        else if (message.type === "thinking") {
          // Start local wall-clock timer on first thinking message
          if (thinkingStartLocal === null) {
            thinkingStartLocal = Date.now();
          }

          // Capture thinking text content
          if (typeof message.content === "string") {
            thinkingText += message.content;
          }

          const stats = message.metadata?.streamingStats as
            | { thinkingMs?: number; outputTokens?: number }
            | undefined;

          if (stats?.thinkingMs != null) {
            // Authoritative value from SDK — use it and reset local timer
            thinkingMs = stats.thinkingMs;
            thinkingStartLocal = null;
          } else {
            // Live estimation: accumulated + current block duration
            thinkingMs = thinkingMs + (Date.now() - thinkingStartLocal);
            // Don't reset thinkingStartLocal — keep accumulating
          }

          if (stats?.outputTokens && stats.outputTokens > 0) {
            sdkOutputTokens = stats.outputTokens;
          }
          onMeta?.({ outputTokens: sdkOutputTokens, thinkingMs, thinkingText });
        }
        // Handle tool_use content - notify UI of tool invocation
        // Skip if we're getting tool events from hooks to avoid duplicates
        else if (message.type === "tool_use" && message.content && !state.toolEventsViaHooks) {
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
        // Skip if we're getting tool events from hooks to avoid duplicates
        else if (message.type === "tool_result" && !state.toolEventsViaHooks) {
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
      // Only clear parallel agents if none are still actively running.
      // When sub-agents outlive the stream, handleComplete in chat.tsx
      // defers queue processing until they finish.
      const hasActiveAgents = state.parallelAgents.some(
        (a) => a.status === "running" || a.status === "pending"
      );
      if (!hasActiveAgents) {
        state.parallelAgents = [];
      }
      onComplete();
    } catch (error) {
      // Ignore AbortError - this is expected when user interrupts
      if (error instanceof Error && error.name === "AbortError") {
        // Stream was intentionally aborted
      }
      state.parallelAgents = [];
      onComplete();
    } finally {
      // Clear streaming state
      state.streamAbortController = null;
      // Keep isStreaming true if sub-agents are still running so
      // subagent.complete events continue to be processed.
      const hasActiveAgents = state.parallelAgents.some(
        (a) => a.status === "running" || a.status === "pending"
      );
      if (!hasActiveAgents) {
        state.isStreaming = false;
      }
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
  function handleInterrupt(): void {
    // If streaming, abort the current operation
    if (state.isStreaming && state.streamAbortController) {
      // Skip if already aborted (e.g., keyboard handler already triggered abort
      // and SIGINT fires as a second signal for the same Ctrl+C press)
      if (state.streamAbortController.signal.aborted) return;
      // Clear streaming state immediately so tool events from SDK
      // don't flow through and overwrite React state after interrupt
      state.isStreaming = false;
      state.parallelAgents = [];
      state.streamAbortController.abort();
      // Reset interrupt state
      state.interruptCount = 0;
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
        state.interruptTimeout = null;
      }
      if (state.showCtrlCWarning) {
        state.showCtrlCWarning(false);
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
      if (state.showCtrlCWarning) {
        state.showCtrlCWarning(false);
      }
      void cleanup();
      return;
    }

    // First press - show warning and set timeout
    if (state.showCtrlCWarning) {
      state.showCtrlCWarning(true);
    }
    if (state.interruptTimeout) {
      clearTimeout(state.interruptTimeout);
    }
    state.interruptTimeout = setTimeout(() => {
      state.interruptCount = 0;
      state.interruptTimeout = null;
      if (state.showCtrlCWarning) {
        state.showCtrlCWarning(false);
      }
    }, 1000);
  }

  // Set up signal handlers for cleanup
  // Ctrl+C (SIGINT) uses the unified interrupt handler
  const sigintHandler = () => {
    handleInterrupt();
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
    if (state.ctrlCTimeout) {
      clearTimeout(state.ctrlCTimeout);
    }
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
      useAlternateScreen: true,
      exitOnCtrlC: false,
      useKittyKeyboard: { disambiguate: true },
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

    const registerSkillInvokedHandler = (handler: OnSkillInvoked) => {
      state.skillInvokedHandler = handler;
    };

    const registerPermissionRequestHandler = (handler: ChatOnPermissionRequest) => {
      state.permissionRequestHandler = handler;
    };

    const registerAskUserQuestionHandler = (handler: OnAskUserQuestion) => {
      state.askUserQuestionHandler = handler;
    };

    const registerParallelAgentHandler = (handler: (agents: ParallelAgent[]) => void) => {
      state.parallelAgentHandler = handler;
    };

    const registerCtrlCWarningHandler = (handler: (show: boolean) => void) => {
      state.showCtrlCWarning = handler;
    };

    /**
     * Handle interrupt request from the UI (Escape/Ctrl+C during streaming).
     * This is called by ChatApp when user presses interrupt keys.
     */
    const handleInterruptFromUI = () => {
      handleInterrupt();
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
      if (state.session) {
        try {
          await state.session.destroy();
        } catch {
          // Session may already be destroyed
        }
        state.session = null;
      }
    };

    /**
     * Factory for creating independent sub-agent sessions.
     * Delegates to client.createSession() to give each sub-agent its own context.
     */
    const createSubagentSession = (config?: SessionConfig) =>
      client.createSession(config);

    /**
     * Handle model change from ChatApp (via /model command or model selector).
     * Updates sessionConfig so that new sessions (e.g., after /clear) use the correct model.
     */
    const handleModelChange = (newModel: string) => {
      if (sessionConfig) {
        sessionConfig.model = newModel;
      }
    };

    state.root.render(
      React.createElement(
        ThemeProvider,
        {
          initialTheme: theme,
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
                getModelDisplayInfo: () => client.getModelDisplayInfo(),
                onSendMessage: handleSendMessage,
                onStreamMessage: handleStreamMessage,
                onExit: handleExit,
                onResetSession: resetSession,
                onInterrupt: handleInterruptFromUI,
                registerToolStartHandler,
                registerToolCompleteHandler,
                registerSkillInvokedHandler,
                registerPermissionRequestHandler,
                registerAskUserQuestionHandler,
                registerParallelAgentHandler,
                registerCtrlCWarningHandler,
                getSession,
                createSubagentSession,
                initialPrompt,
                onModelChange: handleModelChange,
              }),
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
  MAX_VISIBLE_MESSAGES,
  type ChatAppProps,
  type ChatMessage,
  type MessageToolCall,
  type WorkflowChatState,
  type OnToolStart,
  type OnToolComplete,
  type OnInterrupt,
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
  type ToolResultProps,
} from "./components/tool-result.tsx";
