/**
 * Terminal Chat UI Component
 *
 * React components for a terminal-based chat interface using OpenTUI.
 * Supports message streaming, sticky scroll, and keyboard navigation.
 *
 * Reference: Feature 15 - Implement terminal chat UI
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useKeyboard, useRenderer, flushSync, useTerminalDimensions } from "@opentui/react";
import type {
  KeyEvent,
  TextareaRenderable,
  ScrollBoxRenderable,
  KeyBinding,
  PasteEvent,
} from "@opentui/core";
import { MacOSScrollAccel, SyntaxStyle, RGBA } from "@opentui/core";
import { useTheme, useThemeColors, darkTheme, lightTheme, createMarkdownSyntaxStyle } from "./theme.tsx";
import { STATUS, CONNECTOR, ARROW, PROMPT, SPINNER_FRAMES, SPINNER_COMPLETE, SCROLLBAR, MISC } from "./constants/icons.ts";
import { SPACING } from "./constants/spacing.ts";

import { Autocomplete, navigateUp, navigateDown } from "./components/autocomplete.tsx";

import { QueueIndicator } from "./components/queue-indicator.tsx";
import {
  type ParallelAgent,
} from "./components/parallel-agents-tree.tsx";
import { BackgroundAgentFooter } from "./components/background-agent-footer.tsx";
import { TranscriptView } from "./components/transcript-view.tsx";
import {
  appendCompactionSummary,
  appendToHistoryBuffer,
  readHistoryBuffer,
  clearHistoryBuffer,
} from "./utils/conversation-history-buffer.ts";
import {
  SubagentGraphBridge,
  type CreateSessionFn,
} from "../workflows/graph/subagent-bridge.ts";
import { WorkflowSDK } from "../workflows/graph/sdk.ts";
import {
  UserQuestionDialog,
  type UserQuestion,
  type QuestionAnswer,
} from "./components/user-question-dialog.tsx";
import {
  ModelSelectorDialog,
} from "./components/model-selector-dialog.tsx";
import type { Model } from "../models/model-transform.ts";
import type { TaskItem } from "./components/task-list-indicator.tsx";
import { TaskListPanel } from "./components/task-list-panel.tsx";
import { sortTasksTopologically } from "./components/task-order.ts";
import { saveTasksToActiveSession } from "./commands/workflow-commands.ts";
import {
  useStreamingState,
  type ToolExecutionStatus,
} from "./hooks/use-streaming-state.ts";
import { useMessageQueue, type QueuedMessage } from "./hooks/use-message-queue.ts";
import {
  globalRegistry,
  parseSlashCommand,
  type CommandDefinition,
  type CommandContext,
  type CommandContextState,
  type CommandCategory,
} from "./commands/index.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AskUserQuestionEventData } from "../workflows/graph/index.ts";
import type { AgentType, ModelOperations } from "../models";
import type {
  CodingAgentClient,
  EventHandler,
  EventType,
  McpServerConfig,
  ModelDisplayInfo,
  Session,
  ToolDefinition,
} from "../sdk/types.ts";
import { saveModelPreference, saveReasoningEffortPreference, clearReasoningEffortPreference } from "../utils/settings.ts";
import { formatDuration, normalizeMarkdownNewlines } from "./utils/format.ts";
import {
  hasLiveLoadingIndicator as hasAnyLiveLoadingIndicator,
  shouldShowCompletionSummary,
  shouldShowMessageLoadingIndicator,
} from "./utils/loading-state.ts";
import {
  getActiveBackgroundAgents,
  resolveBackgroundAgentsForFooter,
  formatBackgroundAgentFooterStatus,
  isBackgroundAgent,
} from "./utils/background-agent-footer.ts";
import { BACKGROUND_FOOTER_CONTRACT } from "./utils/background-agent-contracts.ts";
import {
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
} from "./utils/background-agent-termination.ts";
import { loadCommandHistory, appendCommandHistory } from "./utils/command-history.ts";
import { getRandomVerb, getRandomCompletionVerb } from "./constants/index.ts";
import type { McpServerToggleMap, McpSnapshotView } from "./utils/mcp-output.ts";
import {
  normalizeHitlAnswer,
  type HitlResponseRecord,
} from "./utils/hitl-response.ts";
import {
  normalizeTodoItems,
  reconcileTodoWriteItems,
  isTodoWriteToolName,
  type NormalizedTodoItem,
} from "./utils/task-status.ts";
import {
  AUTO_COMPACTION_INDICATOR_IDLE_STATE,
  AUTO_COMPACTION_RESULT_VISIBILITY_MS,
  clearRunningAutoCompactionIndicator,
  completeAutoCompactionIndicator,
  getAutoCompactionIndicatorLabel,
  shouldShowAutoCompactionIndicator,
  startAutoCompactionIndicator,
  type AutoCompactionIndicatorState,
} from "./utils/auto-compaction-lifecycle.ts";
import {
  createStartedStreamControlState,
  createStoppedStreamControlState,
  dispatchNextQueuedMessage,
  interruptRunningToolCalls,
  interruptRunningToolParts,
  isAskQuestionToolName,
  isCurrentStreamCallback,
  shouldTrackToolAsBlocking,
  shouldDispatchQueuedMessage,
  shouldDeferComposerSubmit,
  invalidateActiveStreamGeneration,
} from "./utils/stream-continuation.ts";
import { getNextKittyKeyboardDetectionState } from "./utils/kitty-keyboard-detection.ts";
import {
  getEnqueueShortcutLabel,
  shouldApplyBackslashLineContinuation,
  shouldEnqueueMessageFromKeyEvent,
  shouldInsertNewlineFromKeyEvent,
} from "./utils/newline-strategies.ts";
import {
  hasAnyAtReferenceToken,
  parseAtMentions,
  processFileMentions,
  type FileReadInfo,
} from "./utils/mention-parsing.ts";
import {
  applyTaskSnapshotToLatestAssistantMessage,
  hasRalphTaskIdOverlap,
  normalizeInterruptedTasks,
  preferTerminalTaskItems,
  snapshotTaskItems,
} from "./utils/ralph-task-state.ts";
import type {
  Part,
  TextPart,
  TaskListPart,
  SkillLoadPart,
  McpSnapshotPart,
  CompactionPart,
  PartId,
  ToolPart,
} from "./parts/index.ts";
import {
  createPartId,
  finalizeStreamingReasoningInMessage,
  hasActiveForegroundAgents,
  shouldFinalizeDeferredStream,
  applyStreamPartEvent,
  mergeParallelAgentsIntoParts,
  shouldGroupSubagentTrees,
  syncToolCallsIntoParts,
} from "./parts/index.ts";
import { MessageBubbleParts } from "./components/parts/message-bubble-parts.tsx";


export { shouldGroupSubagentTrees };
export {
  isTaskProgressComplete,
  shouldShowMessageLoadingIndicator,
  shouldShowCompletionSummary,
} from "./utils/loading-state.ts";


/**
 * Get autocomplete suggestions for @ mentions (agents and files).
 * Agent names are searched from the command registry (category "agent").
 * File paths are searched when input contains path characters (/ or .).
 */
export function getMentionSuggestions(input: string): CommandDefinition[] {
  const suggestions: CommandDefinition[] = [];

  // Agent suggestions first so they're visible at the top of the dropdown.
  // Use substring matching (not just prefix) so e.g. "@researcher" finds
  // "codebase-online-researcher" and "codebase-research-analyzer".
  const searchKey = input.toLowerCase();
  const allAgents = globalRegistry.all().filter(cmd => cmd.category === "agent");
  const agentMatches = searchKey
    ? allAgents.filter(cmd => cmd.name.toLowerCase().includes(searchKey))
    : allAgents;
  // Sort: prefix matches first, then substring matches, then alphabetical
  agentMatches.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(searchKey);
    const bPrefix = b.name.toLowerCase().startsWith(searchKey);
    if (aPrefix && !bPrefix) return -1;
    if (!aPrefix && bPrefix) return 1;
    return a.name.localeCompare(b.name);
  });
  suggestions.push(...agentMatches);

  // File/directory suggestions after agents — recursive traversal
  try {
    const cwd = process.cwd();
    const allEntries: Array<{ relPath: string; isDir: boolean }> = [];

    // Recursively read directory entries (skip hidden paths and node_modules)
    const scanDirectory = (dirPath: string, relativeBase: string) => {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          // Skip hidden files and common ignore patterns
          if (entry.name.startsWith(".")) continue;
          if (entry.name === "node_modules") continue;
          if (entry.name === "target") continue;
          if (entry.name === "build") continue;
          if (entry.name === "dist") continue;
          if (entry.name === "out") continue;
          if (entry.name === "coverage") continue;

          const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
          const isDir = entry.isDirectory();
          allEntries.push({ relPath: isDir ? `${relPath}/` : relPath, isDir });

          // Recursively scan subdirectories
          if (isDir) {
            scanDirectory(join(dirPath, entry.name), relPath);
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };

    // Start scanning from the current working directory
    scanDirectory(cwd, "");

    // Fuzzy (substring) match on the full relative path
    const filtered = searchKey
      ? allEntries.filter(e => e.relPath.toLowerCase().includes(searchKey))
      : allEntries;

    // Sort: directories first, then alphabetical
    filtered.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.relPath.localeCompare(b.relPath);
    });

    // Cap results to keep the dropdown manageable
    const dirs = filtered.filter(e => e.isDir);
    const files = filtered.filter(e => !e.isDir);
    const maxDirs = Math.min(dirs.length, 7);
    const maxFiles = Math.min(files.length, 15 - maxDirs);
    const mixed = [...dirs.slice(0, maxDirs), ...files.slice(0, maxFiles)];

    const fileMatches = mixed.map(e => ({
      name: e.relPath,
      description: "",
      category: (e.isDir ? "folder" : "file") as CommandCategory,
      execute: () => ({ success: true as const }),
    }));

    suggestions.push(...fileMatches);
  } catch {
    // Silently fail for invalid paths
  }

  return suggestions;
}

// ============================================================================
// BLOCK LETTER LOGO WITH GRADIENT
// ============================================================================

/**
 * ATOMIC in chunky block letters - pixel-art aesthetic
 * Uses Unicode block characters for retro feel
 */
const ATOMIC_BLOCK_LOGO = [
  "█▀▀█ ▀▀█▀▀ █▀▀█ █▀▄▀█ ▀█▀ █▀▀",
  "█▄▄█   █   █  █ █ ▀ █  █  █  ",
  "▀  ▀   ▀   ▀▀▀▀ ▀   ▀ ▀▀▀ ▀▀▀",
];

/**
 * Build the Atomic branding gradient based on theme mode.
 * Catppuccin-inspired: warm rosewater/flamingo/pink → cool blue/sky/teal.
 */
function buildAtomicGradient(isDark: boolean): string[] {
  return isDark
    ? ["#f5e0dc", "#f2cdcd", "#f5c2e7", "#cba6f7", "#b4befe", "#89b4fa", "#74c7ec", "#89dceb", "#94e2d5"]
    : ["#dc8a78", "#dd7878", "#ea76cb", "#8839ef", "#7287fd", "#1e66f5", "#209fb5", "#04a5e5", "#179299"];
}

// ============================================================================
// GRADIENT INTERPOLATION
// ============================================================================

/**
 * Parse a hex color string (#RRGGBB) to RGB components.
 */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/**
 * Convert RGB components to a hex color string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

/**
 * Interpolate a smooth color from a gradient at continuous position t (0..1).
 * Linearly blends between adjacent color stops for seamless transitions.
 */
function interpolateGradient(gradient: string[], t: number): string {
  if (gradient.length === 0) return "#ffffff";
  if (gradient.length === 1) return gradient[0] as string;

  const clampedT = Math.max(0, Math.min(1, t));
  const gradPos = clampedT * (gradient.length - 1);
  const lower = Math.floor(gradPos);
  const upper = Math.min(lower + 1, gradient.length - 1);
  const frac = gradPos - lower;

  const [r1, g1, b1] = hexToRgb(gradient[lower] as string);
  const [r2, g2, b2] = hexToRgb(gradient[upper] as string);

  return rgbToHex(
    r1 + (r2 - r1) * frac,
    g1 + (g2 - g1) * frac,
    b1 + (b2 - b1) * frac,
  );
}

/**
 * Props for GradientText component
 */
interface GradientTextProps {
  text: string;
  gradient: string[];
}

/**
 * Renders text with a smooth, continuous horizontal gradient effect.
 * Each character gets a linearly interpolated color between adjacent stops,
 * producing seamless color transitions across the full text width.
 *
 * Note: OpenTUI requires explicit style props - raw ANSI codes don't work.
 */
function GradientText({ text, gradient }: GradientTextProps): React.ReactNode {
  const chars = [...text];
  const len = chars.length;

  return (
    <text>
      {chars.map((char, i) => {
        const t = len > 1 ? i / (len - 1) : 0;
        const color = interpolateGradient(gradient, t);
        return (
          <span key={i} style={{ fg: color }}>
            {char}
          </span>
        );
      })}
    </text>
  );
}

/**
 * Props for the AtomicHeader component.
 */
export interface AtomicHeaderProps {
  /** Application version */
  version?: string;
  /** Model name */
  model?: string;
  /** Model tier/plan */
  tier?: string;
  /** Current working directory */
  workingDir?: string;
  /** Suggestion/hint text */
  suggestion?: string;
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Role of a chat message sender.
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * Represents a tool call within a message.
 */
export interface MessageToolCall {
  /** Unique tool call identifier */
  id: string;
  /** Name of the tool being called */
  toolName: string;
  /** Input parameters for the tool */
  input: Record<string, unknown>;
  /** Output from the tool (if available) */
  output?: unknown;
  /** Current execution status */
  status: ToolExecutionStatus;
  /** Structured HITL response data preserved across late tool.complete events */
  hitlResponse?: HitlResponseRecord;
}

export interface MessageSkillLoad {
  skillName: string;
  status: "loading" | "loaded" | "error";
  errorMessage?: string;
}

/**
 * Streaming metadata for live token count and thinking duration.
 */
export interface StreamingMeta {
  outputTokens: number;
  thinkingMs: number;
  thinkingText: string;
  /** Source key that produced the latest thinking-meta emission. */
  thinkingSourceKey?: string;
  /** Snapshot of accumulated thinking text keyed by source identity. */
  thinkingTextBySource?: Record<string, string>;
  /** Stream generation/run association keyed by source identity. */
  thinkingGenerationBySource?: Record<string, number>;
  /** Message binding keyed by source identity when metadata is available. */
  thinkingMessageBySource?: Record<string, string>;
}

export interface ThinkingDropDiagnostics {
  droppedStaleOrClosedThinkingEvents: number;
  droppedMissingBindingThinkingEvents: number;
}

type ThinkingSourceLifecycleAction = "create" | "update" | "finalize" | "drop";

const THINKING_SOURCE_DIAGNOSTICS_DEBUG = process.env.ATOMIC_THINKING_DIAGNOSTICS_DEBUG === "1";

function createThinkingDropDiagnostics(): ThinkingDropDiagnostics {
  return {
    droppedStaleOrClosedThinkingEvents: 0,
    droppedMissingBindingThinkingEvents: 0,
  };
}

export function traceThinkingSourceLifecycle(
  action: ThinkingSourceLifecycleAction,
  sourceKey: string,
  detail?: string,
): void {
  if (!THINKING_SOURCE_DIAGNOSTICS_DEBUG) {
    return;
  }
  const suffix = detail ? ` ${detail}` : "";
  console.debug(`[thinking-source] ${action} ${sourceKey}${suffix}`);
}

function addThinkingSourceKey(sourceKeys: Set<string>, key: unknown): void {
  if (typeof key !== "string") {
    return;
  }
  const normalized = key.trim();
  if (normalized.length === 0) {
    return;
  }
  sourceKeys.add(normalized);
}

function addThinkingSourceKeysFromRecord(
  sourceKeys: Set<string>,
  sourceRecord: Record<string, unknown> | undefined,
): void {
  if (!sourceRecord) {
    return;
  }
  for (const key of Object.keys(sourceRecord)) {
    addThinkingSourceKey(sourceKeys, key);
  }
}

export function mergeClosedThinkingSources(
  closedSources: ReadonlySet<string>,
  meta: StreamingMeta | null | undefined,
): Set<string> {
  const merged = new Set(closedSources);
  if (!meta) {
    return merged;
  }

  addThinkingSourceKey(merged, meta.thinkingSourceKey);
  addThinkingSourceKeysFromRecord(merged, meta.thinkingTextBySource);
  addThinkingSourceKeysFromRecord(merged, meta.thinkingGenerationBySource);
  addThinkingSourceKeysFromRecord(merged, meta.thinkingMessageBySource);

  return merged;
}

export function resolveValidatedThinkingMetaEvent(
  meta: StreamingMeta,
  expectedMessageId: string,
  currentGeneration: number,
  closedSources?: ReadonlySet<string>,
  diagnostics?: ThinkingDropDiagnostics,
): {
  thinkingSourceKey: string;
  targetMessageId: string;
  streamGeneration: number;
  thinkingText: string;
} | null {
  const recordDrop = (
    category: "stale_or_closed" | "missing_binding",
    sourceKey: string,
    detail: string,
  ): null => {
    if (category === "stale_or_closed") {
      if (diagnostics) {
        diagnostics.droppedStaleOrClosedThinkingEvents += 1;
      }
      traceThinkingSourceLifecycle("drop", sourceKey, `(stale/closed) ${detail}`);
      return null;
    }

    if (diagnostics) {
      diagnostics.droppedMissingBindingThinkingEvents += 1;
    }
    traceThinkingSourceLifecycle("drop", sourceKey, `(missing-binding) ${detail}`);
    return null;
  };

  const sourceKey = typeof meta.thinkingSourceKey === "string"
    ? meta.thinkingSourceKey.trim()
    : "";
  if (sourceKey.length === 0) {
    return null;
  }
  if (closedSources?.has(sourceKey)) {
    return recordDrop("stale_or_closed", sourceKey, "source already finalized");
  }

  const sourceTargetMessageId = meta.thinkingMessageBySource?.[sourceKey];
  // When no explicit targetMessageId binding exists (SDK clients don't emit one),
  // default to the current streaming message — thinking events arriving on the
  // active stream belong to the active message.
  const resolvedTargetMessageId =
    typeof sourceTargetMessageId === "string" && sourceTargetMessageId.length > 0
      ? sourceTargetMessageId
      : expectedMessageId;
  if (resolvedTargetMessageId !== expectedMessageId) {
    return recordDrop("stale_or_closed", sourceKey, "targetMessageId mismatch");
  }

  const sourceGeneration = meta.thinkingGenerationBySource?.[sourceKey];
  if (typeof sourceGeneration !== "number" || !Number.isFinite(sourceGeneration)) {
    return recordDrop("missing_binding", sourceKey, "missing streamGeneration binding");
  }
  if (sourceGeneration !== currentGeneration) {
    return recordDrop("stale_or_closed", sourceKey, "streamGeneration mismatch");
  }

  return {
    thinkingSourceKey: sourceKey,
    targetMessageId: resolvedTargetMessageId,
    streamGeneration: sourceGeneration,
    thinkingText: meta.thinkingTextBySource?.[sourceKey] ?? meta.thinkingText,
  };
}

/**
 * A single chat message.
 */
export interface ChatMessage {
  /** Unique message identifier */
  id: string;
  /** Who sent the message */
  role: MessageRole;
  /** Message content (may be partial during streaming) */
  content: string;
  /** ISO timestamp of when message was created */
  timestamp: string;
  /** Whether message is currently streaming */
  streaming?: boolean;
  /** Ordered parts array for parts-based rendering (ascending by part ID = chronological) */
  parts?: Part[];
  /** Tool calls within this message (for assistant messages) */
  toolCalls?: MessageToolCall[];
  /** Duration in milliseconds for assistant message generation */
  durationMs?: number;
  /** Model ID used for this message */
  modelId?: string;
  /** Whether the message was interrupted (esc/ctrl+c) before completion */
  wasInterrupted?: boolean;
  /** Snapshot of parallel agents that were active during this message (baked on completion) */
  parallelAgents?: ParallelAgent[];
  /** Files read via @mention in this user message */
  filesRead?: FileReadInfo[];
  /** Skill loads triggered during this message */
  skillLoads?: MessageSkillLoad[];
  /** Snapshot of task items active during this message (baked on completion) */
  taskItems?: Array<{id?: string; content: string; status: "pending" | "in_progress" | "completed" | "error"; blockedBy?: string[]}>;
  /** Whether task updates for this message should remain pinned-only (Ralph exception) */
  tasksPinned?: boolean;
  /** MCP snapshot for rendering Codex-style /mcp output */
  mcpSnapshot?: McpSnapshotView;
  /** Output tokens used in this message (baked on completion) */
  outputTokens?: number;
  /** Thinking/reasoning duration in milliseconds (baked on completion) */
  thinkingMs?: number;
  /** Accumulated thinking/reasoning text content (baked on completion) */
  thinkingText?: string;
  /** Optional spinner verb override for this message (e.g., /compact => "Compacting") */
  spinnerVerb?: string;
}

/**
 * Tool start event callback signature.
 */
export type OnToolStart = (
  toolId: string,
  toolName: string,
  input: Record<string, unknown>
) => void;

/**
 * Tool complete event callback signature.
 * @param toolId - The tool call ID
 * @param output - The tool output
 * @param success - Whether the tool execution succeeded
 * @param error - Error message if failed
 * @param input - The tool input parameters (may be more complete than at start time)
 */
export type OnToolComplete = (
  toolId: string,
  output: unknown,
  success: boolean,
  error?: string,
  input?: Record<string, unknown>
) => void;

/**
 * Skill invoked event callback signature.
 */
export type OnSkillInvoked = (
  skillName: string,
  skillPath?: string
) => void;

/**
 * Permission/HITL request callback signature.
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
 * Callback signature for interrupt handler.
 * Called when user presses Escape or Ctrl+C during streaming to abort.
 */
export type OnInterrupt = () => void;

/**
 * Callback signature for background-agent termination handler.
 * Called when user confirms Ctrl+F termination for active background agents.
 */
export type OnTerminateBackgroundAgents = () => void | Promise<void>;

/**
 * AskUserQuestion event callback signature.
 * Called when askUserNode emits a human_input_required signal.
 */
export type OnAskUserQuestion = (eventData: AskUserQuestionEventData) => void;

/**
 * Trigger source for a command execution from the TUI.
 */
export type CommandExecutionTrigger = "input" | "autocomplete" | "initial_prompt" | "mention";

/**
 * Telemetry payload for command execution.
 */
export interface CommandExecutionTelemetry {
  commandName: string;
  commandCategory: CommandCategory | "unknown";
  argsLength: number;
  success: boolean;
  trigger: CommandExecutionTrigger;
}

/**
 * Telemetry payload for user message submissions.
 */
export interface MessageSubmitTelemetry {
  messageLength: number;
  queued: boolean;
  fromInitialPrompt: boolean;
  hasFileMentions: boolean;
  hasAgentMentions: boolean;
}

/**
 * Props for the ChatApp component.
 */
export interface ChatAppProps {
  /** Initial messages to display */
  initialMessages?: ChatMessage[];
  /** Callback when user sends a message */
  onSendMessage?: (content: string) => void | Promise<void>;
  /** Callback for streaming message updates */
  onStreamMessage?: (
    content: string,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onMeta?: (meta: StreamingMeta) => void,
    options?: import("./commands/registry.ts").StreamMessageOptions
  ) => void | Promise<void>;
  /** Callback when user exits the chat */
  onExit?: () => void | Promise<void>;
  /** Callback to destroy and reset the current session (e.g., for /clear) */
  onResetSession?: () => void | Promise<void>;
  /**
   * Callback when user interrupts streaming (single Escape/Ctrl+C during streaming).
   * Called to abort the current operation. If not streaming, double press exits.
   */
  onInterrupt?: OnInterrupt;
  /** Callback when user confirms Ctrl+F background-agent termination. */
  onTerminateBackgroundAgents?: OnTerminateBackgroundAgents;
  /** Set the streaming state in the index.ts layer (for bridge streaming). */
  setStreamingState?: (isStreaming: boolean) => void;
  /** Placeholder text for input */
  placeholder?: string;
  /** Title for the chat window (deprecated, use header props instead) */
  title?: string;
  /** Optional syntax style for markdown rendering */
  syntaxStyle?: SyntaxStyle;
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
  /**
   * Register callback to receive tool start notifications.
   * Called with a function that should be invoked when a tool starts.
   */
  registerToolStartHandler?: (handler: OnToolStart) => void;
  /**
   * Register callback to receive tool complete notifications.
   * Called with a function that should be invoked when a tool completes.
   */
  registerToolCompleteHandler?: (handler: OnToolComplete) => void;
  /**
   * Register callback to receive skill invoked notifications.
   * Called with a function that should be invoked when the SDK loads a skill.
   */
  registerSkillInvokedHandler?: (handler: OnSkillInvoked) => void;
  /**
   * Register callback to receive permission/HITL requests.
   * Called with a function that should be invoked when permission is needed.
   */
  registerPermissionRequestHandler?: (handler: OnPermissionRequest) => void;
  /**
   * Register callback to receive Ctrl+C warning visibility changes.
   * Called with a function that sets whether to show the warning.
   */
  registerCtrlCWarningHandler?: (handler: (show: boolean) => void) => void;
  /**
   * Callback to get the current session for slash commands.
   * Returns null if no session is active yet.
   */
  getSession?: () => import("../sdk/types.ts").Session | null;
  /**
   * Register callback to receive AskUserQuestion events from askUserNode.
   * Called with a function that handles human_input_required signals from workflow graphs.
   */
  registerAskUserQuestionHandler?: (handler: OnAskUserQuestion) => void;
  /**
   * Callback to resume workflow execution with user's answer.
   * Called when the user responds to an askUserNode question in workflow mode.
   */
  onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
  /** The type of agent currently in use (claude, opencode, copilot) */
  agentType?: AgentType;
  /** Model operations interface for listing, setting, and resolving models */
  modelOps?: ModelOperations;
  /** Callback to get model display info from the SDK client */
  getModelDisplayInfo?: (modelHint?: string) => Promise<import("../sdk/types.ts").ModelDisplayInfo>;
  /** Parallel agents currently running (for tree view display) */
  parallelAgents?: ParallelAgent[];
  /** Register callback to receive parallel agent updates */
  registerParallelAgentHandler?: (handler: (agents: ParallelAgent[]) => void) => void;
  /**
   * Factory function to create independent sub-agent sessions.
   * Delegates to client.createSession() for context isolation.
   */
  createSubagentSession?: CreateSessionFn;
  /** Initial prompt to auto-submit on session start */
  initialPrompt?: string;
  /** Callback when the active model changes (via /model command or model selector) */
  onModelChange?: (model: string) => void;
  /** Callback to update MCP servers used by the next SDK session */
  onSessionMcpServersChange?: (servers: McpServerConfig[]) => void;
  /** Raw model ID from session config, used to seed currentModelRef */
  initialModelId?: string;
  /** Callback for slash command telemetry events */
  onCommandExecutionTelemetry?: (event: CommandExecutionTelemetry) => void;
  /** Callback for user message submission telemetry events */
  onMessageSubmitTelemetry?: (event: MessageSubmitTelemetry) => void;
}

/**
 * Internal state for the ChatApp component.
 * Tracks autocomplete, workflow execution, and approval states.
 */
export interface WorkflowChatState {
  // Autocomplete state
  /** Whether the autocomplete dropdown is visible */
  showAutocomplete: boolean;
  /** Current input text for autocomplete filtering (without leading "/") */
  autocompleteInput: string;
  /** Index of the currently selected suggestion in autocomplete */
  selectedSuggestionIndex: number;
  /** Hint text showing expected arguments for the current command */
  argumentHint: string;
  /** Whether autocomplete is for "/" commands or "@" mentions */
  autocompleteMode: "command" | "mention";
  /** Character offset where the current @ mention starts (for mid-text mentions) */
  mentionStartOffset: number;

  // Workflow execution state
  /** Whether a workflow is currently active */
  workflowActive: boolean;
  /** Type of the active workflow (e.g., "atomic") */
  workflowType: string | null;
  /** Initial prompt that started the workflow */
  initialPrompt: string | null;
  /** Current node being executed in the workflow */
  currentNode: string | null;
  /** Current iteration number (1-based) */
  iteration: number;
  /** Maximum number of iterations */
  maxIterations: number | undefined;
  /** Feature progress information */
  featureProgress: { completed: number; total: number; currentFeature?: string } | null;

  // Approval state for human-in-the-loop
  /** Whether waiting for user approval (spec approval, etc.) */
  pendingApproval: boolean;
  /** Whether the spec/item has been approved */
  specApproved: boolean;
  /** User feedback when rejecting (passed back to workflow) */
  feedback: string | null;
  /** Workflow-specific configuration (session ID, user prompt, workflow name, etc.) */
  workflowConfig?: {
    userPrompt: string | null;
    sessionId?: string;
    workflowName?: string;
  };
}

/**
 * Default workflow chat state values.
 */
export const defaultWorkflowChatState: WorkflowChatState = {
  // Autocomplete defaults
  showAutocomplete: false,
  autocompleteInput: "",
  selectedSuggestionIndex: 0,
  argumentHint: "",
  autocompleteMode: "command",
  mentionStartOffset: 0,

  // Workflow defaults
  workflowActive: false,
  workflowType: null,
  initialPrompt: null,
  currentNode: null,
  iteration: 0,
  maxIterations: undefined,
  featureProgress: null,

  // Approval defaults
  pendingApproval: false,
  specApproved: false,
  feedback: null,
};

/**
 * Props for the MessageBubble component.
 */
export interface MessageBubbleProps {
  /** The message to display */
  message: ChatMessage;
  /** Whether this is the last message in the list */
  isLast?: boolean;
  /** Optional syntax style for markdown rendering */
  syntaxStyle?: SyntaxStyle;
  /** Whether to hide AskUserQuestion tool output (when dialog is active) */
  hideAskUserQuestion?: boolean;
  /** Whether to hide loading indicator (when question dialog is active) */
  hideLoading?: boolean;
  /** Todo items to show inline during streaming */
  todoItems?: Array<{id?: string; content: string; status: "pending" | "in_progress" | "completed" | "error"; blockedBy?: string[]}>;
  /** Whether task items are expanded (no truncation) */
  tasksExpanded?: boolean;
  /** Whether task updates should be rendered inline for this message */
  inlineTasksEnabled?: boolean;
  /** Workflow session directory for persistent task list panel */
  workflowSessionDir?: string | null;
  /** Whether the todo/task panel is visible (Ctrl+T toggle) */
  showTodoPanel?: boolean;
  /** Elapsed streaming time in milliseconds */
  elapsedMs?: number;
  /** Whether the conversation is collapsed (shows compact single-line summaries) */
  collapsed?: boolean;
  /** Live streaming metadata (tokens, thinking duration) */
  streamingMeta?: StreamingMeta | null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a new chat message.
 */
export function createMessage(
  role: MessageRole,
  content: string,
  streaming?: boolean
): ChatMessage {
  const parts: Part[] | undefined = role === "assistant"
    ? (
      content
        ? [{
          id: createPartId(),
          type: "text" as const,
          content,
          isStreaming: Boolean(streaming),
          createdAt: new Date().toISOString(),
        }]
        : []
    )
    : undefined;

  return {
    id: generateMessageId(),
    role,
    content,
    timestamp: new Date().toISOString(),
    streaming,
    parts,
  };
}

/**
 * Finalize and remove a previous empty streaming assistant placeholder.
 */
export function reconcilePreviousStreamingPlaceholder(
  messages: ChatMessage[],
  previousStreamingId: string | null,
): ChatMessage[] {
  if (!previousStreamingId) return messages;

  return messages
    .map((msg) =>
      msg.id === previousStreamingId && msg.streaming
        ? { ...finalizeStreamingReasoningInMessage(msg), streaming: false }
        : msg
    )
    .filter((msg) => !(msg.id === previousStreamingId && !msg.content.trim()));
}

/**
 * Returns a command-specific spinner verb override when needed.
 */
export function getSpinnerVerbForCommand(commandName: string): string | undefined {
  return commandName === "compact" ? "Compacting" : undefined;
}

/**
 * Format timestamp for display.
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// DESIGN TOKENS - ATOMIC BRANDING (Muted Pink & Pale Blue Theme)
// ============================================================================

// ============================================================================
// DISPLAY CONSTANTS
// ============================================================================


// ============================================================================
// LOADING INDICATOR COMPONENT
// ============================================================================

// SPINNER_FRAMES imported from ./constants/icons.ts

// Re-export SPINNER_VERBS from constants for backward compatibility
export { SPINNER_VERBS } from "./constants/index.ts";
// Re-export getRandomVerb as getRandomSpinnerVerb for backward compatibility
export { getRandomVerb as getRandomSpinnerVerb } from "./constants/index.ts";

/**
 * Props for the LoadingIndicator component.
 */
interface LoadingIndicatorProps {
  /** Speed of animation in milliseconds per frame */
  speed?: number;
  /** Optional fixed verb override (falls back to random when omitted) */
  verbOverride?: string;
  /** Elapsed time in milliseconds (displays formatted duration after verb) */
  elapsedMs?: number;
  /** Estimated output tokens generated so far */
  outputTokens?: number;
  /** Thinking/reasoning duration in milliseconds */
  thinkingMs?: number;
}

/**
 * Format token count with k/M suffix (e.g., 16700 → "16.7k").
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

/**
 * Animated loading indicator matching Claude Code TUI style.
 * Single spinning character with a random verb and Unicode ellipsis.
 * Muted rose color for the spinner, gray for the verb text.
 *
 * Enhanced format: ⣾ Verb… (6m 22s · ↓ 16.7k tokens · thought for 54s)
 *
 * Returns span elements (not wrapped in text) so it can be composed
 * inside other text elements. Wrap in <text> when using standalone.
 */
export function LoadingIndicator({ speed = 100, verbOverride, elapsedMs, outputTokens, thinkingMs }: LoadingIndicatorProps): React.ReactNode {
  const themeColors = useThemeColors();
  const [frameIndex, setFrameIndex] = useState(0);
  // Select random verb only on mount (empty dependency array)
  const [verb] = useState(() => verbOverride ?? getRandomVerb());

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, speed);

    return () => clearInterval(interval);
  }, [speed]);

  const spinChar = SPINNER_FRAMES[frameIndex] as string;

  // Build info parts separated by " · "
  const parts: string[] = [];
  if (elapsedMs != null && elapsedMs > 0) {
    parts.push(formatDuration(elapsedMs).text);
  }
  if (outputTokens != null && outputTokens > 0) {
    parts.push(`${ARROW.down} ${formatTokenCount(outputTokens)} tokens`);
  }
  if (thinkingMs != null && thinkingMs >= 1000) {
    parts.push(`thought for ${formatCompletionDuration(thinkingMs)}`);
  }
  const infoText = parts.length > 0 ? ` (${parts.join(` ${MISC.separator} `)})` : "";

  return (
    <>
      <span style={{ fg: themeColors.accent }}>{spinChar} </span>
      <span style={{ fg: themeColors.accent }}>{verb}…</span>
      {infoText && (
        <span style={{ fg: themeColors.muted }}>{infoText}</span>
      )}
    </>
  );
}

// ============================================================================
// COMPLETION SUMMARY COMPONENT
// ============================================================================

/**
 * Completion character — full braille block, consistent with the streaming spinner frames.
 */
function getCompletionChar(): string {
  return SPINNER_COMPLETE;
}

/**
 * Format milliseconds into a human-readable duration string using floor (whole-second increments).
 * e.g., 66000 → "1m 6s", 3000 → "3s", 1500 → "1s"
 */
function formatCompletionDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds <= 0) return "1s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

interface CompletionSummaryProps {
  /** Duration in milliseconds */
  durationMs: number;
  /** Output tokens used */
  outputTokens?: number;
  /** Thinking/reasoning duration in milliseconds */
  thinkingMs?: number;
}

/**
 * Completion summary line shown after an assistant response finishes.
 * Enhanced format: "⣿ Worked for 1m 6s · ↓ 16.7k tokens · thought for 54s"
 */
export function CompletionSummary({ durationMs, outputTokens, thinkingMs }: CompletionSummaryProps): React.ReactNode {
  const themeColors = useThemeColors();
  const [verb] = useState(() => getRandomCompletionVerb());
  const [spinChar] = useState(() => getCompletionChar());

  const parts: string[] = [`${verb} for ${formatCompletionDuration(durationMs)}`];
  if (outputTokens != null && outputTokens > 0) {
    parts.push(`${ARROW.down} ${formatTokenCount(outputTokens)} tokens`);
  }
  if (thinkingMs != null && thinkingMs >= 1000) {
    parts.push(`thought for ${formatCompletionDuration(thinkingMs)}`);
  }

  return (
    <box flexDirection="row">
      <text style={{ fg: themeColors.muted }}>
        <span style={{ fg: themeColors.accent }}>{spinChar} </span>
        <span>{parts.join(` ${MISC.separator} `)}</span>
      </text>
    </box>
  );
}

// ============================================================================
// STREAMING BULLET PREFIX COMPONENT
// ============================================================================

/**
 * Animated blinking ● prefix for text that is currently streaming.
 * Alternates between ● and · to simulate a blink (like tool-result's AnimatedStatusIndicator).
 * Once streaming is done, the parent renders a static colored ● instead.
 * Returns a <span> so it can be embedded inline within a <text> element.
 */
export function StreamingBullet({ speed = 500 }: { speed?: number }): React.ReactNode {
  const themeColors = useThemeColors();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, speed);
    return () => clearInterval(interval);
  }, [speed]);

  return <span style={{ fg: themeColors.accent }}>{visible ? STATUS.active : MISC.separator} </span>;
}

const HLREF_COMMAND = 1;
const HLREF_MENTION = 2;


/** Convert a JS string index to a highlight offset by subtracting newline characters,
 *  since addHighlightByCharRange expects display-width offsets excluding newlines. */
function toHighlightOffset(text: string, index: number): number {
  let newlineCount = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") newlineCount++;
  }
  return index - newlineCount;
}

/**
 * Check if the text starts with a registered slash command (not inside quotes/backticks).
 * Returns [start, end] character offset pair if found, or null.
 */
function findSlashCommandRange(text: string): [number, number] | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return null;

  const leadingWhitespace = text.length - trimmed.length;

  // Not a command if wrapped in quotes or backticks
  if (leadingWhitespace > 0) {
    const charBefore = text[leadingWhitespace - 1];
    if (charBefore === '"' || charBefore === "'" || charBefore === '`') return null;
  }

  // Extract the command name (word chars and hyphens after "/")
  let i = 1;
  while (i < trimmed.length && /[\w-]/.test(trimmed[i]!)) i++;
  if (i <= 1) return null;

  const name = trimmed.slice(1, i);

  // Must be followed by whitespace or end of string (isolated token)
  if (i < trimmed.length && !/\s/.test(trimmed[i]!)) return null;

  // Check the character after the command token isn't a closing quote/backtick
  if (i < trimmed.length) {
    const charAfter = trimmed[i];
    if (charAfter === '"' || charAfter === "'" || charAfter === '`') return null;
  }

  if (!globalRegistry.has(name)) return null;

  return [leadingWhitespace, leadingWhitespace + i];
}

interface InputScrollbarState {
  visible: boolean;
  viewportHeight: number;
  thumbTop: number;
  thumbSize: number;
}

// ============================================================================
// ATOMIC HEADER COMPONENT
// ============================================================================

/**
 * Renders the Atomic header with gradient block letter logo and app info.
 *
 * Clean, minimal layout:
 * - Block letter "ATOMIC" logo with coral→pink gradient
 * - Version, model info, and working directory on right
 */
export function AtomicHeader({
  version = "0.1.0",
  model = "",
  tier = "",
  workingDir = "~/",
}: AtomicHeaderProps): React.ReactNode {
  const { theme } = useTheme();
  const { width: terminalWidth } = useTerminalDimensions();
  const gradient = useMemo(() => buildAtomicGradient(theme.isDark), [theme.isDark]);

  // Hide block logo when terminal width is too narrow to prevent layout breakage
  const showBlockLogo = terminalWidth >= 70;

  return (
    <box flexDirection="row" alignItems="flex-start" marginBottom={SPACING.ELEMENT} marginLeft={SPACING.CONTAINER_PAD} flexShrink={0}>
      {/* Block letter logo with gradient - hidden on narrow terminals */}
      {showBlockLogo && (
        <box flexDirection="column" marginRight={SPACING.GUTTER}>
          {ATOMIC_BLOCK_LOGO.map((line, i) => (
            <GradientText key={i} text={line} gradient={gradient} />
          ))}
        </box>
      )}

      {/* App info */}
      <box flexDirection="column" paddingTop={SPACING.NONE}>
        {/* Version line */}
        <text>
          <span style={{ fg: theme.colors.foreground }}>v{version}</span>
        </text>

        {/* Model info line */}
        <text style={{ fg: theme.colors.muted }}>
          {model} {MISC.separator} {tier}
        </text>

        {/* Working directory line */}
        <text style={{ fg: theme.colors.muted }}>{workingDir}</text>
      </box>
    </box>
  );
}

// ============================================================================
// MESSAGE BUBBLE COMPONENT
// ============================================================================

/**
 * Renders a single chat message with role-based styling.
 * Clean, minimal design matching the reference UI:
 * - User messages: highlighted inline box with just the text
 * - Assistant messages: parts-based content rendering
 */
function getRenderableAssistantParts(
  message: ChatMessage,
  taskItemsToShow: TaskItem[] | undefined,
  inlineTaskExpansion: boolean | undefined,
  isLastMessage: boolean,
  hideAskUserQuestion: boolean,
): Part[] {
  let parts = [...(message.parts ?? [])];

  // Keep ToolPart state synchronized with the source toolCalls array.
  parts = syncToolCallsIntoParts(parts, message.toolCalls ?? [], message.timestamp, message.id);

  // Only merge parallel agents into parts if agent parts don't already exist.
  // During streaming, agents are already added to parts via applyStreamPartEvent.
  // This check prevents duplicate agent trees from being rendered.
  if (message.parallelAgents && message.parallelAgents.length > 0) {
    const hasExistingAgentParts = parts.some((part) => part.type === "agent");
    if (!hasExistingAgentParts) {
      parts = mergeParallelAgentsIntoParts(
        parts,
        message.parallelAgents,
        message.timestamp,
        shouldGroupSubagentTrees(message, isLastMessage),
      );
    }
  }

  const shouldRenderInlineTasks = taskItemsToShow && taskItemsToShow.length > 0 && inlineTaskExpansion !== false;
  const existingTaskIdx = parts.findIndex((p) => p.type === "task-list");
  if (shouldRenderInlineTasks) {
    const sortedTaskItems = sortTasksTopologically(taskItemsToShow!);
    const taskPart: TaskListPart = {
      id: existingTaskIdx >= 0 ? parts[existingTaskIdx]!.id : `task-list-${message.id}`,
      type: "task-list",
      items: sortedTaskItems,
      expanded: inlineTaskExpansion ?? false,
      createdAt: existingTaskIdx >= 0 ? parts[existingTaskIdx]!.createdAt : message.timestamp,
    };
    if (existingTaskIdx >= 0) {
      parts[existingTaskIdx] = taskPart;
    } else {
      parts.push(taskPart);
    }
  } else if (existingTaskIdx >= 0) {
    parts.splice(existingTaskIdx, 1);
  }

  if (message.mcpSnapshot) {
    const existingMcpIdx = parts.findIndex((p) => p.type === "mcp-snapshot");
    const mcpPart: McpSnapshotPart = {
      id: existingMcpIdx >= 0 ? parts[existingMcpIdx]!.id : `mcp-${message.id}`,
      type: "mcp-snapshot",
      snapshot: message.mcpSnapshot,
      createdAt: existingMcpIdx >= 0 ? parts[existingMcpIdx]!.createdAt : message.timestamp,
    };
    if (existingMcpIdx >= 0) {
      parts[existingMcpIdx] = mcpPart;
    } else {
      parts.unshift(mcpPart);
    }
  }

  if (message.skillLoads && message.skillLoads.length > 0) {
    const existingSkillIdx = parts.findIndex((p) => p.type === "skill-load");
    const skillPart: SkillLoadPart = {
      id: existingSkillIdx >= 0 ? parts[existingSkillIdx]!.id : `skill-load-${message.id}`,
      type: "skill-load",
      skills: message.skillLoads,
      createdAt: existingSkillIdx >= 0 ? parts[existingSkillIdx]!.createdAt : message.timestamp,
    };
    if (existingSkillIdx >= 0) {
      parts[existingSkillIdx] = skillPart;
    } else {
      // Insert before text/tool parts but after mcp-snapshot
      const insertIndex = parts.findIndex(
        (p) => p.type !== "mcp-snapshot"
      );
      if (insertIndex === -1) {
        parts.push(skillPart);
      } else {
        parts.splice(insertIndex, 0, skillPart);
      }
    }
  }

  // Detect compaction summary messages (created by appendCompactionSummary)
  if (message.id.startsWith("compact_")) {
    const existingCompactionIdx = parts.findIndex((p) => p.type === "compaction");
    const compactionPart: CompactionPart = {
      id: existingCompactionIdx >= 0 ? parts[existingCompactionIdx]!.id : `compaction-${message.id}`,
      type: "compaction",
      summary: message.content,
      createdAt: existingCompactionIdx >= 0 ? parts[existingCompactionIdx]!.createdAt : message.timestamp,
    };
    if (existingCompactionIdx >= 0) {
      parts[existingCompactionIdx] = compactionPart;
    } else {
      parts.unshift(compactionPart);
    }
    return parts;
  }

  const hasTextPart = parts.some((p) => p.type === "text");
  if (!hasTextPart && message.content.trim()) {
    const textPart: TextPart = {
      id: `text-${message.id}`,
      type: "text",
      content: message.content,
      isStreaming: Boolean(message.streaming),
      createdAt: message.timestamp,
    };
    const insertIndex = parts.findIndex(
      (p) => p.type !== "mcp-snapshot"
    );
    if (insertIndex === -1) {
      parts.push(textPart);
    } else {
      parts.splice(insertIndex, 0, textPart);
    }
  }

  if (hideAskUserQuestion) {
    parts = parts.filter((part) => {
      if (part.type !== "tool") return true;
      const toolPart = part as ToolPart;
      const isHitlTool = toolPart.toolName === "AskUserQuestion"
        || toolPart.toolName === "question"
        || toolPart.toolName === "ask_user";
      return !(isHitlTool && toolPart.pendingQuestion);
    });
  }

  return parts;
}
export function MessageBubble({ message, isLast, syntaxStyle, hideAskUserQuestion = false, hideLoading = false, todoItems, tasksExpanded = false, inlineTasksEnabled = true, workflowSessionDir, showTodoPanel = true, elapsedMs, collapsed = false, streamingMeta }: MessageBubbleProps): React.ReactNode {
  const themeColors = useThemeColors();

  // Collapsed mode: show compact single-line summary for each message
  // Spacing: user messages sit tight above their reply; assistant messages
  // get a bottom margin to visually separate conversation pairs.
  if (collapsed && !message.streaming) {
    const truncate = (text: string, maxLen: number) => {
      const firstLine = text.split("\n").find(l => l.trim())?.trim() ?? "";
      return firstLine.length > maxLen ? firstLine.slice(0, maxLen) + "…" : firstLine;
    };

    if (message.role === "user") {
      return (
        <box paddingLeft={SPACING.CONTAINER_PAD} paddingRight={SPACING.CONTAINER_PAD} marginBottom={SPACING.NONE}>
          <text wrapMode="char" selectable>
            <span style={{ fg: themeColors.dim }}>{PROMPT.cursor} </span>
            <span style={{ fg: themeColors.muted }}>{truncate(message.content, 78)}</span>
          </text>
        </box>
      );
    }

    if (message.role === "assistant") {
      const toolCount = message.toolCalls?.length ?? 0;
      const toolLabel = toolCount > 0
        ? ` ${MISC.separator} ${toolCount} tool${toolCount !== 1 ? "s" : ""}`
        : "";
      return (
        <box paddingLeft={SPACING.CONTAINER_PAD} paddingRight={SPACING.CONTAINER_PAD} marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}>
          <text wrapMode="char">
            <span style={{ fg: themeColors.dim }}>  {CONNECTOR.subStatus} </span>
            <span style={{ fg: themeColors.muted }}>{truncate(message.content, 74)}</span>
            <span style={{ fg: themeColors.dim }}>{toolLabel}</span>
          </text>
        </box>
      );
    }

    // System message collapsed
    return (
      <box paddingLeft={SPACING.CONTAINER_PAD} paddingRight={SPACING.CONTAINER_PAD} marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}>
        <text wrapMode="char" style={{ fg: themeColors.error }}>{truncate(message.content, 80)}</text>
      </box>
    );
  }

  // User message: highlighted inline box with just the text (no header/timestamp)
  if (message.role === "user") {
    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
        paddingLeft={SPACING.CONTAINER_PAD}
        paddingRight={SPACING.CONTAINER_PAD}
      >
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          <text wrapMode="char">
            <span style={{ fg: themeColors.accent }}>{PROMPT.cursor} </span>
            <span style={{ bg: themeColors.userBubbleBg, fg: themeColors.userBubbleFg }}> {message.content} </span>
          </text>
        </box>

        {/* Workflow persistent task list - also shown after user messages */}
        {isLast && workflowSessionDir && showTodoPanel && (
          <TaskListPanel
            sessionDir={workflowSessionDir}
            expanded={tasksExpanded}
          />
        )}
      </box>
    );
  }

  // Assistant message: parts-based rendering only
  if (message.role === "assistant") {
    const shouldRenderInlineTasks = inlineTasksEnabled && !message.tasksPinned;
    const taskItemsToShow = shouldRenderInlineTasks
      ? (message.streaming ? todoItems : message.taskItems)
      : undefined;
    const inlineTaskExpansion = shouldRenderInlineTasks ? (tasksExpanded || undefined) : false;
    const renderableMessage = {
      ...message,
      parts: getRenderableAssistantParts(
        message,
        taskItemsToShow,
        inlineTaskExpansion,
        Boolean(isLast),
        hideAskUserQuestion,
      ),
    };

    // Detect active background agents on this message
    const hasActiveBackgroundAgents = getActiveBackgroundAgents(message.parallelAgents ?? []).length > 0;
    const liveTaskItems = message.streaming ? todoItems : message.taskItems;
    const showLoadingIndicator = shouldShowMessageLoadingIndicator(message, liveTaskItems);

    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
        paddingLeft={SPACING.CONTAINER_PAD}
        paddingRight={SPACING.CONTAINER_PAD}
      >
        <MessageBubbleParts message={renderableMessage} syntaxStyle={syntaxStyle} />

        {/* Workflow persistent task list - pinned above streaming text in last message */}
        {isLast && workflowSessionDir && showTodoPanel && (
          <TaskListPanel
            sessionDir={workflowSessionDir}
            expanded={tasksExpanded}
          />
        )}

        {/* Loading spinner while work is active (stops once task progress is fully complete). */}
        {showLoadingIndicator && !hideLoading && (
          <box flexDirection="row" alignItems="flex-start" marginTop={renderableMessage.parts.length > 0 ? SPACING.ELEMENT : SPACING.NONE}>
            <text>
              <LoadingIndicator
                speed={120}
                verbOverride={message.spinnerVerb}
                elapsedMs={elapsedMs}
                outputTokens={streamingMeta?.outputTokens}
                thinkingMs={streamingMeta?.thinkingMs}
              />
            </text>
          </box>
        )}

        {/* Completion summary: shown when all work is done and duration is meaningful */}
        {shouldShowCompletionSummary(message, hasActiveBackgroundAgents) && (
          <box marginTop={SPACING.ELEMENT}>
            <CompletionSummary durationMs={message.durationMs!} outputTokens={message.outputTokens} thinkingMs={message.thinkingMs} />
          </box>
        )}

      </box>
    );
  }

  // System message: inline red text (no separate header/modal)
  return (
    <box
      flexDirection="column"
      marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
      paddingLeft={SPACING.CONTAINER_PAD}
      paddingRight={SPACING.CONTAINER_PAD}
    >
      <text wrapMode="char" style={{ fg: themeColors.error }}>{message.content}</text>
    </box>
  );
}

// ============================================================================
// CHAT APP COMPONENT
// ============================================================================

/**
 * Main chat application component.
 *
 * Features:
 * - Scrollable message history with sticky scroll to bottom
 * - Text input for sending messages
 * - Keyboard shortcuts (ESC, Ctrl+C) to exit
 * - Message streaming support
 *
 * @example
 * ```tsx
 * <ChatApp
 *   onSendMessage={(content) => console.log("Sent:", content)}
 *   onExit={() => console.log("Exiting")}
 * />
 * ```
 */
export function ChatApp({
  initialMessages = [],
  onSendMessage,
  onStreamMessage,
  onExit,
  onResetSession,
  onInterrupt,
  onTerminateBackgroundAgents,
  setStreamingState,
  placeholder: _placeholder = "Type a message...",
  title: _title,
  syntaxStyle: _syntaxStyle,
  version = "0.1.0",
  model = "",
  tier = "",
  workingDir = "~/",
  suggestion: _suggestion,
  registerToolStartHandler,
  registerToolCompleteHandler,
  registerSkillInvokedHandler,
  registerPermissionRequestHandler,
  registerCtrlCWarningHandler,
  getSession,
  registerAskUserQuestionHandler,
  onWorkflowResumeWithAnswer,
  agentType,
  modelOps,
  getModelDisplayInfo,
  parallelAgents: initialParallelAgents = [],
  registerParallelAgentHandler,
  createSubagentSession,
  initialPrompt,
  onModelChange,
  onSessionMcpServersChange,
  initialModelId,
  onCommandExecutionTelemetry,
  onMessageSubmitTelemetry,
}: ChatAppProps): React.ReactNode {
  // title and suggestion are deprecated, kept for backwards compatibility
  void _title;
  void _suggestion;

  // Core message state
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingElapsedMs, setStreamingElapsedMs] = useState(0);
  const [streamingMeta, setStreamingMeta] = useState<StreamingMeta | null>(null);
  const [inputFocused] = useState(true);

  // Workflow chat state (autocomplete, workflow execution, approval)
  const [workflowState, setWorkflowState] = useState<WorkflowChatState>(defaultWorkflowChatState);

  // Interrupt counter for double-press exit (unified for Escape and Ctrl+C)
  // OpenCode behavior: single press interrupts streaming, double press exits when idle
  const [interruptCount, setInterruptCount] = useState(0);
  const interruptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+F confirmation state for terminating active background agents.
  const [backgroundTerminationCount, setBackgroundTerminationCount] = useState(0);
  const [ctrlFPressed, setCtrlFPressed] = useState(false);
  const backgroundTerminationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundTerminationInFlightRef = useRef(false);
  const clearBackgroundTerminationConfirmation = useCallback(() => {
    setBackgroundTerminationCount(0);
    setCtrlFPressed(false);
    if (backgroundTerminationTimeoutRef.current) {
      clearTimeout(backgroundTerminationTimeoutRef.current);
      backgroundTerminationTimeoutRef.current = null;
    }
  }, []);

  // Separate state for showing Ctrl+C warning (controlled by parent via signal handler)
  const [ctrlCPressed, setCtrlCPressed] = useState(false);
  const ctrlCTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Renderer ref for copy-on-selection (OpenTUI Selection API)
  const renderer = useRenderer();

  // Copy-on-selection: auto-copy selected text to clipboard on mouse release
  // Keep selection visible so user can also use Ctrl+C / Ctrl+Shift+C to copy
  const handleMouseUp = useCallback(() => {
    try {
      const selection = renderer.getSelection();
      if (selection) {
        const selectedText = selection.getSelectedText();
        if (selectedText) {
          // Type assertion for method that exists at runtime but not in type definitions
          (renderer as unknown as { copyToClipboardOSC52: (text: string) => void }).copyToClipboardOSC52(selectedText);
        }
      }
    } catch {
      // Ignore errors from mouse selection — can occur when renderables are in a transitional state
    }
  }, [renderer]);

  // Streaming state hook for tool executions and pending questions
  const streamingState = useStreamingState();

  // Message queue for queuing messages during streaming
  const messageQueue = useMessageQueue();

  // Transcript mode: full-screen detailed transcript view (ctrl+o toggle)
  const [transcriptMode, setTranscriptMode] = useState(false);


  // State for showing user question dialog
  const [activeQuestion, setActiveQuestion] = useState<UserQuestion | null>(null);

  // State for showing model selector dialog
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string | undefined>(undefined);
  // Store the display name separately to match what's shown in the selector dropdown
  const [currentModelDisplayName, setCurrentModelDisplayName] = useState<string | undefined>(undefined);
  const [mcpServerToggles, setMcpServerToggles] = useState<McpServerToggleMap>({});

  // Compute display model name reactively
  // Uses stored display name when available, falls back to initial model prop
  const displayModel = useMemo(() => {
    if (currentModelDisplayName) {
      return currentModelDisplayName;
    }
    return model; // Fallback to initial prop
  }, [currentModelDisplayName, model]);

  // Track the effective model ID in a ref so closures always see the latest value.
  // Prefer initialModelId (raw SDK model ID from session config) over model (display name)
  // so that getModelDisplayInfo receives an actual model ID, not a display name like "claude-sonnet-4.5 (medium)".
  const currentModelRef = useRef(initialModelId ?? model);
  useEffect(() => {
    currentModelRef.current = currentModelId ?? initialModelId ?? model;
  }, [currentModelId, initialModelId, model]);

  // State for queue editing mode
  const [isEditingQueue, setIsEditingQueue] = useState(false);

  // Theme context for /theme command
  const { theme, toggleTheme, setTheme } = useTheme();
  const themeColors = theme.colors;

  // Component-scoped SyntaxStyle for textarea slash command and @ mention highlighting
  const inputSyntaxStyleRef = useRef<SyntaxStyle | null>(null);
  const commandStyleIdRef = useRef<number>(0);
  const mentionStyleIdRef = useRef<number>(0);
  const inputSyntaxStyle = useMemo(() => {
    if (inputSyntaxStyleRef.current) {
      inputSyntaxStyleRef.current.destroy();
    }
    const style = SyntaxStyle.create();
    const cmdId = style.registerStyle("command", {
      fg: RGBA.fromHex(themeColors.accent),
      bold: true,
    });
    const mentionId = style.registerStyle("mention", {
      fg: RGBA.fromHex(themeColors.accent),
      bold: false,
      underline: false,
    });
    inputSyntaxStyleRef.current = style;
    commandStyleIdRef.current = cmdId;
    mentionStyleIdRef.current = mentionId;
    return style;
  }, [themeColors.accent]);

  // Create theme-aware markdown syntax style - activates <markdown> rendering for assistant messages
  const markdownSyntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(theme.colors, theme.isDark),
    [theme]
  );

  // State for parallel agents display
  const [parallelAgents, setParallelAgents] = useState<ParallelAgent[]>(initialParallelAgents);
  // Compaction state: stores summary text after /compact for Ctrl+O history
  const [compactionSummary, setCompactionSummary] = useState<string | null>(null);
  const [showCompactionHistory, setShowCompactionHistory] = useState(false);
  const [autoCompactionIndicator, setAutoCompactionIndicator] = useState<AutoCompactionIndicatorState>(
    AUTO_COMPACTION_INDICATOR_IDLE_STATE
  );
  const autoCompactionIndicatorRef = useRef<AutoCompactionIndicatorState>(
    AUTO_COMPACTION_INDICATOR_IDLE_STATE
  );
  const autoCompactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // TodoWrite persistent state
  const [todoItems, setTodoItems] = useState<NormalizedTodoItem[]>([]);
  const todoItemsRef = useRef<NormalizedTodoItem[]>([]);
  // Accumulates the raw text content from the current streaming response (for parsing step 1 output)
  const lastStreamingContentRef = useRef<string>("");
  // Resolver for streamAndWait: when set, handleComplete resolves the Promise instead of processing the queue
  const streamCompletionResolverRef = useRef<((result: import("./commands/registry.ts").StreamResult) => void) | null>(null);
  // Resolver for waitForUserInput: when set, handleSubmit resolves the Promise with the user's prompt
  const waitForUserInputResolverRef = useRef<{ resolve: (prompt: string) => void; reject: (reason: Error) => void } | null>(null);
  // When true, streaming chunks are accumulated but NOT rendered in the assistant message (for hidden workflow steps)
  const hideStreamContentRef = useRef(false);
  const [showTodoPanel, setShowTodoPanel] = useState(true);
  // Whether task list items are expanded (full content, no truncation)
  const [tasksExpanded, _setTasksExpanded] = useState(false);
  // Workflow persistent task list
  const [workflowSessionDir, setWorkflowSessionDir] = useState<string | null>(null);
  const workflowSessionDirRef = useRef<string | null>(null);
  const [workflowSessionId, setWorkflowSessionId] = useState<string | null>(null);
  const workflowSessionIdRef = useRef<string | null>(null);
  // Known workflow task IDs from the planning phase.
  // Used to guard TodoWrite persistence: only updates whose items match
  // these IDs are written to tasks.json, preventing sub-agent overwrites.
  const workflowTaskIdsRef = useRef<Set<string>>(new Set());
  // Tracks started tool names by toolCallId so completion handlers can
  // safely identify TodoWrite payloads (and ignore unrelated `input.todos`).
  const toolNameByIdRef = useRef<Map<string, string>>(new Map());
  // State for input textarea scrollbar (shown only when input overflows)
  const [inputScrollbar, setInputScrollbar] = useState<InputScrollbarState>({
    visible: false,
    viewportHeight: 1,
    thumbTop: 0,
    thumbSize: 1,
  });

  // Prompt history for up/down arrow navigation
  const [_promptHistory, setPromptHistory] = useState<string[]>([]);
  const promptHistoryRef = useRef<string[]>([]);
  const [_historyIndex, setHistoryIndex] = useState(-1);
  // Synchronous mirror — multiple key events may arrive in a single stdin
  // read (OpenTUI dispatches in a tight loop), so React state can be stale.
  const historyIndexRef = useRef(-1);
  // Store current input when entering history mode
  const savedInputRef = useRef<string>("");
  // Suppress handleInputChange from resetting historyIndex during programmatic navigation
  const historyNavigatingRef = useRef(false);

  // Load persisted command history on mount
  useEffect(() => {
    const persisted = loadCommandHistory();
    if (persisted.length > 0) {
      promptHistoryRef.current = persisted;
      setPromptHistory(persisted);
    }
  }, []);

  // Refs for streaming message updates
  const streamingMessageIdRef = useRef<string | null>(null);
  // Ref to track message ID for background agent updates after stream ends
  const backgroundAgentMessageIdRef = useRef<string | null>(null);
  // Ref to track when streaming started for duration calculation
  const streamingStartRef = useRef<number | null>(null);
  // Ref to track streaming state synchronously (for immediate check in handleSubmit)
  // This avoids race conditions where React state hasn't updated yet
  const isStreamingRef = useRef(false);
  // Ref to keep a synchronous copy of streaming meta for baking into message on completion
  const streamingMetaRef = useRef<StreamingMeta | null>(null);
  // Source keys closed by stream finalize/interrupt/error.
  // Used to drop late thinking events that arrive after stream teardown.
  const closedThinkingSourcesRef = useRef<Set<string>>(new Set());
  // Cumulative drop counters for rejected thinking-meta events.
  const thinkingDropDiagnosticsRef = useRef<ThinkingDropDiagnostics>(createThinkingDropDiagnostics());
  // Ref to track whether an interrupt (ESC/Ctrl+C) already finalized agents.
  // Prevents handleComplete from overwriting interrupted agents with "completed".
  const wasInterruptedRef = useRef(false);
  // Ref to keep a synchronous copy of parallel agents (avoids nested dispatch issues)
  const parallelAgentsRef = useRef<ParallelAgent[]>([]);
  const workflowSdkRef = useRef<WorkflowSDK | null>(null);
  const subagentBridgeRef = useRef<SubagentGraphBridge | null>(null);
  // Ref to hold a deferred handleComplete when sub-agents are still running.
  // When the last agent finishes, the stored function is called to finalize
  // the message and process the next queued message.
  const pendingCompleteRef = useRef<(() => void) | null>(null);
  // Small grace timer before running deferred completion. If new chunks arrive,
  // we cancel this timer so the main stream can continue after sub-agent handoff.
  const deferredCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the current stream is an @mention-only stream (no SDK onComplete).
  // Prevents the agent-only completion path from firing for SDK-spawned sub-agents.
  const isAgentOnlyStreamRef = useRef(false);
  // Stream generation counter — incremented each time a new stream starts.
  // handleComplete closures capture the generation at creation time and skip
  // if it no longer matches, preventing stale callbacks from corrupting a
  // newer stream's state (e.g., after round-robin injection).
  const streamGenerationRef = useRef(0);
  // Ref to track whether any tool call is currently running (synchronous check
  // for keyboard handler to avoid stale closure issues with React state).
  const hasRunningToolRef = useRef(false);
  // Set of blocking tool IDs currently running in this stream.
  // Skill-loading tools are intentionally excluded because some SDKs do not
  // emit a matching complete event for them.
  const runningBlockingToolIdsRef = useRef<Set<string>>(new Set());
  // Track active ask_question tools so Enter can defer submit without clearing input.
  const runningAskQuestionToolIdsRef = useRef<Set<string>>(new Set());
  // Counter to trigger effect when tools complete (used for deferred completion logic)
  const [toolCompletionVersion, setToolCompletionVersion] = useState(0);
  // Incremented when message-window overflow eviction happens.
  // Tracks which skills have been loaded in the current session to avoid duplicate indicators.
  const loadedSkillsRef = useRef<Set<string>>(new Set());
  // Ref for scrollbox to enable programmatic scrolling
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);
  // Ref for deferred queue dispatch without circular callback deps
  const dispatchQueuedMessageRef = useRef<(queuedMessage: QueuedMessage) => void>(() => {});

  const clearDeferredCompletion = useCallback(() => {
    pendingCompleteRef.current = null;
    if (deferredCompleteTimeoutRef.current) {
      clearTimeout(deferredCompleteTimeoutRef.current);
      deferredCompleteTimeoutRef.current = null;
    }
  }, []);

  const resetThinkingSourceTracking = useCallback(() => {
    closedThinkingSourcesRef.current = new Set();
    streamingMetaRef.current = null;
    setStreamingMeta(null);
  }, []);

  const finalizeThinkingSourceTracking = useCallback(() => {
    const previousClosedSources = closedThinkingSourcesRef.current;
    const mergedClosedSources = mergeClosedThinkingSources(
      previousClosedSources,
      streamingMetaRef.current,
    );
    for (const sourceKey of mergedClosedSources) {
      if (!previousClosedSources.has(sourceKey)) {
        traceThinkingSourceLifecycle("finalize", sourceKey, "chat stream teardown");
      }
    }
    closedThinkingSourcesRef.current = mergedClosedSources;
    streamingMetaRef.current = null;
    setStreamingMeta(null);
  }, []);

  /**
   * Helper function to separate and interrupt agents.
   * Ctrl+C should ONLY interrupt foreground agents, preserving background agents.
   * Returns { interruptedAgents: all agents with foreground ones marked as interrupted,
   *           remainingLiveAgents: only background agents that should stay in refs }
   */
  const separateAndInterruptAgents = useCallback((agents: ParallelAgent[]) => {
    const backgroundAgents = agents.filter(isBackgroundAgent);
    const foregroundAgents = agents.filter(a => !isBackgroundAgent(a));
    
    // Only interrupt foreground agents
    const interruptedAgents = [
      ...foregroundAgents.map((a) =>
        a.status === "running" || a.status === "pending"
          ? { ...a, status: "interrupted" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
          : a
      ),
      // Keep background agents as-is
      ...backgroundAgents,
    ];
    
    return {
      interruptedAgents,
      remainingLiveAgents: backgroundAgents,
    };
  }, []);

  const continueQueuedConversation = useCallback(() => {
    dispatchNextQueuedMessage<QueuedMessage>(
      () => messageQueue.dequeue(),
      (queuedMessage: QueuedMessage) => {
        dispatchQueuedMessageRef.current(queuedMessage);
      },
      {
        shouldDispatch: () => shouldDispatchQueuedMessage({
          isStreaming: isStreamingRef.current,
          runningAskQuestionToolCount: runningAskQuestionToolIdsRef.current.size,
        }),
      },
    );
  }, [messageQueue]);

  // Create macOS-style scroll acceleration for smooth mouse wheel scrolling
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel(), []);

  /**
   * Update chat messages. Alias for setMessages kept to minimise call-site churn.
   */
  const setMessagesWindowed = useCallback((next: React.SetStateAction<ChatMessage[]>) => {
    setMessages(next);
  }, []);

  // Process a background agent completion by updating the baked message directly.
  // Follows the queued-message pattern: arrive asynchronously, dispatch immediately.
  const applyBackgroundAgentUpdate = useCallback((messageId: string, agents: ParallelAgent[]) => {
    setMessagesWindowed((prev: ChatMessage[]) =>
      prev.map((msg: ChatMessage, index: number) =>
        msg.id === messageId
          ? applyStreamPartEvent(msg, {
              type: "parallel-agents",
              agents,
              isLastMessage: index === prev.length - 1,
            })
          : msg
      )
    );
    // Clean up when all background agents reach terminal state
    if (getActiveBackgroundAgents(agents).length === 0) {
      backgroundAgentMessageIdRef.current = null;
      streamingStartRef.current = null;
    }
  }, [setMessagesWindowed]);

  const applyBackgroundAgentUpdateRef = useRef(applyBackgroundAgentUpdate);
  applyBackgroundAgentUpdateRef.current = applyBackgroundAgentUpdate;

  const hasLiveLoadingIndicator = useMemo(
    () => hasAnyLiveLoadingIndicator(messages, todoItems),
    [messages, todoItems],
  );

  // Live elapsed time counter for the visible loading indicator.
  useEffect(() => {
    if (!hasLiveLoadingIndicator || !streamingStartRef.current) {
      setStreamingElapsedMs(0);
      return;
    }
    setStreamingElapsedMs(Math.floor((Date.now() - streamingStartRef.current) / 1000) * 1000);
    const interval = setInterval(() => {
      if (streamingStartRef.current) {
        setStreamingElapsedMs(Math.floor((Date.now() - streamingStartRef.current) / 1000) * 1000);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hasLiveLoadingIndicator]);

  // Keep todoItemsRef in sync with state for use in completion callbacks
  useEffect(() => {
    todoItemsRef.current = todoItems;
  }, [todoItems]);

  // Keep parallelAgentsRef synchronized with local state updates.
  useEffect(() => {
    parallelAgentsRef.current = parallelAgents;
  }, [parallelAgents]);

  // Auto-clear Ctrl+F confirmation when no active background agents remain.
  useEffect(() => {
    if (
      getActiveBackgroundAgents(parallelAgents).length === 0
      && (backgroundTerminationCount > 0 || ctrlFPressed)
    ) {
      clearBackgroundTerminationConfirmation();
    }
  }, [
    parallelAgents,
    backgroundTerminationCount,
    ctrlFPressed,
    clearBackgroundTerminationConfirmation,
  ]);

  // Keep workflow session refs in sync with state
  useEffect(() => {
    workflowSessionDirRef.current = workflowSessionDir;
  }, [workflowSessionDir]);
  useEffect(() => {
    workflowSessionIdRef.current = workflowSessionId;
  }, [workflowSessionId]);

  /**
   * Check whether a TodoWrite payload is a workflow task update (shares IDs
   * with the known workflow planning-phase tasks). Returns false when the
   * incoming items are from a sub-agent's independent todo list, which
   * should NOT overwrite workflow's tasks.json.
   */
  const isWorkflowTaskUpdate = useCallback((
    todos: NormalizedTodoItem[],
    previousTodos: readonly NormalizedTodoItem[] = todoItemsRef.current,
  ): boolean => {
    return hasRalphTaskIdOverlap(todos, workflowTaskIdsRef.current, previousTodos);
  }, []);

  /**
   * Clear stale TodoWrite state when starting a new stream, except during
   * active workflow sessions where task continuity must persist across turns.
   */
  const resetTodoItemsForNewStream = useCallback(() => {
    if (workflowSessionIdRef.current) return;
    todoItemsRef.current = [];
    setTodoItems([]);
  }, []);

  /**
   * Finalize task items on interrupt: mark in_progress -> pending (unchecked), update state/ref,
   * persist to tasks.json if Ralph is active, and return taskItems for baking into message.
   */
  const finalizeTaskItemsOnInterrupt = useCallback((): TaskItem[] | undefined => {
    const current = todoItemsRef.current;
    if (current.length === 0) return undefined;

    const updated = normalizeInterruptedTasks(current);
    todoItemsRef.current = updated;
    setTodoItems(updated);

    // Persist to tasks.json only if the current items are workflow tasks
    if (workflowSessionIdRef.current && isWorkflowTaskUpdate(updated)) {
      void saveTasksToActiveSession(updated, workflowSessionIdRef.current);
    }

    return snapshotTaskItems(updated) as TaskItem[] | undefined;
  }, [isWorkflowTaskUpdate]);

  const clearAutoCompactionTimeout = useCallback(() => {
    if (autoCompactionTimeoutRef.current) {
      clearTimeout(autoCompactionTimeoutRef.current);
      autoCompactionTimeoutRef.current = null;
    }
  }, []);

  const applyAutoCompactionIndicator = useCallback((next: AutoCompactionIndicatorState) => {
    clearAutoCompactionTimeout();
    autoCompactionIndicatorRef.current = next;
    setAutoCompactionIndicator(next);

    if (next.status === "completed" || next.status === "error") {
      autoCompactionTimeoutRef.current = setTimeout(() => {
        autoCompactionIndicatorRef.current = AUTO_COMPACTION_INDICATOR_IDLE_STATE;
        setAutoCompactionIndicator(AUTO_COMPACTION_INDICATOR_IDLE_STATE);
        autoCompactionTimeoutRef.current = null;
      }, AUTO_COMPACTION_RESULT_VISIBILITY_MS);
    }
  }, [clearAutoCompactionTimeout]);

  const stopSharedStreamState = useCallback((options?: {
    preserveStreamingStart?: boolean;
    resetStreamingStateHook?: boolean;
  }) => {
    const next = createStoppedStreamControlState(
      {
        isStreaming: isStreamingRef.current,
        streamingMessageId: streamingMessageIdRef.current,
        streamingStart: streamingStartRef.current,
        hasStreamingMeta: streamingMetaRef.current !== null,
        hasRunningTool: hasRunningToolRef.current,
        isAgentOnlyStream: isAgentOnlyStreamRef.current,
        hasPendingCompletion: pendingCompleteRef.current !== null,
      },
      { preserveStreamingStart: options?.preserveStreamingStart },
    );

    streamingMessageIdRef.current = next.streamingMessageId;
    streamingStartRef.current = next.streamingStart;
    streamingMetaRef.current = null;
    pendingCompleteRef.current = null;
    isAgentOnlyStreamRef.current = next.isAgentOnlyStream;
    isStreamingRef.current = next.isStreaming;
    hasRunningToolRef.current = next.hasRunningTool;
    runningBlockingToolIdsRef.current.clear();
    if (options?.resetStreamingStateHook !== false) {
      runningAskQuestionToolIdsRef.current.clear();
    }
    setIsStreaming(next.isStreaming);
    setStreamingMeta(null);

    const nextCompactionState = clearRunningAutoCompactionIndicator(
      autoCompactionIndicatorRef.current,
    );
    if (nextCompactionState !== autoCompactionIndicatorRef.current) {
      applyAutoCompactionIndicator(nextCompactionState);
    }

    if (options?.resetStreamingStateHook !== false) {
      streamingState.reset();
    }
  }, [streamingState, applyAutoCompactionIndicator]);

  const handleStreamStartupError = useCallback((error: unknown, expectedGeneration: number) => {
    // Ignore stale failures from an older stream generation.
    if (streamGenerationRef.current !== expectedGeneration) {
      return;
    }

    console.error("[stream] Failed to start stream:", error);

    const failedMessageId = streamingMessageIdRef.current;
    if (failedMessageId) {
      setMessagesWindowed((prev: ChatMessage[]) => {
        const failedMessage = prev.find((msg: ChatMessage) => msg.id === failedMessageId);
        if (!failedMessage) {
          return prev;
        }

        if (failedMessage.content.trim().length === 0) {
          return prev.filter((msg: ChatMessage) => msg.id !== failedMessageId);
        }

        return prev.map((msg: ChatMessage) =>
          msg.id === failedMessageId
            ? { ...finalizeStreamingReasoningInMessage(msg), streaming: false, modelId: currentModelRef.current }
            : msg
        );
      });
    }

    stopSharedStreamState();
    finalizeThinkingSourceTracking();

    const resolver = streamCompletionResolverRef.current;
    streamCompletionResolverRef.current = null;
    hideStreamContentRef.current = false;
    if (resolver) {
      resolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
    }
  }, [setMessagesWindowed, stopSharedStreamState, finalizeThinkingSourceTracking]);

  const enqueueShortcutLabel = useMemo(() => getEnqueueShortcutLabel(), []);

  // Dynamic placeholder based on queue state
  const dynamicPlaceholder = useMemo(() => {
    if (messageQueue.count > 0) {
      return "Press ↑ to edit queued messages...";
    } else if (isStreaming) {
      return `Type a message (enter to interrupt, ${enqueueShortcutLabel} to enqueue)...`;
    } else {
      return "Enter a message...";
    }
  }, [enqueueShortcutLabel, messageQueue.count, isStreaming]);

  /**
   * Update workflow state with partial values.
   * Convenience function for updating specific fields.
   */
  const updateWorkflowState = useCallback((updates: Partial<WorkflowChatState>) => {
    setWorkflowState((prev) => ({ ...prev, ...updates }));
  }, []);

  const emitMessageSubmitTelemetry = useCallback((event: MessageSubmitTelemetry) => {
    onMessageSubmitTelemetry?.(event);
  }, [onMessageSubmitTelemetry]);

  /**
   * Handle tool execution start event.
   * Updates streaming state and adds tool call to current message.
   */
  const handleToolStart = useCallback((
    toolId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => {
    const nextCompactionState = startAutoCompactionIndicator(
      autoCompactionIndicatorRef.current,
      toolName,
    );
    if (nextCompactionState !== autoCompactionIndicatorRef.current) {
      applyAutoCompactionIndicator(nextCompactionState);
    }

    toolNameByIdRef.current.set(toolId, toolName);

    // Update streaming state
    streamingState.handleToolStart(toolId, toolName, input);
    // Track blocking tool lifecycles synchronously for stream finalization.
    if (shouldTrackToolAsBlocking(toolName)) {
      runningBlockingToolIdsRef.current.add(toolId);
      hasRunningToolRef.current = runningBlockingToolIdsRef.current.size > 0;
    }
    if (isAskQuestionToolName(toolName)) {
      runningAskQuestionToolIdsRef.current.add(toolId);
    }

    if (toolName === "AskUserQuestion" || toolName === "question" || toolName === "ask_user") {
      activeHitlToolCallIdRef.current = toolId;
    }

    // Add tool call to current streaming message.
    // If a tool call with the same ID already exists, update its input
    // (SDKs may send an initial event with empty input followed by a
    // populated one for the same logical tool call).
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessagesWindowed((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            return applyStreamPartEvent(msg, {
              type: "tool-start",
              toolId,
              toolName,
              input,
            });
          }
          return msg;
        })
      );
    }

    // Update persistent todo panel when TodoWrite is called
    if (isTodoWriteToolName(toolName) && input.todos && Array.isArray(input.todos)) {
      const previousTodos = todoItemsRef.current;
      const todos = reconcileTodoWriteItems(input.todos, previousTodos);
      const taskStreamPinned = Boolean(workflowSessionIdRef.current);
      const isWorkflowUpdate = isWorkflowTaskUpdate(todos, previousTodos);

      // During workflow, ignore unrelated sub-agent TodoWrite payloads so they
      // cannot replace the in-memory workflow task state.
      const shouldApplyTodoState = !workflowSessionIdRef.current || isWorkflowUpdate;
      if (shouldApplyTodoState) {
        todoItemsRef.current = todos;
        setTodoItems(todos);
      }

      // During workflow: do NOT persist TodoWrite calls to tasks.json.
      // The workflow (workflow-commands.ts) is the sole owner of tasks.json
      // to prevent race conditions where sub-agent TodoWrite calls overwrite
      // the workflow's status updates (e.g., marking a completed task back to in_progress).
      // TodoWrite still updates in-memory UI state above for real-time display.
      // 
      // Before: if (workflowSessionIdRef.current && isWorkflowUpdate) { ... }
      // Now: Never persist TodoWrite during active workflow.

      if (messageId) {
        setMessagesWindowed((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  tasksPinned: msg.tasksPinned ?? taskStreamPinned,
                }
              : msg
          )
        );
      }
    }
  }, [streamingState, isRalphTaskUpdate, applyAutoCompactionIndicator]);

  /**
   * Handle tool execution complete event.
   * Updates streaming state and tool call status in message.
   * Also updates input if it wasn't available at start time (OpenCode sends input with complete event).
   */
  const handleToolComplete = useCallback((
    toolId: string,
    output: unknown,
    success: boolean,
    error?: string,
    input?: Record<string, unknown>
  ) => {
    const completedToolName = toolNameByIdRef.current.get(toolId);
    if (completedToolName) {
      const nextCompactionState = completeAutoCompactionIndicator(
        autoCompactionIndicatorRef.current,
        completedToolName,
        success,
        error,
      );
      if (nextCompactionState !== autoCompactionIndicatorRef.current) {
        applyAutoCompactionIndicator(nextCompactionState);
      }
    }

    const completedAskQuestion = completedToolName
      ? isAskQuestionToolName(completedToolName)
      : false;
    if (completedToolName) {
      toolNameByIdRef.current.delete(toolId);
      if (completedAskQuestion) {
        runningAskQuestionToolIdsRef.current.delete(toolId);
      }
    }

    const hadBlockingTool = hasRunningToolRef.current;
    runningBlockingToolIdsRef.current.delete(toolId);
    hasRunningToolRef.current = runningBlockingToolIdsRef.current.size > 0;
    if (hadBlockingTool && !hasRunningToolRef.current && pendingCompleteRef.current) {
      setToolCompletionVersion(v => v + 1);
    }

    if (
      completedAskQuestion
      && !pendingCompleteRef.current
      && shouldDispatchQueuedMessage({
        isStreaming: isStreamingRef.current,
        runningAskQuestionToolCount: runningAskQuestionToolIdsRef.current.size,
      })
    ) {
      continueQueuedConversation();
    }

    // Update streaming state
    if (success) {
      streamingState.handleToolComplete(toolId, output);
    } else {
      streamingState.handleToolError(toolId, error || "Unknown error");
    }

    // Update tool call in current streaming message
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessagesWindowed((prev) => {
        const updated = prev.map((msg) => {
          if (msg.id === messageId) {
            return applyStreamPartEvent(msg, {
              type: "tool-complete",
              toolId,
              output,
              success,
              error,
              input,
            });
          }
          return msg;
        });

        return updated;
      });
    }

    // Update persistent todo panel when TodoWrite completes (handles late input)
    const isTodoWriteCompletion = isTodoWriteToolName(completedToolName);
    if (isTodoWriteCompletion && input && input.todos && Array.isArray(input.todos)) {
      const previousTodos = todoItemsRef.current;
      const todos = reconcileTodoWriteItems(input.todos, previousTodos);
      const taskStreamPinned = Boolean(ralphSessionIdRef.current);
      const isRalphUpdate = isRalphTaskUpdate(todos, previousTodos);

      // During /ralph, ignore unrelated sub-agent TodoWrite payloads so they
      // cannot replace the in-memory ralph task state.
      const shouldApplyTodoState = !ralphSessionIdRef.current || isRalphUpdate;
      if (shouldApplyTodoState) {
        todoItemsRef.current = todos;
        setTodoItems(todos);
      }

      // During /ralph workflow: do NOT persist TodoWrite calls to tasks.json.
      // The ralph workflow (workflow-commands.ts) is the sole owner of tasks.json
      // to prevent race conditions where sub-agent TodoWrite calls overwrite
      // the workflow's status updates (e.g., marking a completed task back to in_progress).
      // TodoWrite still updates in-memory UI state above for real-time display.
      // 
      // Before: if (ralphSessionIdRef.current && isRalphUpdate) { ... }
      // Now: Never persist TodoWrite during active ralph workflow.

      if (messageId) {
        setMessagesWindowed((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  tasksPinned: msg.tasksPinned ?? taskStreamPinned,
                }
              : msg
          )
        );
      }
    }
  }, [streamingState, isRalphTaskUpdate, continueQueuedConversation, applyAutoCompactionIndicator]);

  /**
   * Handle skill invoked event from SDK.
   * Skill events are represented via normal tool.start/tool.complete rendering.
   */
  const handleSkillInvoked = useCallback((
    _skillName: string,
    _skillPath?: string
  ) => {
    // No-op: skill.invoked is intentionally not rendered as a separate indicator.
  }, []);

  // Register tool event handlers with parent component
  useEffect(() => {
    if (registerToolStartHandler) {
      registerToolStartHandler(handleToolStart);
    }
  }, [registerToolStartHandler, handleToolStart]);

  useEffect(() => {
    if (registerToolCompleteHandler) {
      registerToolCompleteHandler(handleToolComplete);
    }
  }, [registerToolCompleteHandler, handleToolComplete]);

  useEffect(() => {
    if (registerSkillInvokedHandler) {
      registerSkillInvokedHandler(handleSkillInvoked);
    }
  }, [registerSkillInvokedHandler, handleSkillInvoked]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (ctrlCTimeoutRef.current) {
        clearTimeout(ctrlCTimeoutRef.current);
      }
      if (interruptTimeoutRef.current) {
        clearTimeout(interruptTimeoutRef.current);
      }
      clearAutoCompactionTimeout();
      if (deferredCompleteTimeoutRef.current) {
        clearTimeout(deferredCompleteTimeoutRef.current);
      }
      if (backgroundTerminationTimeoutRef.current) {
        clearTimeout(backgroundTerminationTimeoutRef.current);
      }
    };
  }, [clearAutoCompactionTimeout]);

  // Auto-start workflow when workflowActive becomes true with an initialPrompt.
  // This handles non-context-clear workflow starts (e.g., generic workflow commands).
  // For /ralph step 1 → step 2 transitions, the command handler uses streamAndWait directly.
  const workflowStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      workflowState.workflowActive &&
      workflowState.initialPrompt &&
      workflowStartedRef.current !== workflowState.initialPrompt &&
      !isStreaming
    ) {
      workflowStartedRef.current = workflowState.initialPrompt;

      const timeoutId = setTimeout(() => {
        if (isStreamingRef.current) return;

        void (async () => {
          try {
            const promptToSend = workflowState.initialPrompt!;
            // Clear stale todo items from previous turn when not in /ralph
            resetTodoItemsForNewStream();
            clearDeferredCompletion();

          // Increment stream generation so stale handleComplete callbacks become no-ops
          const currentGeneration = ++streamGenerationRef.current;
          // Set streaming BEFORE calling onStreamMessage to prevent race conditions
          setIsStreaming(true);
          isStreamingRef.current = true;
          resetThinkingSourceTracking();

          // Call the stream handler - this is async but we don't await it
          // The callbacks will handle state updates
          void Promise.resolve(onStreamMessage?.(
            promptToSend,
            // onChunk: append to current message
            (chunk) => {
              // Drop chunks from stale streams (round-robin replaced this stream)
              if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
              if (pendingCompleteRef.current) {
                clearDeferredCompletion();
              }
              setMessagesWindowed((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
                  return [
                    ...prev.slice(0, -1),
                    applyStreamPartEvent(lastMsg, { type: "text-delta", delta: chunk }),
                  ];
                }
                // Create new streaming message
                const newMessage = createMessage("assistant", chunk, true);
                streamingMessageIdRef.current = newMessage.id;
                isAgentOnlyStreamRef.current = false;
                return [...prev, newMessage];
              });
            },
            // onComplete: mark message as complete, finalize parallel agents
            () => {
              // Stale generation guard: if a newer stream started, this callback is a no-op
              if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
              // Finalize any still-running parallel agents and bake into message
              setParallelAgents((currentAgents) => {
                if (currentAgents.length > 0) {
                  const finalizedAgents = currentAgents.map((a) => {
                    // Skip background agents — they must not be finalized on stream completion
                    if (a.background) return a;
                    return a.status === "running" || a.status === "pending"
                      ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                      : a;
                  });
                  // Bake finalized agents into the message
                  setMessagesWindowed((prev) => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...finalizeStreamingReasoningInMessage(lastMsg),
                          streaming: false,
                          completedAt: new Date(),
                          parallelAgents: finalizedAgents,
                          taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
                        },
                      ];
                    }
                    return prev;
                  });
                  // Clear live agents since they're now baked into the message
                  return [];
                }
                // No agents — just finalize the message normally
                setMessagesWindowed((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
                    return [
                      ...prev.slice(0, -1),
                      {
                        ...finalizeStreamingReasoningInMessage(lastMsg),
                        streaming: false,
                        completedAt: new Date(),
                        taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
                      },
                    ];
                  }
                  return prev;
                });
                return currentAgents;
              });
              stopSharedStreamState();
              finalizeThinkingSourceTracking();
            },
            // onMeta: update streaming metadata
            (meta: StreamingMeta) => {
              streamingMetaRef.current = meta;
              setStreamingMeta(meta);
              const messageId = streamingMessageIdRef.current;
              if (!messageId) return;
              const thinkingMetaEvent = resolveValidatedThinkingMetaEvent(
                meta,
                messageId,
                currentGeneration,
                closedThinkingSourcesRef.current,
                thinkingDropDiagnosticsRef.current,
              );
              if (!thinkingMetaEvent) return;
              setMessagesWindowed((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === messageId
                    ? applyStreamPartEvent(msg, {
                        type: "thinking-meta",
                        thinkingSourceKey: thinkingMetaEvent.thinkingSourceKey,
                        targetMessageId: thinkingMetaEvent.targetMessageId,
                        streamGeneration: thinkingMetaEvent.streamGeneration,
                        thinkingMs: meta.thinkingMs,
                        thinkingText: thinkingMetaEvent.thinkingText,
                        includeReasoningPart: true,
                      })
                    : msg
                )
              );
            }
          )).catch((error) => {
            handleStreamStartupError(error, currentGeneration);
          });
          } catch (error) {
            // Prevent unhandled errors from crashing the TUI
            console.error("[workflow auto-start] Error during context clear or streaming:", error);
            stopSharedStreamState();
            finalizeThinkingSourceTracking();
          }
        })();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [workflowState.workflowActive, workflowState.initialPrompt, isStreaming, onStreamMessage, handleStreamStartupError, stopSharedStreamState, finalizeThinkingSourceTracking, resetThinkingSourceTracking]);

  // Reset workflow started ref when workflow becomes inactive
  useEffect(() => {
    if (!workflowState.workflowActive) {
      workflowStartedRef.current = null;
    }
  }, [workflowState.workflowActive]);

  // Auto-hide task list panel when workflow ends naturally
  const syncTerminalTaskStateFromSession = useCallback((sessionDir: string) => {
    let diskTasks: NormalizedTodoItem[] = [];
    try {
      const content = readFileSync(join(sessionDir, "tasks.json"), "utf-8");
      diskTasks = normalizeTodoItems(JSON.parse(content));
    } catch {
      // best effort: tasks.json may be absent during teardown
    }

    const terminalTasks = sortTasksTopologically(
      preferTerminalTaskItems(todoItemsRef.current, diskTasks),
    );
    if (terminalTasks.length === 0) return;

    todoItemsRef.current = terminalTasks;
    setTodoItems(terminalTasks);
    setMessagesWindowed((prev: ChatMessage[]) =>
      applyTaskSnapshotToLatestAssistantMessage(prev, terminalTasks)
    );
  }, [setMessagesWindowed]);

  useEffect(() => {
    if (!workflowState.workflowActive && workflowSessionDir) {
      syncTerminalTaskStateFromSession(workflowSessionDir);
      setWorkflowSessionDir(null);
      setWorkflowSessionId(null);
      workflowSessionDirRef.current = null;
      workflowSessionIdRef.current = null;
    }
  }, [workflowState.workflowActive, workflowSessionDir, syncTerminalTaskStateFromSession]);

  /**
   * Handle human_input_required signal.
   * Shows UserQuestionDialog for HITL interactions.
   * Simplified: directly set activeQuestion, don't use pending queue for active display.
   */
  const handleHumanInputRequired = useCallback((question: UserQuestion) => {
    // Only add to queue if there's already an active question
    // Otherwise, show directly
    if (activeQuestion) {
      streamingState.addPendingQuestion(question);
    } else {
      setActiveQuestion(question);
    }
  }, [streamingState, activeQuestion]);

  // Store the respond callback for permission requests
  const permissionRespondRef = useRef<((answer: string | string[]) => void) | null>(null);

  /**
   * Handle permission/HITL request from SDK.
   * Converts the SDK event to a UserQuestion and shows the dialog.
   * Also sets pendingQuestion on the matching ToolPart for inline rendering.
   */
  const handlePermissionRequest = useCallback((
    requestId: string,
    toolName: string,
    question: string,
    options: Array<{ label: string; value: string; description?: string }>,
    respond: (answer: string | string[]) => void,
    header?: string,
    toolCallId?: string
  ) => {
    // During Ralph autonomous execution, auto-approve permission requests
    if (workflowState.workflowActive) {
      const autoAnswer = options[0]?.value ?? "allow";
      respond(autoAnswer);
      return;
    }

    // Store the respond callback
    permissionRespondRef.current = respond;

    // Convert to UserQuestion format
    // Use provided header, fall back to toolName if no header
    const userQuestion: UserQuestion = {
      header: header || toolName,
      question,
      options: options.map(opt => ({
        label: opt.label,
        value: opt.value,
        description: opt.description,
      })),
      multiSelect: false,
    };

    // Show the question dialog (custom UI overlay)
    handleHumanInputRequired(userQuestion);

    const targetToolId = toolCallId ?? activeHitlToolCallIdRef.current;
    if (targetToolId) {
      setMessagesWindowed((prev) =>
        prev.map((msg) => {
          const hasToolCall = msg.toolCalls?.some((toolCall) => toolCall.id === targetToolId) ?? false;
          const hasToolPart = msg.parts?.some(
            (part) => part.type === "tool" && part.toolCallId === targetToolId,
          ) ?? false;
          if (!hasToolCall && !hasToolPart) return msg;

          return applyStreamPartEvent(msg, {
            type: "tool-hitl-request",
            toolId: targetToolId,
            request: {
              requestId,
              header: header || toolName,
              question,
              options,
              multiSelect: false,
              respond,
            },
          });
        }),
      );
    }
  }, [handleHumanInputRequired, workflowState.workflowActive, setMessagesWindowed]);

  // Store the requestId for askUserNode questions (for workflow resumption)
  const askUserQuestionRequestIdRef = useRef<string | null>(null);
  const activeHitlToolCallIdRef = useRef<string | null>(null);

  /**
   * Handle AskUserQuestion event from askUserNode.
   * Converts AskUserQuestionEventData to UserQuestion and shows the dialog.
   *
   * This handler is specifically for askUserNode graph nodes which emit
   * 'human_input_required' signals with AskUserQuestionEventData.
   *
   * The respond flow:
   * - If workflowState.workflowActive, call onWorkflowResumeWithAnswer
   * - Otherwise, call session.send() with the user's answer for standalone agents
   */
  const handleAskUserQuestion = useCallback((eventData: AskUserQuestionEventData) => {
    // During Ralph autonomous execution, auto-respond to questions
    if (workflowState.workflowActive) {
      const autoAnswer = eventData.options?.[0]?.label ?? "continue";
      if (onWorkflowResumeWithAnswer && eventData.requestId) {
        onWorkflowResumeWithAnswer(eventData.requestId, autoAnswer);
      }
      return;
    }

    // Store the requestId for response correlation
    askUserQuestionRequestIdRef.current = eventData.requestId;

    // Convert AskUserQuestionEventData to UserQuestion format
    const userQuestion: UserQuestion = {
      header: eventData.header || "Question",
      question: eventData.question,
      options: eventData.options?.map(opt => ({
        label: opt.label,
        value: opt.label, // Use label as value since AskUserOption only has label/description
        description: opt.description,
      })) || [],
      multiSelect: false,
    };

    // Show the question dialog
    handleHumanInputRequired(userQuestion);
  }, [handleHumanInputRequired, workflowState.workflowActive, onWorkflowResumeWithAnswer]);

  // Register askUserQuestion handler with parent component
  useEffect(() => {
    if (registerAskUserQuestionHandler) {
      registerAskUserQuestionHandler(handleAskUserQuestion);
    }
  }, [registerAskUserQuestionHandler, handleAskUserQuestion]);

  // Register permission request handler with parent component
  useEffect(() => {
    if (registerPermissionRequestHandler) {
      registerPermissionRequestHandler(handlePermissionRequest);
    }
  }, [registerPermissionRequestHandler, handlePermissionRequest]);

  // Register Ctrl+C warning handler with parent component
  useEffect(() => {
    if (registerCtrlCWarningHandler) {
      registerCtrlCWarningHandler(setCtrlCPressed);
    }
  }, [registerCtrlCWarningHandler]);

  // Register parallel agent handler with parent component.
  // Wraps setParallelAgents to also keep the synchronous ref in sync.
  useEffect(() => {
    if (registerParallelAgentHandler) {
      registerParallelAgentHandler((agents: ParallelAgent[]) => {
        parallelAgentsRef.current = agents;
        setParallelAgents(agents);

        // Dispatch background results immediately (queued-message pattern)
        // instead of routing through a React state → effect cycle.
        if (!streamingMessageIdRef.current && backgroundAgentMessageIdRef.current) {
          applyBackgroundAgentUpdateRef.current(backgroundAgentMessageIdRef.current, agents);
        }
      });
    }
  }, [registerParallelAgentHandler]);

  // Keep live sub-agent updates anchored to the active streaming message so
  // they render in-order inside chat scrollback instead of as a last-row overlay.
  // Background agent completions after stream ends are handled directly by the
  // parallelAgentHandler callback (queued-message pattern) — not this effect.
  useEffect(() => {
    if (parallelAgents.length === 0) return;

    // During streaming: bake into the active streaming message
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessagesWindowed((prev: ChatMessage[]) =>
        prev.map((msg: ChatMessage, index: number) => {
          if (msg.id === messageId && msg.streaming) {
            return applyStreamPartEvent(msg, {
              type: "parallel-agents",
              agents: parallelAgents,
              isLastMessage: index === prev.length - 1,
            });
          }
          return msg;
        })
      );
    }
  }, [parallelAgents, setMessagesWindowed]);

  // When all sub-agents/tools finish and a dequeue was deferred, trigger it.
  // This fires whenever parallelAgents changes (from SDK events OR interrupt handler)
  // or when tools complete (via toolCompletionVersion).
  useEffect(() => {
    const canFinalizeDeferred = shouldFinalizeDeferredStream(
      parallelAgents,
      hasRunningToolRef.current,
    );
    if (!canFinalizeDeferred) {
      if (deferredCompleteTimeoutRef.current) {
        clearTimeout(deferredCompleteTimeoutRef.current);
        deferredCompleteTimeoutRef.current = null;
      }
      return;
    }

    if (pendingCompleteRef.current) {
      if (deferredCompleteTimeoutRef.current) {
        return;
      }
      const pendingComplete = pendingCompleteRef.current;
      deferredCompleteTimeoutRef.current = setTimeout(() => {
        deferredCompleteTimeoutRef.current = null;
        if (pendingCompleteRef.current !== pendingComplete) {
          return;
        }
        if (!shouldFinalizeDeferredStream(parallelAgentsRef.current, hasRunningToolRef.current)) {
          return;
        }
        pendingCompleteRef.current = null;
        pendingComplete();
      }, 0);
      return;
    }

    // Finalize "agent-only" streaming message (created by @mention handler)
    // when all spawned sub-agents have completed and there is no pending SDK
    // stream completion.  Without this, the placeholder assistant message
    // would stay in the streaming state indefinitely.
    if (
      streamingMessageIdRef.current &&
      isStreamingRef.current &&
      isAgentOnlyStreamRef.current &&
      parallelAgents.length > 0
    ) {
      const messageId = streamingMessageIdRef.current;
      const durationMs = streamingStartRef.current
        ? Date.now() - streamingStartRef.current
        : undefined;
      // SDK-side correlation cleanup may clear live parallelAgents before this
      // finalizer runs. Fall back to the agents already baked onto the message
      // so we can still stop streaming and preserve the final tree state.
      const messageAgents = messages.find((m) => m.id === messageId)?.parallelAgents ?? [];
      const sourceAgents = parallelAgents.length > 0 ? parallelAgents : messageAgents;
      const finalizedAgents = sourceAgents.map((a) => {
        if (a.background) return a;
        return a.status === "running" || a.status === "pending"
          ? {
            ...a,
            status: "completed" as const,
            currentTool: undefined,
            durationMs: Date.now() - new Date(a.startedAt).getTime(),
          }
          : a;
      });

      // Collect sub-agent result text into the message content so it
      // renders in the main conversation (like Claude Code's Task tool).
      const agentOutputParts = finalizedAgents
        .map((a) => (typeof a.result === "string" ? normalizeMarkdownNewlines(a.result) : ""))
        .filter((result) => result.length > 0);
      const agentOutput = agentOutputParts.join("\n\n");

      setMessagesWindowed((prev: ChatMessage[]) =>
        prev.map((msg: ChatMessage) =>
          msg.id === messageId
            ? {
              ...finalizeStreamingReasoningInMessage(msg),
              content: (msg.toolCalls?.length ?? 0) > 0 ? msg.content : (agentOutput || msg.content),
              streaming: false,
              completedAt: new Date(),
              durationMs,
              parallelAgents: finalizedAgents,
              taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
            }
            : msg
        )
      );
      finalizeThinkingSourceTracking();
      // Invalidate the SDK handleComplete callback so it doesn't double-finalize
      // this message after the agent-only path has already stopped the stream.
      streamGenerationRef.current++;
      // Keep background agents in live state for post-stream completion tracking
      const remainingBg = getActiveBackgroundAgents(parallelAgents);
      if (remainingBg.length > 0 && messageId) {
        stopSharedStreamState({ preserveStreamingStart: true });
        backgroundAgentMessageIdRef.current = messageId;
        setParallelAgents(remainingBg);
        parallelAgentsRef.current = remainingBg;
      } else {
        stopSharedStreamState();
        setParallelAgents([]);
        parallelAgentsRef.current = [];
      }

      // Drain the message queue — the agent-only path doesn't go through
      // the SDK handleComplete callback, so we must dequeue here.
      continueQueuedConversation();
    }
  }, [parallelAgents, continueQueuedConversation, toolCompletionVersion, messages, stopSharedStreamState, finalizeThinkingSourceTracking]);

  // Initialize SubagentGraphBridge when createSubagentSession is available
  useEffect(() => {
    if (!createSubagentSession) {
      workflowSdkRef.current = null;
      subagentBridgeRef.current = null;
      return;
    }

    const providerName = agentType ?? "claude";
    const workflowClient: CodingAgentClient = {
      agentType: providerName,
      createSession: createSubagentSession,
      async resumeSession(_sessionId: string): Promise<Session | null> {
        return null;
      },
      on<T extends EventType>(_eventType: T, _handler: EventHandler<T>): () => void {
        return () => {};
      },
      registerTool(_tool: ToolDefinition): void {},
      async start(): Promise<void> {},
      async stop(): Promise<void> {},
      async getModelDisplayInfo(): Promise<ModelDisplayInfo> {
        return {
          model: providerName,
          tier: "workflow-sdk",
        };
      },
      getSystemToolsTokens(): number | null {
        return null;
      },
    };

    const sdk = WorkflowSDK.init({
      providers: { [providerName]: workflowClient },
      subagentProvider: providerName,
    });
    workflowSdkRef.current = sdk;
    subagentBridgeRef.current = sdk.getSubagentBridge();

    return () => {
      workflowSdkRef.current = null;
      subagentBridgeRef.current = null;
      void sdk.destroy();
    };
  }, [agentType, createSubagentSession]);

  /**
   * Handle user answering a question from UserQuestionDialog.
   * Claude Code behavior: Just respond and continue streaming, no "User selected" messages.
   *
   * For askUserNode questions:
   * - If workflowState.workflowActive, calls onWorkflowResumeWithAnswer to resume workflow
   * - Otherwise, sends the answer through session.send() for standalone agent mode
   */
  const handleQuestionAnswer = useCallback((answer: QuestionAnswer) => {
    const normalizedHitl = normalizeHitlAnswer(answer);

    // Advance to the next pending question (if any).
    const nextQuestion = streamingState.removePendingQuestion();
    setActiveQuestion(nextQuestion ?? null);

    // If there's a permission respond callback, call it (SDK permission requests)
    if (permissionRespondRef.current) {
      if (answer.cancelled) {
        // For cancellation, send a deny response
        permissionRespondRef.current("deny");
      } else {
        // Send the selected values
        permissionRespondRef.current(answer.selected);
      }
      permissionRespondRef.current = null;
    }

    // Handle askUserNode question responses (workflow graph questions)
    if (askUserQuestionRequestIdRef.current) {
      const requestId = askUserQuestionRequestIdRef.current;
      askUserQuestionRequestIdRef.current = null;

      if (!answer.cancelled) {
        // Determine how to respond based on workflow state
        if (workflowState.workflowActive && onWorkflowResumeWithAnswer) {
          // Workflow mode: call workflow executor to resume with answer
          onWorkflowResumeWithAnswer(requestId, answer.selected);
        } else {
          // Standalone agent mode: send the answer through the session
          const session = getSession?.();
          if (session) {
            // Send the user's answer as a message to continue the conversation
            const answerText = Array.isArray(answer.selected)
              ? answer.selected.join(", ")
              : answer.selected;
            void session.send(answerText);
          }
        }
      }
    }

    // Store the user's answer on the HITL tool call so it renders inline.
    let answerStoredOnToolCall = false;
    if (activeHitlToolCallIdRef.current) {
      const hitlToolId = activeHitlToolCallIdRef.current;
      activeHitlToolCallIdRef.current = null;
      answerStoredOnToolCall = true;

      setMessagesWindowed((prev) =>
        prev.map((msg) => {
          const hasMatchingToolCall = msg.toolCalls?.some((toolCall) => toolCall.id === hitlToolId) ?? false;
          const hasMatchingToolPart = msg.parts?.some(
            (part) => part.type === "tool" && part.toolCallId === hitlToolId,
          ) ?? false;

          if (hasMatchingToolCall || hasMatchingToolPart) {
            return applyStreamPartEvent(msg, {
              type: "tool-hitl-response",
              toolId: hitlToolId,
              response: normalizedHitl,
            });
          }
          return msg;
        })
      );
    }

    // Fallback for askUserNode questions (no tool call) — insert as user message
    if (!answerStoredOnToolCall) {
      const answerText = answer.cancelled
        ? normalizedHitl.displayText
        : Array.isArray(answer.selected)
          ? answer.selected.join(", ")
          : answer.selected;
      setMessagesWindowed((prev) => {
        const streamingIdx = prev.findIndex(m => m.streaming);
        const answerMsg = createMessage("user", answerText);
        if (streamingIdx >= 0) {
          return [...prev.slice(0, streamingIdx), answerMsg, ...prev.slice(streamingIdx)];
        }
        return [...prev, answerMsg];
      });
    }

    // Update workflow state if this was spec approval
    const selectedArray = Array.isArray(answer.selected) ? answer.selected : [answer.selected];
    if (selectedArray.includes("Approve")) {
      updateWorkflowState({ specApproved: true, pendingApproval: false });
    } else if (selectedArray.includes("Reject")) {
      updateWorkflowState({ specApproved: false, pendingApproval: false });
    }

    // Don't add "User selected" messages - Claude Code doesn't show these
    // The streaming response continues automatically after the callback
  }, [streamingState, updateWorkflowState, workflowState.workflowActive, onWorkflowResumeWithAnswer, getSession]);

  /**
   * Update workflow progress state (called by workflow execution).
   */
  const _updateWorkflowProgress = useCallback((updates: {
    currentNode?: string | null;
    iteration?: number;
    featureProgress?: { completed: number; total: number; currentFeature?: string } | null;
  }) => {
    updateWorkflowState(updates);
  }, [updateWorkflowState]);

  // Ref for textarea to access value and clear it
  const textareaRef = useRef<TextareaRenderable>(null);
  const kittyKeyboardDetectedRef = useRef(false);

  const syncInputScrollbar = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Guard against destroyed EditorView (can happen during app exit while interval is still firing)
    let viewportHeight: number;
    let totalLines: number;
    try {
      viewportHeight = Math.max(1, Math.floor(textarea.editorView.getViewport().height));
      totalLines = Math.max(1, textarea.editorView.getTotalVirtualLineCount());
    } catch {
      return;
    }
    const maxScrollTop = Math.max(0, totalLines - viewportHeight);
    const scrollTop = Math.max(0, Math.floor(textarea.scrollY));
    const visible = maxScrollTop > 0;
    const thumbSize = visible
      ? Math.max(1, Math.round((viewportHeight / totalLines) * viewportHeight))
      : viewportHeight;
    const maxThumbTop = Math.max(0, viewportHeight - thumbSize);
    const thumbTop = maxScrollTop > 0
      ? Math.round((scrollTop / maxScrollTop) * maxThumbTop)
      : 0;

    setInputScrollbar((prev) => {
      if (
        prev.visible === visible &&
        prev.viewportHeight === viewportHeight &&
        prev.thumbTop === thumbTop &&
        prev.thumbSize === thumbSize
      ) {
        return prev;
      }
      return { visible, viewportHeight, thumbTop, thumbSize };
    });
  }, []);

  // Ref for sendMessage to allow executeCommand to call it without circular dependencies
  const sendMessageRef = useRef<((content: string, options?: { skipUserMessage?: boolean }) => void) | null>(null);

  // Ref for executeCommand to allow deferred message handling to spawn agents
  const executeCommandRef = useRef<((commandName: string, args: string, trigger?: CommandExecutionTrigger) => Promise<boolean>) | null>(null);

  const dispatchQueuedMessage = useCallback((queuedMessage: QueuedMessage) => {
    const atMentions = parseAtMentions(queuedMessage.content);
    if (atMentions.length > 0 && executeCommandRef.current) {
      if (!queuedMessage.skipUserMessage) {
        const visibleContent = queuedMessage.displayContent ?? queuedMessage.content;
        setMessagesWindowed((prev: ChatMessage[]) => [...prev, createMessage("user", visibleContent)]);
      }

      isStreamingRef.current = true;
      setIsStreaming(true);
      for (const mention of atMentions) {
        void executeCommandRef.current(mention.agentName, mention.args, "mention");
      }
      return;
    }

    if (sendMessageRef.current) {
      sendMessageRef.current(
        queuedMessage.content,
        queuedMessage.skipUserMessage ? { skipUserMessage: true } : undefined
      );
    }
  }, [setMessagesWindowed]);

  useEffect(() => {
    dispatchQueuedMessageRef.current = dispatchQueuedMessage;
  }, [dispatchQueuedMessage]);

  /**
   * Check if a character is a valid word boundary for @ mentions.
   * Includes whitespace and common punctuation that can precede mentions.
   */
  const isAtMentionBoundary = useCallback((char: string): boolean => {
    return char === " " || char === "\n" || char === "\t" ||
           char === "(" || char === "[" || char === "{" ||
           char === "," || char === ";" || char === ":" ||
           char === "." || char === "!" || char === "?";
  }, []);

  /**
   * Handle input changes to detect slash command prefix or @ mentions.
   * Shows autocomplete when input starts with "/" and has no space,
   * or when "@" appears at any position near the cursor.
   */
  const handleInputChange = useCallback((rawValue: string, cursorOffset: number) => {
    // Trim leading whitespace to prevent leading space from breaking slash command detection
    const value = rawValue.trimStart();
    // Check if input starts with "/" (slash command)
    if (value.startsWith("/")) {
      // Extract the command prefix (text after "/" without spaces)
      const afterSlash = value.slice(1);
      const spaceIndex = afterSlash.indexOf(" ");

      // Only show autocomplete if there's no space (still typing command name)
      if (spaceIndex === -1) {
        updateWorkflowState({
          showAutocomplete: true,
          autocompleteInput: afterSlash,
          selectedSuggestionIndex: 0, // Reset selection on input change
          argumentHint: "", // Clear hint while typing command name
        });
      } else {
        // Space present - command name is complete, check for @ mention in args
        const commandName = afterSlash.slice(0, spaceIndex);
        const afterCommandSpace = afterSlash.slice(spaceIndex + 1);
        const command = globalRegistry.get(commandName);

        // Check for @ mention in the argument portion
        const textBeforeCursor = rawValue.slice(0, cursorOffset);
        const atIndex = textBeforeCursor.lastIndexOf("@");

        if (atIndex !== -1 && atIndex > spaceIndex + 1) {
          const charBefore = atIndex > 0 ? (rawValue[atIndex - 1] ?? " ") : " ";

          if (isAtMentionBoundary(charBefore) || atIndex === 0) {
            const mentionToken = rawValue.slice(atIndex + 1, cursorOffset);
            if (!mentionToken.includes(" ")) {
              updateWorkflowState({
                showAutocomplete: true,
                autocompleteInput: mentionToken,
                selectedSuggestionIndex: 0,
                autocompleteMode: "mention",
                mentionStartOffset: atIndex,
                argumentHint: "",
              });
              return;
            }
          }
        }

        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          argumentHint: afterCommandSpace.length === 0 ? (command?.argumentHint || "") : "",
        });
      }
    } else {
      // Check for @ mention at any cursor position
      // Walk backwards from cursor to find the nearest @ that starts a mention token
      const textBeforeCursor = rawValue.slice(0, cursorOffset);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex !== -1) {
        // Check that the @ is either at position 0 or preceded by a valid boundary
        const charBefore = atIndex > 0 ? (rawValue[atIndex - 1] ?? " ") : " ";

        if (isAtMentionBoundary(charBefore) || atIndex === 0) {
          // Extract the mention token between @ and cursor (no spaces allowed in mention)
          const mentionToken = rawValue.slice(atIndex + 1, cursorOffset);
          const hasSpace = mentionToken.includes(" ");

          if (!hasSpace) {
            updateWorkflowState({
              showAutocomplete: true,
              autocompleteInput: mentionToken,
              selectedSuggestionIndex: 0,
              autocompleteMode: "mention",
              mentionStartOffset: atIndex,
              argumentHint: "",
            });
            return;
          }
        }
      }

      // No active mention or slash command - hide autocomplete
      if (workflowState.showAutocomplete || workflowState.argumentHint) {
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          selectedSuggestionIndex: 0,
          argumentHint: "",
          autocompleteMode: "command",
        });
      }
    }
  }, [workflowState.showAutocomplete, workflowState.argumentHint, updateWorkflowState, isAtMentionBoundary]);

  const handleTextareaContentChange = useCallback(() => {
    const textarea = textareaRef.current;
    const value = textarea?.plainText ?? "";
    const cursorOffset = textarea?.cursorOffset ?? value.length;
    handleInputChange(value, cursorOffset);
    syncInputScrollbar();

    // Apply slash command highlighting
    if (textarea) {
      textarea.removeHighlightsByRef(HLREF_COMMAND);
      const range = findSlashCommandRange(value);
      if (range) {
        textarea.addHighlightByCharRange({
          start: toHighlightOffset(value, range[0]),
          end: toHighlightOffset(value, range[1]),
          styleId: commandStyleIdRef.current,
          hlRef: HLREF_COMMAND,
        });
      }

      // Clear any existing @ mention highlighting
      textarea.removeHighlightsByRef(HLREF_MENTION);
    }
  }, [handleInputChange, syncInputScrollbar]);

  const handleTextareaCursorChange = useCallback(() => {
    syncInputScrollbar();
  }, [syncInputScrollbar]);

  /**
   * Helper to add a message to the chat.
   * Used by command execution context.
   */
  const addMessage = useCallback((role: "user" | "assistant" | "system", content: string) => {
    // When streaming is active and we're adding an assistant message,
    // mark it as streaming so the LoadingIndicator and task animations render.
    // This is essential for workflow commands like /ralph that use setStreaming(true)
    // and addMessage together.
    const streaming = role === "assistant" && isStreamingRef.current;
    const msg = createMessage(role, content, streaming);
    setMessagesWindowed((prev) => {
      // Finalize any previously streaming messages so only the newest one
      // shows the spinner. This prevents stale spinners on earlier messages
      // and ensures the spinner is always pinned above the chatbox.
      const finalized = prev.map((m) =>
        m.streaming
          ? { ...finalizeStreamingReasoningInMessage(m), streaming: false, completedAt: new Date() }
          : m,
      );
      return [...finalized, msg];
    });
  }, []);

  /**
   * Helper to set streaming state and optionally finalize the last streaming message.
   * Used by command execution context.
   */
  const setStreamingWithFinalize = useCallback((streaming: boolean) => {
    // When turning off streaming, finalize the last assistant message
    if (!streaming && isStreamingRef.current) {
      setMessagesWindowed((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
          return [
            ...prev.slice(0, -1),
            {
              ...finalizeStreamingReasoningInMessage(lastMsg),
              streaming: false,
              completedAt: new Date(),
              taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
            },
          ];
        }
        return prev;
      });
    }
    
    isStreamingRef.current = streaming;
    setIsStreaming(streaming);
  }, []);

  /**
   * Handle model selection from the ModelSelectorDialog.
   */
  const handleModelSelect = useCallback(async (selectedModel: Model, reasoningEffort?: string) => {
    setShowModelSelector(false);

    try {
      if (modelOps && 'setPendingReasoningEffort' in modelOps) {
        (modelOps as { setPendingReasoningEffort: (e: string | undefined) => void }).setPendingReasoningEffort(reasoningEffort);
      }
      const result = await modelOps?.setModel(selectedModel.id);
      const effectiveModel =
        modelOps?.getPendingModel?.()
        ?? await modelOps?.getCurrentModel?.()
        ?? selectedModel.id;
      const effortSuffix = reasoningEffort ? ` (${reasoningEffort})` : "";
      if (result?.requiresNewSession) {
        addMessage("assistant", `Model **${selectedModel.modelID}**${effortSuffix} will be used for the next session.`);
      } else {
        addMessage("assistant", `Switched to model **${selectedModel.modelID}**${effortSuffix}`);
      }
      setCurrentModelId(effectiveModel);
      onModelChange?.(effectiveModel);
      const displaySuffix = (agentType === "copilot" && reasoningEffort) ? ` (${reasoningEffort})` : "";
      setCurrentModelDisplayName(`${selectedModel.modelID}${displaySuffix}`);
      if (agentType) {
        saveModelPreference(agentType, effectiveModel);
        if (reasoningEffort) {
          saveReasoningEffortPreference(agentType, reasoningEffort);
        } else {
          clearReasoningEffortPreference(agentType);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Failed to switch model: ${errorMessage}`);
    }
  }, [modelOps, addMessage, onModelChange, agentType]);

  /**
   * Handle model selector cancellation.
   */
  const handleModelSelectorCancel = useCallback(() => {
    setShowModelSelector(false);
  }, []);

  /**
   * Execute a slash command by name with arguments.
   * Creates the CommandContext and calls the command's execute function.
   *
   * @param commandName - The command name (without leading slash)
   * @param args - Arguments to pass to the command
   * @returns Promise resolving to true if command executed successfully
   */
  const executeCommand = useCallback(async (
    commandName: string,
    args: string,
    trigger: CommandExecutionTrigger = "input"
  ): Promise<boolean> => {
    // Clear stale todo items from previous commands
    setTodoItems([]);

    // Look up the command in the registry
    const command = globalRegistry.get(commandName);

    if (!command) {
      // Command not found - show error message
      addMessage("system", `Unknown command: /${commandName}. Type /help for available commands.`);
      onCommandExecutionTelemetry?.({
        commandName,
        commandCategory: "unknown",
        argsLength: args.length,
        success: false,
        trigger,
      });
      return false;
    }

    // Create the command context
    const contextState: CommandContextState = {
      isStreaming,
      messageCount: messages.length,
      workflowActive: workflowState.workflowActive,
      workflowType: workflowState.workflowType,
      initialPrompt: workflowState.initialPrompt,
      currentNode: workflowState.currentNode,
      iteration: workflowState.iteration,
      maxIterations: workflowState.maxIterations,
      featureProgress: workflowState.featureProgress,
      pendingApproval: workflowState.pendingApproval,
      specApproved: workflowState.specApproved,
      feedback: workflowState.feedback,
    };

    const context: CommandContext = {
      session: getSession?.() ?? null,
      state: contextState,
      addMessage,
      setStreaming: setStreamingWithFinalize,
      sendMessage: (content: string) => {
        // Use ref to call sendMessage without circular dependency
        if (sendMessageRef.current) {
          sendMessageRef.current(content);
        }
      },
      sendSilentMessage: (content: string, options?: import("./commands/registry.ts").StreamMessageOptions) => {
        // Send to agent without displaying as user message
        // Call send handler (fire and forget)
        if (onSendMessage) {
          void Promise.resolve(onSendMessage(content));
        }
        // Handle streaming response if handler provided
        if (onStreamMessage) {
          // Finalize any previous streaming message before starting a new one.
          // This prevents duplicate "Generating..." spinners when sendSilentMessage
          // is called when a placeholder was already created by the caller.
          const prevStreamingId = streamingMessageIdRef.current;
          if (prevStreamingId) {
            setMessagesWindowed((prev: ChatMessage[]) => reconcilePreviousStreamingPlaceholder(prev, prevStreamingId));
          }

          // Increment stream generation so stale handleComplete callbacks become no-ops
          const currentGeneration = ++streamGenerationRef.current;
          isStreamingRef.current = true;
          setIsStreaming(true);
          streamingStartRef.current = Date.now();
          resetThinkingSourceTracking();
          // Clear stale todo items from previous turn when not in /ralph
          resetTodoItemsForNewStream();
          // Reset streaming content accumulator for step 1 → step 2 task parsing
          lastStreamingContentRef.current = "";
          // Reset tool tracking for the new stream
          hasRunningToolRef.current = false;
          runningBlockingToolIdsRef.current.clear();
          clearDeferredCompletion();

          // Create placeholder assistant message for the response
          const assistantMessage = createMessage("assistant", "", true);
          streamingMessageIdRef.current = assistantMessage.id;
          isAgentOnlyStreamRef.current = options?.isAgentOnlyStream ?? false;
          setMessagesWindowed((prev: ChatMessage[]) => [...prev, assistantMessage]);

          const handleChunk = (chunk: string) => {
            if (!isStreamingRef.current) return;
            // Drop chunks from stale streams (round-robin replaced this stream)
            if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
            // If completion was deferred waiting on sub-agents/tools but the
            // model resumes emitting chunks, cancel the deferred completion and
            // keep the current stream alive.
            if (pendingCompleteRef.current) {
              clearDeferredCompletion();
            }
            // Accumulate content for step 1 → step 2 task parsing
            lastStreamingContentRef.current += chunk;
            // Skip rendering in message when content is hidden (e.g., step 1 JSON output)
            if (hideStreamContentRef.current) return;
            const messageId = streamingMessageIdRef.current;
            if (messageId) {
              setMessagesWindowed((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) => {
                  if (msg.id === messageId) {
                    return applyStreamPartEvent(msg, { type: "text-delta", delta: chunk });
                  }
                  return msg;
                })
              );
            }
          };

          const handleComplete = () => {
            // Stale generation guard — a newer stream has started (round-robin inject),
            // so this callback must not touch any shared refs/state.
            if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
            const messageId = streamingMessageIdRef.current;
            const durationMs = streamingStartRef.current
              ? Date.now() - streamingStartRef.current
              : undefined;
            const finalMeta = streamingMetaRef.current;

            // If the interrupt handler already finalized agents, skip overwriting
            if (wasInterruptedRef.current) {
              wasInterruptedRef.current = false;
              // Just ensure streaming flags are cleared and message is finalized
              if (messageId) {
                setMessagesWindowed((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === messageId
                      ? {
                        ...finalizeStreamingReasoningInMessage(msg),
                        streaming: false,
                        durationMs,
                        modelId: currentModelRef.current,
                        outputTokens: finalMeta?.outputTokens,
                        thinkingMs: finalMeta?.thinkingMs,
                        thinkingText: finalMeta?.thinkingText || undefined,
                      }
                      : msg
                  )
                );
              }
              setParallelAgents([]);
              stopSharedStreamState();
              finalizeThinkingSourceTracking();
              const resolver = streamCompletionResolverRef.current;
              if (resolver) {
                streamCompletionResolverRef.current = null;
                // Remove the empty placeholder message when content was hidden
                if (hideStreamContentRef.current && messageId) {
                  setMessagesWindowed((prev: ChatMessage[]) => prev.filter((msg: ChatMessage) => msg.id !== messageId));
                }
                hideStreamContentRef.current = false;
                resolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
                return;
              }

              continueQueuedConversation();
              return;
            }

            // If foreground sub-agents or tools are still running, defer
            // finalization until they complete (preserves correct state).
            // Background agents are excluded — they must not block completion;
            // they continue running after the main stream ends and are tracked
            // separately via hasActiveBackgroundAgents.
            const hasActiveAgents = hasActiveForegroundAgents(parallelAgentsRef.current);
            if (hasActiveAgents || hasRunningToolRef.current) {
              const originalHandleComplete = handleComplete;
              let spawnTimeout: ReturnType<typeof setTimeout> | null = null;
              const deferredComplete = () => {
                if (spawnTimeout) {
                  clearTimeout(spawnTimeout);
                  spawnTimeout = null;
                }
                originalHandleComplete();
              };
              pendingCompleteRef.current = deferredComplete;
              // Safety timeout: if no sub-agent was ever spawned within 30s,
              // unblock the deferred completion to prevent TUI freeze.
              spawnTimeout = setTimeout(() => {
                if (pendingCompleteRef.current === deferredComplete
                    && parallelAgentsRef.current.length === 0) {
                  pendingCompleteRef.current = null;
                  deferredComplete();
                }
              }, 30_000);
              return;
            }

            // Finalize running parallel agents and bake into message
            setParallelAgents((currentAgents) => {
              const finalizedAgents = currentAgents.length > 0
                ? currentAgents.map((a) => {
                  if (a.background) return a;
                  return a.status === "running" || a.status === "pending"
                    ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                    : a;
                })
                : undefined;

              if (messageId) {
                setMessagesWindowed((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === messageId
                      ? {
                        ...finalizeStreamingReasoningInMessage(msg),
                        streaming: false,
                        durationMs,
                        modelId: currentModelRef.current,
                        outputTokens: finalMeta?.outputTokens,
                        thinkingMs: finalMeta?.thinkingMs,
                        thinkingText: finalMeta?.thinkingText || undefined,
                        toolCalls: interruptRunningToolCalls(msg.toolCalls),
                        parts: interruptRunningToolParts(msg.parts),
                        parallelAgents: finalizedAgents,
                        taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
                      }
                      : msg
                  )
                );
              }
              // Keep background agents in live state for post-stream completion tracking
              const remaining = getActiveBackgroundAgents(currentAgents);
              if (remaining.length > 0 && messageId) {
                backgroundAgentMessageIdRef.current = messageId;
              }
              return remaining;
            });

            // Preserve streamingStartRef when background agents are still running
            // so the elapsed timer continues tracking total work duration
            const hasRemainingBg = getActiveBackgroundAgents(parallelAgentsRef.current).length > 0;
            stopSharedStreamState({ preserveStreamingStart: hasRemainingBg });
            finalizeThinkingSourceTracking();

            // If a streamAndWait call is pending, resolve its promise
            // instead of processing the message queue.
            const resolver = streamCompletionResolverRef.current;
            if (resolver) {
              streamCompletionResolverRef.current = null;
              // Remove the empty placeholder message when content was hidden
              if (hideStreamContentRef.current && messageId) {
                setMessagesWindowed((prev: ChatMessage[]) => prev.filter((msg: ChatMessage) => msg.id !== messageId));
              }
              hideStreamContentRef.current = false;
              resolver({ content: lastStreamingContentRef.current, wasInterrupted: false });
              return;
            }

            continueQueuedConversation();
          };

          const handleMeta = (meta: StreamingMeta) => {
            streamingMetaRef.current = meta;
            setStreamingMeta(meta);
            const messageId = streamingMessageIdRef.current;
            if (!messageId) return;
            const thinkingMetaEvent = resolveValidatedThinkingMetaEvent(
              meta,
              messageId,
              currentGeneration,
              closedThinkingSourcesRef.current,
              thinkingDropDiagnosticsRef.current,
            );
            if (!thinkingMetaEvent) return;
            setMessagesWindowed((prev: ChatMessage[]) =>
              prev.map((msg: ChatMessage) =>
                msg.id === messageId
                  ? applyStreamPartEvent(msg, {
                      type: "thinking-meta",
                      thinkingSourceKey: thinkingMetaEvent.thinkingSourceKey,
                      targetMessageId: thinkingMetaEvent.targetMessageId,
                      streamGeneration: thinkingMetaEvent.streamGeneration,
                      thinkingMs: meta.thinkingMs,
                      thinkingText: thinkingMetaEvent.thinkingText,
                      includeReasoningPart: true,
                    })
                  : msg
              )
            );
          };

          void Promise.resolve(onStreamMessage(content, handleChunk, handleComplete, handleMeta, options)).catch((error) => {
            handleStreamStartupError(error, currentGeneration);
          });
        }
      },
      spawnSubagent: async (options) => {
        // Inject into main session — SDK's native sub-agent dispatch handles it.
        // Wait for the streaming response so the caller gets the actual result.
        //
        // IMPORTANT: For ralph review-fix loops, the sub-agent output must be
        // clean JSON without additional commentary. We hide the stream content
        // to avoid polluting the chat UI with intermediate steps.
        const agentName = options.name ?? options.model ?? "general-purpose";
        const task = options.message;

        let instruction: string;
        let silentOptions: import("./commands/registry.ts").StreamMessageOptions | undefined;
        if (agentType === "opencode") {
          // OpenCode SDK dispatches sub-agents via AgentPartInput parts.
          // Pass the agent name structurally so the client can construct the
          // correct prompt parts without string encoding.
          instruction = task;
          silentOptions = { agent: agentName };
        } else {
          // Claude SDK and Copilot SDK use the Task tool for sub-agent dispatch.
          // Explicitly request the agent tool and ask for the complete output
          // to be passed through without additional commentary.
          instruction = `Invoke the "${agentName}" sub-agent with the following task. Return ONLY the sub-agent's complete output with no additional commentary or explanation.

Task for ${agentName}:
${task}

Important: Do not add any text before or after the sub-agent's output. Pass through the complete response exactly as produced.`;
        }

        const result = await new Promise<import("./commands/registry.ts").StreamResult>((resolve) => {
          const previousResolver = streamCompletionResolverRef.current;
          if (previousResolver) {
            previousResolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
          }
          streamCompletionResolverRef.current = resolve;
          // Hide stream content to keep chat UI clean (content is still accumulated)
          hideStreamContentRef.current = true;
          context.sendSilentMessage(instruction, silentOptions);
        });
        
        // Reset hideStreamContent for next stream
        hideStreamContentRef.current = false;
        
        return {
          success: !result.wasInterrupted,
          output: result.content,
        };
      },
      spawnSubagentParallel: async (agents, externalAbortSignal) => {
        const bridge = subagentBridgeRef.current;
        if (!bridge) {
          throw new Error("SubagentGraphBridge not initialized. Cannot spawn parallel sub-agents.");
        }

        // Create an AbortController so Ctrl+C can cancel the bridge sessions.
        // Mark streaming as active so the Ctrl+C handler enters the abort path.
        const parallelAbortController = new AbortController();
        isStreamingRef.current = true;
        setIsStreaming(true);
        setStreamingState?.(true);

        // Forward external abort signal if provided
        if (externalAbortSignal) {
          if (externalAbortSignal.aborted) {
            parallelAbortController.abort();
          } else {
            externalAbortSignal.addEventListener(
              "abort",
              () => parallelAbortController.abort(),
              { once: true },
            );
          }
        }

        // Register a stream completion resolver so Ctrl+C's streamResolver
        // path can signal cancellation back to us.
        const previousResolver = streamCompletionResolverRef.current;
        streamCompletionResolverRef.current = (_result: import("./commands/registry.ts").StreamResult) => {
          // Ctrl+C fires this resolver — abort all bridge sessions
          parallelAbortController.abort();
        };

        try {
          return await bridge.spawnParallel(agents, parallelAbortController.signal);
        } finally {
          // Restore previous resolver (if any) and reset streaming flags
          if (streamCompletionResolverRef.current === null) {
            // Ctrl+C already cleared it — don't restore
          } else {
            streamCompletionResolverRef.current = previousResolver ?? null;
          }
          setStreamingWithFinalize(false);
          setStreamingState?.(false);
        }
      },
      streamAndWait: (prompt: string, options?: { hideContent?: boolean }) => {
        return new Promise<import("./commands/registry.ts").StreamResult>((resolve) => {
          const previousResolver = streamCompletionResolverRef.current;
          if (previousResolver) {
            previousResolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
          }
          streamCompletionResolverRef.current = resolve;
          hideStreamContentRef.current = options?.hideContent ?? false;
          // Delegate to sendSilentMessage logic
          context.sendSilentMessage(prompt);
        });
      },
      waitForUserInput: () => {
        return new Promise<string>((resolve, reject) => {
          waitForUserInputResolverRef.current = { resolve, reject };
        });
      },
      clearContext: async () => {
        if (onResetSession) {
          await onResetSession();
        }
        setMessagesWindowed((prev) => {
          appendToHistoryBuffer(prev);
          return [];
        });
        setCompactionSummary(null);
        setShowCompactionHistory(false);
        setParallelAgents([]);
        // Restore todoItems (preserved across context clears)
        const saved = todoItemsRef.current;
        setTodoItems(saved);
        // Restore workflow session state (preserved across context clears)
        setWorkflowSessionDir(workflowSessionDirRef.current);
        setWorkflowSessionId(workflowSessionIdRef.current);
      },
      setTodoItems: (items) => {
        const nextTodos = sortTasksTopologically(normalizeTodoItems(items));
        todoItemsRef.current = nextTodos;
        setTodoItems(nextTodos);
      },
      setWorkflowSessionDir: (dir: string | null) => {
        workflowSessionDirRef.current = dir;
        setWorkflowSessionDir(dir);
      },
      setWorkflowSessionId: (id: string | null) => {
        workflowSessionIdRef.current = id;
        setWorkflowSessionId(id);
      },
      setWorkflowTaskIds: (ids: Set<string>) => {
        workflowTaskIdsRef.current = ids;
      },
      updateWorkflowState: (update) => {
        updateWorkflowState(update);
      },
      agentType,
      modelOps,
      getModelDisplayInfo: getModelDisplayInfo
        ? async () => {
          const currentModel = modelOps?.getPendingModel?.() ?? await modelOps?.getCurrentModel() ?? currentModelRef.current;
          return getModelDisplayInfo(currentModel);
        }
        : undefined,
      getMcpServerToggles: () => mcpServerToggles,
      setMcpServerEnabled: (name: string, enabled: boolean) => {
        setMcpServerToggles((previous) => ({
          ...previous,
          [name]: enabled,
        }));
      },
      setSessionMcpServers: (servers: McpServerConfig[]) => {
        onSessionMcpServersChange?.(servers);
      },
    };

    // Delayed spinner: show loading indicator if command takes >250ms
    // Uses flushSync to force an immediate render so the spinner is visible
    // before the command completes (OpenTUI defers renders via setTimeout,
    // so without flushSync both state updates could batch into one render).
    let commandSpinnerShown = false;
    let commandSpinnerMsgId: string | null = null;
    const commandSpinnerTimer = setTimeout(() => {
      // Don't show spinner if command already set streaming (e.g., /compact)
      if (!isStreamingRef.current) {
        commandSpinnerShown = true;
        const msg = createMessage("assistant", "", true);
        msg.spinnerVerb = getSpinnerVerbForCommand(commandName);
        commandSpinnerMsgId = msg.id;
        const next = createStartedStreamControlState(
          {
            isStreaming: isStreamingRef.current,
            streamingMessageId: streamingMessageIdRef.current,
            streamingStart: streamingStartRef.current,
            hasStreamingMeta: streamingMetaRef.current !== null,
            hasRunningTool: hasRunningToolRef.current,
            isAgentOnlyStream: isAgentOnlyStreamRef.current,
            hasPendingCompletion: pendingCompleteRef.current !== null,
          },
          { messageId: msg.id, startedAt: Date.now() },
        );

        streamingMessageIdRef.current = next.streamingMessageId;
        streamingStartRef.current = next.streamingStart;
        streamingMetaRef.current = null;
        pendingCompleteRef.current = null;
        isAgentOnlyStreamRef.current = next.isAgentOnlyStream;
        isStreamingRef.current = next.isStreaming;
        hasRunningToolRef.current = next.hasRunningTool;
        runningAskQuestionToolIdsRef.current.clear();
        flushSync(() => {
          setIsStreaming(next.isStreaming);
          setStreamingMeta(null);
          setMessagesWindowed((prev) => [...prev, msg]);
        });
      }
    }, 250);

    try {
      // Execute the command (may be sync or async)
      const result = await Promise.resolve(command.execute(args, context));

      // Handle destroySession flag (e.g., /clear)
      if (result.destroySession && onResetSession) {
        void Promise.resolve(onResetSession());
        // Reset workflow state when session is destroyed
        updateWorkflowState({
          ...defaultWorkflowChatState,
        });
        // Reset UI state on session destroy (/clear)
        setCompactionSummary(null);
        setShowCompactionHistory(false);
        applyAutoCompactionIndicator(AUTO_COMPACTION_INDICATOR_IDLE_STATE);
        setParallelAgents([]);
        setTranscriptMode(false);
        clearHistoryBuffer();
        loadedSkillsRef.current.clear();
        // Reset workflow state on /clear (Copilot only)
        if (agentType === "copilot") {
          setWorkflowSessionDir(null);
          setWorkflowSessionId(null);
          workflowSessionDirRef.current = null;
          workflowSessionIdRef.current = null;
          workflowTaskIdsRef.current = new Set();
          todoItemsRef.current = [];
          setTodoItems([]);
        }
        // /clear postcondition contract: messages=[],
        // transcriptMode=false, historyBuffer=[], compactionSummary=null
        console.debug("[lifecycle] /clear postconditions: messages=[], transcriptMode=false, historyBuffer=[], compactionSummary=null");
      }

      // Handle clearMessages flag — persist history before clearing
      if (result.clearMessages) {
        const shouldResetHistory = result.destroySession || Boolean(result.compactionSummary);
        if (shouldResetHistory) {
          clearHistoryBuffer();
          if (result.compactionSummary) {
            appendCompactionSummary(result.compactionSummary);
          }
        } else {
          appendToHistoryBuffer(messages);
        }
        setMessagesWindowed([]);
      }

      // Store compaction summary if present (from /compact command)
      if (result.compactionSummary) {
        setCompactionSummary(result.compactionSummary);
        setShowCompactionHistory(false);
        // /compact postcondition contract: messages=[],
        // historyBuffer=[summary marker only], compactionSummary=<summary text>
        console.debug(`[lifecycle] /compact postconditions: messages=[], historyBuffer=[summary], compactionSummary=${result.compactionSummary?.slice(0, 50)}...`);
      }

      // Apply state updates if present
      if (result.stateUpdate) {
        updateWorkflowState({
          workflowActive: result.stateUpdate.workflowActive !== undefined ? result.stateUpdate.workflowActive : workflowState.workflowActive,
          workflowType: result.stateUpdate.workflowType !== undefined ? result.stateUpdate.workflowType : workflowState.workflowType,
          initialPrompt: result.stateUpdate.initialPrompt !== undefined ? result.stateUpdate.initialPrompt : workflowState.initialPrompt,
          currentNode: result.stateUpdate.currentNode !== undefined ? result.stateUpdate.currentNode : workflowState.currentNode,
          iteration: result.stateUpdate.iteration !== undefined ? result.stateUpdate.iteration : workflowState.iteration,
          maxIterations: result.stateUpdate.maxIterations !== undefined ? result.stateUpdate.maxIterations : workflowState.maxIterations,
          featureProgress: result.stateUpdate.featureProgress !== undefined ? result.stateUpdate.featureProgress : workflowState.featureProgress,
          pendingApproval: result.stateUpdate.pendingApproval !== undefined ? result.stateUpdate.pendingApproval : workflowState.pendingApproval,
          specApproved: result.stateUpdate.specApproved !== undefined ? result.stateUpdate.specApproved : workflowState.specApproved,
          feedback: result.stateUpdate.feedback !== undefined ? result.stateUpdate.feedback : workflowState.feedback,
          workflowConfig: result.stateUpdate.workflowConfig !== undefined ? result.stateUpdate.workflowConfig : workflowState.workflowConfig,
        });

        // Also update isStreaming if specified
        if (result.stateUpdate.isStreaming !== undefined) {
          setIsStreaming(result.stateUpdate.isStreaming);
        }

        // Notify parent when model changes via /model command
        const modelUpdate = (result.stateUpdate as Record<string, unknown>).model;
        if (typeof modelUpdate === "string") {
          setCurrentModelId(modelUpdate);
          setCurrentModelDisplayName(modelUpdate);
          onModelChange?.(modelUpdate);
        }
      }

      // Display message if present (as assistant message, not system)
      // Skip if the delayed spinner already placed the message (and messages weren't cleared)
      if (result.message && (!commandSpinnerShown || result.clearMessages)) {
        addMessage("assistant", result.message);
      }

      // Track MCP snapshot in message for UI indicator
      if (result.mcpSnapshot) {
        const mcpSnapshot = result.mcpSnapshot;
        setMessagesWindowed((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, mcpSnapshot },
            ];
          }
          // No assistant message yet — create one with MCP snapshot
          const msg = createMessage("assistant", "");
          msg.mcpSnapshot = mcpSnapshot;
          return [...prev, msg];
        });
      }

      // Track skill load in message for UI indicator (with session-level deduplication)
      if (result.skillLoaded && !loadedSkillsRef.current.has(result.skillLoaded)) {
        loadedSkillsRef.current.add(result.skillLoaded);
        const skillLoad: MessageSkillLoad = {
          skillName: result.skillLoaded,
          status: result.skillLoadError ? "error" : "loaded",
          errorMessage: result.skillLoadError,
        };
        setMessagesWindowed((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, skillLoads: [...(lastMsg.skillLoads || []), skillLoad] },
            ];
          }
          const msg = createMessage("assistant", "");
          msg.skillLoads = [skillLoad];
          return [...prev, msg];
        });
      }

      // Handle exit command
      if (result.shouldExit) {
        // Small delay to show the message before exiting
        setTimeout(() => {
          onExit?.();
        }, 100);
      }

      // Handle model selector request
      if (result.showModelSelector) {
        // Fetch available models and show the selector
        const models = await modelOps?.listAvailableModels() ?? [];
        const currentModel = await modelOps?.getCurrentModel();
        setAvailableModels(models);
        setCurrentModelId(currentModel);
        setShowModelSelector(true);
      }

      // Handle theme change request
      if (result.themeChange) {
        if (result.themeChange === "toggle") {
          toggleTheme();
        } else {
          setTheme(result.themeChange === "light" ? lightTheme : darkTheme);
        }
      }

      // Clean up delayed spinner after all async result handling
      clearTimeout(commandSpinnerTimer);
      if (commandSpinnerShown && commandSpinnerMsgId) {
        const msgId = commandSpinnerMsgId;
        const hasStructuredPayload = Boolean(
          result.mcpSnapshot || result.skillLoaded
        );
        if ((result.message || hasStructuredPayload) && !result.clearMessages) {
          // Preserve the spinner placeholder when command data is attached to it.
          setMessagesWindowed((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? { ...msg, content: result.message ?? msg.content, streaming: false }
                : msg
            )
          );
        } else {
          // Remove spinner message (either no result or messages will be cleared)
          setMessagesWindowed((prev) => prev.filter((msg) => msg.id !== msgId));
        }
        
        // Only reset streaming state if the current stream is still the spinner stream
        if (streamingMessageIdRef.current === msgId) {
          stopSharedStreamState({ resetStreamingStateHook: false });
        }
      }

      onCommandExecutionTelemetry?.({
        commandName,
        commandCategory: command.category,
        argsLength: args.length,
        success: result.success,
        trigger,
      });

      return result.success;
    } catch (error) {
      // Clean up delayed spinner on error
      clearTimeout(commandSpinnerTimer);
      if (commandSpinnerShown && commandSpinnerMsgId) {
        const msgId = commandSpinnerMsgId;
        setMessagesWindowed((prev) => prev.filter((msg) => msg.id !== msgId));
        
        // Only reset streaming state if the current stream is still the spinner stream
        if (streamingMessageIdRef.current === msgId) {
          stopSharedStreamState({ resetStreamingStateHook: false });
        }
      }
      // Handle execution error (as assistant message, not system)
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Error executing /${commandName}: ${errorMessage}`);
      onCommandExecutionTelemetry?.({
        commandName,
        commandCategory: command.category,
        argsLength: args.length,
        success: false,
        trigger,
      });
      return false;
    }
  }, [isStreaming, messages.length, workflowState, addMessage, updateWorkflowState, toggleTheme, setTheme, onSendMessage, onStreamMessage, getSession, model, onModelChange, onSessionMcpServersChange, onCommandExecutionTelemetry, mcpServerToggles, handleStreamStartupError, stopSharedStreamState, applyAutoCompactionIndicator]);

  /**
   * Handle autocomplete selection (Tab for complete, Enter for execute).
   */
  const handleAutocompleteSelect = useCallback((
    command: CommandDefinition,
    action: "complete" | "execute"
  ) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const isMention = workflowState.autocompleteMode === "mention";

    if (isMention) {
      // Replace only the @mention token (supports mid-text mentions)
      const fullText = textarea.plainText ?? "";
      const mentionStart = workflowState.mentionStartOffset;
      const mentionEnd = mentionStart + 1 + workflowState.autocompleteInput.length;
      const before = fullText.slice(0, mentionStart);
      const after = fullText.slice(mentionEnd);

      textarea.gotoBufferHome();
      textarea.gotoBufferEnd({ select: true });
      textarea.deleteChar();

      if (action === "complete") {
        const isDirectoryMention = command.name.endsWith("/");
        const suffix = isDirectoryMention ? "" : " ";
        const replacement = `@${command.name}${suffix}`;
        textarea.insertText(before + replacement + after);
        textarea.cursorOffset = mentionStart + replacement.length;

        if (isDirectoryMention) {
          updateWorkflowState({
            showAutocomplete: true,
            autocompleteInput: command.name,
            selectedSuggestionIndex: 0,
            autocompleteMode: "mention",
            mentionStartOffset: mentionStart,
            argumentHint: "",
          });
        } else {
          updateWorkflowState({
            showAutocomplete: false,
            autocompleteInput: "",
            selectedSuggestionIndex: 0,
            autocompleteMode: "command",
            argumentHint: "",
          });
        }
      } else if (action === "execute") {
        if (command.category !== "agent") {
          // File/directory @ mention: insert into text
          const isDirectory = command.name.endsWith("/");
          const suffix = isDirectory ? "" : " ";
          const replacement = `@${command.name}${suffix}`;
          textarea.insertText(before + replacement + after);
          textarea.cursorOffset = mentionStart + replacement.length;
          updateWorkflowState({
            showAutocomplete: false,
            autocompleteInput: "",
            selectedSuggestionIndex: 0,
            autocompleteMode: "command",
            argumentHint: "",
          });
        } else {
          // Agent @ mention: execute immediately, restore remaining text
          const remaining = (before + after).trim();
          if (remaining) textarea.insertText(remaining);
          updateWorkflowState({
            showAutocomplete: false,
            autocompleteInput: "",
            selectedSuggestionIndex: 0,
            autocompleteMode: "command",
            argumentHint: "",
          });
          addMessage("user", remaining ? `@${command.name} ${remaining}` : `@${command.name}`);
          void executeCommand(command.name, remaining, "mention");
        }
      }
    } else {
      // Slash command: clear entire input
      textarea.gotoBufferHome();
      textarea.gotoBufferEnd({ select: true });
      textarea.deleteChar();

      updateWorkflowState({
        showAutocomplete: false,
        autocompleteInput: "",
        selectedSuggestionIndex: 0,
        autocompleteMode: "command",
        argumentHint: action === "complete" ? (command.argumentHint || "") : "",
      });

      if (action === "complete") {
        textarea.insertText(`/${command.name} `);
      } else {
        addMessage("user", `/${command.name}`);
        void executeCommand(command.name, "", "autocomplete");
      }
    }
  }, [updateWorkflowState, executeCommand, addMessage, workflowState.autocompleteMode, workflowState.mentionStartOffset, workflowState.autocompleteInput]);

  /**
   * Handle autocomplete index changes (up/down navigation).
   */
  const handleAutocompleteIndexChange = useCallback((index: number) => {
    updateWorkflowState({ selectedSuggestionIndex: index });
  }, [updateWorkflowState]);

  // Key bindings for textarea: Enter submits, Shift+Enter/Alt+Enter/Ctrl+J adds newline
  const textareaKeyBindings: KeyBinding[] = [
    { name: "return", action: "submit" },
    { name: "linefeed", action: "newline" },
    { name: "return", shift: true, action: "newline" },
    { name: "linefeed", shift: true, action: "newline" },
    { name: "return", meta: true, action: "newline" },
    { name: "linefeed", meta: true, action: "newline" },
  ];

  const normalizePastedText = useCallback((text: string) => {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }, []);

  // Handle clipboard copy - copies selected text to system clipboard
  // Checks both textarea selection and renderer (mouse-drag) selection
  const handleCopy = useCallback(() => {
    const textarea = textareaRef.current;
    // Type assertion for method that exists at runtime but not in type definitions
    const copyToClipboard = (text: string) =>
      (renderer as unknown as { copyToClipboardOSC52: (text: string) => void }).copyToClipboardOSC52(text);

    // First, check textarea selection (input area)
    if (textarea?.hasSelection()) {
      const selectedText = textarea.getSelectedText();
      if (selectedText) {
        copyToClipboard(selectedText);
        return;
      }
    }

    // Then, check renderer selection (mouse-drag on chat content)
    const selection = renderer.getSelection();
    if (selection) {
      const selectedText = selection.getSelectedText();
      if (selectedText) {
        copyToClipboard(selectedText);
        renderer.clearSelection();
      }
    }
  }, [renderer]);

  // Handle bracketed paste events from OpenTUI
  // This is the primary paste handler for modern terminals that support bracketed paste mode
  const handleBracketedPaste = useCallback((event: PasteEvent) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    event.preventDefault();
    textarea.insertText(normalizePastedText(event.text));
    handleTextareaContentChange();
  }, [handleTextareaContentChange, normalizePastedText]);

  // Get current autocomplete suggestions count for navigation
  const autocompleteSuggestions = workflowState.showAutocomplete
    ? workflowState.autocompleteMode === "mention"
      ? getMentionSuggestions(workflowState.autocompleteInput)
      : globalRegistry.search(workflowState.autocompleteInput)
    : [];

  // Handle keyboard events for exit, clipboard, and autocomplete navigation
  useKeyboard(
    useCallback(
      (event: KeyEvent) => {
        // Detect advanced keyboard protocol support used for newline handling.
        // Keep Enter-specific CSI-u detection (task #1) and also treat
        // modifyOtherKeys CSI sequences as protocol-active.
        kittyKeyboardDetectedRef.current = getNextKittyKeyboardDetectionState(
          kittyKeyboardDetectedRef.current,
          event.raw,
        );

        // Ctrl+C handling must work everywhere (even in dialogs) for double-press exit
        if (event.ctrl && event.name === "c") {
          const textarea = textareaRef.current;
          // If textarea or renderer has selection and no dialog is active, copy instead of interrupt/exit
          const hasRendererSelection = !!renderer.getSelection()?.getSelectedText();
          if (!activeQuestion && !showModelSelector && (textarea?.hasSelection() || hasRendererSelection)) {
            void handleCopy();
            return;
          }

          // If streaming, interrupt (abort) the current operation
          // Use ref for immediate check — avoids stale closure when React
          // hasn't re-rendered after setIsStreaming(true)
          if (isStreamingRef.current) {
            // Invalidate current stream callbacks before interrupting the SDK,
            // so synchronous onComplete callbacks from an interrupt become stale.
            streamGenerationRef.current = invalidateActiveStreamGeneration(streamGenerationRef.current);
            clearDeferredCompletion();
            // Abort the stream FIRST so chunks stop arriving immediately
            onInterrupt?.();

            // Read agents synchronously from ref (avoids nested dispatch issues)
            const currentAgents = parallelAgentsRef.current;
            const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(currentAgents);

            // Keep background agents alive in refs
            parallelAgentsRef.current = remainingLiveAgents;
            setParallelAgents(remainingLiveAgents);

            // Finalize in_progress task items -> pending and bake into message
            const interruptedTaskItems = finalizeTaskItemsOnInterrupt();

            // Bake interrupted agents into message and stop streaming
            const interruptedId = streamingMessageIdRef.current;
            // Capture duration before stopSharedStreamState nulls streamingStartRef
            const durationMs = streamingStartRef.current
              ? Date.now() - streamingStartRef.current
              : undefined;
            const finalMeta = streamingMetaRef.current;
            if (interruptedId) {
              setMessagesWindowed((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === interruptedId
                    ? {
                      ...finalizeStreamingReasoningInMessage(msg),
                      wasInterrupted: true,
                      streaming: false,
                      durationMs,
                      outputTokens: finalMeta?.outputTokens,
                      thinkingMs: finalMeta?.thinkingMs,
                      thinkingText: finalMeta?.thinkingText || undefined,
                      parallelAgents: interruptedAgents,
                      taskItems: interruptedTaskItems,
                      toolCalls: interruptRunningToolCalls(msg.toolCalls),
                      parts: interruptRunningToolParts(msg.parts),
                    }
                    : msg
                )
              );
            }

            // Stop streaming state immediately so UI reflects interrupted state
            wasInterruptedRef.current = false;
            stopSharedStreamState();
            finalizeThinkingSourceTracking();
            activeHitlToolCallIdRef.current = null;

            // Resolve streamAndWait promise with interrupted flag so workflow can react
            const streamResolver = streamCompletionResolverRef.current;
            if (streamResolver) {
              streamCompletionResolverRef.current = null;
              if (hideStreamContentRef.current && interruptedId) {
                setMessagesWindowed((prev: ChatMessage[]) => prev.filter((msg: ChatMessage) => msg.id !== interruptedId));
              }
              hideStreamContentRef.current = false;

              if (workflowState.workflowActive && interruptCount >= 1) {
                // Double Ctrl+C during streaming — cancel workflow
                streamResolver({ content: lastStreamingContentRef.current, wasInterrupted: true, wasCancelled: true });
              } else {
                streamResolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
              }
            }

            if (workflowState.workflowActive) {
              const newCount = interruptCount + 1;
              if (newCount >= 2) {
                // Double Ctrl+C — terminate workflow
                updateWorkflowState({ workflowActive: false, workflowType: null, initialPrompt: null });
                if (waitForUserInputResolverRef.current) {
                  waitForUserInputResolverRef.current.reject(new Error("Workflow cancelled"));
                  waitForUserInputResolverRef.current = null;
                }
                setInterruptCount(0);
                if (interruptTimeoutRef.current) {
                  clearTimeout(interruptTimeoutRef.current);
                  interruptTimeoutRef.current = null;
                }
                setCtrlCPressed(false);
              } else {
                // Single Ctrl+C — cancel stream, workflow will waitForUserInput
                setInterruptCount(newCount);
                setCtrlCPressed(true);
                if (interruptTimeoutRef.current) {
                  clearTimeout(interruptTimeoutRef.current);
                }
                interruptTimeoutRef.current = setTimeout(() => {
                  setInterruptCount(0);
                  setCtrlCPressed(false);
                  interruptTimeoutRef.current = null;
                }, 1000);
              }
            } else {
              setInterruptCount(0);
              if (interruptTimeoutRef.current) {
                clearTimeout(interruptTimeoutRef.current);
                interruptTimeoutRef.current = null;
              }
              setCtrlCPressed(false);
              continueQueuedConversation();
            }
            return;
          }

          // If not streaming but subagents are still running, mark them interrupted
          {
            const currentAgents = parallelAgentsRef.current;
            // Only check for foreground agents - background agents should continue running
            const foregroundAgents = currentAgents.filter(a => !isBackgroundAgent(a));
            const hasRunningForegroundAgents = foregroundAgents.some(
              (a) => a.status === "running" || a.status === "pending"
            );
            if (hasRunningForegroundAgents) {
              // Inform parent integration so SDK-side run/correlation state is reset too.
              onInterrupt?.();
              const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(currentAgents);
              // Finalize in_progress task items -> pending and bake into message
              const interruptedTaskItems = finalizeTaskItemsOnInterrupt();

              const interruptedId = streamingMessageIdRef.current;
              if (interruptedId) {
                setMessagesWindowed((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === interruptedId
                      ? {
                        ...msg,
                        parallelAgents: interruptedAgents,
                        taskItems: interruptedTaskItems,
                        toolCalls: interruptRunningToolCalls(msg.toolCalls),
                        parts: interruptRunningToolParts(msg.parts),
                      }
                      : msg
                  )
                );
              }
              parallelAgentsRef.current = remainingLiveAgents;
              setParallelAgents(remainingLiveAgents);
              clearDeferredCompletion();
              wasInterruptedRef.current = false;
              stopSharedStreamState();
              finalizeThinkingSourceTracking();
              continueQueuedConversation();
              return;
            }
          }

          // Not streaming: if textarea has content, clear it first
          if (textarea?.plainText) {
            textarea.gotoBufferHome();
            textarea.gotoBufferEnd({ select: true });
            textarea.deleteChar();
            return;
          }

          // Textarea empty: use double-press to cancel workflow or exit
          const newCount = interruptCount + 1;
          if (newCount >= 2) {
            setInterruptCount(0);
            if (interruptTimeoutRef.current) {
              clearTimeout(interruptTimeoutRef.current);
              interruptTimeoutRef.current = null;
            }
            setCtrlCPressed(false);

            if (workflowState.workflowActive) {
              // Double Ctrl+C — terminate workflow
              updateWorkflowState({ workflowActive: false, workflowType: null, initialPrompt: null });
              if (waitForUserInputResolverRef.current) {
                waitForUserInputResolverRef.current.reject(new Error("Workflow cancelled"));
                waitForUserInputResolverRef.current = null;
              }
            } else {
              // Double press - exit
              onExit?.();
            }
            return;
          }

          // First press - show warning and set timeout
          setInterruptCount(newCount);
          setCtrlCPressed(true);
          if (interruptTimeoutRef.current) {
            clearTimeout(interruptTimeoutRef.current);
          }
          interruptTimeoutRef.current = setTimeout(() => {
            setInterruptCount(0);
            setCtrlCPressed(false);
            interruptTimeoutRef.current = null;
          }, 1000);
          return;
        }

        // While a dialog is active, it owns keyboard input exclusively.
        // Keep Ctrl+C handling above for copy/interrupt semantics.
        if (activeQuestion || showModelSelector) {
          return;
        }

        // Ctrl+F - terminate active background agents (double press confirmation)
        if (isBackgroundTerminationKey(event)) {
          // Keep foreground stream interruption on ESC/Ctrl+C only.
          if (isStreamingRef.current) {
            return;
          }

          const currentAgents = parallelAgentsRef.current;
          const activeBackgroundAgents = getActiveBackgroundAgents(currentAgents);
          const decision = getBackgroundTerminationDecision(
            backgroundTerminationCount,
            activeBackgroundAgents.length,
          );

          console.debug("[background-termination] decision:", decision.action, {
            pressCount: backgroundTerminationCount,
            activeAgents: activeBackgroundAgents.length,
          });

          if (decision.action === "none") {
            console.debug("[background-termination] noop: no active background agents");
            clearBackgroundTerminationConfirmation();
            return;
          }

          if (decision.action === "terminate") {
            if (backgroundTerminationInFlightRef.current) {
              return;
            }
            backgroundTerminationInFlightRef.current = true;
            clearBackgroundTerminationConfirmation();

            const { agents: interruptedAgents, interruptedIds } = interruptActiveBackgroundAgents(currentAgents);
            if (interruptedIds.length === 0) {
              backgroundTerminationInFlightRef.current = false;
              return;
            }

            console.debug("[background-termination] executing termination", {
              interruptedIds,
              remainingCount: currentAgents.filter((agent) => !new Set(interruptedIds).has(agent.id)).length,
            });

            const interruptedIdSet = new Set(interruptedIds);
            const remainingLiveAgents = currentAgents.filter((agent) => !interruptedIdSet.has(agent.id));

            const interruptedMessageId = backgroundAgentMessageIdRef.current ?? streamingMessageIdRef.current;
            if (interruptedMessageId) {
              setMessagesWindowed((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === interruptedMessageId
                    ? {
                      ...msg,
                      parallelAgents: interruptedAgents,
                    }
                    : msg
                )
              );
            }

            parallelAgentsRef.current = remainingLiveAgents;
            setParallelAgents(remainingLiveAgents);
            backgroundAgentMessageIdRef.current = null;
            streamingStartRef.current = null;
            clearDeferredCompletion();

            void Promise.resolve(onTerminateBackgroundAgents?.()).catch((error) => {
              console.error("[background-termination] parent callback failed:", error);
            });
            addMessage("system", `${STATUS.active} ${decision.message}`);
            backgroundTerminationInFlightRef.current = false;
            return;
          }

          console.debug("[background-termination] armed: awaiting confirmation");
          setBackgroundTerminationCount(1);
          setCtrlFPressed(true);
          if (backgroundTerminationTimeoutRef.current) {
            clearTimeout(backgroundTerminationTimeoutRef.current);
          }
          backgroundTerminationTimeoutRef.current = setTimeout(() => {
            setBackgroundTerminationCount(0);
            setCtrlFPressed(false);
            backgroundTerminationTimeoutRef.current = null;
          }, 1000);
          return;
        }

        // Ctrl+O - toggle transcript mode (full-screen detailed view)
        if (event.ctrl && event.name === "o") {
          setTranscriptMode(prev => !prev);
          return;
        }

        // Ctrl+T - toggle todo list panel visibility
        if (event.ctrl && !event.shift && event.name === "t") {
          setShowTodoPanel(prev => !prev);
          return;
        }

        // Skip other keyboard handling when a dialog is active
        // The dialog components handle their own keyboard events via their own useKeyboard hooks
        if (activeQuestion || showModelSelector) {
          // Don't call stopPropagation - let the event continue to the dialog's handler
          return;
        }

        // ESC key - interrupt streaming, hide autocomplete, or exit queue editing
        // NOTE: ESC does NOT exit the TUI. Use /exit command or Ctrl+C twice to exit.
        if (event.name === "escape") {
          // First, hide autocomplete if visible
          if (workflowState.showAutocomplete) {
            updateWorkflowState({
              showAutocomplete: false,
              autocompleteInput: "",
              selectedSuggestionIndex: 0,
            });
            return;
          }

          // Exit queue editing mode if active
          if (isEditingQueue) {
            setIsEditingQueue(false);
            messageQueue.setEditIndex(-1);
            return;
          }

          // If streaming, interrupt (abort) the current operation
          // Use ref for immediate check — avoids stale closure when React
          // hasn't re-rendered after setIsStreaming(true)
          if (isStreamingRef.current) {
            // Invalidate current stream callbacks before interrupting the SDK,
            // so synchronous onComplete callbacks from an interrupt become stale.
            streamGenerationRef.current = invalidateActiveStreamGeneration(streamGenerationRef.current);
            clearDeferredCompletion();
            // Abort the stream FIRST so chunks stop arriving immediately
            onInterrupt?.();

            // Read agents synchronously from ref (avoids nested dispatch issues)
            const currentAgents = parallelAgentsRef.current;
            const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(currentAgents);

            // Keep background agents alive in refs
            parallelAgentsRef.current = remainingLiveAgents;
            setParallelAgents(remainingLiveAgents);

            // Finalize in_progress task items -> pending and bake into message
            const interruptedTaskItems = finalizeTaskItemsOnInterrupt();

            // Bake interrupted agents into message and stop streaming
            const interruptedId = streamingMessageIdRef.current;
            // Capture timing/meta BEFORE stopSharedStreamState() clears them
            const frozenDurationMs = streamingStartRef.current
              ? Date.now() - streamingStartRef.current
              : undefined;
            const frozenMeta = streamingMetaRef.current
              ? { ...streamingMetaRef.current }
              : undefined;
            if (interruptedId) {
              setMessagesWindowed((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === interruptedId
                    ? {
                      ...finalizeStreamingReasoningInMessage(msg),
                      wasInterrupted: true,
                      streaming: false,
                      ...(frozenDurationMs != null && { durationMs: frozenDurationMs }),
                      ...(frozenMeta && { streamingMeta: frozenMeta }),
                      parallelAgents: interruptedAgents,
                      taskItems: interruptedTaskItems,
                      toolCalls: interruptRunningToolCalls(msg.toolCalls),
                      parts: interruptRunningToolParts(msg.parts),
                    }
                    : msg
                )
              );
            }

            // Stop streaming state immediately so UI reflects interrupted state
            wasInterruptedRef.current = false;
            stopSharedStreamState();
            finalizeThinkingSourceTracking();
            setActiveQuestion(null);
            askUserQuestionRequestIdRef.current = null;
            activeHitlToolCallIdRef.current = null;

            // Resolve streamAndWait promise with interrupted flag so workflow can react
            const streamResolver = streamCompletionResolverRef.current;
            if (streamResolver) {
              streamCompletionResolverRef.current = null;
              if (hideStreamContentRef.current && interruptedId) {
                setMessagesWindowed((prev: ChatMessage[]) => prev.filter((msg: ChatMessage) => msg.id !== interruptedId));
              }
              hideStreamContentRef.current = false;
              streamResolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
            }

            if (!workflowState.workflowActive) {
              continueQueuedConversation();
            }
            return;
          }

          // If not streaming but subagents are still running, mark them interrupted
          {
            const currentAgents = parallelAgentsRef.current;
            // Only check for foreground agents - background agents should continue running
            const foregroundAgents = currentAgents.filter(a => !isBackgroundAgent(a));
            const hasRunningForegroundAgents = foregroundAgents.some(
              (a) => a.status === "running" || a.status === "pending"
            );
            if (hasRunningForegroundAgents) {
              // Inform parent integration so SDK-side run/correlation state is reset too.
              onInterrupt?.();
              const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(currentAgents);
              // Finalize in_progress task items -> pending and bake into message
              const interruptedTaskItems = finalizeTaskItemsOnInterrupt();

              const interruptedId = streamingMessageIdRef.current;
              if (interruptedId) {
                setMessagesWindowed((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === interruptedId
                      ? {
                        ...msg,
                        parallelAgents: interruptedAgents,
                        taskItems: interruptedTaskItems,
                        toolCalls: interruptRunningToolCalls(msg.toolCalls),
                        parts: interruptRunningToolParts(msg.parts),
                      }
                      : msg
                  )
                );
              }
              parallelAgentsRef.current = remainingLiveAgents;
              setParallelAgents(remainingLiveAgents);
              clearDeferredCompletion();
              wasInterruptedRef.current = false;
              stopSharedStreamState();
              continueQueuedConversation();
              return;
            }
          }

          // ESC when idle does nothing - use /exit or Ctrl+C twice to exit
          return;
        }

        // PageUp - scroll messages up
        if (event.name === "pageup") {
          if (scrollboxRef.current) {
            scrollboxRef.current.scrollBy(-scrollboxRef.current.height / 2);
          }
          return;
        }

        // PageDown - scroll messages down
        if (event.name === "pagedown") {
          if (scrollboxRef.current) {
            scrollboxRef.current.scrollBy(scrollboxRef.current.height / 2);
          }
          return;
        }

        // Autocomplete navigation: Up arrow - navigate up
        if (event.name === "up" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
          const newIndex = navigateUp(workflowState.selectedSuggestionIndex, autocompleteSuggestions.length);
          updateWorkflowState({ selectedSuggestionIndex: newIndex });
          return;
        }

        // Queue editing: Up arrow - navigate queue messages
        if (event.name === "up" && messageQueue.count > 0 && !isStreaming) {
          const textarea = textareaRef.current;
          if (messageQueue.currentEditIndex === -1) {
            // Enter edit mode at last message - load its content into textarea
            const lastIndex = messageQueue.count - 1;
            const queuedMessage = messageQueue.queue[lastIndex];
            if (queuedMessage && textarea) {
              // Save current input before loading queue message (if any)
              // Clear textarea and insert queued message content
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(queuedMessage.content);
            }
            messageQueue.setEditIndex(lastIndex);
            setIsEditingQueue(true);
          } else if (messageQueue.currentEditIndex > 0) {
            // Save current edits before moving to previous message
            if (textarea) {
              const currentContent = textarea.plainText ?? "";
              messageQueue.updateAt(messageQueue.currentEditIndex, currentContent);
            }
            // Move to previous message - load its content
            const prevIndex = messageQueue.currentEditIndex - 1;
            const prevMessage = messageQueue.queue[prevIndex];
            if (prevMessage && textarea) {
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(prevMessage.content);
            }
            messageQueue.setEditIndex(prevIndex);
          }
          return;
        }

        // Queue editing: Down arrow - navigate queue messages
        if (event.name === "down" && isEditingQueue && messageQueue.count > 0) {
          const textarea = textareaRef.current;
          if (messageQueue.currentEditIndex < messageQueue.count - 1) {
            // Save current edits before moving to next message
            if (textarea) {
              const currentContent = textarea.plainText ?? "";
              messageQueue.updateAt(messageQueue.currentEditIndex, currentContent);
            }
            // Move to next message - load its content
            const nextIndex = messageQueue.currentEditIndex + 1;
            const nextMessage = messageQueue.queue[nextIndex];
            if (nextMessage && textarea) {
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(nextMessage.content);
            }
            messageQueue.setEditIndex(nextIndex);
          } else {
            // Save current edits and exit edit mode
            if (textarea) {
              const currentContent = textarea.plainText ?? "";
              messageQueue.updateAt(messageQueue.currentEditIndex, currentContent);
              // Clear textarea when exiting edit mode
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
            }
            setIsEditingQueue(false);
            messageQueue.setEditIndex(-1);
          }
          return;
        }

        // Autocomplete navigation: Down arrow - navigate down
        if (event.name === "down" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
          const newIndex = navigateDown(workflowState.selectedSuggestionIndex, autocompleteSuggestions.length);
          updateWorkflowState({ selectedSuggestionIndex: newIndex });
          return;
        }

        // Prompt history & cursor navigation: Up arrow
        // Rule 1: first line + not index 0 → move cursor to index 0
        // Rule 3: index 0 → navigate older history; down just moves in chatbox
        // Rule 4: at last index, up just moves up in chatbox (no history)
        if (
          event.name === "up"
          && !workflowState.showAutocomplete
          && !isEditingQueue
          && (isStreaming || messageQueue.count === 0)
        ) {
          const textarea = textareaRef.current;
          if (textarea) {
            const cursorOffset = textarea.cursorOffset;
            if (cursorOffset === 0) {
              // At index 0: navigate to older history (Rule 3)
              if (promptHistoryRef.current.length > 0) {
                const hIdx = historyIndexRef.current;
                const history = promptHistoryRef.current;
                historyNavigatingRef.current = true;
                if (hIdx === -1) {
                  savedInputRef.current = textarea.plainText ?? "";
                  const newIndex = history.length - 1;
                  historyIndexRef.current = newIndex;
                  setHistoryIndex(newIndex);
                  textarea.gotoBufferHome();
                  textarea.gotoBufferEnd({ select: true });
                  textarea.deleteChar();
                  textarea.insertText(history[newIndex]!);
                  textarea.gotoBufferHome();
                } else if (hIdx > 0) {
                  const newIndex = hIdx - 1;
                  historyIndexRef.current = newIndex;
                  setHistoryIndex(newIndex);
                  textarea.gotoBufferHome();
                  textarea.gotoBufferEnd({ select: true });
                  textarea.deleteChar();
                  textarea.insertText(history[newIndex]!);
                  textarea.gotoBufferHome();
                }
                historyNavigatingRef.current = false;
                event.stopPropagation();
                return;
              }
              // No history and already at index 0 — fall through to scrollbox handler
            } else {
              // Not at index 0: check if on first visual line (Rule 1)
              const absoluteVisualRow = Math.floor(textarea.scrollY) + textarea.visualCursor.visualRow;
              if (absoluteVisualRow === 0) {
                textarea.gotoBufferHome();
                event.stopPropagation();
                return;
              }
              // Not on first line — let textarea handle cursor-up naturally (Rule 4)
            }
          }
        }

        // Prompt history & cursor navigation: Down arrow
        // Rule 2: last line + not last index → move cursor to last index
        // Rule 3: at index 0, down just moves down in chatbox (no history)
        // Rule 4: at last index → navigate newer history
        if (
          event.name === "down"
          && !workflowState.showAutocomplete
          && !isEditingQueue
          && (isStreaming || messageQueue.count === 0)
        ) {
          const textarea = textareaRef.current;
          if (textarea) {
            const cursorOffset = textarea.cursorOffset;
            const textLength = (textarea.plainText ?? "").length;
            if (cursorOffset === textLength) {
              // At last index: navigate to newer history (Rule 4)
              if (historyIndexRef.current >= 0) {
                const hIdx = historyIndexRef.current;
                const history = promptHistoryRef.current;
                historyNavigatingRef.current = true;
                if (hIdx < history.length - 1) {
                  const newIndex = hIdx + 1;
                  historyIndexRef.current = newIndex;
                  setHistoryIndex(newIndex);
                  textarea.gotoBufferHome();
                  textarea.gotoBufferEnd({ select: true });
                  textarea.deleteChar();
                  textarea.insertText(history[newIndex]!);
                } else {
                  historyIndexRef.current = -1;
                  setHistoryIndex(-1);
                  textarea.gotoBufferHome();
                  textarea.gotoBufferEnd({ select: true });
                  textarea.deleteChar();
                  if (savedInputRef.current) {
                    textarea.insertText(savedInputRef.current);
                  }
                }
                historyNavigatingRef.current = false;
                event.stopPropagation();
                return;
              }
              // Not in history mode and already at last index — fall through to scrollbox handler
            } else {
              // Not at last index: check if on last visual line (Rule 2)
              const absoluteVisualRow = Math.floor(textarea.scrollY) + textarea.visualCursor.visualRow;
              const totalVirtualLines = textarea.editorView.getTotalVirtualLineCount();
              if (absoluteVisualRow >= totalVirtualLines - 1) {
                textarea.gotoBufferEnd();
                event.stopPropagation();
                return;
              }
              // Not on last line — let textarea handle cursor-down naturally (Rule 3)
            }
          }
        }

        // Arrow key scrolling: when idle and input is empty, up/down scroll the scrollbox
        if (
          (event.name === "up" || event.name === "down") &&
          !workflowState.showAutocomplete &&
          !isEditingQueue &&
          !isStreaming &&
          messageQueue.count === 0
        ) {
          const inputValue = textareaRef.current?.plainText ?? "";
          if (inputValue.trim() === "" && scrollboxRef.current) {
            const lineHeight = 1;
            scrollboxRef.current.scrollBy(event.name === "up" ? -lineHeight : lineHeight);
            return;
          }
        }

        // Shift+Enter or Alt+Enter - insert newline
        // (unless streaming + enqueue shortcut is used)
        // Must be handled here (before autocomplete Enter handler) with stopPropagation
        // to prevent the textarea's built-in "return → submit" key binding from firing.
        // Ctrl+J (linefeed without shift) also inserts newline as a universal fallback
        // for terminals that don't support the Kitty keyboard protocol.
        // Fallback: some terminals send Shift+Enter as a Kitty-protocol escape sequence
        // that gets misinterpreted (e.g., "/" extracted from the CSI sequence).
        // Detect by checking event.raw for Enter codepoint (13/10) with a modifier.
        if (isStreamingRef.current && shouldEnqueueMessageFromKeyEvent(event)) {
          const textarea = textareaRef.current;
          const value = textarea?.plainText?.trim() ?? "";
          if (value) {
            const hasAgentMentions = parseAtMentions(value).length > 0;
            const hasAnyMentionToken = hasAnyAtReferenceToken(value);
            emitMessageSubmitTelemetry({
              messageLength: value.length,
              queued: true,
              fromInitialPrompt: false,
              hasFileMentions: hasAnyMentionToken && !hasAgentMentions,
              hasAgentMentions,
            });
            messageQueue.enqueue(value);
            if (textarea) {
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
            }
          }
          event.stopPropagation();
          return;
        }

        if (shouldInsertNewlineFromKeyEvent(event)) {
          const textarea = textareaRef.current;
          if (textarea) {
            textarea.insertText("\n");
          }
          event.stopPropagation();
          return;
        }

        // Autocomplete: Tab - complete the selected command
        if (event.name === "tab" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
          const selectedCommand = autocompleteSuggestions[workflowState.selectedSuggestionIndex];
          const textarea = textareaRef.current;
          if (selectedCommand && textarea) {
            const isMentionMode = workflowState.autocompleteMode === "mention";
            const isDirectoryMention = isMentionMode && selectedCommand.name.endsWith("/");
            const suffix = isDirectoryMention ? "" : " ";

            if (isMentionMode) {
              // Replace only the @mention token (supports mid-text mentions)
              const fullText = textarea.plainText ?? "";
              const mentionStart = workflowState.mentionStartOffset;
              const mentionEnd = mentionStart + 1 + workflowState.autocompleteInput.length; // @ + typed text
              const before = fullText.slice(0, mentionStart);
              const after = fullText.slice(mentionEnd);
              const replacement = `@${selectedCommand.name}${suffix}`;
              const newText = before + replacement + after;
              const newCursorPos = mentionStart + replacement.length;

              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(newText);
              textarea.cursorOffset = newCursorPos;
            } else {
              // Slash command: replace entire input
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(`/${selectedCommand.name}${suffix}`);
            }

            if (isDirectoryMention) {
              // Keep autocomplete open to browse directory contents
              updateWorkflowState({
                showAutocomplete: true,
                autocompleteInput: selectedCommand.name,
                selectedSuggestionIndex: 0,
                autocompleteMode: "mention",
                mentionStartOffset: workflowState.mentionStartOffset,
                argumentHint: "",
              });
            } else {
              updateWorkflowState({
                showAutocomplete: false,
                autocompleteInput: "",
                selectedSuggestionIndex: 0,
                autocompleteMode: "command",
                argumentHint: workflowState.autocompleteMode === "command" ? (selectedCommand.argumentHint || "") : "",
              });
            }
          }
          return;
        }

        // Autocomplete: Enter - execute the selected command immediately (skip if shift/meta held for newline)
        // Also skip when backslash line continuation applies: in non-Kitty terminals,
        // Shift+Enter sends "\" then "\r" as two events. The "\" gets typed (keeping
        // autocomplete visible) and the "\r" arrives as plain Enter. We must let
        // handleSubmit process the backslash continuation instead of executing the command.
        if (event.name === "return" && !event.shift && !event.meta && workflowState.showAutocomplete && autocompleteSuggestions.length > 0
          && !shouldApplyBackslashLineContinuation(textareaRef.current?.plainText ?? "", kittyKeyboardDetectedRef.current)) {
          const selectedCommand = autocompleteSuggestions[workflowState.selectedSuggestionIndex];
          const textarea = textareaRef.current;
          if (selectedCommand && textarea) {
            const isMentionMode = workflowState.autocompleteMode === "mention";
            const isDirectoryMention = isMentionMode && selectedCommand.name.endsWith("/");

            if (isMentionMode) {
              // Replace only the @mention token (supports mid-text mentions)
              const fullText = textarea.plainText ?? "";
              const mentionStart = workflowState.mentionStartOffset;
              const mentionEnd = mentionStart + 1 + workflowState.autocompleteInput.length;
              const before = fullText.slice(0, mentionStart);
              const after = fullText.slice(mentionEnd);

              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();

              if (isDirectoryMention) {
                const newText = `${before}@${selectedCommand.name}${after}`;
                textarea.insertText(newText);
                textarea.cursorOffset = mentionStart + 1 + selectedCommand.name.length;
                updateWorkflowState({
                  showAutocomplete: true,
                  autocompleteInput: selectedCommand.name,
                  selectedSuggestionIndex: 0,
                  autocompleteMode: "mention",
                  mentionStartOffset: mentionStart,
                  argumentHint: "",
                });
              } else if (selectedCommand.category === "agent") {
                // Agent @ mention: execute the agent command
                // Use any remaining text (before/after the mention) as the agent's args
                const remaining = (before + after).trim();
                textarea.gotoBufferHome();
                textarea.gotoBufferEnd({ select: true });
                textarea.deleteChar();
                updateWorkflowState({
                  showAutocomplete: false,
                  autocompleteInput: "",
                  selectedSuggestionIndex: 0,
                  autocompleteMode: "command",
                });
                const displayText = remaining
                  ? `@${selectedCommand.name} ${remaining}`
                  : `@${selectedCommand.name}`;
                addMessage("user", displayText);
                void executeCommand(selectedCommand.name, remaining, "mention");
              } else {
                // File @ mention: insert completed mention into text
                const replacement = `@${selectedCommand.name} `;
                const newText = before + replacement + after;
                textarea.insertText(newText);
                textarea.cursorOffset = mentionStart + replacement.length;
                updateWorkflowState({
                  showAutocomplete: false,
                  autocompleteInput: "",
                  selectedSuggestionIndex: 0,
                  autocompleteMode: "command",
                });
              }
            } else {
              // Slash command: clear and execute
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              updateWorkflowState({
                showAutocomplete: false,
                autocompleteInput: "",
                selectedSuggestionIndex: 0,
                autocompleteMode: "command",
              });
              addMessage("user", `/${selectedCommand.name}`);
              void executeCommand(selectedCommand.name, "", "autocomplete");
            }
          }
          // Prevent textarea's built-in "return → submit" from firing
          event.stopPropagation();
          return;
        }

        // Queue editing: Enter - exit edit mode and allow submission (skip if shift/meta held for newline)
        if (event.name === "return" && !event.shift && !event.meta && isEditingQueue) {
          setIsEditingQueue(false);
          // Keep edit index for potential message update
          // Allow default input submission behavior to proceed
        }

        // Ctrl+Shift+C - copy selected text
        if (event.ctrl && event.shift && event.name === "c") {
          void handleCopy();
          return;
        }

        // After processing key, check input for slash command detection
        // Use setTimeout to let the textarea update first
        setTimeout(() => {
          const textarea = textareaRef.current;
          const value = textarea?.plainText ?? "";
          handleInputChange(value, textarea?.cursorOffset ?? value.length);
          syncInputScrollbar();
        }, 0);
      },
      [
        onExit,
        onInterrupt,
        onTerminateBackgroundAgents,
        isStreaming,
        interruptCount,
        backgroundTerminationCount,
        handleCopy,
        workflowState.showAutocomplete,
        workflowState.selectedSuggestionIndex,
        workflowState.autocompleteInput,
        workflowState.autocompleteMode,
        autocompleteSuggestions,
        updateWorkflowState,
        handleInputChange,
        syncInputScrollbar,
        executeCommand,
        activeQuestion,
        showModelSelector,
        ctrlCPressed,
        messageQueue,
        setIsEditingQueue,
        parallelAgents,
        compactionSummary,
        addMessage,
        renderer,
        emitMessageSubmitTelemetry,
        finalizeTaskItemsOnInterrupt,
        stopSharedStreamState,
        clearBackgroundTerminationConfirmation,
        finalizeThinkingSourceTracking,
      ]
    )
  );

  useEffect(() => {
    setTimeout(() => {
      syncInputScrollbar();
    }, 0);
  }, [syncInputScrollbar, workflowState.argumentHint]);

  // Keep input scrollbar synced for all scroll paths (keyboard, mouse wheel, drag).
  useEffect(() => {
    if (activeQuestion || showModelSelector) {
      return;
    }

    const interval = setInterval(() => {
      syncInputScrollbar();
    }, 80);

    return () => clearInterval(interval);
  }, [syncInputScrollbar, activeQuestion, showModelSelector]);

  /**
   * Send a message and handle streaming response.
   * Extracted to allow reuse for queued message processing.
   */
  const sendMessage = useCallback(
    (content: string, options?: { skipUserMessage?: boolean }) => {
      // Add user message (unless caller already added it)
      if (!options?.skipUserMessage) {
        const userMessage = createMessage("user", content);
        setMessagesWindowed((prev: ChatMessage[]) => [...prev, userMessage]);
      }

      // Call send handler (fire and forget for sync callback signature)
      if (onSendMessage) {
        void Promise.resolve(onSendMessage(content));
      }

      // Handle streaming response if handler provided
      if (onStreamMessage) {
        // Increment stream generation so stale handleComplete callbacks become no-ops
        const currentGeneration = ++streamGenerationRef.current;
        // Set ref immediately (synchronous) so handleSubmit can check it
        isStreamingRef.current = true;
        setIsStreaming(true);
        // Track when streaming started for duration calculation
        streamingStartRef.current = Date.now();
        // Reset streaming metadata
        resetThinkingSourceTracking();
        // Clear stale todo items from previous turn when not in /ralph
        resetTodoItemsForNewStream();
        // Reset tool tracking for the new stream
        hasRunningToolRef.current = false;
        runningBlockingToolIdsRef.current.clear();
        clearDeferredCompletion();

        // Create placeholder assistant message
        const assistantMessage = createMessage("assistant", "", true);
        streamingMessageIdRef.current = assistantMessage.id;
        isAgentOnlyStreamRef.current = false;
        setMessagesWindowed((prev: ChatMessage[]) => [...prev, assistantMessage]);

        // Handle stream chunks — guarded by ref to drop post-interrupt chunks
        const handleChunk = (chunk: string) => {
          if (!isStreamingRef.current) return;
          // Drop chunks from stale streams (round-robin replaced this stream)
          if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
          if (pendingCompleteRef.current) {
            clearDeferredCompletion();
          }
          const messageId = streamingMessageIdRef.current;
          if (messageId) {
            setMessagesWindowed((prev: ChatMessage[]) =>
              prev.map((msg: ChatMessage) => {
                if (msg.id === messageId) {
                  return applyStreamPartEvent(msg, { type: "text-delta", delta: chunk });
                }
                return msg;
              })
            );
          }
        };

        // Handle stream completion - process next queued message after delay
        const handleComplete = () => {
          // Stale generation guard — a newer stream has started (round-robin inject),
          // so this callback must not touch any shared refs/state.
          if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
          const messageId = streamingMessageIdRef.current;
          // Calculate duration from streaming start
          const durationMs = streamingStartRef.current
            ? Date.now() - streamingStartRef.current
            : undefined;
          // Capture streaming meta before clearing
          const finalMeta = streamingMetaRef.current;

          // If the interrupt handler already finalized agents, skip overwriting
          if (wasInterruptedRef.current) {
            wasInterruptedRef.current = false;
            if (messageId) {
              setMessagesWindowed((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === messageId
                    ? {
                      ...finalizeStreamingReasoningInMessage(msg),
                      streaming: false,
                      durationMs,
                      modelId: currentModelRef.current,
                      outputTokens: finalMeta?.outputTokens,
                      thinkingMs: finalMeta?.thinkingMs,
                      thinkingText: finalMeta?.thinkingText || undefined,
                    }
                    : msg
                )
              );
            }
            setParallelAgents([]);
            stopSharedStreamState();
            finalizeThinkingSourceTracking();
            return;
          }

          // If foreground sub-agents or tools are still running, defer
          // finalization until they complete (preserves correct state).
          // Background agents are excluded — they must not block completion;
          // they continue running after the main stream ends and are tracked
          // separately via hasActiveBackgroundAgents.
          const hasActiveAgents = hasActiveForegroundAgents(parallelAgentsRef.current);
          if (hasActiveAgents || hasRunningToolRef.current) {
            const originalHandleComplete = handleComplete;
            let spawnTimeout: ReturnType<typeof setTimeout> | null = null;
            const deferredComplete = () => {
              if (spawnTimeout) {
                clearTimeout(spawnTimeout);
                spawnTimeout = null;
              }
              originalHandleComplete();
            };
            pendingCompleteRef.current = deferredComplete;
            // Safety timeout: if no sub-agent was ever spawned within 30s,
            // unblock the deferred completion to prevent TUI freeze.
            spawnTimeout = setTimeout(() => {
              if (pendingCompleteRef.current === deferredComplete
                  && parallelAgentsRef.current.length === 0) {
                pendingCompleteRef.current = null;
                deferredComplete();
              }
            }, 30_000);
            return;
          }

          // Finalize running parallel agents and bake into message
          setParallelAgents((currentAgents) => {
            const finalizedAgents = currentAgents.length > 0
              ? currentAgents.map((a) => {
                if (a.background) return a;
                return a.status === "running" || a.status === "pending"
                  ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                  : a;
              })
              : undefined;

            if (messageId) {
              setMessagesWindowed((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === messageId
                    ? {
                      ...finalizeStreamingReasoningInMessage(msg),
                      streaming: false,
                      durationMs,
                      modelId: currentModelRef.current,
                      outputTokens: finalMeta?.outputTokens,
                      thinkingMs: finalMeta?.thinkingMs,
                      thinkingText: finalMeta?.thinkingText || undefined,
                      toolCalls: interruptRunningToolCalls(msg.toolCalls),
                      parts: interruptRunningToolParts(msg.parts),
                      parallelAgents: finalizedAgents,
                      taskItems: snapshotTaskItems(todoItemsRef.current) as TaskItem[] | undefined,
                    }
                    : msg
                )
              );
            }
            // Keep background agents in live state for post-stream completion tracking
            const remaining = getActiveBackgroundAgents(currentAgents);
            if (remaining.length > 0 && messageId) {
              backgroundAgentMessageIdRef.current = messageId;
            }
            return remaining;
          });

          const hasRemainingBg = getActiveBackgroundAgents(parallelAgentsRef.current).length > 0;
          stopSharedStreamState({ preserveStreamingStart: hasRemainingBg });
          finalizeThinkingSourceTracking();
          continueQueuedConversation();
        };

        // Handle streaming metadata updates (tokens, thinking duration)
        const handleMeta = (meta: StreamingMeta) => {
          streamingMetaRef.current = meta;
          setStreamingMeta(meta);
          const messageId = streamingMessageIdRef.current;
          if (!messageId) return;
          const thinkingMetaEvent = resolveValidatedThinkingMetaEvent(
            meta,
            messageId,
            currentGeneration,
            closedThinkingSourcesRef.current,
            thinkingDropDiagnosticsRef.current,
          );
          if (!thinkingMetaEvent) return;
          setMessagesWindowed((prev: ChatMessage[]) =>
            prev.map((msg: ChatMessage) =>
              msg.id === messageId
                ? applyStreamPartEvent(msg, {
                    type: "thinking-meta",
                    thinkingSourceKey: thinkingMetaEvent.thinkingSourceKey,
                    targetMessageId: thinkingMetaEvent.targetMessageId,
                    streamGeneration: thinkingMetaEvent.streamGeneration,
                    thinkingMs: meta.thinkingMs,
                    thinkingText: thinkingMetaEvent.thinkingText,
                    includeReasoningPart: true,
                  })
                : msg
            )
          );
        };

        void Promise.resolve(onStreamMessage(content, handleChunk, handleComplete, handleMeta)).catch((error) => {
          handleStreamStartupError(error, currentGeneration);
        });
      }
    },
    [onSendMessage, onStreamMessage, continueQueuedConversation, handleStreamStartupError, stopSharedStreamState, finalizeThinkingSourceTracking, resetThinkingSourceTracking]
  );

  // Keep the sendMessageRef in sync with sendMessage callback
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Keep the executeCommandRef in sync with executeCommand callback
  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

  // Auto-submit initial prompt from CLI argument
  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (initialPrompt && !initialPromptSentRef.current) {
      initialPromptSentRef.current = true;

      // Defer to next tick to ensure all effects have settled
      // and the component is fully initialized
      setTimeout(() => {
        // Route slash commands through the command system for proper validation
        const parsed = parseSlashCommand(initialPrompt);
        if (parsed.isCommand) {
          addMessage("user", initialPrompt);
          void executeCommand(parsed.name, parsed.args, "initial_prompt");
          return;
        }

        // Check for @agent mention in initial prompt (e.g., "@codebase-analyzer analyze this")
        if (initialPrompt.startsWith("@")) {
          const afterAt = initialPrompt.slice(1);
          const spaceIndex = afterAt.indexOf(" ");
          const agentName = spaceIndex === -1 ? afterAt : afterAt.slice(0, spaceIndex);
          const agentArgs = spaceIndex === -1 ? "" : afterAt.slice(spaceIndex + 1).trim();
          const agentCommand = globalRegistry.get(agentName);
          if (agentCommand && agentCommand.category === "agent") {
            addMessage("user", initialPrompt);
            void executeCommand(agentName, agentArgs, "mention");
            return;
          }
        }

        const { message: processed, filesRead } = processFileMentions(initialPrompt);
        emitMessageSubmitTelemetry({
          messageLength: initialPrompt.length,
          queued: false,
          fromInitialPrompt: true,
          hasFileMentions: filesRead.length > 0,
          hasAgentMentions: false,
        });
        sendMessage(processed);
      }, 0);
    }
  }, [initialPrompt, sendMessage, addMessage, executeCommand, emitMessageSubmitTelemetry]);

  /**
   * Handle message submission from textarea.
   * Gets value from textarea ref since onSubmit receives SubmitEvent, not value.
   * Handles both slash commands and regular messages.
   * When streaming, queues messages instead of blocking.
   */
  const handleSubmit = useCallback(
    () => {
      // Get value from textarea ref
      const value = textareaRef.current?.plainText ?? "";
      const trimmedValue = value.trim();
      if (!trimmedValue) {
        return;
      }

      // Line continuation: trailing \ before Enter inserts a newline instead of submitting.
      // This serves as a universal fallback for terminals where Shift+Enter
      // sends "\" followed by Enter (e.g., VSCode integrated terminal).
      // Only applies when the terminal doesn't support the Kitty keyboard protocol.
      if (shouldApplyBackslashLineContinuation(value, kittyKeyboardDetectedRef.current)) {
        const textarea = textareaRef.current;
        if (textarea) {
          const newValue = value.slice(0, -1) + "\n";
          textarea.gotoBufferHome();
          textarea.gotoBufferEnd({ select: true });
          textarea.deleteChar();
          textarea.insertText(newValue);
        }
        return;
      }

      if (shouldDeferComposerSubmit({
        isStreaming: isStreamingRef.current,
        runningAskQuestionToolCount: runningAskQuestionToolIdsRef.current.size,
      })) {
        return;
      }

      // Add to prompt history (avoid duplicates of last entry)
      setPromptHistory(prev => {
        if (prev[prev.length - 1] === trimmedValue) return prev;
        const updated = [...prev, trimmedValue];
        promptHistoryRef.current = updated;
        return updated;
      });
      historyIndexRef.current = -1;
      setHistoryIndex(-1);
      appendCommandHistory(trimmedValue);

      // Clear textarea by selecting all and deleting
      if (textareaRef.current) {
        textareaRef.current.gotoBufferHome();
        textareaRef.current.gotoBufferEnd({ select: true });
        textareaRef.current.deleteChar();
      }

      // Hide autocomplete and argument hint if visible
      if (workflowState.showAutocomplete || workflowState.argumentHint) {
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          selectedSuggestionIndex: 0,
          argumentHint: "",
        });
      }

      // Check if this is a slash command
      const parsed = parseSlashCommand(trimmedValue);
      if (parsed.isCommand) {
        // Dismiss workflow panel when user sends a non-workflow slash command (Copilot only)
        if (agentType === "copilot" && workflowSessionDirRef.current && parsed.name !== "ralph") {
          setWorkflowSessionDir(null);
          setWorkflowSessionId(null);
          workflowSessionDirRef.current = null;
          workflowSessionIdRef.current = null;
          workflowTaskIdsRef.current = new Set();
          todoItemsRef.current = [];
          setTodoItems([]);
        }

        // Add the slash command to conversation history like any regular user message
        addMessage("user", trimmedValue);
        // Execute the slash command (allowed even during streaming)
        void executeCommand(parsed.name, parsed.args, "input");
        return;
      }

      // If a workflow is waiting for user input (after Ctrl+C stream interrupt),
      // resolve the pending promise with the user's prompt instead of sending normally.
      if (waitForUserInputResolverRef.current) {
        const { resolve } = waitForUserInputResolverRef.current;
        waitForUserInputResolverRef.current = null;
        addMessage("user", trimmedValue);
        resolve(trimmedValue);
        return;
      }

      // Dismiss workflow panel when user sends a non-workflow message (Copilot only)
      if (agentType === "copilot" && workflowSessionDirRef.current && !trimmedValue.startsWith("/ralph")) {
        setWorkflowSessionDir(null);
        setWorkflowSessionId(null);
        workflowSessionDirRef.current = null;
        workflowSessionIdRef.current = null;
        workflowTaskIdsRef.current = new Set();
        todoItemsRef.current = [];
        setTodoItems([]);
      }

      // Check if this contains @agent mentions
      if (trimmedValue.startsWith("@")) {
        const atMentions = parseAtMentions(trimmedValue);

        if (atMentions.length > 0) {
          // @mention invocations queue while streaming so they stay in the
          // same round-robin queue UI as keyboard enqueue inputs.
          if (isStreamingRef.current) {
            emitMessageSubmitTelemetry({
              messageLength: trimmedValue.length,
              queued: true,
              fromInitialPrompt: false,
              hasFileMentions: false,
              hasAgentMentions: true,
            });
            messageQueue.enqueue(trimmedValue);
            return;
          }

          emitMessageSubmitTelemetry({
            messageLength: trimmedValue.length,
            queued: false,
            fromInitialPrompt: false,
            hasFileMentions: false,
            hasAgentMentions: true,
          });
          addMessage("user", trimmedValue);
          // Set streaming state immediately so loading hints render on submit.
          isStreamingRef.current = true;
          setIsStreaming(true);

          for (const mention of atMentions) {
            void executeCommand(mention.agentName, mention.args, "mention");
          }
          return;
        }
      }

      // Process file @mentions (e.g., @src/file.ts) - clean @tokens from message
      const { message: processedValue, filesRead } = processFileMentions(trimmedValue);
      const hasFileMentions = filesRead.length > 0;

      // If streaming, interrupt: inject immediately unless sub-agents are active
      if (isStreamingRef.current) {
        // Defer interrupt if sub-agents are actively working — fires when they finish
        // Background agents are excluded — they must not block interrupt.
        const hasActiveSubagents = hasActiveForegroundAgents(parallelAgentsRef.current);
        if (hasActiveSubagents) {
          emitMessageSubmitTelemetry({
            messageLength: trimmedValue.length,
            queued: true,
            fromInitialPrompt: false,
            hasFileMentions,
            hasAgentMentions: false,
          });
          messageQueue.enqueue(processedValue);
          return;
        }

        // Round-robin inject: finalize current stream and send new message immediately
        const interruptedId = streamingMessageIdRef.current;
        const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
        if (interruptedId) {
          const durationMs = streamingStartRef.current ? Date.now() - streamingStartRef.current : undefined;
          const finalMeta = streamingMetaRef.current;
          setMessagesWindowed((prev: ChatMessage[]) =>
            prev.map((msg: ChatMessage) =>
              msg.id === interruptedId
                ? {
                  ...finalizeStreamingReasoningInMessage(msg),
                  streaming: false,
                  durationMs,
                  modelId: currentModelRef.current,
                  outputTokens: finalMeta?.outputTokens,
                  thinkingMs: finalMeta?.thinkingMs,
                  thinkingText: finalMeta?.thinkingText || undefined,
                  toolCalls: interruptRunningToolCalls(msg.toolCalls),
                  parts: interruptRunningToolParts(msg.parts),
                  taskItems: interruptedTaskItems,
                }
                : msg
            )
          );
        }
        // Invalidate callbacks for the interrupted stream before aborting.
        streamGenerationRef.current = invalidateActiveStreamGeneration(streamGenerationRef.current);
        stopSharedStreamState();
        finalizeThinkingSourceTracking();

        const streamResolver = streamCompletionResolverRef.current;
        if (streamResolver) {
          streamCompletionResolverRef.current = null;
          if (hideStreamContentRef.current && interruptedId) {
            setMessagesWindowed((prev: ChatMessage[]) =>
              prev.filter((msg: ChatMessage) => msg.id !== interruptedId)
            );
          }
          hideStreamContentRef.current = false;
          streamResolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
        }


        // Abort the SDK stream (stale handleComplete is a no-op via generation guard)
        onInterrupt?.();
        // Send immediately — starts a new stream generation
        emitMessageSubmitTelemetry({
          messageLength: trimmedValue.length,
          queued: false,
          fromInitialPrompt: false,
          hasFileMentions,
          hasAgentMentions: false,
        });
        sendMessage(processedValue);
        return;
      }

      // Send the message - normal flow
      emitMessageSubmitTelemetry({
        messageLength: trimmedValue.length,
        queued: false,
        fromInitialPrompt: false,
        hasFileMentions,
        hasAgentMentions: false,
      });
      sendMessage(processedValue);
    },
    [workflowState.showAutocomplete, workflowState.argumentHint, updateWorkflowState, addMessage, executeCommand, messageQueue, sendMessage, model, onInterrupt, emitMessageSubmitTelemetry, finalizeTaskItemsOnInterrupt, stopSharedStreamState, finalizeThinkingSourceTracking, resetThinkingSourceTracking]
  );

  // All messages are kept in memory; no windowing/eviction.
  const renderMessages = messages;
  const footerBackgroundAgents = useMemo(
    () => resolveBackgroundAgentsForFooter(parallelAgents, messages),
    [parallelAgents, messages],
  );

  // Render message list (no empty state text)
  const messageContent = renderMessages.length > 0 ? (
    <>
      {renderMessages.map((msg, index) => {
        const liveTaskItems = msg.streaming ? todoItems : undefined;
        const showLive = shouldShowMessageLoadingIndicator(msg, liveTaskItems);
        return (
        <MessageBubble
          key={msg.id}
          message={msg}
          isLast={index === renderMessages.length - 1}
          syntaxStyle={markdownSyntaxStyle}
          hideAskUserQuestion={activeQuestion !== null}
          hideLoading={activeQuestion !== null}
          todoItems={msg.streaming ? todoItems : undefined}
          elapsedMs={showLive ? streamingElapsedMs : undefined}
          streamingMeta={msg.streaming ? streamingMeta : null}
          collapsed={false}
          tasksExpanded={tasksExpanded}
          inlineTasksEnabled={!ralphSessionDir}
          ralphSessionDir={ralphSessionDir}
          showTodoPanel={showTodoPanel}
        />
        );
      })}
    </>
  ) : null;

  return (
    <box
      flexDirection="column"
      height="100%"
      width="100%"
      onMouseUp={handleMouseUp}
    >
      {/* Header */}
      <AtomicHeader
        version={version}
        model={displayModel}
        tier={tier}
        workingDir={workingDir}
      />

      {/* Transcript mode: full-screen detailed view of thinking, tools, agents */}
      {transcriptMode ? (
        <TranscriptView
          messages={[...readHistoryBuffer(), ...messages]}
          liveThinkingText={streamingMeta?.thinkingText}
          liveParallelAgents={parallelAgents}
          modelId={currentModelId ?? initialModelId ?? model}
          isStreaming={isStreaming}
          streamingMeta={streamingMeta}
        />
      ) : (
      <box flexDirection="column" flexGrow={1}>
      {/* Message display area - scrollable chat history */}
      {/* Text can be selected with mouse and copied with Ctrl+C */}
      <scrollbox
        key="chat-window"
        ref={scrollboxRef}
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        scrollY={true}
        scrollX={false}
        viewportCulling={false}
        paddingLeft={SPACING.CONTAINER_PAD}
        paddingRight={SPACING.CONTAINER_PAD}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
        scrollAcceleration={scrollAcceleration}
      >
        {/* Compaction History - inline within scrollbox */}
        {showCompactionHistory && compactionSummary && parallelAgents.length === 0 && (
          <box flexDirection="column" paddingLeft={SPACING.CONTAINER_PAD} paddingRight={SPACING.CONTAINER_PAD} marginTop={SPACING.ELEMENT} marginBottom={SPACING.ELEMENT}>
            <box flexDirection="column" border borderStyle="rounded" borderColor={themeColors.muted} paddingLeft={SPACING.CONTAINER_PAD} paddingRight={SPACING.CONTAINER_PAD}>
              <text style={{ fg: themeColors.muted }} attributes={1}>Compaction Summary</text>
              <text style={{ fg: themeColors.foreground }} wrapMode="char" selectable>{compactionSummary}</text>
            </box>
          </box>
        )}

        {/* Messages */}
        {messageContent}

        {/* User Question Dialog - inline within chat flow */}
        {activeQuestion && (
          <UserQuestionDialog
            question={activeQuestion}
            onAnswer={handleQuestionAnswer}
            visible={true}
          />
        )}

        {/* Model Selector Dialog - for interactive model selection */}
        {showModelSelector && (
          <ModelSelectorDialog
            models={availableModels}
            currentModel={currentModelId}
            onSelect={handleModelSelect}
            onCancel={handleModelSelectorCancel}
            visible={true}
          />
        )}

        {/* Queue Indicator - shows pending queued messages */}
        {messageQueue.count > 0 && (
          <box marginTop={SPACING.ELEMENT}>
            <QueueIndicator
              count={messageQueue.count}
              queue={messageQueue.queue}
              compact={!isEditingQueue}
              editable={!isStreaming}
              editIndex={messageQueue.currentEditIndex}
              onEdit={(index) => {
                messageQueue.setEditIndex(index);
                setIsEditingQueue(true);
              }}
            />
          </box>
        )}

        {/* Input Area - flows with content inside scrollbox */}
        {/* Hidden when question dialog or model selector is active */}
        {!activeQuestion && !showModelSelector && (
          <>
            <box
              border
              borderStyle="rounded"
              borderColor={workflowState.workflowActive ? themeColors.accent : themeColors.inputFocus}
              paddingLeft={SPACING.CONTAINER_PAD}
              paddingRight={SPACING.CONTAINER_PAD}
              marginTop={messages.length > 0 ? SPACING.ELEMENT : SPACING.NONE}
              flexDirection="row"
              alignItems="flex-start"
              flexShrink={0}
            >
              <text flexShrink={0} style={{ fg: themeColors.accent }}>{PROMPT.cursor}{" "}</text>
              <textarea
                ref={textareaRef}
                placeholder={messages.length === 0 ? dynamicPlaceholder : ""}
                focused={inputFocused}
                keyBindings={textareaKeyBindings}
                syntaxStyle={inputSyntaxStyle}
                onSubmit={handleSubmit}
                onPaste={handleBracketedPaste}
                onContentChange={handleTextareaContentChange}
                onCursorChange={handleTextareaCursorChange}
                wrapMode="word"
                flexGrow={workflowState.argumentHint ? 0 : 1}
                flexShrink={1}
                flexBasis={workflowState.argumentHint ? undefined : 0}
                minWidth={0}
                minHeight={1}
                maxHeight={8}
              />
              {workflowState.argumentHint && (
                <text style={{ fg: themeColors.dim }}>{workflowState.argumentHint}</text>
              )}
              {workflowState.argumentHint && <box flexGrow={1} />}
              {inputScrollbar.visible && (
                <box flexDirection="column" marginLeft={SPACING.ELEMENT}>
                  {Array.from({ length: inputScrollbar.viewportHeight }).map((_, i) => {
                    const inThumb = i >= inputScrollbar.thumbTop
                      && i < inputScrollbar.thumbTop + inputScrollbar.thumbSize;
                    return (
                      <text
                        key={`input-scroll-${i}`}
                        style={{ fg: inThumb ? themeColors.scrollbarFg : themeColors.scrollbarBg }}
                      >
                        {inThumb ? SCROLLBAR.thumb : SCROLLBAR.track}
                      </text>
                    );
                  })}
                </box>
              )}
            </box>
            {shouldShowAutoCompactionIndicator(autoCompactionIndicator) && (
              <box paddingLeft={SPACING.CONTAINER_PAD} flexDirection="row" gap={SPACING.ELEMENT} flexShrink={0}>
                <text style={{ fg: themeColors.muted }}>
                  auto-compaction
                </text>
                <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                <text
                  style={{
                    fg: autoCompactionIndicator.status === "running"
                      ? themeColors.accent
                      : autoCompactionIndicator.status === "completed"
                        ? themeColors.success
                        : themeColors.error,
                  }}
                >
                  {getAutoCompactionIndicatorLabel(autoCompactionIndicator)}
                </text>
              </box>
            )}
            {/* Streaming/workflow hints */}
            {isStreaming && !workflowState.workflowActive ? (
              <box paddingLeft={SPACING.CONTAINER_PAD} flexDirection="row" gap={SPACING.ELEMENT} flexShrink={0}>
                <text style={{ fg: themeColors.muted }}>
                  esc to interrupt
                </text>
                <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                <text style={{ fg: themeColors.muted }}>
                  {enqueueShortcutLabel} enqueue
                </text>
                {footerBackgroundAgents.length > 0 && (
                  <>
                    <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                    <text style={{ fg: themeColors.accent }}>
                      {formatBackgroundAgentFooterStatus(footerBackgroundAgents)}
                    </text>
                    <text style={{ fg: themeColors.dim }}>{MISC.separator} {BACKGROUND_FOOTER_CONTRACT.terminateHintText}</text>
                  </>
                )}
              </box>
            ) : null}
            {/* Workflow mode label with hints - shown when workflow is active */}
            {workflowState.workflowActive && (
              <box paddingLeft={SPACING.CONTAINER_PAD} flexDirection="row" gap={SPACING.ELEMENT} flexShrink={0}>
                <text style={{ fg: themeColors.accent }}>
                  workflow
                </text>
                <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                <text style={{ fg: themeColors.muted }}>
                  esc to interrupt
                </text>
                <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                <text style={{ fg: themeColors.muted }}>
                  {enqueueShortcutLabel} enqueue
                </text>
                <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                <text style={{ fg: themeColors.muted }}>
                  ctrl+c twice to exit workflow
                </text>
                {footerBackgroundAgents.length > 0 && (
                  <>
                    <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                    <text style={{ fg: themeColors.accent }}>
                      {formatBackgroundAgentFooterStatus(footerBackgroundAgents)}
                    </text>
                    <text style={{ fg: themeColors.dim }}>{MISC.separator} {BACKGROUND_FOOTER_CONTRACT.terminateHintText}</text>
                  </>
                )}
              </box>
            )}
          </>
        )}

        {/* Autocomplete dropdown for slash commands and @ mentions */}
        {workflowState.showAutocomplete && (
          <box marginTop={SPACING.NONE} marginBottom={SPACING.NONE}>
            <Autocomplete
              input={workflowState.autocompleteInput}
              visible={workflowState.showAutocomplete}
              selectedIndex={workflowState.selectedSuggestionIndex}
              onSelect={handleAutocompleteSelect}
              onIndexChange={handleAutocompleteIndexChange}
              namePrefix={workflowState.autocompleteMode === "mention" ? "@" : "/"}
              externalSuggestions={workflowState.autocompleteMode === "mention" ? autocompleteSuggestions : undefined}
            />
          </box>
        )}

        {/* Ctrl+C warning message */}
        {ctrlCPressed && (
          <box paddingLeft={1} flexShrink={0}>
            <text style={{ fg: themeColors.muted }}>
              Press Ctrl-C again to exit
            </text>
          </box>
        )}
        {ctrlFPressed && (
          <box paddingLeft={1} flexShrink={0}>
            <text style={{ fg: themeColors.muted }}>
              Press Ctrl-F again to terminate background agents
            </text>
          </box>
        )}
      </scrollbox>
      </box>
      )}

      {!isStreaming && <BackgroundAgentFooter agents={footerBackgroundAgents} />}

    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatApp;
