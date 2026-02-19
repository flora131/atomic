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
  type OnToolStart,
  type OnToolComplete,
  type OnSkillInvoked,
  type OnPermissionRequest as ChatOnPermissionRequest,
  type OnInterrupt,
  type OnAskUserQuestion,
  type CommandExecutionTelemetry,
  type MessageSubmitTelemetry,
} from "./chat.tsx";
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
import { parseTaskToolResult } from "./tools/registry.ts";
import {
  createTuiTelemetrySessionTracker,
  type TuiTelemetrySessionTracker,
} from "../telemetry/index.ts";
import { shouldFinalizeOnToolComplete } from "./parts/index.ts";

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
 * Handler for permission/HITL requests
 */
export type OnPermissionRequest = (
  requestId: string,
  toolName: string,
  question: string,
  options: Array<{ label: string; value: string; description?: string }>,
  respond: (answer: string | string[]) => void,
  header?: string,
  toolCallId?: string
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
  /** Session IDs owned by this TUI instance (main + spawned subagent sessions) */
  ownedSessionIds: Set<string>;
  /** Promise lock to prevent concurrent session creation */
  sessionCreationPromise: Promise<void> | null;
  /** Monotonic run counter used to assign ownership to each active stream */
  runCounter: number;
  /** Active stream run owner ID. Null means no run currently owns hook events. */
  currentRunId: number | null;
  /**
   * Hook-scoped reset callback installed by subscribeToToolEvents().
   * Clears correlation maps and live parallel tree state.
   */
  resetParallelTracking: ((reason: string) => void) | null;
  /**
   * Suppress streaming text that is a raw JSON echo of the Task tool result.
   * When set, holds the result text so suppression is content-aware.
   * Reset when the model produces non-echo text or starts a new tool.
   */
  suppressPostTaskResult: string | null;
  /** Native TUI telemetry tracker (null when telemetry is disabled or agent type is unknown) */
  telemetryTracker: TuiTelemetrySessionTracker | null;
}

function clearParallelAgents(state: ChatUIState) {
  state.parallelAgents = [];
  state.parallelAgentHandler?.(state.parallelAgents);
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
    ownedSessionIds: new Set(),
    sessionCreationPromise: null,
    runCounter: 0,
    currentRunId: null,
    resetParallelTracking: null,
    suppressPostTaskResult: null,
    telemetryTracker: agentType
      ? createTuiTelemetrySessionTracker({
        agentType,
        workflowEnabled,
        hasInitialPrompt: !!initialPrompt,
      })
      : null,
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
    state.resetParallelTracking?.("cleanup");

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

    // FIFO queue of pending Task tool calls consumed by subagent.start.
    // Keeps prompt + internal toolId + mode + run ownership together.
    const pendingTaskEntries: Array<{ toolId: string; prompt?: string; isBackground?: boolean; runId: number }> = [];

    // Maps SDK-level correlation IDs to agent IDs for ID-based result attribution.
    // Populated by subagent.start, consumed by tool.complete for Task tools.
    // Keys: toolUseID (Claude), toolCallId (Copilot), internal toolId (FIFO fallback)
    const toolCallToAgentMap = new Map<string, string>();

    // Map SDK tool use IDs to internal tool IDs for deduplication.
    // SDKs like OpenCode emit tool.start for both "pending" and "running"
    // statuses of the same tool call — this map ensures we reuse the same
    // internal ID and update the existing UI entry instead of creating a duplicate.
    const sdkToolIdMap = new Map<string, string>();

    // Tool IDs belonging to running sub-agents. These tools are tracked in
    // the parallel agents tree but filtered out of the main chat UI and
    // ctrl+o transcript to avoid duplicate display.
    const subagentToolIds = new Set<string>();

    // Internal run ownership tracking for hook events.
    const toolIdToRunMap = new Map<string, number>();
    const sdkCorrelationToRunMap = new Map<string, number>();
    const agentIdToRunMap = new Map<string, number>();

    const eventBelongsToOwnedSession = (eventSessionId: string): boolean => {
      if (typeof eventSessionId !== "string" || eventSessionId.length === 0) return false;
      if (state.ownedSessionIds.has(eventSessionId)) return true;
      return false;
    };

    const detachToolIdFromNameStack = (toolName: string, toolId: string): void => {
      const ids = toolNameToIds.get(toolName);
      if (!ids || ids.length === 0) return;
      const idx = ids.indexOf(toolId);
      if (idx === -1) return;
      ids.splice(idx, 1);
      if (ids.length === 0) {
        toolNameToIds.delete(toolName);
        toolNameToId.delete(toolName);
      } else {
        toolNameToId.set(toolName, ids[0] as string);
      }
    };

    const clearToolRunTracking = (toolId: string, sdkCorrelationId?: string): void => {
      state.activeToolIds.delete(toolId);
      subagentToolIds.delete(toolId);
      toolIdToRunMap.delete(toolId);
      if (sdkCorrelationId) {
        sdkToolIdMap.delete(sdkCorrelationId);
        sdkCorrelationToRunMap.delete(sdkCorrelationId);
      }
    };

    const resetParallelTracking = (_reason: string): void => {
      pendingTaskEntries.splice(0, pendingTaskEntries.length);
      toolCallToAgentMap.clear();
      sdkToolIdMap.clear();
      subagentToolIds.clear();
      toolIdToRunMap.clear();
      sdkCorrelationToRunMap.clear();
      agentIdToRunMap.clear();
      toolNameToIds.clear();
      toolNameToId.clear();
      state.activeToolIds.clear();
      state.suppressPostTaskResult = null;
      clearParallelAgents(state);
    };
    state.resetParallelTracking = resetParallelTracking;

    // Internal cleanup gate for correlation tracking.
    // Keep completed agents around until late Task tool.complete events are consumed.
    const tryFinalizeParallelTracking = (): void => {
      const hasActiveAgents = state.parallelAgents.some(
        (a) => a.status === "running" || a.status === "pending" || a.status === "background"
      );
      const hasPendingCorrelations =
        pendingTaskEntries.length > 0 || toolCallToAgentMap.size > 0;
      if (!hasActiveAgents && !hasPendingCorrelations) {
        // Keep completed agents visible while the parent stream is still
        // active so sequential Task calls in the same response can merge into
        // one tree. Clear only after stream ownership ends/reset.
        if (!state.isStreaming || state.currentRunId === null) {
          clearParallelAgents(state);
        }
      }
    };

    // Subscribe to tool.start events
    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolInput?: unknown; toolUseId?: string; toolUseID?: string };
      if (data.toolName) {
        state.telemetryTracker?.trackToolStart(data.toolName);
      }
      if (!state.toolStartHandler || !data.toolName) return;

      // Reject stale hook events when no active run owns the stream.
      const activeRunId = state.currentRunId;
      if (activeRunId === null || !state.isStreaming) return;

      // Resolve SDK-provided tool use ID (OpenCode: toolUseId, Claude: toolUseID)
      const sdkId = data.toolUseId ?? data.toolUseID;
      const isTaskToolName = data.toolName === "Task" || data.toolName === "task";
      const sessionOwned = eventBelongsToOwnedSession(event.sessionId);
      if (!sessionOwned) {
        const sdkRunId = sdkId ? sdkCorrelationToRunMap.get(sdkId) : undefined;
        const correlatedToActiveRun =
          sdkRunId !== undefined && sdkRunId === activeRunId;
        if (!correlatedToActiveRun) return;
      }
      if (sdkId) {
        const sdkRunId = sdkCorrelationToRunMap.get(sdkId);
        if (sdkRunId !== undefined && sdkRunId !== activeRunId) return;
      }

      let toolId: string;
      let isUpdate = false;
      if (sdkId && sdkToolIdMap.has(sdkId)) {
        // Same logical tool call — reuse internal ID and update input
        toolId = sdkToolIdMap.get(sdkId)!;
        isUpdate = true;
        const mappedRunId = toolIdToRunMap.get(toolId);
        if (mappedRunId !== undefined && mappedRunId !== activeRunId) return;
      } else {
        // New tool call — assign a fresh internal ID
        toolId = `tool_${++state.toolIdCounter}`;
        if (sdkId) sdkToolIdMap.set(sdkId, toolId);
      }

      if (!toolIdToRunMap.has(toolId)) {
        toolIdToRunMap.set(toolId, activeRunId);
      }
      if (sdkId) {
        sdkCorrelationToRunMap.set(sdkId, activeRunId);
      }

      // Check for duplicate events (same toolId already tracked)
      if (!isUpdate && state.activeToolIds.has(toolId)) {
        return; // Skip duplicate event
      }
      state.activeToolIds.add(toolId);

      // Track name → ID stack (allows concurrent same-name tools)
      if (!isUpdate) {
        const ids = toolNameToIds.get(data.toolName) ?? [];
        ids.push(toolId);
        toolNameToIds.set(data.toolName, ids);
      }
      toolNameToId.set(data.toolName, toolId);

      // Capture Task tool prompts and toolIds for subagent.start correlation.
      // Only queue on first logical start; SDK updates for the same call
      // must not enqueue duplicates.
      if (isTaskToolName && data.toolInput && !isUpdate) {
        const input = data.toolInput as Record<string, unknown>;
        const prompt = (input.prompt as string) ?? (input.description as string) ?? "";
        const isBackground = input.run_in_background === true;
        pendingTaskEntries.push({ toolId, prompt: prompt || undefined, isBackground, runId: activeRunId });

        // Eagerly create a ParallelAgent so the tree appears immediately
        // instead of waiting for the SDK's subagent.start event (which may
        // arrive late or not at all). When subagent.start fires later, the
        // entry is updated in-place with the real subagentId.
        if (state.parallelAgentHandler) {
          const agentType = (input.subagent_type as string) ?? (input.agent_type as string) ?? "agent";
          const taskDesc = (input.description as string) ?? prompt ?? "Sub-agent task";
          const newAgent: ParallelAgent = {
            id: toolId,
            taskToolCallId: toolId,
            name: agentType,
            task: taskDesc,
            status: isBackground ? "background" : "running",
            background: isBackground || undefined,
            startedAt: new Date().toISOString(),
            currentTool: isBackground
              ? `Running ${agentType} in background…`
              : `Starting ${agentType}…`,
          };
          state.parallelAgents = [...state.parallelAgents, newAgent];
          state.parallelAgentHandler(state.parallelAgents);
          toolCallToAgentMap.set(toolId, toolId);
          agentIdToRunMap.set(toolId, activeRunId);
        }
      }

      // Reset post-task text suppression when the model invokes a new tool —
      // the model has moved past any potential JSON echo of the previous
      // task result and is generating new output.
      state.suppressPostTaskResult = null;

      // Propagate tool progress to running subagents in the parallel agents tree.
      // SDK events (subagent.start / subagent.complete) don't carry intermediate
      // tool-use updates, so we bridge that gap here by attributing each tool.start
      // to the most recently started running subagent.
      const isTaskTool = isTaskToolName;
      let isSubagentTool = false;
      if (!isTaskTool && state.parallelAgentHandler && state.parallelAgents.length > 0) {
        const runningAgent = [...state.parallelAgents]
          .reverse()
          .find((a) => a.status === "running");
        if (runningAgent) {
          isSubagentTool = true;
          subagentToolIds.add(toolId);
          const updatedToolUses = (runningAgent.toolUses ?? 0) + 1;
          state.parallelAgents = state.parallelAgents.map((a) =>
            a.id === runningAgent.id
              ? { ...a, currentTool: data.toolName!, toolUses: updatedToolUses }
              : a
          );
          state.parallelAgentHandler(state.parallelAgents);
        }
      }

      // Only dispatch to the main chat UI for non-subagent tools.
      // Sub-agent tool calls are tracked in the parallel agents tree
      // and filtered out of the main UI / ctrl+o transcript.
      if (!isSubagentTool) {
        state.toolStartHandler(
          toolId,
          data.toolName,
          (data.toolInput as Record<string, unknown>) ?? {}
        );
      }
    });

    // Subscribe to tool.complete events
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolResult?: unknown; success?: boolean; error?: string; toolInput?: Record<string, unknown>; toolUseID?: string; toolCallId?: string; toolUseId?: string };
      if (data.toolName) {
        state.telemetryTracker?.trackToolComplete(data.toolName, data.success ?? true);
      }
      if (!state.toolCompleteHandler) return;

      const activeRunId = state.currentRunId;
      if (activeRunId === null || !state.isStreaming) return;

      // Resolve internal tool ID:
      // 1) Prefer SDK correlation IDs for deterministic attribution
      // 2) Fallback to tool-name FIFO for SDKs without stable IDs
      const sdkCorrelationId = data.toolUseID ?? data.toolCallId ?? data.toolUseId;
      const sessionOwned = eventBelongsToOwnedSession(event.sessionId);
      if (!sessionOwned) {
        const sdkRunId = sdkCorrelationId
          ? sdkCorrelationToRunMap.get(sdkCorrelationId)
          : undefined;
        if (sdkRunId === undefined || sdkRunId !== activeRunId) {
          return;
        }
      }
      let toolId: string;
      if (sdkCorrelationId && sdkToolIdMap.has(sdkCorrelationId)) {
        toolId = sdkToolIdMap.get(sdkCorrelationId)!;
        if (data.toolName) {
          detachToolIdFromNameStack(data.toolName, toolId);
        }
      } else if (data.toolName) {
        // Find the matching tool ID from the stack (FIFO order)
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

      const runIdFromSdk = sdkCorrelationId ? sdkCorrelationToRunMap.get(sdkCorrelationId) : undefined;
      const runIdFromTool = toolIdToRunMap.get(toolId);
      const eventRunId = runIdFromSdk ?? runIdFromTool;

      // Fail closed on stale or unowned completions.
      if (eventRunId === undefined || eventRunId !== activeRunId) {
        clearToolRunTracking(toolId, sdkCorrelationId);
        return;
      }

      // Skip dispatching to main chat UI for sub-agent tools.
      // They were never registered via toolStartHandler, so there's
      // nothing to complete in the message parts or tool calls arrays.
      const isSubagentTool = subagentToolIds.has(toolId);
      if (!isSubagentTool) {
        state.toolCompleteHandler(
          toolId,
          data.toolResult,
          data.success ?? true,
          data.error,
          data.toolInput // Pass input to update if it wasn't available at start
        );
      }
      subagentToolIds.delete(toolId);

      const isTaskTool = data.toolName === "Task" || data.toolName === "task";
      if (isTaskTool) {
        // Task completion consumed this call even if output is empty.
        // Remove unresolved FIFO entry to avoid stale correlation state.
        const pendingIdx = pendingTaskEntries.findIndex(
          (entry) => entry.toolId === toolId && entry.runId === activeRunId
        );
        if (pendingIdx !== -1) {
          pendingTaskEntries.splice(pendingIdx, 1);
        }
      }

      // Propagate Task tool result to the corresponding parallel agent.
      // The subagent.complete event (from SubagentStop / step-finish hooks)
      // doesn't carry the actual output text — only the PostToolUse /
      // tool.execution_complete event for the "Task" tool has the result.
      // Use ID-based correlation to attribute results to the correct agent,
      // falling back to reverse heuristic for backward compatibility.
      if (
        isTaskTool &&
        data.toolResult &&
        state.parallelAgentHandler &&
        state.parallelAgents.length > 0
      ) {
        // Extract clean result text using the shared parser
        const parsed = parseTaskToolResult(data.toolResult);
        const resultStr = parsed.text ?? (typeof data.toolResult === "string"
          ? data.toolResult
          : JSON.stringify(data.toolResult));

        // Try ID-based correlation: SDK-level IDs first, then internal toolId
        const taskSdkCorrelationId = data.toolUseID ?? data.toolCallId ?? data.toolUseId;
        const agentId = (taskSdkCorrelationId && toolCallToAgentMap.get(taskSdkCorrelationId))
          || toolCallToAgentMap.get(toolId);

        if (agentId) {
          // Fallback: if the tool result indicates async (e.g. { isAsync: true }),
          // retroactively mark the agent as background so finalization is skipped.
          if (parsed.isAsync) {
            state.parallelAgents = state.parallelAgents.map((a) =>
              a.id === agentId && !a.background
                ? { ...a, background: true, status: "background" as const }
                : a
            );
          }

          // Set result AND finalize status — if subagent.complete never
          // fired (eager agent path), this ensures the agent transitions
          // from "running" → "completed" when the Task tool returns.
          // Use shouldFinalizeOnToolComplete guard to prevent premature
          // finalization of background agents.
          state.parallelAgents = state.parallelAgents.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  result: resultStr,
                  status: shouldFinalizeOnToolComplete(a)
                    ? (a.status === "running" || a.status === "pending"
                        ? "completed" as const
                        : a.status)
                    : a.status,
                  currentTool: shouldFinalizeOnToolComplete(a)
                    ? (a.status === "running" || a.status === "pending"
                        ? undefined
                        : a.currentTool)
                    : a.currentTool,
                  durationMs: shouldFinalizeOnToolComplete(a)
                    ? (a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime()))
                    : a.durationMs,
                }
              : a
          );
          state.parallelAgentHandler(state.parallelAgents);
          // Clean up consumed mappings
          if (taskSdkCorrelationId) toolCallToAgentMap.delete(taskSdkCorrelationId);
          toolCallToAgentMap.delete(toolId);
        } else {
          // Fallback: find the last completed-or-running agent without a result
          // Use shouldFinalizeOnToolComplete guard to prevent premature
          // finalization of background agents.
          const agentToUpdate = [...state.parallelAgents]
            .reverse()
            .find((a) => (a.status === "completed" || a.status === "running") && !a.result && shouldFinalizeOnToolComplete(a));
          if (agentToUpdate) {
            state.parallelAgents = state.parallelAgents.map((a) =>
              a.id === agentToUpdate.id
                ? {
                    ...a,
                    result: resultStr,
                    status: "completed" as const,
                    currentTool: undefined,
                    durationMs: a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime()),
                  }
                : a
            );
            state.parallelAgentHandler(state.parallelAgents);
          }
        }

        // Store the result text so we can content-match against it.
        // The SDK model may echo back the raw tool_response JSON as
        // streaming text — we suppress text that matches the result but
        // allow the model's real follow-up response through.
        state.suppressPostTaskResult = resultStr;
      } else if (
        isTaskTool &&
        state.parallelAgentHandler &&
        state.parallelAgents.length > 0
      ) {
        // Task tool completed without a result — still finalize any
        // eagerly-created agent that hasn't been marked completed yet.
        // Use shouldFinalizeOnToolComplete guard to prevent premature
        // finalization of background agents.
        const agentId = toolCallToAgentMap.get(toolId);
        if (agentId) {
          state.parallelAgents = state.parallelAgents.map((a) =>
            a.id === agentId && (a.status === "running" || a.status === "pending") && shouldFinalizeOnToolComplete(a)
              ? {
                  ...a,
                  status: "completed" as const,
                  currentTool: undefined,
                  durationMs: a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime()),
                }
              : a
          );
          state.parallelAgentHandler(state.parallelAgents);
          toolCallToAgentMap.delete(toolId);
        }
      }

      clearToolRunTracking(toolId, sdkCorrelationId);
      tryFinalizeParallelTracking();
    });

    // Subscribe to skill.invoked events
    const unsubSkill = client.on("skill.invoked", (event) => {
      if (!eventBelongsToOwnedSession(event.sessionId)) return;
      const data = event.data as { skillName?: string; skillPath?: string };
      if (state.skillInvokedHandler && data.skillName) {
        state.skillInvokedHandler(data.skillName, data.skillPath);
      }
    });

    // Subscribe to permission.requested events for HITL
    const unsubPermission = client.on("permission.requested", (event) => {
      if (!eventBelongsToOwnedSession(event.sessionId)) return;
      const data = event.data as {
        requestId?: string;
        toolName?: string;
        question?: string;
        header?: string;
        options?: Array<{ label: string; value: string; description?: string }>;
        respond?: (answer: string | string[]) => void;
        toolCallId?: string;
      };

      if (state.permissionRequestHandler && data.question && data.respond) {
        state.permissionRequestHandler(
          data.requestId ?? `perm_${Date.now()}`,
          data.toolName ?? "Unknown Tool",
          data.question,
          data.options ?? [],
          data.respond,
          data.header,
          data.toolCallId
        );
      }
    });

    // Subscribe to human_input_required events from workflow graphs (askUserNode)
    const unsubHumanInput = client.on("human_input_required", (event) => {
      if (!eventBelongsToOwnedSession(event.sessionId)) return;
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
        toolInput?: unknown;
        toolUseID?: string; // Claude: parent Task tool's use ID
        toolCallId?: string; // Copilot: same as subagentId
      };

      // Skip if stream already ended — late events should not revive cleared agents
      if (!state.isStreaming) return;
      const activeRunId = state.currentRunId;
      if (activeRunId === null) return;

      if (!state.parallelAgentHandler || !data.subagentId) return;

      const sdkCorrelationId = data.toolUseID ?? data.toolCallId;
      const sdkRunId = sdkCorrelationId ? sdkCorrelationToRunMap.get(sdkCorrelationId) : undefined;
      if (sdkRunId !== undefined && sdkRunId !== activeRunId) return;
      const correlatedToolId = sdkCorrelationId ? sdkToolIdMap.get(sdkCorrelationId) : undefined;
      let pendingTaskEntry: { toolId: string; prompt?: string; isBackground?: boolean; runId: number } | undefined;
      if (correlatedToolId) {
        const entryIdx = pendingTaskEntries.findIndex(
          (entry) => entry.toolId === correlatedToolId && entry.runId === activeRunId
        );
        if (entryIdx !== -1) {
          pendingTaskEntry = pendingTaskEntries.splice(entryIdx, 1)[0];
        }
      }
      if (!pendingTaskEntry && !sdkCorrelationId) {
        const firstActiveIdx = pendingTaskEntries.findIndex(
          (entry) => entry.runId === activeRunId
        );
        if (firstActiveIdx !== -1) {
          pendingTaskEntry = pendingTaskEntries.splice(firstActiveIdx, 1)[0];
        }
      }
      const hasSdkCorrelationMatch = sdkRunId !== undefined && sdkRunId === activeRunId;
      const sessionOwned = eventBelongsToOwnedSession(event.sessionId);
      if (!sessionOwned && !pendingTaskEntry && !hasSdkCorrelationMatch) return;
      // Fail closed for uncorrelated events to prevent cross-run leakage,
      // but allow flows with SDK correlation IDs even if no Task entry exists.
      if (!pendingTaskEntry && !hasSdkCorrelationMatch) return;

      // Use task from event data, or dequeue a pending Task tool prompt
      const fallbackInput = data.toolInput as Record<string, unknown> | undefined;
      const fallbackPrompt = fallbackInput
        ? ((fallbackInput.prompt as string) ?? (fallbackInput.description as string))
        : undefined;
      const task = data.task
        || pendingTaskEntry?.prompt
        || fallbackPrompt
        || data.subagentType
        || "Sub-agent";
      const agentTypeName = data.subagentType ?? "agent";
      const isBackground = pendingTaskEntry?.isBackground
        ?? (fallbackInput?.run_in_background === true);

      // Check if an eager agent was already created from tool.start.
      // If so, update it in-place with the real subagentId instead of
      // creating a duplicate entry.
      const eagerToolId = pendingTaskEntry?.toolId;
      const hasEagerAgent = eagerToolId
        ? state.parallelAgents.some(a => a.id === eagerToolId)
        : false;

      if (hasEagerAgent && eagerToolId) {
        // Merge: update existing eager agent with real subagentId.
        // Preserve background status and other fields from the eager agent.
        state.parallelAgents = state.parallelAgents.map(a =>
          a.id === eagerToolId
            ? {
                ...a,
                id: data.subagentId!,
                taskToolCallId: a.taskToolCallId ?? eagerToolId,
                name: agentTypeName,
                task: data.task || a.task,
                currentTool: `Running ${agentTypeName}…`,
              }
            : a
        );
        // Re-point correlation: toolId now maps to the real subagentId
        toolCallToAgentMap.set(eagerToolId, data.subagentId!);
      } else {
        // No eager agent — create fresh (backward compat for non-Task subagents)
        // Use stored background status from pendingTaskEntry
        const newAgent: ParallelAgent = {
          id: data.subagentId,
          taskToolCallId: pendingTaskEntry?.toolId,
          name: agentTypeName,
          task,
          status: isBackground ? "background" : "running",
          background: isBackground || undefined,
          startedAt: event.timestamp ?? new Date().toISOString(),
          currentTool: isBackground
            ? `Running ${agentTypeName} in background…`
            : `Running ${agentTypeName}…`,
        };
        state.parallelAgents = [...state.parallelAgents, newAgent];
      }
      state.parallelAgentHandler(state.parallelAgents);
      agentIdToRunMap.set(data.subagentId, activeRunId);

      // Build correlation mapping: SDK-level ID → agentId
      // This allows tool.complete to attribute results to the correct agent.
      if (sdkCorrelationId) {
        toolCallToAgentMap.set(sdkCorrelationId, data.subagentId);
      }
      // FIFO fallback: consume pending Task toolId and map it to this agent
      const fifoToolId = pendingTaskEntry?.toolId;
      if (fifoToolId) {
        toolCallToAgentMap.set(fifoToolId, data.subagentId);
      }
    });

    // Subscribe to subagent.complete events to update ParallelAgentsTree
    const unsubSubagentComplete = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: unknown;
      };
      const activeRunId = state.currentRunId;
      if (activeRunId === null) return;

      const sessionOwned = eventBelongsToOwnedSession(event.sessionId);
      if (data.subagentId) {
        const runId = agentIdToRunMap.get(data.subagentId);
        if (!sessionOwned && (runId === undefined || runId !== activeRunId)) return;
        if (runId !== undefined && runId !== activeRunId) return;
      } else if (!sessionOwned) {
        return;
      }

      // Skip if stream already ended, unless a background agent is completing
      if (!state.isStreaming) {
        const targetAgent = data.subagentId
          ? state.parallelAgents.find((a) => a.id === data.subagentId)
          : undefined;
        if (!targetAgent?.background) return;
      }

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

        // Note: Do NOT clear parallelAgents here. The Task tool.complete
        // events fire after subagent.complete and need parallelAgents to
        // still be populated to propagate results. Cleanup is handled by
        // chat.tsx's handleComplete / isAgentOnlyStream effect which properly
        // bakes agents into the final message before clearing.
        agentIdToRunMap.delete(data.subagentId);
        for (const [correlationId, mappedAgentId] of toolCallToAgentMap) {
          if (mappedAgentId === data.subagentId) {
            toolCallToAgentMap.delete(correlationId);
          }
        }
        tryFinalizeParallelTracking();
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
      if (state.resetParallelTracking === resetParallelTracking) {
        state.resetParallelTracking = null;
      }
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
        // Subscribe to tool events BEFORE creating the session.
        // Only subscribe once — handlers reference `state` so they stay
        // up-to-date even across session resets (e.g., /clear).
        if (!state.toolEventsViaHooks) {
          const unsubscribe = subscribeToToolEvents();
          state.cleanupHandlers.push(unsubscribe);
        }

        // Clear stale tool tracking from any previous session
        state.currentRunId = null;
        state.activeToolIds.clear();
        state.resetParallelTracking?.("ensure_session");

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
   * Handles text, tool_use, and tool_result messages from the stream.
   * Supports interruption via AbortController (Escape/Ctrl+C during streaming).
   */
  async function handleStreamMessage(
    content: string,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onMeta?: (meta: { outputTokens: number; thinkingMs: number; thinkingText: string }) => void
  ): Promise<void> {
    // Single-owner stream model: any new stream handoff resets previous
    // run-owned hook state before creating the next owner.
    state.currentRunId = null;
    state.resetParallelTracking?.("stream_start");

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
    state.currentRunId = ++state.runCounter;
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
      // Map SDK tool use IDs to internal tool IDs for stream-path deduplication
      const streamToolIdMap = new Map<string, string>();
      let thinkingText = "";

      // Reset the suppress state at the start of each stream
      state.suppressPostTaskResult = null;

      // Prefix-based accumulator for post-task text suppression.
      // Tracks accumulated text so we can check if the model is echoing the
      // sub-agent result (text arrives sequentially matching from the start)
      // vs. generating genuine follow-up content.
      let suppressAccumulator = "";
      let suppressTarget: string | null = null;

      for await (const message of abortableStream) {
        // Handle text content
        if (message.type === "text" && typeof message.content === "string") {
          // Accumulate thinking duration when transitioning away from thinking
          if (thinkingStartLocal !== null) {
            thinkingMs = thinkingMs + (Date.now() - thinkingStartLocal);
            thinkingStartLocal = null;
          }

          // After a Task tool completes, the SDK model may echo back the raw
          // tool_response as streaming text. Suppress only text that looks
          // like the echoed result (starts with JSON delimiters or sequentially
          // matches the stored result from the beginning). Once non-echo text
          // arrives, clear the suppression so the model's real response flows.
          const cachedResult = state.suppressPostTaskResult;
          // Reset accumulator when suppression target changes
          if (cachedResult !== suppressTarget) {
            suppressAccumulator = "";
            suppressTarget = cachedResult;
          }
          if (cachedResult !== null) {
            const trimmed = message.content.trim();
            if (trimmed.length === 0) {
              // Accumulate whitespace while suppression is active
              suppressAccumulator += message.content;
              continue;
            }
            const isJsonEcho = trimmed.startsWith("{") || trimmed.startsWith("[");
            if (isJsonEcho) {
              continue;
            }
            // Check if accumulated text + current chunk is a prefix of the
            // cached result. When the model echoes a result, text arrives
            // sequentially matching from the start of the result string.
            // The old substring check (`cachedResult.indexOf(trimmed) !== -1`)
            // was too aggressive — small streaming chunks (single words) are
            // almost always found as substrings of long result strings, which
            // incorrectly suppressed the model's genuine follow-up text.
            const candidate = (suppressAccumulator + message.content).trimStart();
            if ((cachedResult as string).startsWith(candidate)) {
              suppressAccumulator += message.content;
              continue;
            }
            // Not an echo — clear suppression, let this chunk through.
            // Accumulated text was part of the echo prefix and stays suppressed.
            state.suppressPostTaskResult = null;
            suppressTarget = null;
            suppressAccumulator = "";
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
          const toolContent = message.content as { name?: string; input?: Record<string, unknown>; toolUseId?: string };
          if (state.toolStartHandler && toolContent.name) {
            state.telemetryTracker?.trackToolStart(toolContent.name);
            // Deduplicate using SDK tool use ID (e.g., Claude's includePartialMessages
            // emits multiple assistant messages for the same tool_use block)
            const sdkId = toolContent.toolUseId ?? (message.metadata as Record<string, unknown> | undefined)?.toolId as string | undefined;
            let toolId: string;
            if (sdkId && streamToolIdMap.has(sdkId)) {
              toolId = streamToolIdMap.get(sdkId)!;
            } else {
              toolId = `tool_${++state.toolIdCounter}`;
              if (sdkId) streamToolIdMap.set(sdkId, toolId);
            }
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
            const toolNameFromMeta = typeof message.metadata?.toolName === "string"
              ? message.metadata.toolName
              : "unknown";
            state.telemetryTracker?.trackToolComplete(toolNameFromMeta, true);
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
      // Ignore AbortError - this is expected when user interrupts
      if (error instanceof Error && error.name === "AbortError") {
        // Stream was intentionally aborted
      }
      state.currentRunId = null;
      state.resetParallelTracking?.("stream_error");
      onComplete();
    } finally {
      // Clear streaming state
      state.streamAbortController = null;
      // Keep isStreaming true if sub-agents are still actively running so
      // subagent.complete events continue to be processed.
      // Only match agents that are actually active (running/pending/background),
      // not completed background agents that happen to have background=true.
      const hasActiveAgents = state.parallelAgents.some(
        (a) => a.status === "running" || a.status === "pending" || a.status === "background"
      );
      if (!hasActiveAgents) {
        state.isStreaming = false;
        state.currentRunId = null;
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
  function handleInterrupt(sourceType: "ui" | "signal"): void {
    // If streaming, abort the current operation
    if (state.isStreaming) {
      // Skip duplicate signal interrupts for an already-aborted foreground stream.
      if (state.streamAbortController?.signal.aborted) return;
      // Clear streaming state immediately so tool events from SDK
      // don't flow through and overwrite React state after interrupt
      state.isStreaming = false;
      state.currentRunId = null;
      state.resetParallelTracking?.("interrupt");
      state.streamAbortController?.abort();
      state.telemetryTracker?.trackInterrupt(sourceType);
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
      enableMouseMovement: false,
      openConsoleOnError: false,
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
      handleInterrupt("ui");
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
      state.resetParallelTracking?.("reset_session");
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
                onSessionMcpServersChange: handleSessionMcpServersChange,
                onCommandExecutionTelemetry: handleCommandTelemetry,
                onMessageSubmitTelemetry: handleMessageTelemetry,
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
  getWorkflowMetadata,

  // Skill commands
  registerSkillCommands,

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
