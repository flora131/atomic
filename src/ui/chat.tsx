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
import { STATUS, CONNECTOR, ARROW, PROMPT, SPINNER_FRAMES, SPINNER_COMPLETE, CHECKBOX, SCROLLBAR, MISC } from "./constants/icons.ts";

import { Autocomplete, navigateUp, navigateDown } from "./components/autocomplete.tsx";
import { ToolResult } from "./components/tool-result.tsx";
import { SkillLoadIndicator } from "./components/skill-load-indicator.tsx";
import { McpServerListIndicator } from "./components/mcp-server-list.tsx";
import { ContextInfoDisplay } from "./components/context-info-display.tsx";

import { QueueIndicator } from "./components/queue-indicator.tsx";
import {
  ParallelAgentsTree,
  type ParallelAgent,
} from "./components/parallel-agents-tree.tsx";
import { TranscriptView } from "./components/transcript-view.tsx";
import { appendToHistoryBuffer, readHistoryBuffer, clearHistoryBuffer } from "./utils/conversation-history-buffer.ts";
import {
  SubagentGraphBridge,
  setSubagentBridge,
  type CreateSessionFn,
} from "../graph/subagent-bridge.ts";
import {
  UserQuestionDialog,
  type UserQuestion,
  type QuestionAnswer,
} from "./components/user-question-dialog.tsx";
import {
  ModelSelectorDialog,
} from "./components/model-selector-dialog.tsx";
import type { Model } from "../models/model-transform.ts";
import { type TaskItem } from "./components/task-list-indicator.tsx";
import {
  useStreamingState,
  type ToolExecutionStatus,
} from "./hooks/use-streaming-state.ts";
import { useMessageQueue } from "./hooks/use-message-queue.ts";
import {
  globalRegistry,
  parseSlashCommand,
  type CommandDefinition,
  type CommandContext,
  type CommandContextState,
  type CommandCategory,
} from "./commands/index.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import type { AskUserQuestionEventData } from "../graph/index.ts";
import type { AgentType, ModelOperations } from "../models";
import { saveModelPreference, saveReasoningEffortPreference, clearReasoningEffortPreference } from "../utils/settings.ts";
import { formatDuration } from "./utils/format.ts";
import { getRandomVerb, getRandomCompletionVerb } from "./constants/index.ts";

// ============================================================================
// @ MENTION HELPERS
// ============================================================================

interface ParsedAtMention {
  agentName: string;
  args: string;
}

/**
 * Parse @mentions in a message and extract agent invocations.
 * Returns an array of { agentName, args } for each agent mention found.
 */
function parseAtMentions(message: string): ParsedAtMention[] {
  const atMentions: ParsedAtMention[] = [];
  const atRegex = /@(\S+)/g;
  let atMatch: RegExpExecArray | null;
  const agentPositions: Array<{ name: string; start: number; end: number }> = [];

  while ((atMatch = atRegex.exec(message)) !== null) {
    const candidateName = atMatch[1] ?? "";
    const cmd = globalRegistry.get(candidateName);
    if (cmd && cmd.category === "agent") {
      agentPositions.push({
        name: candidateName,
        start: atMatch.index,
        end: atMatch.index + atMatch[0].length,
      });
    }
  }

  for (let i = 0; i < agentPositions.length; i++) {
    const pos = agentPositions[i]!;
    const nextPos = agentPositions[i + 1];
    const argsStart = pos.end;
    const argsEnd = nextPos ? nextPos.start : message.length;
    const args = message.slice(argsStart, argsEnd).trim();
    atMentions.push({ agentName: pos.name, args });
  }

  return atMentions;
}

/**
 * Get autocomplete suggestions for @ mentions (agents and files).
 * Agent names are searched from the command registry (category "agent").
 * File paths are searched when input contains path characters (/ or .).
 */
function getMentionSuggestions(input: string): CommandDefinition[] {
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

  // File/directory suggestions after agents
  try {
    const cwd = process.cwd();
    let searchDir: string;
    let filterPrefix: string;
    let pathPrefix: string;

    if (input.endsWith("/")) {
      // Browsing a directory - show its contents
      searchDir = join(cwd, input);
      filterPrefix = "";
      pathPrefix = input;
    } else if (input.includes("/")) {
      // Typing a name within a directory
      searchDir = join(cwd, dirname(input));
      filterPrefix = basename(input);
      pathPrefix = dirname(input) + "/";
    } else {
      // Top-level - search cwd
      searchDir = cwd;
      filterPrefix = input;
      pathPrefix = "";
    }

    const entries = readdirSync(searchDir, { withFileTypes: true });
    const filtered = entries
      .filter(e => e.name.toLowerCase().startsWith(filterPrefix.toLowerCase()) && !e.name.startsWith("."))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    // Ensure both directories and files are represented in results
    const dirs = filtered.filter(e => e.isDirectory());
    const files = filtered.filter(e => !e.isDirectory());
    const maxDirs = Math.min(dirs.length, 7);
    const maxFiles = Math.min(files.length, 15 - maxDirs);
    const mixed = [...dirs.slice(0, maxDirs), ...files.slice(0, maxFiles)];
    const fileMatches = mixed
      .map(e => ({
        name: `${pathPrefix}${e.name}${e.isDirectory() ? "/" : ""}`,
        description: "",
        category: "custom" as CommandCategory,
        execute: () => ({ success: true as const }),
      }));

    suggestions.push(...fileMatches);
  } catch {
    // Silently fail for invalid paths
  }

  return suggestions;
}

interface FileReadInfo {
  path: string;
  sizeBytes: number;
  lineCount: number;
  isImage: boolean;
  isDirectory: boolean;
}

interface ProcessedMention {
  message: string;
  filesRead: FileReadInfo[];
}

/**
 * Process file @mentions in a message. Replaces @filepath with file content context.
 * Returns the message with file content prepended and metadata about files read.
 */
function processFileMentions(message: string): ProcessedMention {
  const mentionRegex = /@([\w./_-]+)/g;
  const fileContents: string[] = [];
  const filesRead: FileReadInfo[] = [];
  const cleanedMessage = message.replace(mentionRegex, (match, filePath: string) => {
    const cmd = globalRegistry.get(filePath);
    if (cmd && cmd.category === "agent") return match;

    try {
      const fullPath = join(process.cwd(), filePath);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        const entries = readdirSync(fullPath, { withFileTypes: true });
        const listing = entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .join("\n");

        filesRead.push({
          path: filePath.endsWith("/") ? filePath : `${filePath}/`,
          sizeBytes: stats.size,
          lineCount: entries.length,
          isImage: false,
          isDirectory: true,
        });

        fileContents.push(`<directory path="${filePath}">\n${listing}\n</directory>`);
        return filePath;
      }

      const content = readFileSync(fullPath, "utf-8");
      const lineCount = content.split("\n").length;
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(filePath);

      filesRead.push({
        path: filePath,
        sizeBytes: stats.size,
        lineCount,
        isImage,
        isDirectory: false,
      });

      fileContents.push(`<file path="${filePath}">\n${content}\n</file>`);
      return filePath;
    } catch {
      return match;
    }
  });

  const processed = fileContents.length > 0
    ? `${fileContents.join("\n\n")}\n\n${cleanedMessage}`
    : cleanedMessage;

  return { message: processed, filesRead };
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
  /** Content offset at the time tool call started (for inline rendering) */
  contentOffsetAtStart?: number;
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
  /** Content offset when parallel agents first appeared (for chronological positioning) */
  agentsContentOffset?: number;
  /** Content offset when task list first appeared (for chronological positioning) */
  tasksContentOffset?: number;
  /** MCP server list for rendering via McpServerListIndicator */
  mcpServers?: import("../sdk/types.ts").McpServerConfig[];
  contextInfo?: import("./commands/registry.ts").ContextDisplayInfo;
  /** Output tokens used in this message (baked on completion) */
  outputTokens?: number;
  /** Thinking/reasoning duration in milliseconds (baked on completion) */
  thinkingMs?: number;
  /** Accumulated thinking/reasoning text content (baked on completion) */
  thinkingText?: string;
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
 * AskUserQuestion event callback signature.
 * Called when askUserNode emits a human_input_required signal.
 */
export type OnAskUserQuestion = (eventData: AskUserQuestionEventData) => void;

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
    onMeta?: (meta: StreamingMeta) => void
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
  /** Raw model ID from session config, used to seed currentModelRef for accurate /context display */
  initialModelId?: string;
  /** Get system tools tokens from the client (pre-session fallback) */
  getClientSystemToolsTokens?: () => number | null;
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
  /** Ralph-specific workflow configuration (session ID, user prompt, etc.) */
  ralphConfig?: {
    userPrompt: string | null;
    resumeSessionId?: string;
    sessionId?: string;
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
  /** Parallel agents to display inline (only for streaming assistant message) */
  parallelAgents?: ParallelAgent[];
  /** Todo items to show inline during streaming */
  todoItems?: Array<{content: string; status: "pending" | "in_progress" | "completed" | "error"}>;
  /** Whether task items are expanded (no truncation) */
  tasksExpanded?: boolean;
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
  return {
    id: generateMessageId(),
    role,
    content,
    timestamp: new Date().toISOString(),
    streaming,
  };
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

/**
 * Maximum number of messages to display in the chat UI.
 * Set to Infinity to show all messages (no truncation).
 * The scrollbox handles large message counts efficiently.
 * Messages are only cleared by /clear or /compact commands.
 */
export const MAX_VISIBLE_MESSAGES = 50;

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
export function LoadingIndicator({ speed = 100, elapsedMs, outputTokens, thinkingMs }: LoadingIndicatorProps): React.ReactNode {
  const themeColors = useThemeColors();
  const [frameIndex, setFrameIndex] = useState(0);
  // Select random verb only on mount (empty dependency array)
  const [verb] = useState(() => getRandomVerb());

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

/**
 * Find all @mention ranges in the text for highlighting.
 * Matches @token patterns where token is [\w./_-]+ (same as processFileMentions regex).
 * Excludes mentions inside backticks or not at a word boundary.
 * Returns array of [start, end] character offset pairs.
 */
function findMentionRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const regex = /@([\w./_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const mentionName = match[1];
    if (!mentionName) continue;
    // Check word boundary before @
    if (start > 0) {
      const charBefore = text[start - 1];
      if (charBefore !== " " && charBefore !== "\n" && charBefore !== "\t") continue;
    }
    // Check not inside backticks
    if (start > 0 && text[start - 1] === "`") continue;
    if (end < text.length && text[end] === "`") continue;
    // Only highlight if mention resolves to a registered command, file, or folder
    const cmd = globalRegistry.get(mentionName);
    if (cmd) {
      ranges.push([start, end]);
      continue;
    }
    try {
      statSync(join(process.cwd(), mentionName));
      ranges.push([start, end]);
    } catch {
      // Not a valid agent, file, or folder — skip highlighting
    }
  }
  return ranges;
}

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
    <box flexDirection="row" alignItems="flex-start" marginBottom={1} marginLeft={1} flexShrink={0}>
      {/* Block letter logo with gradient - hidden on narrow terminals */}
      {showBlockLogo && (
        <box flexDirection="column" marginRight={3}>
          {ATOMIC_BLOCK_LOGO.map((line, i) => (
            <GradientText key={i} text={line} gradient={gradient} />
          ))}
        </box>
      )}

      {/* App info */}
      <box flexDirection="column" paddingTop={0}>
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
 * Represents a segment of content to render (either text or tool call).
 * Used for interleaving text content with tool calls at the correct positions.
 */
interface ContentSegment {
  type: "text" | "tool" | "agents" | "tasks";
  content?: string;
  toolCall?: MessageToolCall;
  agents?: ParallelAgent[];
  taskItems?: TaskItem[];
  tasksExpanded?: boolean;
  key: string;
}

/**
 * Build interleaved content segments from message content and tool calls.
 * Tool calls are inserted at their recorded content offsets.
 * Agents and tasks are also inserted at their chronological offsets.
 */
function buildContentSegments(
  content: string,
  toolCalls: MessageToolCall[],
  agents?: ParallelAgent[] | null,
  agentsOffset?: number,
  taskItems?: TaskItem[] | null,
  tasksOffset?: number,
  tasksExpanded?: boolean,
): ContentSegment[] {
  // Filter out HITL tools
  const visibleToolCalls = toolCalls.filter(tc =>
    tc.toolName !== "AskUserQuestion" && tc.toolName !== "question" && tc.toolName !== "ask_user"
  );

  // Build unified list of insertion points
  interface InsertionPoint {
    offset: number;
    segment: ContentSegment;
    consumesText: boolean; // Only tool calls consume text at their offset
  }

  const insertions: InsertionPoint[] = [];

  // Add tool call insertions
  for (const tc of visibleToolCalls) {
    insertions.push({
      offset: tc.contentOffsetAtStart ?? 0,
      segment: { type: "tool", toolCall: tc, key: `tool-${tc.id}` },
      consumesText: true,
    });
  }

  // Add agents tree insertion (if agents exist and offset is defined)
  if (agents && agents.length > 0 && agentsOffset !== undefined) {
    insertions.push({
      offset: agentsOffset,
      segment: { type: "agents", agents, key: "agents-tree" },
      consumesText: false,
    });
  }

  // Add task list insertion (if tasks exist and offset is defined)
  if (taskItems && taskItems.length > 0 && tasksOffset !== undefined) {
    insertions.push({
      offset: tasksOffset,
      segment: { type: "tasks", taskItems, tasksExpanded, key: "task-list" },
      consumesText: false,
    });
  }

  // Sort all insertions by offset ascending
  insertions.sort((a, b) => a.offset - b.offset);

  // If no insertions, return text-only segment
  if (insertions.length === 0) {
    return content ? [{ type: "text", content, key: "text-0" }] : [];
  }

  // Build segments by slicing content at insertion offsets
  const segments: ContentSegment[] = [];
  let lastOffset = 0;

  for (const ins of insertions) {
    // Add text segment before this insertion (if any)
    if (ins.offset > lastOffset) {
      const textContent = content.slice(lastOffset, ins.offset).trimEnd();
      if (textContent) {
        segments.push({
          type: "text",
          content: textContent,
          key: `text-${lastOffset}`,
        });
      }
    }

    // Add the insertion segment
    segments.push(ins.segment);

    // Only advance lastOffset for tool calls (which consume text)
    // For agents/tasks, keep lastOffset where it is so text continues after them
    if (ins.consumesText) {
      lastOffset = ins.offset;
    }
  }

  // Add remaining text after the last insertion
  if (lastOffset < content.length) {
    const remainingContent = content.slice(lastOffset).trimStart();
    if (remainingContent) {
      segments.push({
        type: "text",
        content: remainingContent,
        key: `text-${lastOffset}`,
      });
    }
  }

  return segments;
}

/**
 * Renders a single chat message with role-based styling.
 * Clean, minimal design matching the reference UI:
 * - User messages: highlighted inline box with just the text
 * - Assistant messages: bullet point (●) prefix, no header
 * Tool calls are rendered inline at their correct chronological positions.
 */

/**
 * Convert GFM task list checkboxes to unicode characters.
 * OpenTUI's MarkdownRenderable doesn't handle checkbox syntax natively.
 */
function preprocessTaskListCheckboxes(content: string): string {
  return content
    .replace(/^(\s*[-*+]\s+)\[ \]/gm, `$1${CHECKBOX.unchecked}`)
    .replace(/^(\s*[-*+]\s+)\[[xX]\]/gm, `$1${CHECKBOX.checked}`);
}
export function MessageBubble({ message, isLast, syntaxStyle, hideAskUserQuestion: _hideAskUserQuestion = false, hideLoading = false, parallelAgents, todoItems, tasksExpanded = false, elapsedMs, collapsed = false, streamingMeta }: MessageBubbleProps): React.ReactNode {
  const themeColors = useThemeColors();

  // Hide the entire message when question dialog is active and there's no content yet
  // This prevents showing a stray "●" bullet before the dialog
  const hideEntireMessage = hideLoading && message.streaming && !message.content.trim();

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
        <box paddingLeft={1} paddingRight={1} marginBottom={0}>
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
        <box paddingLeft={1} paddingRight={1} marginBottom={isLast ? 0 : 1}>
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
      <box paddingLeft={1} paddingRight={1} marginBottom={isLast ? 0 : 1}>
        <text wrapMode="char" style={{ fg: themeColors.error }}>{truncate(message.content, 80)}</text>
      </box>
    );
  }

  // User message: highlighted inline box with just the text (no header/timestamp)
  if (message.role === "user") {
    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? 0 : 1}
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexGrow={1} flexShrink={1} minWidth={0}>
          <text wrapMode="char">
            <span style={{ fg: themeColors.accent }}>{PROMPT.cursor} </span>
            <span style={{ bg: themeColors.userBubbleBg, fg: themeColors.userBubbleFg }}> {message.content} </span>
          </text>
        </box>
        {message.filesRead && message.filesRead.length > 0 && (
          <box flexDirection="column">
            {message.filesRead.map((f, i) => {
              const basename = f.path.split("/").pop() ?? "";
              const isConfigFile = /^(CLAUDE|AGENTS)\.md$/i.test(basename);
              const verb = f.isDirectory
                ? "Listed directory"
                : isConfigFile
                  ? "Loaded"
                  : "Read";
              return (
                <text key={i} wrapMode="char" style={{ fg: themeColors.muted }}>
                  {` ${CONNECTOR.subStatus}  ${verb} `}
                  {f.path}
                  {f.isDirectory
                    ? ""
                    : f.isImage
                      ? ` (${f.sizeBytes >= 1024 ? `${(f.sizeBytes / 1024).toFixed(1)}KB` : `${f.sizeBytes}B`})`
                      : ` (${f.lineCount} lines)`}
                </text>
              );
            })}
          </box>
        )}
      </box>
    );
  }

  // Assistant message: bullet point prefix, with tool calls interleaved at correct positions
  if (message.role === "assistant") {
    // Determine which agents and tasks to show (live during streaming, baked when completed)
    const agentsToShow = parallelAgents?.length ? parallelAgents
      : message.parallelAgents?.length ? message.parallelAgents
      : null;
    const taskItemsToShow = message.streaming ? todoItems : message.taskItems;

    // Build interleaved content segments (now includes agents and tasks)
    const segments = buildContentSegments(
      message.content,
      message.toolCalls || [],
      agentsToShow,
      message.agentsContentOffset,
      taskItemsToShow,
      message.tasksContentOffset,
      tasksExpanded,
    );
    const _hasContent = segments.length > 0;

    // Check if first segment is text (for bullet point prefix)
    const firstTextSegment = segments.find(s => s.type === "text" && s.content?.trim());
    const firstSegment = segments[0];
    const _hasLeadingText = segments.length > 0 && firstSegment?.type === "text";

    // Render interleaved segments (loading spinner is at the bottom, after all content)
    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? 0 : 1}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Skill load indicators */}
        {message.skillLoads?.map((sl, i) => (
          <box key={`skill-${i}`} marginBottom={1}>
            <SkillLoadIndicator
              skillName={sl.skillName}
              status={sl.status}
              errorMessage={sl.errorMessage}
            />
          </box>
        ))}
        {/* MCP server list indicator */}
        {message.mcpServers && (
          <box key="mcp-servers" marginBottom={1}>
            <McpServerListIndicator servers={message.mcpServers} />
          </box>
        )}
        {message.contextInfo && (
          <box key="context-info" marginBottom={1}>
            <ContextInfoDisplay contextInfo={message.contextInfo} />
          </box>
        )}
        {!hideEntireMessage && segments.map((segment, index) => {
          if (segment.type === "text" && segment.content?.trim()) {
            // Text segment - add bullet prefix to first text segment
            const isFirst = segment === firstTextSegment;
            // Show animated blinking ● while streaming, static colored ● when done
            const isActivelyStreaming = message.streaming && index === segments.length - 1;
            // ● color: always foreground (white) for regular text — only sub-agents/tools change color
            const bulletColor = themeColors.foreground;
            // Inline bullet prefix as <span> to avoid flex layout issues
            const bulletSpan = isFirst
              ? (isActivelyStreaming ? <StreamingBullet speed={500} /> : <span style={{ fg: bulletColor }}>{STATUS.active} </span>)
              : "  ";
            const trimmedContent = syntaxStyle 
              ? segment.content.replace(/^\n+/, "")
              : segment.content.trimStart();
            return syntaxStyle ? (
              <box key={segment.key} flexDirection="row" alignItems="flex-start" marginBottom={index < segments.length - 1 ? 1 : 0}>
                <box flexShrink={0}>{isFirst
                  ? (isActivelyStreaming ? <text><StreamingBullet speed={500} /></text> : <text style={{ fg: bulletColor }}>{STATUS.active} </text>)
                  : <text>  </text>}</box>
                <box flexGrow={1} flexShrink={1} minWidth={0}>
                  <markdown
                    content={preprocessTaskListCheckboxes(trimmedContent)}
                    syntaxStyle={syntaxStyle}
                    streaming={isActivelyStreaming}
                  />
                </box>
              </box>
            ) : (
              <box key={segment.key} marginBottom={index < segments.length - 1 ? 1 : 0}>
                <text wrapMode="char" selectable>{bulletSpan}{trimmedContent}</text>
              </box>
            );
          } else if (segment.type === "tool" && segment.toolCall) {
            // Tool call segment
            return (
              <box key={segment.key}>
                <ToolResult
                  toolName={segment.toolCall.toolName}
                  input={segment.toolCall.input}
                  output={segment.toolCall.output}
                  status={segment.toolCall.status}
                />
              </box>
            );
          } else if (segment.type === "agents" && segment.agents) {
            // Parallel agents tree segment (chronologically positioned)
            return (
              <ParallelAgentsTree
                key={segment.key}
                agents={segment.agents}
                compact={true}
                maxVisible={5}
                noTopMargin={index === 0}
              />
            );
          } else if (segment.type === "tasks" && segment.taskItems) {
            // Tasks already rendered by TodoWrite tool result + persistent panel at top
            return null;
          }
          return null;
        })}

        {/* Fallback: Render agents/tasks at bottom if not in segments (for legacy messages) */}
        {(() => {
          const agentsInSegments = segments.some(s => s.type === "agents");
          
          return (
            <>
              {!agentsInSegments && agentsToShow && (
                <ParallelAgentsTree
                  agents={agentsToShow}
                  compact={true}
                  maxVisible={5}
                  noTopMargin={segments.length === 0}
                />
              )}
              {/* Tasks rendered by TodoWrite tool result + persistent panel */}
            </>
          );
        })()}

        {/* Loading spinner — always at bottom of streamed content */}
        {message.streaming && !hideLoading && (
          <box flexDirection="row" alignItems="flex-start" marginTop={segments.length > 0 || agentsToShow ? 1 : 0}>
            <text>
              <LoadingIndicator speed={120} elapsedMs={elapsedMs} outputTokens={streamingMeta?.outputTokens} thinkingMs={streamingMeta?.thinkingMs} />
            </text>
          </box>
        )}

        {/* Completion summary: shown only when response took longer than 60s */}
        {!message.streaming && message.durationMs != null && message.durationMs > 60_000 && (
          <box marginTop={1}>
            <CompletionSummary durationMs={message.durationMs} outputTokens={message.outputTokens} thinkingMs={message.thinkingMs} />
          </box>
        )}

      </box>
    );
  }

  // System message: inline red text (no separate header/modal)
  return (
    <box
      flexDirection="column"
      marginBottom={isLast ? 0 : 1}
      paddingLeft={1}
      paddingRight={1}
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
  placeholder: _placeholder = "Type a message...",
  title: _title,
  syntaxStyle,
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
  initialModelId,
  getClientSystemToolsTokens,
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

  // Separate state for showing Ctrl+C warning (controlled by parent via signal handler)
  const [ctrlCPressed, setCtrlCPressed] = useState(false);
  const ctrlCTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Renderer ref for copy-on-selection (OpenTUI Selection API)
  const renderer = useRenderer();

  // Copy-on-selection: auto-copy selected text to clipboard on mouse release
  // Keep selection visible so user can also use Ctrl+C / Ctrl+Shift+C to copy
  const handleMouseUp = useCallback(() => {
    const selection = renderer.getSelection();
    if (selection) {
      const selectedText = selection.getSelectedText();
      if (selectedText) {
        renderer.copyToClipboardOSC52(selectedText);
      }
    }
  }, [renderer]);

  // Streaming state hook for tool executions and pending questions
  const streamingState = useStreamingState();

  // Message queue for queuing messages during streaming
  const messageQueue = useMessageQueue();

  // Transcript mode: full-screen detailed transcript view (ctrl+o toggle)
  const [transcriptMode, setTranscriptMode] = useState(false);

  // Conversation collapsed state for collapsing/expanding entire conversation
  const [conversationCollapsed, setConversationCollapsed] = useState(false);



  // State for showing user question dialog
  const [activeQuestion, setActiveQuestion] = useState<UserQuestion | null>(null);

  // State for showing model selector dialog
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string | undefined>(undefined);
  // Store the display name separately to match what's shown in the selector dropdown
  const [currentModelDisplayName, setCurrentModelDisplayName] = useState<string | undefined>(undefined);

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
      underline: true,
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
  // TodoWrite persistent state
  const [todoItems, setTodoItems] = useState<Array<{id?: string; content: string; status: "pending" | "in_progress" | "completed" | "error"; activeForm: string; blockedBy?: string[]}>>([]);
  const todoItemsRef = useRef<Array<{id?: string; content: string; status: "pending" | "in_progress" | "completed" | "error"; activeForm: string; blockedBy?: string[]}>>([]);
  // Accumulates the raw text content from the current streaming response (for parsing step 1 output)
  const lastStreamingContentRef = useRef<string>("");
  // Resolver for streamAndWait: when set, handleComplete resolves the Promise instead of processing the queue
  const streamCompletionResolverRef = useRef<((result: import("./commands/registry.ts").StreamResult) => void) | null>(null);
  const [showTodoPanel, setShowTodoPanel] = useState(true);
  // Whether task list items are expanded (full content, no truncation)
  const [tasksExpanded, setTasksExpanded] = useState(false);
  // State for input textarea scrollbar (shown only when input overflows)
  const [inputScrollbar, setInputScrollbar] = useState<InputScrollbarState>({
    visible: false,
    viewportHeight: 1,
    thumbTop: 0,
    thumbSize: 1,
  });

  // Prompt history for up/down arrow navigation
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Store current input when entering history mode
  const savedInputRef = useRef<string>("");

  // Refs for streaming message updates
  const streamingMessageIdRef = useRef<string | null>(null);
  // Ref to track when streaming started for duration calculation
  const streamingStartRef = useRef<number | null>(null);
  // Ref to track streaming state synchronously (for immediate check in handleSubmit)
  // This avoids race conditions where React state hasn't updated yet
  const isStreamingRef = useRef(false);
  // Ref to keep a synchronous copy of streaming meta for baking into message on completion
  const streamingMetaRef = useRef<StreamingMeta | null>(null);
  // Ref to track whether an interrupt (ESC/Ctrl+C) already finalized agents.
  // Prevents handleComplete from overwriting interrupted agents with "completed".
  const wasInterruptedRef = useRef(false);
  // Ref to keep a synchronous copy of parallel agents (avoids nested dispatch issues)
  const parallelAgentsRef = useRef<ParallelAgent[]>([]);
  // Ref to hold a deferred handleComplete when sub-agents are still running.
  // When the last agent finishes, the stored function is called to finalize
  // the message and process the next queued message.
  const pendingCompleteRef = useRef<(() => void) | null>(null);
  // Tracks whether the current stream is an @mention-only stream (no SDK onComplete).
  // Prevents the agent-only completion path from firing for SDK-spawned sub-agents.
  const isAgentOnlyStreamRef = useRef(false);
  // Ref to hold a deferred user interrupt message when sub-agents are still running.
  // When the last agent finishes, the interrupt fires and the stored message is sent.
  const pendingInterruptMessageRef = useRef<string | null>(null);
  // Whether the pending interrupt came from a filesRead (skipUserMessage) flow
  const pendingInterruptSkipUserRef = useRef(false);
  // Stream generation counter — incremented each time a new stream starts.
  // handleComplete closures capture the generation at creation time and skip
  // if it no longer matches, preventing stale callbacks from corrupting a
  // newer stream's state (e.g., after round-robin injection).
  const streamGenerationRef = useRef(0);
  // Ref to track whether any tool call is currently running (synchronous check
  // for keyboard handler to avoid stale closure issues with React state).
  const hasRunningToolRef = useRef(false);
  // Counter to trigger effect when tools complete (used for deferred completion logic)
  const [toolCompletionVersion, setToolCompletionVersion] = useState(0);
  // Ref to hold user messages that were dequeued and added to chat context
  // during tool execution. handleComplete checks this before the regular queue.
  const toolContextMessagesRef = useRef<string[]>([]);
  // Ref for scrollbox to enable programmatic scrolling
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);

  // Create macOS-style scroll acceleration for smooth mouse wheel scrolling
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel(), []);

  // Live elapsed time counter for streaming indicator
  useEffect(() => {
    if (!isStreaming || !streamingStartRef.current) {
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
  }, [isStreaming]);

  // Keep todoItemsRef in sync with state for use in completion callbacks
  useEffect(() => {
    todoItemsRef.current = todoItems;
  }, [todoItems]);

  // Dynamic placeholder based on queue state
  const dynamicPlaceholder = useMemo(() => {
    if (messageQueue.count > 0) {
      return "Press ↑ to edit queued messages...";
    } else if (isStreaming) {
      return "Type a message (enter to interrupt, ctrl+d to enqueue)...";
    } else {
      return "Enter a message...";
    }
  }, [messageQueue.count, isStreaming]);

  /**
   * Update workflow state with partial values.
   * Convenience function for updating specific fields.
   */
  const updateWorkflowState = useCallback((updates: Partial<WorkflowChatState>) => {
    setWorkflowState((prev) => ({ ...prev, ...updates }));
  }, []);

  /**
   * Check if a tool spawns sub-agents (for offset capture).
   */
  function isSubAgentTool(toolName: string): boolean {
    const subAgentTools = ["Task", "task"];
    return subAgentTools.includes(toolName);
  }

  /**
   * Handle tool execution start event.
   * Updates streaming state and adds tool call to current message.
   * Captures content offset for inline rendering.
   */
  const handleToolStart = useCallback((
    toolId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => {
    // Update streaming state
    streamingState.handleToolStart(toolId, toolName, input);
    // Track that a tool is running (synchronous ref for keyboard handler)
    hasRunningToolRef.current = true;

    // Add tool call to current streaming message, capturing content offset.
    // If a tool call with the same ID already exists, update its input
    // (SDKs may send an initial event with empty input followed by a
    // populated one for the same logical tool call).
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            const existing = msg.toolCalls?.find(tc => tc.id === toolId);
            if (existing) {
              // Update existing tool call's input with the latest values
              return {
                ...msg,
                toolCalls: msg.toolCalls?.map(tc =>
                  tc.id === toolId ? { ...tc, input } : tc
                ),
              };
            }

            // Capture current content length as offset for inline rendering
            const contentOffsetAtStart = msg.content.length;
            const newToolCall: MessageToolCall = {
              id: toolId,
              toolName,
              input,
              status: "running",
              contentOffsetAtStart,
            };
            
            // Create updated message with new tool call
            const updatedMsg = {
              ...msg,
              toolCalls: [...(msg.toolCalls || []), newToolCall],
            };
            
            // Capture agents offset on first sub-agent-spawning tool
            if (isSubAgentTool(toolName) && msg.agentsContentOffset === undefined) {
              updatedMsg.agentsContentOffset = msg.content.length;
            }
            
            return updatedMsg;
          }
          return msg;
        })
      );
    }

    // Update persistent todo panel when TodoWrite is called
    if (toolName === "TodoWrite" && input.todos && Array.isArray(input.todos)) {
      const todos = input.todos as Array<{id?: string; content: string; status: "pending" | "in_progress" | "completed" | "error"; activeForm: string; blockedBy?: string[]}>;
      todoItemsRef.current = todos;
      setTodoItems(todos);
      
      // Capture tasks offset on first TodoWrite call
      if (messageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId && msg.tasksContentOffset === undefined
              ? { ...msg, tasksContentOffset: msg.content.length }
              : msg
          )
        );
      }
    }
  }, [streamingState]);

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
    // Update streaming state
    if (success) {
      streamingState.handleToolComplete(toolId, output);
    } else {
      streamingState.handleToolError(toolId, error || "Unknown error");
    }

    // Update tool call in current streaming message
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((prev) => {
        const updated = prev.map((msg) => {
          if (msg.id === messageId && msg.toolCalls) {
            return {
              ...msg,
              toolCalls: msg.toolCalls.map((tc) => {
                if (tc.id === toolId) {
                  // Merge input if provided and current input is empty
                  const updatedInput = (input && Object.keys(tc.input).length === 0)
                    ? input
                    : tc.input;
                  return {
                    ...tc,
                    input: updatedInput,
                    output,
                    status: success ? "completed" as const : "error" as const,
                  };
                }
                return tc;
              }),
            };
          }
          return msg;
        });

        // Update hasRunningToolRef: check if any tool calls are still running
        // in the current streaming message after this completion.
        const streamMsg = updated.find((msg) => msg.id === messageId);
        const stillRunning = streamMsg?.toolCalls?.some((tc) => tc.status === "running") ?? false;
        const wasRunning = hasRunningToolRef.current;
        hasRunningToolRef.current = stillRunning;

        // If all tools completed and there's a pending complete, trigger effect
        if (wasRunning && !stillRunning && pendingCompleteRef.current) {
          setToolCompletionVersion(v => v + 1);
        }

        return updated;
      });
    }

    // Update persistent todo panel when TodoWrite completes (handles late input)
    if (input && input.todos && Array.isArray(input.todos)) {
      const todos = input.todos as Array<{id?: string; content: string; status: "pending" | "in_progress" | "completed" | "error"; activeForm: string; blockedBy?: string[]}>;
      todoItemsRef.current = todos;
      setTodoItems(todos);
    }
  }, [streamingState]);

  /**
   * Handle skill invoked event from SDK.
   * Adds a SkillLoadIndicator entry to the current streaming message.
   */
  const handleSkillInvoked = useCallback((
    skillName: string,
    _skillPath?: string
  ) => {
    const skillLoad: MessageSkillLoad = {
      skillName,
      status: "loaded",
    };
    const messageId = streamingMessageIdRef.current;
    setMessages((prev) => {
      if (messageId) {
        return prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, skillLoads: [...(msg.skillLoads || []), skillLoad] }
            : msg
        );
      }
      // No streaming message — attach to last assistant message or create one
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
    };
  }, []);

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
            // Clear stale todo items from previous turn
            todoItemsRef.current = [];
            setTodoItems([]);

          // Increment stream generation so stale handleComplete callbacks become no-ops
          const currentGeneration = ++streamGenerationRef.current;
          // Set streaming BEFORE calling onStreamMessage to prevent race conditions
          setIsStreaming(true);
          isStreamingRef.current = true;
          streamingMetaRef.current = null;
          setStreamingMeta(null);

          // Call the stream handler - this is async but we don't await it
          // The callbacks will handle state updates
          onStreamMessage?.(
            promptToSend,
            // onChunk: append to current message
            (chunk) => {
              // Drop chunks from stale streams (round-robin replaced this stream)
              if (streamGenerationRef.current !== currentGeneration) return;
              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
                  return [
                    ...prev.slice(0, -1),
                    { ...lastMsg, content: lastMsg.content + chunk },
                  ];
                }
                // Create new streaming message
                const newMessage: ChatMessage = {
                  id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  role: "assistant",
                  content: chunk,
                  timestamp: new Date().toISOString(),
                  streaming: true,
                  toolCalls: [],
                };
                streamingMessageIdRef.current = newMessage.id;
                isAgentOnlyStreamRef.current = false;
                return [...prev, newMessage];
              });
            },
            // onComplete: mark message as complete, finalize parallel agents
            () => {
              // Stale generation guard: if a newer stream started, this callback is a no-op
              if (streamGenerationRef.current !== currentGeneration) return;
              // Finalize any still-running parallel agents and bake into message
              setParallelAgents((currentAgents) => {
                if (currentAgents.length > 0) {
                  const finalizedAgents = currentAgents.map((a) =>
                    a.status === "running" || a.status === "pending"
                      ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                      : a
                  );
                  // Bake finalized agents into the message
                  setMessages((prev) => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
                      return [
                        ...prev.slice(0, -1),
                        { ...lastMsg, streaming: false, completedAt: new Date(), parallelAgents: finalizedAgents, taskItems: todoItemsRef.current.length > 0 ? todoItemsRef.current.map(t => ({ id: t.id, content: t.content, status: t.status === "in_progress" || t.status === "pending" ? "completed" as const : t.status, blockedBy: t.blockedBy })) : undefined },
                      ];
                    }
                    return prev;
                  });
                  // Clear live agents since they're now baked into the message
                  return [];
                }
                // No agents — just finalize the message normally
                setMessages((prev) => {
                  const lastMsg = prev[prev.length - 1];
                  if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
                    return [
                      ...prev.slice(0, -1),
                      { ...lastMsg, streaming: false, completedAt: new Date(), taskItems: todoItemsRef.current.length > 0 ? todoItemsRef.current.map(t => ({ id: t.id, content: t.content, status: t.status === "in_progress" || t.status === "pending" ? "completed" as const : t.status, blockedBy: t.blockedBy })) : undefined },
                    ];
                  }
                  return prev;
                });
                return currentAgents;
              });
              streamingMessageIdRef.current = null;
              setIsStreaming(false);
            },
            // onMeta: update streaming metadata
            (meta: StreamingMeta) => {
              streamingMetaRef.current = meta;
              setStreamingMeta(meta);
            }
          );
          } catch (error) {
            // Prevent unhandled errors from crashing the TUI
            console.error("[workflow auto-start] Error during context clear or streaming:", error);
            setIsStreaming(false);
          }
        })();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [workflowState.workflowActive, workflowState.initialPrompt, isStreaming, onStreamMessage]);

  // Reset workflow started ref when workflow becomes inactive
  useEffect(() => {
    if (!workflowState.workflowActive) {
      workflowStartedRef.current = null;
    }
  }, [workflowState.workflowActive]);

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
   */
  const handlePermissionRequest = useCallback((
    _requestId: string,
    toolName: string,
    question: string,
    options: Array<{ label: string; value: string; description?: string }>,
    respond: (answer: string | string[]) => void,
    header?: string
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

    // Show the question dialog
    handleHumanInputRequired(userQuestion);
  }, [handleHumanInputRequired, workflowState.workflowActive]);

  // Store the requestId for askUserNode questions (for workflow resumption)
  const askUserQuestionRequestIdRef = useRef<string | null>(null);

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
      });
    }
  }, [registerParallelAgentHandler]);

  // When all sub-agents/tools finish and a dequeue was deferred, trigger it.
  // This fires whenever parallelAgents changes (from SDK events OR interrupt handler)
  // or when tools complete (via toolCompletionVersion).
  // Also handles deferred user interrupts (Enter during streaming with active sub-agents).
  useEffect(() => {
    const hasActive = parallelAgents.some(
      (a) => a.status === "running" || a.status === "pending"
    );
    // Also check if tools are still running
    if (hasActive || hasRunningToolRef.current) return;

    // Deferred user interrupt takes priority over deferred SDK complete
    if (pendingInterruptMessageRef.current !== null) {
      const deferredMessage = pendingInterruptMessageRef.current;
      const skipUser = pendingInterruptSkipUserRef.current;
      pendingInterruptMessageRef.current = null;
      pendingInterruptSkipUserRef.current = false;
      // Also clear any pending SDK complete since we're interrupting
      pendingCompleteRef.current = null;

      // Perform the interrupt: finalize current stream and send deferred message
      const interruptedId = streamingMessageIdRef.current;
      if (interruptedId) {
        const durationMs = streamingStartRef.current ? Date.now() - streamingStartRef.current : undefined;
        const finalMeta = streamingMetaRef.current;
        setMessages((prev: ChatMessage[]) =>
          prev.map((msg: ChatMessage) =>
            msg.id === interruptedId
              ? {
                ...msg,
                streaming: false,
                durationMs,
                modelId: currentModelRef.current,
                outputTokens: finalMeta?.outputTokens,
                thinkingMs: finalMeta?.thinkingMs,
                thinkingText: finalMeta?.thinkingText || undefined,
                toolCalls: msg.toolCalls?.map((tc) =>
                  tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                ),
              }
              : msg
          )
        );
      }
      streamingMessageIdRef.current = null;
      streamingStartRef.current = null;
      streamingMetaRef.current = null;
      isStreamingRef.current = false;
      setIsStreaming(false);
      setStreamingMeta(null);
      onInterrupt?.();

      // Check for @mentions in deferred message and spawn agents if found
      const atMentions = parseAtMentions(deferredMessage);
      if (atMentions.length > 0 && executeCommandRef.current) {
        if (!skipUser) {
          setMessages((prev: ChatMessage[]) => [...prev, createMessage("user", deferredMessage)]);
        }

        const assistantMsg = createMessage("assistant", "", true);
        streamingMessageIdRef.current = assistantMsg.id;
        isAgentOnlyStreamRef.current = true;
        isStreamingRef.current = true;
        streamingStartRef.current = Date.now();
        streamingMetaRef.current = null;
        setIsStreaming(true);
        setStreamingMeta(null);
        setMessages((prev: ChatMessage[]) => [...prev, assistantMsg]);

        for (const mention of atMentions) {
          void executeCommandRef.current(mention.agentName, mention.args);
        }
        return;
      }

      if (sendMessageRef.current) {
        sendMessageRef.current(deferredMessage, skipUser ? { skipUserMessage: true } : undefined);
      }
      return;
    }

    if (pendingCompleteRef.current) {
      const complete = pendingCompleteRef.current;
      pendingCompleteRef.current = null;
      complete();
      return;
    }

    // Finalize "agent-only" streaming message (created by @mention handler)
    // when all spawned sub-agents have completed and there is no pending SDK
    // stream completion.  Without this, the placeholder assistant message
    // would stay in the streaming state indefinitely.
    if (
      parallelAgents.length > 0 &&
      streamingMessageIdRef.current &&
      isStreamingRef.current &&
      isAgentOnlyStreamRef.current
    ) {
      const messageId = streamingMessageIdRef.current;
      const durationMs = streamingStartRef.current
        ? Date.now() - streamingStartRef.current
        : undefined;
      const finalizedAgents = parallelAgents.map((a) =>
        a.status === "running" || a.status === "pending"
          ? {
            ...a,
            status: "completed" as const,
            currentTool: undefined,
            durationMs: Date.now() - new Date(a.startedAt).getTime(),
          }
          : a
      );

      // Collect sub-agent result text into the message content so it
      // renders in the main conversation (like Claude Code's Task tool).
      const agentOutputParts = finalizedAgents
        .filter((a) => a.result && a.result.trim())
        .map((a) => a.result!.trim());
      const agentOutput = agentOutputParts.join("\n\n");

      setMessages((prev: ChatMessage[]) =>
        prev.map((msg: ChatMessage) =>
          msg.id === messageId
            ? {
              ...msg,
              content: (msg.toolCalls?.length ?? 0) > 0 ? msg.content : (agentOutput || msg.content),
              streaming: false,
              completedAt: new Date(),
              durationMs,
              parallelAgents: finalizedAgents,
              taskItems: todoItemsRef.current.length > 0 ? todoItemsRef.current.map(t => ({ id: t.id, content: t.content, status: t.status === "in_progress" || t.status === "pending" ? "completed" as const : t.status, blockedBy: t.blockedBy })) : undefined,
            }
            : msg
        )
      );
      streamingMessageIdRef.current = null;
      streamingStartRef.current = null;
      streamingMetaRef.current = null;
      isStreamingRef.current = false;
      isAgentOnlyStreamRef.current = false;
      setIsStreaming(false);
      setStreamingMeta(null);
      setParallelAgents([]);
      parallelAgentsRef.current = [];

      // Drain the message queue — the agent-only path doesn't go through
      // the SDK handleComplete callback, so we must dequeue here.
      const nextMessage = messageQueue.dequeue();
      if (nextMessage) {
        setTimeout(() => {
          if (sendMessageRef.current) {
            sendMessageRef.current(nextMessage.content);
          }
        }, 50);
      }
    }
  }, [parallelAgents, model, onInterrupt, messageQueue, toolCompletionVersion]);

  // Initialize SubagentGraphBridge when createSubagentSession is available
  useEffect(() => {
    if (!createSubagentSession) {
      setSubagentBridge(null);
      return;
    }

    const bridge = new SubagentGraphBridge({ createSession: createSubagentSession });
    setSubagentBridge(bridge);

    return () => {
      setSubagentBridge(null);
    };
  }, [createSubagentSession]);

  /**
   * Handle user answering a question from UserQuestionDialog.
   * Claude Code behavior: Just respond and continue streaming, no "User selected" messages.
   *
   * For askUserNode questions:
   * - If workflowState.workflowActive, calls onWorkflowResumeWithAnswer to resume workflow
   * - Otherwise, sends the answer through session.send() for standalone agent mode
   */
  const handleQuestionAnswer = useCallback((answer: QuestionAnswer) => {
    // Clear active question first
    setActiveQuestion(null);

    // Remove from pending questions queue
    streamingState.removePendingQuestion();

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

    // Display user's answer in chat so the conversation flow is visible
    if (!answer.cancelled) {
      const answerText = Array.isArray(answer.selected)
        ? answer.selected.join(", ")
        : answer.selected;
      setMessages((prev) => [...prev, createMessage("user", answerText)]);
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
  const executeCommandRef = useRef<((commandName: string, args: string) => Promise<boolean>) | null>(null);

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
          const charBefore = atIndex > 0 ? rawValue[atIndex - 1] : " ";
          const isWordBoundary = charBefore === " " || charBefore === "\n" || charBefore === "\t";

          if (isWordBoundary || atIndex === 0) {
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
        // Check that the @ is either at position 0 or preceded by a space/newline
        const charBefore = atIndex > 0 ? rawValue[atIndex - 1] : " ";
        const isWordBoundary = charBefore === " " || charBefore === "\n" || charBefore === "\t";

        if (isWordBoundary || atIndex === 0) {
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
  }, [workflowState.showAutocomplete, workflowState.argumentHint, updateWorkflowState]);

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

      // Apply @ mention highlighting
      textarea.removeHighlightsByRef(HLREF_MENTION);
      const mentionRanges = findMentionRanges(value);
      for (const [start, end] of mentionRanges) {
        textarea.addHighlightByCharRange({
          start: toHighlightOffset(value, start),
          end: toHighlightOffset(value, end),
          styleId: mentionStyleIdRef.current,
          hlRef: HLREF_MENTION,
        });
      }
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
    const msg = createMessage(role, content);
    setMessages((prev) => [...prev, msg]);
  }, []);

  /**
   * Handle model selection from the ModelSelectorDialog.
   */
  const handleModelSelect = useCallback(async (selectedModel: Model, reasoningEffort?: string) => {
    setShowModelSelector(false);

    try {
      const result = await modelOps?.setModel(selectedModel.id);
      if (modelOps && 'setPendingReasoningEffort' in modelOps) {
        (modelOps as { setPendingReasoningEffort: (e: string | undefined) => void }).setPendingReasoningEffort(reasoningEffort);
      }
      const effortSuffix = reasoningEffort ? ` (${reasoningEffort})` : "";
      if (result?.requiresNewSession) {
        addMessage("assistant", `Model **${selectedModel.modelID}**${effortSuffix} will be used for the next session.`);
      } else {
        addMessage("assistant", `Switched to model **${selectedModel.modelID}**${effortSuffix}`);
      }
      setCurrentModelId(selectedModel.id);
      onModelChange?.(selectedModel.id);
      const displaySuffix = (agentType === "copilot" && reasoningEffort) ? ` (${reasoningEffort})` : "";
      setCurrentModelDisplayName(`${selectedModel.modelID}${displaySuffix}`);
      if (agentType) {
        saveModelPreference(agentType, selectedModel.id);
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
    args: string
  ): Promise<boolean> => {
    // Clear stale todo items from previous commands
    setTodoItems([]);

    // Look up the command in the registry
    const command = globalRegistry.get(commandName);

    if (!command) {
      // Command not found - show error message
      addMessage("system", `Unknown command: /${commandName}. Type /help for available commands.`);
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
      setStreaming: setIsStreaming,
      sendMessage: (content: string) => {
        // Use ref to call sendMessage without circular dependency
        if (sendMessageRef.current) {
          sendMessageRef.current(content);
        }
      },
      sendSilentMessage: (content: string) => {
        // Send to agent without displaying as user message
        // Call send handler (fire and forget)
        if (onSendMessage) {
          void Promise.resolve(onSendMessage(content));
        }
        // Handle streaming response if handler provided
        if (onStreamMessage) {
          // Increment stream generation so stale handleComplete callbacks become no-ops
          const currentGeneration = ++streamGenerationRef.current;
          isStreamingRef.current = true;
          setIsStreaming(true);
          streamingStartRef.current = Date.now();
          streamingMetaRef.current = null;
          setStreamingMeta(null);
          // Clear stale todo items from previous turn
          todoItemsRef.current = [];
          setTodoItems([]);
          // Reset streaming content accumulator for step 1 → step 2 task parsing
          lastStreamingContentRef.current = "";
          // Reset tool tracking for the new stream
          hasRunningToolRef.current = false;

          // Create placeholder assistant message for the response
          const assistantMessage = createMessage("assistant", "", true);
          streamingMessageIdRef.current = assistantMessage.id;
          isAgentOnlyStreamRef.current = false;
          setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);

          const handleChunk = (chunk: string) => {
            if (!isStreamingRef.current) return;
            // Drop chunks from stale streams (round-robin replaced this stream)
            if (streamGenerationRef.current !== currentGeneration) return;
            // Accumulate content for step 1 → step 2 task parsing
            lastStreamingContentRef.current += chunk;
            const messageId = streamingMessageIdRef.current;
            if (messageId) {
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === messageId
                    ? { ...msg, content: msg.content + chunk }
                    : msg
                )
              );
            }
          };

          const handleComplete = () => {
            // Stale generation guard — a newer stream has started (round-robin inject),
            // so this callback must not touch any shared refs/state.
            if (streamGenerationRef.current !== currentGeneration) return;
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
                setMessages((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === messageId
                      ? { ...msg, streaming: false, durationMs, modelId: currentModelRef.current, outputTokens: finalMeta?.outputTokens, thinkingMs: finalMeta?.thinkingMs, thinkingText: finalMeta?.thinkingText || undefined }
                      : msg
                  )
                );
              }
              setParallelAgents([]);
              streamingMessageIdRef.current = null;
              streamingStartRef.current = null;
              streamingMetaRef.current = null;
              isStreamingRef.current = false;
              setIsStreaming(false);
              setStreamingMeta(null);
              hasRunningToolRef.current = false;

              // Resolve streamAndWait promise with interrupted flag
              const resolver = streamCompletionResolverRef.current;
              if (resolver) {
                streamCompletionResolverRef.current = null;
                resolver({ content: lastStreamingContentRef.current, wasInterrupted: true });
                return;
              }

              // Check for messages added to chat context during tool execution first
              const toolCtxMsg = toolContextMessagesRef.current.shift();
              if (toolCtxMsg) {
                setTimeout(() => {
                  if (sendMessageRef.current) {
                    sendMessageRef.current(toolCtxMsg, { skipUserMessage: true });
                  }
                }, 50);
              } else {
                const nextMessage = messageQueue.dequeue();
                if (nextMessage) {
                  setTimeout(() => {
                    if (sendMessageRef.current) {
                      sendMessageRef.current(nextMessage.content);
                    }
                  }, 50);
                }
              }
              return;
            }

            // If sub-agents or tools are still running, defer finalization and queue
            // processing until they complete (preserves correct state).
            const hasActiveAgents = parallelAgentsRef.current.some(
              (a) => a.status === "running" || a.status === "pending"
            );
            if (hasActiveAgents || hasRunningToolRef.current) {
              pendingCompleteRef.current = handleComplete;
              return;
            }

            // Finalize running parallel agents and bake into message
            setParallelAgents((currentAgents) => {
              const finalizedAgents = currentAgents.length > 0
                ? currentAgents.map((a) =>
                  a.status === "running" || a.status === "pending"
                    ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                    : a
                )
                : undefined;

              if (messageId) {
                setMessages((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === messageId
                      ? {
                        ...msg,
                        streaming: false,
                        durationMs,
                        modelId: currentModelRef.current,
                        outputTokens: finalMeta?.outputTokens,
                        thinkingMs: finalMeta?.thinkingMs,
                        thinkingText: finalMeta?.thinkingText || undefined,
                        toolCalls: msg.toolCalls?.map((tc) =>
                          tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                        ),
                        parallelAgents: finalizedAgents,
                        taskItems: todoItemsRef.current.length > 0 ? todoItemsRef.current.map(t => ({ id: t.id, content: t.content, status: t.status === "in_progress" || t.status === "pending" ? "completed" as const : t.status, blockedBy: t.blockedBy })) : undefined,
                      }
                      : msg
                  )
                );
              }
              // Clear live agents
              return [];
            });

            streamingMessageIdRef.current = null;
            streamingStartRef.current = null;
            streamingMetaRef.current = null;
            isStreamingRef.current = false;
            setIsStreaming(false);
            setStreamingMeta(null);
            hasRunningToolRef.current = false;

            // If a streamAndWait call is pending, resolve its promise
            // instead of processing the message queue.
            const resolver = streamCompletionResolverRef.current;
            if (resolver) {
              streamCompletionResolverRef.current = null;
              resolver({ content: lastStreamingContentRef.current, wasInterrupted: false });
              return;
            }

            // Check for messages added to chat context during tool execution first
            const toolCtxMessage = toolContextMessagesRef.current.shift();
            if (toolCtxMessage) {
              setTimeout(() => {
                if (sendMessageRef.current) {
                  sendMessageRef.current(toolCtxMessage, { skipUserMessage: true });
                }
              }, 50);
            } else {
              const nextMessage = messageQueue.dequeue();
              if (nextMessage) {
                setTimeout(() => {
                  if (sendMessageRef.current) {
                    sendMessageRef.current(nextMessage.content);
                  }
                }, 50);
              }
            }
          };

          const handleMeta = (meta: StreamingMeta) => {
            streamingMetaRef.current = meta;
            setStreamingMeta(meta);
          };

          void Promise.resolve(onStreamMessage(content, handleChunk, handleComplete, handleMeta));
        }
      },
      spawnSubagent: async (options) => {
        // Inject into main session — SDK's native sub-agent dispatch handles it.
        // Wait for the streaming response so the caller gets the actual result
        // (previously returned empty output immediately).
        const agentName = options.name ?? options.model ?? "general-purpose";
        const task = options.message;
        const instruction = `Use the ${agentName} sub-agent to handle this task: ${task}`;
        const result = await new Promise<import("./commands/registry.ts").StreamResult>((resolve) => {
          streamCompletionResolverRef.current = resolve;
          context.sendSilentMessage(instruction);
        });
        return {
          success: !result.wasInterrupted,
          output: result.content,
        };
      },
      streamAndWait: (prompt: string) => {
        return new Promise<import("./commands/registry.ts").StreamResult>((resolve) => {
          streamCompletionResolverRef.current = resolve;
          // Delegate to sendSilentMessage logic
          context.sendSilentMessage(prompt);
        });
      },
      clearContext: async () => {
        if (onResetSession) {
          await onResetSession();
        }
        setMessages((prev) => {
          appendToHistoryBuffer(prev);
          return [];
        });
        setCompactionSummary(null);
        setShowCompactionHistory(false);
        setParallelAgents([]);
        // Restore todoItems (preserved across context clears)
        const saved = todoItemsRef.current;
        setTodoItems(saved);
      },
      setTodoItems: (items) => {
        todoItemsRef.current = items;
        setTodoItems(items);
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
      getClientSystemToolsTokens,
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
        streamingStartRef.current = Date.now();
        isStreamingRef.current = true;
        const msg = createMessage("assistant", "", true);
        commandSpinnerMsgId = msg.id;
        flushSync(() => {
          setIsStreaming(true);
          setMessages((prev) => [...prev, msg]);
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
        setParallelAgents([]);
        setTranscriptMode(false);
        clearHistoryBuffer();
      }

      // Handle clearMessages flag — persist history before clearing
      if (result.clearMessages) {
        appendToHistoryBuffer(messages);
        setMessages([]);
      }

      // Store compaction summary if present (from /compact command)
      if (result.compactionSummary) {
        setCompactionSummary(result.compactionSummary);
        setShowCompactionHistory(false);
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
          ralphConfig: result.stateUpdate.ralphConfig !== undefined ? result.stateUpdate.ralphConfig : workflowState.ralphConfig,
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

      // Track skill load in message for UI indicator
      if (result.skillLoaded) {
        const skillLoad: MessageSkillLoad = {
          skillName: result.skillLoaded,
          status: result.skillLoadError ? "error" : "loaded",
          errorMessage: result.skillLoadError,
        };
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, skillLoads: [...(lastMsg.skillLoads || []), skillLoad] },
            ];
          }
          // No assistant message yet — create one with skill load
          const msg = createMessage("assistant", "");
          msg.skillLoads = [skillLoad];
          return [...prev, msg];
        });
      }

      // Track MCP server list in message for UI indicator
      if (result.mcpServers) {
        const mcpServers = result.mcpServers;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, mcpServers },
            ];
          }
          // No assistant message yet — create one with MCP servers
          const msg = createMessage("assistant", "");
          msg.mcpServers = mcpServers;
          return [...prev, msg];
        });
      }

      // Track context info in message for UI display
      if (result.contextInfo) {
        const contextInfo = result.contextInfo;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, contextInfo },
            ];
          }
          const msg = createMessage("assistant", "");
          msg.contextInfo = contextInfo;
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
        if (result.message && !result.clearMessages) {
          // Replace spinner message with result content
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? { ...msg, content: result.message!, streaming: false }
                : msg
            )
          );
        } else {
          // Remove spinner message (either no result or messages will be cleared)
          setMessages((prev) => prev.filter((msg) => msg.id !== msgId));
        }
        isStreamingRef.current = false;
        setIsStreaming(false);
        streamingStartRef.current = null;
      }

      return result.success;
    } catch (error) {
      // Clean up delayed spinner on error
      clearTimeout(commandSpinnerTimer);
      if (commandSpinnerShown && commandSpinnerMsgId) {
        const msgId = commandSpinnerMsgId;
        setMessages((prev) => prev.filter((msg) => msg.id !== msgId));
        isStreamingRef.current = false;
        setIsStreaming(false);
        streamingStartRef.current = null;
      }
      // Handle execution error (as assistant message, not system)
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Error executing /${commandName}: ${errorMessage}`);
      return false;
    }
  }, [isStreaming, messages.length, workflowState, addMessage, updateWorkflowState, toggleTheme, setTheme, onSendMessage, onStreamMessage, getSession, model, onModelChange]);

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
          void executeCommand(command.name, remaining);
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
        void executeCommand(command.name, "");
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

    // First, check textarea selection (input area)
    if (textarea?.hasSelection()) {
      const selectedText = textarea.getSelectedText();
      if (selectedText) {
        renderer.copyToClipboardOSC52(selectedText);
        return;
      }
    }

    // Then, check renderer selection (mouse-drag on chat content)
    const selection = renderer.getSelection();
    if (selection) {
      const selectedText = selection.getSelectedText();
      if (selectedText) {
        renderer.copyToClipboardOSC52(selectedText);
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
        // Detect Kitty keyboard protocol support from any CSI u-style event
        if (!kittyKeyboardDetectedRef.current && event.raw?.endsWith("u") && event.raw.startsWith("\x1b[")) {
          kittyKeyboardDetectedRef.current = true;
        }

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
            // Abort the stream FIRST so chunks stop arriving immediately
            onInterrupt?.();

            // Signal that interrupt already finalized agents — prevents
            // handleComplete from overwriting with "completed" status
            wasInterruptedRef.current = true;

            // Read agents synchronously from ref (avoids nested dispatch issues)
            const currentAgents = parallelAgentsRef.current;
            const interruptedAgents = currentAgents.length > 0
              ? currentAgents.map((a) =>
                a.status === "running" || a.status === "pending"
                  ? { ...a, status: "interrupted" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                  : a
              )
              : undefined;

            // Clear live agents and update ref immediately
            parallelAgentsRef.current = [];
            setParallelAgents([]);

            // Bake interrupted agents into message and stop streaming
            const interruptedId = streamingMessageIdRef.current;
            if (interruptedId) {
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === interruptedId
                    ? {
                      ...msg,
                      wasInterrupted: true,
                      streaming: false,
                      parallelAgents: interruptedAgents,
                      toolCalls: msg.toolCalls?.map((tc) =>
                        tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                      ),
                    }
                    : msg
                )
              );
            }

            // Stop streaming state immediately so UI reflects interrupted state
            isStreamingRef.current = false;
            setIsStreaming(false);

            // Sub-agent cancellation handled by SDK session interrupt

            // Clear any pending ask-user question so dialog dismisses on ESC
            setActiveQuestion(null);
            askUserQuestionRequestIdRef.current = null;

            // Cancel active workflow too (if running)
            if (workflowState.workflowActive) {
              updateWorkflowState({
                workflowActive: false,
                workflowType: null,
                initialPrompt: null,
              });
            }

            setInterruptCount(0);
            if (interruptTimeoutRef.current) {
              clearTimeout(interruptTimeoutRef.current);
              interruptTimeoutRef.current = null;
            }
            setCtrlCPressed(false);
            return;
          }

          // If not streaming but subagents are still running, mark them interrupted
          {
            const currentAgents = parallelAgentsRef.current;
            const hasRunningAgents = currentAgents.some(
              (a) => a.status === "running" || a.status === "pending"
            );
            if (hasRunningAgents) {
              wasInterruptedRef.current = true;
              const interruptedAgents = currentAgents.map((a) =>
                a.status === "running" || a.status === "pending"
                  ? { ...a, status: "interrupted" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                  : a
              );
              const interruptedId = streamingMessageIdRef.current;
              if (interruptedId) {
                setMessages((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === interruptedId
                      ? {
                        ...msg,
                        parallelAgents: interruptedAgents,
                        toolCalls: msg.toolCalls?.map((tc) =>
                          tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                        ),
                      }
                      : msg
                  )
                );
              }
              parallelAgentsRef.current = [];
              setParallelAgents([]);
              return;
            }
          }

          // Cancel active workflow regardless of streaming state
          // (workflow may be active but between API calls, e.g. after error)
          if (workflowState.workflowActive) {
            updateWorkflowState({
              workflowActive: false,
              workflowType: null,
              initialPrompt: null,
            });
            setInterruptCount(0);
            if (interruptTimeoutRef.current) {
              clearTimeout(interruptTimeoutRef.current);
              interruptTimeoutRef.current = null;
            }
            setCtrlCPressed(false);
            return;
          }

          // Not streaming: if textarea has content, clear it first
          if (textarea?.plainText) {
            textarea.gotoBufferHome();
            textarea.gotoBufferEnd({ select: true });
            textarea.deleteChar();
            return;
          }

          // Textarea empty: use double-press to exit
          const newCount = interruptCount + 1;
          if (newCount >= 2) {
            // Double press - exit
            setInterruptCount(0);
            if (interruptTimeoutRef.current) {
              clearTimeout(interruptTimeoutRef.current);
              interruptTimeoutRef.current = null;
            }
            setCtrlCPressed(false);
            onExit?.();
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

        // Ctrl+O - toggle transcript mode (full-screen detailed view)
        if (event.ctrl && event.name === "o") {
          setTranscriptMode(prev => !prev);
          return;
        }

        // Ctrl+T - toggle todo list panel visibility and task expansion
        if (event.ctrl && !event.shift && event.name === "t") {
          setShowTodoPanel(prev => !prev);
          setTasksExpanded(prev => !prev);
          return;
        }

        // Ctrl+D - enqueue message (round-robin) during streaming
        // When a tool call is executing, dequeue immediately and add the
        // user prompt to the chat context so it's visible while waiting.
        if (event.ctrl && event.name === "d") {
          if (isStreamingRef.current) {
            const textarea = textareaRef.current;
            const value = textarea?.plainText?.trim() ?? "";
            if (value) {
              if (hasRunningToolRef.current) {
                // Tool is running — add user message to chat context immediately
                // and store for sending when the stream completes.
                const userMsg = createMessage("user", value);
                setMessages((prev) => [...prev, userMsg]);
                toolContextMessagesRef.current.push(value);
              } else {
                // No tool running — enqueue for later (existing behavior)
                messageQueue.enqueue(value);
              }
              // Clear textarea
              if (textarea) {
                textarea.gotoBufferHome();
                textarea.gotoBufferEnd({ select: true });
                textarea.deleteChar();
              }
            }
          }
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
            // Abort the stream FIRST so chunks stop arriving immediately
            onInterrupt?.();

            // Signal that interrupt already finalized agents — prevents
            // handleComplete from overwriting with "completed" status
            wasInterruptedRef.current = true;

            // Read agents synchronously from ref (avoids nested dispatch issues)
            const currentAgents = parallelAgentsRef.current;
            const interruptedAgents = currentAgents.length > 0
              ? currentAgents.map((a) =>
                a.status === "running" || a.status === "pending"
                  ? { ...a, status: "interrupted" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                  : a
              )
              : undefined;

            // Clear live agents and update ref immediately
            parallelAgentsRef.current = [];
            setParallelAgents([]);

            // Bake interrupted agents into message and stop streaming
            const interruptedId = streamingMessageIdRef.current;
            if (interruptedId) {
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === interruptedId
                    ? {
                      ...msg,
                      wasInterrupted: true,
                      streaming: false,
                      parallelAgents: interruptedAgents,
                      toolCalls: msg.toolCalls?.map((tc) =>
                        tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                      ),
                    }
                    : msg
                )
              );
            }

            // Stop streaming state immediately so UI reflects interrupted state
            isStreamingRef.current = false;
            setIsStreaming(false);
            hasRunningToolRef.current = false;
            // Discard any tool-context messages on interrupt — they won't be sent
            toolContextMessagesRef.current = [];

            // Sub-agent cancellation handled by SDK session interrupt

            // Clear any pending ask-user question so dialog dismisses on ESC
            setActiveQuestion(null);
            askUserQuestionRequestIdRef.current = null;

            // Cancel active workflow too (if running)
            if (workflowState.workflowActive) {
              updateWorkflowState({
                workflowActive: false,
                workflowType: null,
                initialPrompt: null,
              });
            }
            return;
          }

          // If not streaming but subagents are still running, mark them interrupted
          {
            const currentAgents = parallelAgentsRef.current;
            const hasRunningAgents = currentAgents.some(
              (a) => a.status === "running" || a.status === "pending"
            );
            if (hasRunningAgents) {
              wasInterruptedRef.current = true;
              const interruptedAgents = currentAgents.map((a) =>
                a.status === "running" || a.status === "pending"
                  ? { ...a, status: "interrupted" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                  : a
              );
              const interruptedId = streamingMessageIdRef.current;
              if (interruptedId) {
                setMessages((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === interruptedId
                      ? {
                        ...msg,
                        parallelAgents: interruptedAgents,
                        toolCalls: msg.toolCalls?.map((tc) =>
                          tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                        ),
                      }
                      : msg
                  )
                );
              }
              parallelAgentsRef.current = [];
              setParallelAgents([]);
              return;
            }
          }

          // Cancel active workflow regardless of streaming state
          if (workflowState.workflowActive) {
            updateWorkflowState({
              workflowActive: false,
              workflowType: null,
              initialPrompt: null,
            });
            return;
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

        // Prompt history navigation: Up arrow cycles through previous prompts
        if (event.name === "up" && !workflowState.showAutocomplete && !isEditingQueue && !isStreaming && messageQueue.count === 0 && promptHistory.length > 0) {
          const textarea = textareaRef.current;
          if (textarea) {
            const currentInput = textarea.plainText ?? "";
            if (historyIndex === -1) {
              // Entering history mode - save current input
              savedInputRef.current = currentInput;
              const newIndex = promptHistory.length - 1;
              setHistoryIndex(newIndex);
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(promptHistory[newIndex]!);
            } else if (historyIndex > 0) {
              // Navigate to earlier prompt
              const newIndex = historyIndex - 1;
              setHistoryIndex(newIndex);
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(promptHistory[newIndex]!);
            }
            return;
          }
        }

        // Prompt history navigation: Down arrow cycles forward through history
        if (event.name === "down" && !workflowState.showAutocomplete && !isEditingQueue && !isStreaming && messageQueue.count === 0 && historyIndex >= 0) {
          const textarea = textareaRef.current;
          if (textarea) {
            if (historyIndex < promptHistory.length - 1) {
              // Navigate to more recent prompt
              const newIndex = historyIndex + 1;
              setHistoryIndex(newIndex);
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              textarea.insertText(promptHistory[newIndex]!);
            } else {
              // Exiting history mode - restore saved input
              setHistoryIndex(-1);
              textarea.gotoBufferHome();
              textarea.gotoBufferEnd({ select: true });
              textarea.deleteChar();
              if (savedInputRef.current) {
                textarea.insertText(savedInputRef.current);
              }
            }
            return;
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
        // Must be handled here (before autocomplete Enter handler) with stopPropagation
        // to prevent the textarea's built-in "return → submit" key binding from firing.
        // Ctrl+J (linefeed without shift) also inserts newline as a universal fallback
        // for terminals that don't support the Kitty keyboard protocol.
        // Fallback: some terminals send Shift+Enter as a Kitty-protocol escape sequence
        // that gets misinterpreted (e.g., "/" extracted from the CSI sequence).
        // Detect by checking event.raw for Enter codepoint (13/10) with a modifier.
        if (
          ((event.name === "return" || event.name === "linefeed") && (event.shift || event.meta)) ||
          (event.name === "linefeed" && !event.ctrl && !event.shift && !event.meta) ||
          (event.name !== "return" && event.name !== "linefeed" && event.raw?.endsWith("u") && /^\x1b\[(?:13|10)/.test(event.raw) && event.raw.includes(";")) ||
          (event.name === "return" && !event.shift && event.raw != null && event.raw !== "\r" && event.raw !== "\n" && event.raw.includes(";2"))
        ) {
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
        if (event.name === "return" && !event.shift && !event.meta && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
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
                void executeCommand(selectedCommand.name, remaining);
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
              void executeCommand(selectedCommand.name, "");
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
      [onExit, onInterrupt, isStreaming, interruptCount, handleCopy, workflowState.showAutocomplete, workflowState.selectedSuggestionIndex, workflowState.autocompleteInput, workflowState.autocompleteMode, autocompleteSuggestions, updateWorkflowState, handleInputChange, syncInputScrollbar, executeCommand, activeQuestion, showModelSelector, ctrlCPressed, messageQueue, setIsEditingQueue, parallelAgents, compactionSummary, addMessage, renderer]
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
        setMessages((prev: ChatMessage[]) => [...prev, userMessage]);
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
        streamingMetaRef.current = null;
        setStreamingMeta(null);
        // Clear stale todo items from previous turn
        todoItemsRef.current = [];
        setTodoItems([]);
        // Reset tool tracking for the new stream
        hasRunningToolRef.current = false;

        // Create placeholder assistant message
        const assistantMessage = createMessage("assistant", "", true);
        streamingMessageIdRef.current = assistantMessage.id;
        isAgentOnlyStreamRef.current = false;
        setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);

        // Handle stream chunks — guarded by ref to drop post-interrupt chunks
        const handleChunk = (chunk: string) => {
          if (!isStreamingRef.current) return;
          // Drop chunks from stale streams (round-robin replaced this stream)
          if (streamGenerationRef.current !== currentGeneration) return;
          const messageId = streamingMessageIdRef.current;
          if (messageId) {
            setMessages((prev: ChatMessage[]) =>
              prev.map((msg: ChatMessage) =>
                msg.id === messageId
                  ? { ...msg, content: msg.content + chunk }
                  : msg
              )
            );
          }
        };

        // Handle stream completion - process next queued message after delay
        const handleComplete = () => {
          // Stale generation guard — a newer stream has started (round-robin inject),
          // so this callback must not touch any shared refs/state.
          if (streamGenerationRef.current !== currentGeneration) return;
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
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === messageId
                    ? { ...msg, streaming: false, durationMs, modelId: currentModelRef.current, outputTokens: finalMeta?.outputTokens, thinkingMs: finalMeta?.thinkingMs, thinkingText: finalMeta?.thinkingText || undefined }
                    : msg
                )
              );
            }
            setParallelAgents([]);
            streamingMessageIdRef.current = null;
            streamingStartRef.current = null;
            streamingMetaRef.current = null;
            isStreamingRef.current = false;
            setIsStreaming(false);
            setStreamingMeta(null);
            hasRunningToolRef.current = false;

            // Check for messages added to chat context during tool execution first
            const toolCtxMsg = toolContextMessagesRef.current.shift();
            if (toolCtxMsg) {
              setTimeout(() => {
                sendMessage(toolCtxMsg, { skipUserMessage: true });
              }, 50);
            } else {
              const nextMessage = messageQueue.dequeue();
              if (nextMessage) {
                setTimeout(() => {
                  sendMessage(nextMessage.content);
                }, 50);
              }
            }
            return;
          }

          // If sub-agents are still running, defer finalization and queue
          // processing until they complete (preserves correct state).
          const hasActiveAgents = parallelAgentsRef.current.some(
            (a) => a.status === "running" || a.status === "pending"
          );
          if (hasActiveAgents) {
            pendingCompleteRef.current = handleComplete;
            return;
          }

          // Finalize running parallel agents and bake into message
          setParallelAgents((currentAgents) => {
            const finalizedAgents = currentAgents.length > 0
              ? currentAgents.map((a) =>
                a.status === "running" || a.status === "pending"
                  ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: Date.now() - new Date(a.startedAt).getTime() }
                  : a
              )
              : undefined;

            if (messageId) {
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === messageId
                    ? {
                      ...msg,
                      streaming: false,
                      durationMs,
                      modelId: currentModelRef.current,
                      outputTokens: finalMeta?.outputTokens,
                      thinkingMs: finalMeta?.thinkingMs,
                      thinkingText: finalMeta?.thinkingText || undefined,
                      toolCalls: msg.toolCalls?.map((tc) =>
                        tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                      ),
                      parallelAgents: finalizedAgents,
                      taskItems: todoItemsRef.current.length > 0 ? todoItemsRef.current.map(t => ({ id: t.id, content: t.content, status: t.status === "in_progress" || t.status === "pending" ? "completed" as const : t.status, blockedBy: t.blockedBy })) : undefined,
                    }
                    : msg
                )
              );
            }
            // Clear live agents
            return [];
          });

          streamingMessageIdRef.current = null;
          streamingStartRef.current = null;
          streamingMetaRef.current = null;
          // Clear ref immediately (synchronous) before state update
          isStreamingRef.current = false;
          setIsStreaming(false);
          setStreamingMeta(null);
          hasRunningToolRef.current = false;
          // Check for messages added to chat context during tool execution first
          const toolCtxMessage = toolContextMessagesRef.current.shift();
          if (toolCtxMessage) {
            setTimeout(() => {
              sendMessage(toolCtxMessage, { skipUserMessage: true });
            }, 50);
          } else {
            const nextMessage = messageQueue.dequeue();
            if (nextMessage) {
              setTimeout(() => {
                sendMessage(nextMessage.content);
              }, 50);
            }
          }
        };

        // Handle streaming metadata updates (tokens, thinking duration)
        const handleMeta = (meta: StreamingMeta) => {
          streamingMetaRef.current = meta;
          setStreamingMeta(meta);
        };

        void Promise.resolve(onStreamMessage(content, handleChunk, handleComplete, handleMeta));
      }
    },
    [onSendMessage, onStreamMessage, messageQueue]
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
          void executeCommand(parsed.name, parsed.args);
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
            void executeCommand(agentName, agentArgs);
            return;
          }
        }

        const { message: processed } = processFileMentions(initialPrompt);
        sendMessage(processed);
      }, 0);
    }
  }, [initialPrompt, sendMessage, addMessage, executeCommand]);

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
      if (!kittyKeyboardDetectedRef.current && value.endsWith("\\")) {
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

      // Add to prompt history (avoid duplicates of last entry)
      setPromptHistory(prev => {
        if (prev[prev.length - 1] === trimmedValue) return prev;
        return [...prev, trimmedValue];
      });
      setHistoryIndex(-1);

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
        // Add the slash command to conversation history like any regular user message
        addMessage("user", trimmedValue);
        // Execute the slash command (allowed even during streaming)
        void executeCommand(parsed.name, parsed.args);
        return;
      }

      // Check if this contains @agent mentions
      if (trimmedValue.startsWith("@")) {
        const atMentions = parseAtMentions(trimmedValue);

        if (atMentions.length > 0) {
          // If sub-agents or streaming are already active, defer this
          // @mention until they finish (same queuing behaviour as regular
          // messages — active runs are always prioritised).
          if (isStreamingRef.current) {
            const hasActiveSubagents = parallelAgentsRef.current.some(
              (a) => a.status === "running" || a.status === "pending"
            );
            if (hasActiveSubagents) {
              addMessage("user", trimmedValue);
              pendingInterruptMessageRef.current = trimmedValue;
              pendingInterruptSkipUserRef.current = true;
              return;
            }
          }

          addMessage("user", trimmedValue);

          // Create a streaming assistant message immediately so the parallel
          // agents tree view renders right away instead of waiting for the
          // next user message.  The message acts as a placeholder that is
          // finalised when all spawned sub-agents complete (see the
          // parallelAgents useEffect).
          const assistantMsg = createMessage("assistant", "", true);
          streamingMessageIdRef.current = assistantMsg.id;
          isAgentOnlyStreamRef.current = true;
          isStreamingRef.current = true;
          streamingStartRef.current = Date.now();
          streamingMetaRef.current = null;
          setIsStreaming(true);
          setStreamingMeta(null);
          todoItemsRef.current = [];
          setTodoItems([]);
          setMessages((prev) => [...prev, assistantMsg]);

          for (const mention of atMentions) {
            void executeCommand(mention.agentName, mention.args);
          }
          return;
        }
      }

      // Process file @mentions (e.g., @src/file.ts) - prepend file content as context
      const { message: processedValue, filesRead } = processFileMentions(trimmedValue);

      // Display file read confirmations attached to user message (GH issue #162)
      if (filesRead.length > 0) {
        // Add user message with filesRead metadata so the UI renders it inline
        const msg = createMessage("user", trimmedValue);
        msg.filesRead = filesRead;
        setMessages((prev) => [...prev, msg]);

        // Send processed message without re-adding the user message
        if (isStreamingRef.current) {
          // Defer interrupt if sub-agents are active — will fire when they finish
          const hasActiveSubagents = parallelAgentsRef.current.some(
            (a) => a.status === "running" || a.status === "pending"
          );
          if (hasActiveSubagents) {
            pendingInterruptMessageRef.current = processedValue;
            pendingInterruptSkipUserRef.current = true;
            return;
          }
          // No sub-agents — interrupt and inject immediately
          const interruptedId = streamingMessageIdRef.current;
          if (interruptedId) {
            const durationMs = streamingStartRef.current ? Date.now() - streamingStartRef.current : undefined;
            const finalMeta = streamingMetaRef.current;
            setMessages((prev) =>
              prev.map((msg2) =>
                msg2.id === interruptedId
                  ? {
                    ...msg2,
                    streaming: false,
                    durationMs,
                    modelId: currentModelRef.current,
                    outputTokens: finalMeta?.outputTokens,
                    thinkingMs: finalMeta?.thinkingMs,
                    thinkingText: finalMeta?.thinkingText || undefined,
                    toolCalls: msg2.toolCalls?.map((tc) =>
                      tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                    ),
                  }
                  : msg2
              )
            );
          }
          streamingMessageIdRef.current = null;
          streamingStartRef.current = null;
          streamingMetaRef.current = null;
          isStreamingRef.current = false;
          setIsStreaming(false);
          setStreamingMeta(null);
          onInterrupt?.();
          sendMessage(processedValue, { skipUserMessage: true });
          return;
        }
        sendMessage(processedValue, { skipUserMessage: true });
        return;
      }

      // If streaming, interrupt: inject immediately unless sub-agents are active
      if (isStreamingRef.current) {
        // Defer interrupt if sub-agents are actively working — fires when they finish
        const hasActiveSubagents = parallelAgentsRef.current.some(
          (a) => a.status === "running" || a.status === "pending"
        );
        if (hasActiveSubagents) {
          pendingInterruptMessageRef.current = processedValue;
          pendingInterruptSkipUserRef.current = false;
          return;
        }

        // Round-robin inject: finalize current stream and send new message immediately
        const interruptedId = streamingMessageIdRef.current;
        if (interruptedId) {
          const durationMs = streamingStartRef.current ? Date.now() - streamingStartRef.current : undefined;
          const finalMeta = streamingMetaRef.current;
          setMessages((prev: ChatMessage[]) =>
            prev.map((msg: ChatMessage) =>
              msg.id === interruptedId
                ? {
                  ...msg,
                  streaming: false,
                  durationMs,
                  modelId: currentModelRef.current,
                  outputTokens: finalMeta?.outputTokens,
                  thinkingMs: finalMeta?.thinkingMs,
                  thinkingText: finalMeta?.thinkingText || undefined,
                  toolCalls: msg.toolCalls?.map((tc) =>
                    tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                  ),
                }
                : msg
            )
          );
        }
        // Clear streaming state before starting new stream
        streamingMessageIdRef.current = null;
        streamingStartRef.current = null;
        streamingMetaRef.current = null;
        isStreamingRef.current = false;
        setIsStreaming(false);
        setStreamingMeta(null);
        // Abort the SDK stream (stale handleComplete is a no-op via generation guard)
        onInterrupt?.();
        // Send immediately — starts a new stream generation
        sendMessage(processedValue);
        return;
      }

      // Send the message (no file mentions - normal flow)
      sendMessage(processedValue);
    },
    [workflowState.showAutocomplete, workflowState.argumentHint, updateWorkflowState, addMessage, executeCommand, messageQueue, sendMessage, model, onInterrupt]
  );

  // Get the visible messages (limit to MAX_VISIBLE_MESSAGES for performance)
  // Show the most recent messages, truncating older ones
  const visibleMessages = messages.length > MAX_VISIBLE_MESSAGES
    ? messages.slice(-MAX_VISIBLE_MESSAGES)
    : messages;

  // Show truncation indicator if there are hidden messages
  const hiddenMessageCount = messages.length - visibleMessages.length;

  // Render message list (no empty state text)
  const messageContent = messages.length > 0 ? (
    <>
      {/* Truncation indicator - shows how many messages are hidden */}
      {hiddenMessageCount > 0 && (
        <box marginBottom={1} paddingLeft={1}>
          <text style={{ fg: themeColors.muted }}>
            ↑ {hiddenMessageCount} earlier message{hiddenMessageCount !== 1 ? "s" : ""} hidden
          </text>
        </box>
      )}
      {conversationCollapsed && messages.length > 0 && (
        <box paddingLeft={1} marginBottom={1}>
          <text style={{ fg: themeColors.dim }}>
            {"─".repeat(3)} {messages.length} message{messages.length !== 1 ? "s" : ""} collapsed {"─".repeat(3)}
          </text>
        </box>
      )}
      {visibleMessages.map((msg, index) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isLast={index === visibleMessages.length - 1}
          syntaxStyle={markdownSyntaxStyle}
          hideAskUserQuestion={activeQuestion !== null}
          hideLoading={activeQuestion !== null}
          parallelAgents={index === visibleMessages.length - 1 ? parallelAgents : undefined}
          todoItems={msg.streaming ? todoItems : undefined}
          elapsedMs={msg.streaming ? streamingElapsedMs : undefined}
          streamingMeta={msg.streaming ? streamingMeta : null}
          collapsed={conversationCollapsed}
          tasksExpanded={tasksExpanded}
        />
      ))}
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
          modelId={model}
          isStreaming={isStreaming}
          streamingMeta={streamingMeta}
        />
      ) : (
      <>
      {/* Compaction History - shows expanded compaction summary */}
      {showCompactionHistory && compactionSummary && parallelAgents.length === 0 && (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
          <box flexDirection="column" border borderStyle="rounded" borderColor={themeColors.muted} paddingLeft={1} paddingRight={1}>
            <text style={{ fg: themeColors.muted }} attributes={1}>Compaction Summary</text>
            <text style={{ fg: themeColors.foreground }} wrapMode="char" selectable>{compactionSummary}</text>
          </box>
        </box>
      )}

      {/* Todo Panel - shows persistent summary from TodoWrite (Ctrl+T to toggle) */}
      {/* Hidden during streaming — the inline TaskListIndicator under the spinner handles it */}
      {/* Shows only summary line after streaming to avoid render artifacts with bordered boxes */}
      {showTodoPanel && !isStreaming && todoItems.length > 0 && (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} marginBottom={1}>
          <text style={{ fg: themeColors.muted }}>
            {`${CHECKBOX.checked} ${todoItems.length} tasks (${todoItems.filter(t => t.status === "completed").length} done, ${todoItems.filter(t => t.status !== "completed").length} open) ${MISC.separator} ctrl+t to hide`}
          </text>
        </box>
      )}

      {/* Message display area - scrollable console below input */}
      {/* Text can be selected with mouse and copied with Ctrl+C */}
      <scrollbox
        ref={scrollboxRef}
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        scrollY={true}
        scrollX={false}
        viewportCulling={false}
        paddingLeft={1}
        paddingRight={1}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
        scrollAcceleration={scrollAcceleration}
      >
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
          <box marginTop={1}>
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

        {/* Input Area - inside scrollbox, flows after messages */}
        {/* Hidden when question dialog or model selector is active */}
        {!activeQuestion && !showModelSelector && (
          <>
            <box
              border
              borderStyle="rounded"
              borderColor={themeColors.inputFocus}
              paddingLeft={1}
              paddingRight={1}
              marginTop={messages.length > 0 ? 1 : 0}
              flexDirection="row"
              alignItems="flex-start"
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
                <box flexDirection="column" marginLeft={1}>
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
            {/* Streaming hints - shows "esc to interrupt" and "ctrl+d enqueue" during streaming */}
            {isStreaming ? (
              <box paddingLeft={2} flexDirection="row" gap={1}>
                <text style={{ fg: themeColors.muted }}>
                  esc to interrupt
                </text>
                <text style={{ fg: themeColors.muted }}>{MISC.separator}</text>
                <text style={{ fg: themeColors.muted }}>
                  ctrl+d enqueue
                </text>
              </box>
            ) : null}
          </>
        )}

        {/* Autocomplete dropdown for slash commands and @ mentions - inside scrollbox */}
        {workflowState.showAutocomplete && (
          <box marginTop={0} marginBottom={0}>
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
          <box paddingLeft={2}>
            <text style={{ fg: themeColors.muted }}>
              Press Ctrl-C again to exit
            </text>
          </box>
        )}
      </scrollbox>
      </>
      )}

    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatApp;
