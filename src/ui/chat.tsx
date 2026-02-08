/**
 * Terminal Chat UI Component
 *
 * React components for a terminal-based chat interface using OpenTUI.
 * Supports message streaming, sticky scroll, and keyboard navigation.
 *
 * Reference: Feature 15 - Implement terminal chat UI
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type {
  KeyEvent,
  SyntaxStyle,
  TextareaRenderable,
  ScrollBoxRenderable,
  KeyBinding,
  PasteEvent,
} from "@opentui/core";
import { MacOSScrollAccel } from "@opentui/core";
import { useTheme, useThemeColors, darkTheme, lightTheme } from "./theme.tsx";
import { copyToClipboard, pasteFromClipboard } from "../utils/clipboard.ts";
import { Autocomplete, navigateUp, navigateDown } from "./components/autocomplete.tsx";
import { WorkflowStatusBar, type FeatureProgress } from "./components/workflow-status-bar.tsx";
import { ToolResult } from "./components/tool-result.tsx";
import { TimestampDisplay } from "./components/timestamp-display.tsx";
import { QueueIndicator } from "./components/queue-indicator.tsx";
import {
  ParallelAgentsTree,
  type ParallelAgent,
} from "./components/parallel-agents-tree.tsx";
import {
  SubagentSessionManager,
  type SubagentSpawnOptions as ManagerSpawnOptions,
  type CreateSessionFn,
} from "./subagent-session-manager.ts";
import {
  UserQuestionDialog,
  type UserQuestion,
  type QuestionAnswer,
} from "./components/user-question-dialog.tsx";
import {
  ModelSelectorDialog,
} from "./components/model-selector-dialog.tsx";
import type { Model } from "../models/model-transform.ts";
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
import { saveModelPreference } from "../utils/preferences.ts";

// ============================================================================
// @ MENTION HELPERS
// ============================================================================

/**
 * Get autocomplete suggestions for @ mentions (agents and files).
 * Agent names are searched from the command registry (category "agent").
 * File paths are searched when input contains path characters (/ or .).
 */
function getMentionSuggestions(input: string): CommandDefinition[] {
  const suggestions: CommandDefinition[] = [];

  // Agent suggestions - filter registry by "agent" category
  const agentMatches = globalRegistry.search(input).filter(cmd => cmd.category === "agent");
  suggestions.push(...agentMatches);

  // File suggestions - when input contains path characters
  if (input.includes("/") || input.includes(".")) {
    try {
      const cwd = process.cwd();
      const inputDir = input.includes("/") ? dirname(input) : "";
      const inputBase = input.includes("/") ? basename(input) : input;
      const searchDir = inputDir ? join(cwd, inputDir) : cwd;

      const entries = readdirSync(searchDir, { withFileTypes: true });
      const fileMatches = entries
        .filter(e => e.name.toLowerCase().startsWith(inputBase.toLowerCase()) && !e.name.startsWith("."))
        .slice(0, 10)
        .map(e => ({
          name: inputDir ? `${inputDir}/${e.name}` : e.name,
          description: e.isDirectory() ? "📁 Directory" : "📄 File",
          category: "custom" as CommandCategory,
          execute: () => ({ success: true as const }),
        }));

      suggestions.push(...fileMatches);
    } catch {
      // Silently fail for invalid paths
    }
  }

  return suggestions;
}

interface FileReadInfo {
  path: string;
  sizeBytes: number;
  lineCount: number;
  isImage: boolean;
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
      const content = readFileSync(fullPath, "utf-8");
      const stats = statSync(fullPath);
      const lineCount = content.split("\n").length;
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(filePath);

      filesRead.push({
        path: filePath,
        sizeBytes: stats.size,
        lineCount,
        isImage,
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
 * Gradient color palette for Atomic branding
 * Muted dusty pink → soft rose → pale blue transition
 */
const ATOMIC_GRADIENT = [
  "#E8B4B8", // Dusty pink (start)
  "#DDA8AC", // Muted rose
  "#D49CA0", // Soft rose
  "#C99094", // Dusty rose
  "#B8949C", // Mauve
  "#A898A4", // Dusty lavender
  "#989CAC", // Muted periwinkle
  "#8AA0B4", // Pale steel blue (end)
];

/**
 * Props for GradientText component
 */
interface GradientTextProps {
  text: string;
  gradient: string[];
}

/**
 * Renders text with a horizontal gradient effect.
 * Each character is wrapped in a span with its own color from the gradient.
 *
 * Note: OpenTUI requires explicit style props - raw ANSI codes don't work.
 */
function GradientText({ text, gradient }: GradientTextProps): React.ReactNode {
  const chars = [...text];
  const gradientLen = gradient.length;

  return (
    <text>
      {chars.map((char, i) => {
        // Map character position to gradient index
        const gradientIndex = Math.floor((i / chars.length) * gradientLen);
        const color = gradient[Math.min(gradientIndex, gradientLen - 1)] as string;
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
    onComplete: () => void
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
  featureProgress: FeatureProgress | null;

  // Approval state for human-in-the-loop
  /** Whether waiting for user approval (spec approval, etc.) */
  pendingApproval: boolean;
  /** Whether the spec/item has been approved */
  specApproved: boolean;
  /** User feedback when rejecting (passed back to workflow) */
  feedback: string | null;
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
  /** Whether verbose mode is enabled (shows timestamps) */
  verboseMode?: boolean;
  /** Whether to hide AskUserQuestion tool output (when dialog is active) */
  hideAskUserQuestion?: boolean;
  /** Whether to hide loading indicator (when question dialog is active) */
  hideLoading?: boolean;
  /** Parallel agents to display inline (only for streaming assistant message) */
  parallelAgents?: ParallelAgent[];
  /** Whether the agent tree is expanded */
  agentTreeExpanded?: boolean;
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
export const MAX_VISIBLE_MESSAGES = Infinity;

// ============================================================================
// LOADING INDICATOR COMPONENT
// ============================================================================

/**
 * Configurable array of spinner verbs for the loading indicator.
 * These verbs are contextually appropriate for AI assistant actions.
 * One is randomly selected when LoadingIndicator mounts.
 */
export const SPINNER_VERBS = [
  "Thinking",
  "Analyzing",
  "Processing",
  "Reasoning",
  "Considering",
  "Evaluating",
  "Formulating",
  "Generating",
  "Orchestrating",
  "Iterating",
  "Synthesizing",
  "Resolving",
];

/**
 * Spinner frames matching Claude Code TUI style.
 * Single character cycles through shapes for a clean, minimal animation.
 */
const SPINNER_FRAMES = ["✻", "✶", "✢", "·", "✢", "✶", "✻", "✽"];

/**
 * Select a random verb from the SPINNER_VERBS array.
 *
 * @returns A randomly selected verb string
 */
export function getRandomSpinnerVerb(): string {
  const index = Math.floor(Math.random() * SPINNER_VERBS.length);
  return SPINNER_VERBS[index] as string;
}

/**
 * Props for the LoadingIndicator component.
 */
interface LoadingIndicatorProps {
  /** Speed of animation in milliseconds per frame */
  speed?: number;
}

/**
 * Animated loading indicator matching Claude Code TUI style.
 * Single spinning character with a random verb and Unicode ellipsis.
 * Muted rose color for the spinner, gray for the verb text.
 *
 * Returns span elements (not wrapped in text) so it can be composed
 * inside other text elements. Wrap in <text> when using standalone.
 */
export function LoadingIndicator({ speed = 120 }: LoadingIndicatorProps): React.ReactNode {
  const [frameIndex, setFrameIndex] = useState(0);
  // Select random verb only on mount (empty dependency array)
  const [verb] = useState(() => getRandomSpinnerVerb());

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, speed);

    return () => clearInterval(interval);
  }, [speed]);

  const spinChar = SPINNER_FRAMES[frameIndex] as string;

  return (
    <>
      <span style={{ fg: "#D4A5A5" }}>{spinChar} </span>
      <span style={{ fg: "#D4A5A5" }}>{verb}…</span>
    </>
  );
}

// ============================================================================
// COMPLETION SUMMARY COMPONENT
// ============================================================================

/**
 * Past-tense verbs for the completion summary line.
 * Displayed after a response finishes: "✻ Worked for 1m 6s"
 */
const COMPLETION_VERBS = [
  "Worked",
  "Crafted",
  "Processed",
  "Computed",
  "Reasoned",
  "Composed",
  "Delivered",
  "Produced",
];

/**
 * Pick a random completion verb.
 */
function getRandomCompletionVerb(): string {
  const index = Math.floor(Math.random() * COMPLETION_VERBS.length);
  return COMPLETION_VERBS[index] as string;
}

/**
 * Pick a random spinner frame (excluding ● which is reserved for completed content).
 */
function getRandomSpinnerChar(): string {
  const chars = ["✻", "✶", "✢", "✽"];
  const index = Math.floor(Math.random() * chars.length);
  return chars[index] as string;
}

/**
 * Format milliseconds into a human-readable duration string.
 * e.g., 66000 → "1m 6s", 3000 → "3s", 125 → "<1s"
 */
function formatCompletionDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

interface CompletionSummaryProps {
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Completion summary line shown after an assistant response finishes.
 * Matches Claude Code style: "✻ Worked for 1m 6s"
 */
export function CompletionSummary({ durationMs }: CompletionSummaryProps): React.ReactNode {
  const [verb] = useState(() => getRandomCompletionVerb());
  const [spinChar] = useState(() => getRandomSpinnerChar());

  return (
    <box flexDirection="row">
      <text style={{ fg: "#9A9AAC" }}>
        <span style={{ fg: "#D4A5A5" }}>{spinChar} </span>
        <span>{verb} for {formatCompletionDuration(durationMs)}</span>
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
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, speed);
    return () => clearInterval(interval);
  }, [speed]);

  return <span style={{ fg: "#D4A5A5" }}>{visible ? "●" : "·"} </span>;
}

// ============================================================================
// DESIGN TOKENS - ATOMIC BRANDING (Muted Pink & Pale Blue Theme)
// ============================================================================

/** Primary pink - soft dusty rose brand color */
const ATOMIC_PINK = "#D4A5A5";
/** Secondary pink - muted rose for borders */
const ATOMIC_PINK_DIM = "#B8878A";
/** User message color - pale sky blue for contrast */
const _USER_SKY = "#A8C5D8";
/** Muted color for timestamps and secondary text */
const MUTED_LAVENDER = "#9A9AAC";
/** Dim text for subtle elements */
const _DIM_BLUE = "#8899AA";
/** Input scrollbar thumb color when textarea content overflows */
const INPUT_SCROLLBAR_FG = "#BFA6AC";
/** Input scrollbar track color when textarea content overflows */
const INPUT_SCROLLBAR_BG = "#5A4C50";

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
  model = "sonnet",
  tier = "Claude Max",
  workingDir = "~/",
}: AtomicHeaderProps): React.ReactNode {
  return (
    <box flexDirection="row" alignItems="flex-start" marginBottom={1} marginLeft={1} flexShrink={0}>
      {/* Block letter logo with gradient */}
      <box flexDirection="column" marginRight={3}>
        {ATOMIC_BLOCK_LOGO.map((line, i) => (
          <GradientText key={i} text={line} gradient={ATOMIC_GRADIENT} />
        ))}
      </box>

      {/* App info */}
      <box flexDirection="column" paddingTop={0}>
        {/* Version line */}
        <text>
          <span style={{ fg: "white" }}>v{version}</span>
        </text>

        {/* Model info line */}
        <text style={{ fg: MUTED_LAVENDER }}>
          {model} · {tier}
        </text>

        {/* Working directory line */}
        <text style={{ fg: MUTED_LAVENDER }}>{workingDir}</text>
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
  type: "text" | "tool";
  content?: string;
  toolCall?: MessageToolCall;
  key: string;
}

/**
 * Build interleaved content segments from message content and tool calls.
 * Tool calls are inserted at their recorded content offsets.
 */
function buildContentSegments(content: string, toolCalls: MessageToolCall[]): ContentSegment[] {
  // Filter out HITL tools
  const visibleToolCalls = toolCalls.filter(tc =>
    tc.toolName !== "AskUserQuestion" && tc.toolName !== "question" && tc.toolName !== "ask_user"
  );

  if (visibleToolCalls.length === 0) {
    return content ? [{ type: "text", content, key: "text-0" }] : [];
  }

  // Sort tool calls by their content offset (ascending)
  const sortedToolCalls = [...visibleToolCalls].sort((a, b) => {
    const offsetA = a.contentOffsetAtStart ?? 0;
    const offsetB = b.contentOffsetAtStart ?? 0;
    return offsetA - offsetB;
  });

  const segments: ContentSegment[] = [];
  let lastOffset = 0;

  for (const toolCall of sortedToolCalls) {
    const offset = toolCall.contentOffsetAtStart ?? 0;

    // Add text segment before this tool call (if any)
    if (offset > lastOffset) {
      const textContent = content.slice(lastOffset, offset).trimEnd();
      if (textContent) {
        segments.push({
          type: "text",
          content: textContent,
          key: `text-${lastOffset}`,
        });
      }
    }

    // Add the tool call segment
    segments.push({
      type: "tool",
      toolCall,
      key: `tool-${toolCall.id}`,
    });

    lastOffset = offset;
  }

  // Add remaining text after the last tool call
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
export function MessageBubble({ message, isLast, syntaxStyle, verboseMode = false, hideAskUserQuestion: _hideAskUserQuestion = false, hideLoading = false, parallelAgents, agentTreeExpanded }: MessageBubbleProps): React.ReactNode {
  const themeColors = useThemeColors();

  // Hide the entire message when question dialog is active and there's no content yet
  // This prevents showing a stray "●" bullet before the dialog
  const hideEntireMessage = hideLoading && message.streaming && !message.content.trim();

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
            <span style={{ bg: "#3A3A4A", fg: "#E0E0E0" }}> {message.content} </span>
          </text>
        </box>
      </box>
    );
  }

  // Assistant message: bullet point prefix, with tool calls interleaved at correct positions
  if (message.role === "assistant") {
    // Build interleaved content segments
    const segments = buildContentSegments(message.content, message.toolCalls || []);
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
              ? (isActivelyStreaming ? <StreamingBullet speed={500} /> : <span style={{ fg: bulletColor }}>● </span>)
              : "  ";
            const trimmedContent = segment.content.trimStart();
            return syntaxStyle ? (
              <box key={segment.key} flexDirection="row" alignItems="flex-start" marginBottom={index < segments.length - 1 ? 1 : 0}>
                <box flexShrink={0}>{isFirst
                  ? (isActivelyStreaming ? <StreamingBullet speed={500} /> : <text style={{ fg: bulletColor }}>● </text>)
                  : <text>  </text>}</box>
                <box flexGrow={1} flexShrink={1} minWidth={0}>
                  <markdown
                    content={trimmedContent}
                    syntaxStyle={syntaxStyle}
                    streaming={isActivelyStreaming}
                  />
                </box>
              </box>
            ) : (
              <box key={segment.key} marginBottom={index < segments.length - 1 ? 1 : 0}>
                <text wrapMode="char">{bulletSpan}{trimmedContent}</text>
              </box>
            );
          } else if (segment.type === "tool" && segment.toolCall) {
            // Tool call segment
            return (
              <box key={segment.key} marginBottom={index < segments.length - 1 ? 1 : 0}>
                <ToolResult
                  toolName={segment.toolCall.toolName}
                  input={segment.toolCall.input}
                  output={segment.toolCall.output}
                  status={segment.toolCall.status}
                  verboseMode={verboseMode}
                />
              </box>
            );
          }
          return null;
        })}

        {/* Inline parallel agents tree — between tool/text content and loading spinner */}
        {/* Live agents (from prop) for the currently streaming message, or baked agents for completed messages */}
        {(() => {
          const agentsToShow = parallelAgents && parallelAgents.length > 0
            ? parallelAgents
            : message.parallelAgents && message.parallelAgents.length > 0
              ? message.parallelAgents
              : null;
          return agentsToShow ? (
            <ParallelAgentsTree
              agents={agentsToShow}
              compact={!agentTreeExpanded}
              maxVisible={agentTreeExpanded ? 20 : 5}
            />
          ) : null;
        })()}

        {/* Loading spinner — always at bottom of streamed content */}
        {message.streaming && !hideLoading && (
          <box flexDirection="row" alignItems="flex-start" paddingLeft={1}>
            <text>
              <LoadingIndicator speed={120} />
            </text>
          </box>
        )}

        {/* Completion summary: "✻ Worked for 1m 6s" after response finishes */}
        {!message.streaming && message.durationMs != null && message.durationMs >= 3000 && (
          <CompletionSummary durationMs={message.durationMs} />
        )}

        {/* Timestamp display in verbose mode (only for completed assistant messages) */}
        {verboseMode && !message.streaming && (
          <TimestampDisplay
            timestamp={message.timestamp}
            durationMs={message.durationMs}
            modelId={message.modelId}
          />
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
  model = "sonnet",
  tier = "Claude Max",
  workingDir = "~/",
  suggestion: _suggestion,
  registerToolStartHandler,
  registerToolCompleteHandler,
  registerPermissionRequestHandler,
  registerCtrlCWarningHandler,
  getSession,
  registerAskUserQuestionHandler,
  onWorkflowResumeWithAnswer,
  agentType,
  modelOps,
  parallelAgents: initialParallelAgents = [],
  registerParallelAgentHandler,
  createSubagentSession,
  initialPrompt,
}: ChatAppProps): React.ReactNode {
  // title and suggestion are deprecated, kept for backwards compatibility
  void _title;
  void _suggestion;

  // Core message state
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
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
  const handleMouseUp = useCallback(() => {
    const selection = renderer.getSelection();
    if (selection) {
      const selectedText = selection.getSelectedText();
      if (selectedText) {
        void copyToClipboard(selectedText);
        renderer.clearSelection();
      }
    }
  }, [renderer]);

  // Streaming state hook for tool executions and pending questions
  const streamingState = useStreamingState();

  // Message queue for queuing messages during streaming
  const messageQueue = useMessageQueue();

  // Verbose mode state for expanded tool outputs and timestamps
  const [verboseMode, setVerboseMode] = useState(false);

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

  // State for queue editing mode
  const [isEditingQueue, setIsEditingQueue] = useState(false);

  // Theme context for /theme command
  const { toggleTheme, setTheme } = useTheme();

  // State for parallel agents display
  const [parallelAgents, setParallelAgents] = useState<ParallelAgent[]>(initialParallelAgents);
  // State for parallel agents tree expand/collapse (ctrl+o)
  const [agentTreeExpanded, setAgentTreeExpanded] = useState(false);
  // Compaction state: stores summary text after /compact for Ctrl+O history
  const [compactionSummary, setCompactionSummary] = useState<string | null>(null);
  const [showCompactionHistory, setShowCompactionHistory] = useState(false);
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

  // SubagentSessionManager ref for delegating sub-agent spawning
  const subagentManagerRef = useRef<SubagentSessionManager | null>(null);

  // Refs for streaming message updates
  const streamingMessageIdRef = useRef<string | null>(null);
  // Ref to track when streaming started for duration calculation
  const streamingStartRef = useRef<number | null>(null);
  // Ref to track streaming state synchronously (for immediate check in handleSubmit)
  // This avoids race conditions where React state hasn't updated yet
  const isStreamingRef = useRef(false);
  // Ref to track whether an interrupt (ESC/Ctrl+C) already finalized agents.
  // Prevents handleComplete from overwriting interrupted agents with "completed".
  const wasInterruptedRef = useRef(false);
  // Ref to keep a synchronous copy of parallel agents (avoids nested dispatch issues)
  const parallelAgentsRef = useRef<ParallelAgent[]>([]);
  // Ref for scrollbox to enable programmatic scrolling
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);

  // Create macOS-style scroll acceleration for smooth mouse wheel scrolling
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel(), []);

  // Dynamic placeholder based on queue state
  const dynamicPlaceholder = useMemo(() => {
    if (messageQueue.count > 0) {
      return "Press ↑ to edit queued messages...";
    } else if (isStreaming) {
      return "Type to queue message...";
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

    // Add tool call to current streaming message, capturing content offset
    // Deduplicate: if a tool call with the same ID already exists, skip adding
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            // Check if tool call with this ID already exists (prevents duplicates)
            const existing = msg.toolCalls?.find(tc => tc.id === toolId);
            if (existing) return msg;

            // Capture current content length as offset for inline rendering
            const contentOffsetAtStart = msg.content.length;
            const newToolCall: MessageToolCall = {
              id: toolId,
              toolName,
              input,
              status: "running",
              contentOffsetAtStart,
            };
            return {
              ...msg,
              toolCalls: [...(msg.toolCalls || []), newToolCall],
            };
          }
          return msg;
        })
      );
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
      setMessages((prev) =>
        prev.map((msg) => {
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
        })
      );
    }
  }, [streamingState]);

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

  // Auto-start workflow when workflowActive becomes true with an initialPrompt
  // This handles the transition from /ralph command to actual workflow execution
  const workflowStartedRef = useRef<string | null>(null);
  useEffect(() => {
    // Only trigger if:
    // 1. Workflow is active
    // 2. We have an initial prompt
    // 3. We haven't already started this workflow (prevent double-sends)
    // 4. We're not currently streaming
    if (
      workflowState.workflowActive &&
      workflowState.initialPrompt &&
      workflowStartedRef.current !== workflowState.initialPrompt &&
      !isStreaming
    ) {
      // Mark this prompt as started to prevent re-triggering
      workflowStartedRef.current = workflowState.initialPrompt;

      // Small delay to ensure state is settled before sending
      const timeoutId = setTimeout(() => {
        // Set streaming BEFORE calling onStreamMessage to prevent race conditions
        setIsStreaming(true);

        // Call the stream handler - this is async but we don't await it
        // The callbacks will handle state updates
        onStreamMessage?.(
          workflowState.initialPrompt!,
          // onChunk: append to current message
          (chunk) => {
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
              return [...prev, newMessage];
            });
          },
          // onComplete: mark message as complete, finalize parallel agents
          () => {
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
                      { ...lastMsg, streaming: false, completedAt: new Date(), parallelAgents: finalizedAgents },
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
                    { ...lastMsg, streaming: false, completedAt: new Date() },
                  ];
                }
                return prev;
              });
              return currentAgents;
            });
            streamingMessageIdRef.current = null;
            setIsStreaming(false);
          }
        );
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

  // Initialize SubagentSessionManager when createSubagentSession is available
  useEffect(() => {
    if (!createSubagentSession) {
      subagentManagerRef.current = null;
      return;
    }

    const manager = new SubagentSessionManager({
      createSession: createSubagentSession,
      onStatusUpdate: (agentId, update) => {
        setParallelAgents((prev) =>
          prev.map((a) => (a.id === agentId ? { ...a, ...update } : a))
        );
      },
    });

    subagentManagerRef.current = manager;

    return () => {
      manager.destroy();
      subagentManagerRef.current = null;
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
    featureProgress?: FeatureProgress | null;
  }) => {
    updateWorkflowState(updates);
  }, [updateWorkflowState]);

  // Ref for textarea to access value and clear it
  const textareaRef = useRef<TextareaRenderable>(null);

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
  const sendMessageRef = useRef<((content: string) => void) | null>(null);

  /**
   * Handle input changes to detect slash command prefix.
   * Shows autocomplete when input starts with "/" and has no space.
   * Shows argument hints when a space follows a valid command name.
   */
  const handleInputChange = useCallback((rawValue: string) => {
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
        // Space present - hide autocomplete, show argument hint only when no args typed yet
        const commandName = afterSlash.slice(0, spaceIndex);
        const afterCommandSpace = afterSlash.slice(spaceIndex + 1);
        const command = globalRegistry.get(commandName);
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          argumentHint: afterCommandSpace.length === 0 ? (command?.argumentHint || "") : "",
        });
      }
    } else if (value.startsWith("@")) {
      // @ mention: show autocomplete with agents and file paths
      const afterAt = value.slice(1);
      const spaceIndex = afterAt.indexOf(" ");

      if (spaceIndex === -1) {
        updateWorkflowState({
          showAutocomplete: true,
          autocompleteInput: afterAt,
          selectedSuggestionIndex: 0,
          autocompleteMode: "mention",
          argumentHint: "",
        });
      } else {
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          autocompleteMode: "command",
          argumentHint: "",
        });
      }
    } else {
      // Hide autocomplete and hints for non-slash commands
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
    const value = textareaRef.current?.plainText ?? "";
    handleInputChange(value);
    syncInputScrollbar();
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
  const handleModelSelect = useCallback(async (selectedModel: Model) => {
    setShowModelSelector(false);

    try {
      const result = await modelOps?.setModel(selectedModel.id);
      if (result?.requiresNewSession) {
        addMessage("assistant", `Model **${selectedModel.name}** will be used for the next session.`);
      } else {
        addMessage("assistant", `Switched to model **${selectedModel.name}**`);
      }
      setCurrentModelId(selectedModel.id);
      // Store the display name to match what's shown in the selector dropdown
      setCurrentModelDisplayName(selectedModel.name);
      if (agentType) {
        saveModelPreference(agentType, selectedModel.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Failed to switch model: ${errorMessage}`);
    }
  }, [modelOps, addMessage]);

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
          isStreamingRef.current = true;
          setIsStreaming(true);
          streamingStartRef.current = Date.now();

          // Create placeholder assistant message for the response
          const assistantMessage = createMessage("assistant", "", true);
          streamingMessageIdRef.current = assistantMessage.id;
          setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);

          const handleChunk = (chunk: string) => {
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
            const messageId = streamingMessageIdRef.current;
            const durationMs = streamingStartRef.current
              ? Date.now() - streamingStartRef.current
              : undefined;

            // If the interrupt handler already finalized agents, skip overwriting
            if (wasInterruptedRef.current) {
              wasInterruptedRef.current = false;
              // Just ensure streaming flags are cleared and message is finalized
              if (messageId) {
                setMessages((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === messageId
                      ? { ...msg, streaming: false, durationMs, modelId: model }
                      : msg
                  )
                );
              }
              setParallelAgents([]);
              streamingMessageIdRef.current = null;
              streamingStartRef.current = null;
              isStreamingRef.current = false;
              setIsStreaming(false);

              const nextMessage = messageQueue.dequeue();
              if (nextMessage) {
                setTimeout(() => {
                  if (sendMessageRef.current) {
                    sendMessageRef.current(nextMessage.content);
                  }
                }, 50);
              }
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
                          modelId: model,
                          toolCalls: msg.toolCalls?.map((tc) =>
                            tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                          ),
                          parallelAgents: finalizedAgents,
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
            isStreamingRef.current = false;
            setIsStreaming(false);

            const nextMessage = messageQueue.dequeue();
            if (nextMessage) {
              setTimeout(() => {
                if (sendMessageRef.current) {
                  sendMessageRef.current(nextMessage.content);
                }
              }, 50);
            }
          };

          void Promise.resolve(onStreamMessage(content, handleChunk, handleComplete));
        }
      },
      spawnSubagent: async (options) => {
        const manager = subagentManagerRef.current;
        if (!manager) {
          return {
            success: false,
            output: "",
            error: "Sub-agent session manager not available (no createSubagentSession factory)",
          };
        }

        const agentId = crypto.randomUUID().slice(0, 8);
        const agentName = options.model ?? "general-purpose";

        // Add the agent to the parallel agents list before spawning
        const parallelAgent: ParallelAgent = {
          id: agentId,
          name: agentName,
          task: options.message.slice(0, 100) + (options.message.length > 100 ? "..." : ""),
          status: "running",
          startedAt: new Date().toISOString(),
          model: options.model,
        };
        setParallelAgents((prev) => [...prev, parallelAgent]);

        // Delegate to SubagentSessionManager for independent session execution
        const spawnOptions: ManagerSpawnOptions = {
          agentId,
          agentName,
          task: options.message,
          systemPrompt: options.systemPrompt,
          model: options.model,
          tools: options.tools,
        };

        const result = await manager.spawn(spawnOptions);

        return {
          success: result.success,
          output: result.output,
          error: result.error,
        };
      },
      agentType,
      modelOps,
    };

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
        setAgentTreeExpanded(false);
        setVerboseMode(false);
      }

      // Handle clearMessages flag
      if (result.clearMessages) {
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
        });

        // Also update isStreaming if specified
        if (result.stateUpdate.isStreaming !== undefined) {
          setIsStreaming(result.stateUpdate.isStreaming);
        }
      }

      // Display message if present (as assistant message, not system)
      if (result.message) {
        addMessage("assistant", result.message);
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

      return result.success;
    } catch (error) {
      // Handle execution error (as assistant message, not system)
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Error executing /${commandName}: ${errorMessage}`);
      return false;
    }
  }, [isStreaming, messages.length, workflowState, addMessage, updateWorkflowState, toggleTheme, setTheme, onSendMessage, onStreamMessage, getSession, model]);

  /**
   * Handle autocomplete selection (Tab for complete, Enter for execute).
   */
  const handleAutocompleteSelect = useCallback((
    command: CommandDefinition,
    action: "complete" | "execute"
  ) => {
    if (!textareaRef.current) return;

    const isMention = workflowState.autocompleteMode === "mention";
    const prefix = isMention ? "@" : "/";

    // Clear the textarea first
    textareaRef.current.gotoBufferHome();
    textareaRef.current.gotoBufferEnd({ select: true });
    textareaRef.current.deleteChar();

    // Hide autocomplete and set argument hint for complete action
    updateWorkflowState({
      showAutocomplete: false,
      autocompleteInput: "",
      selectedSuggestionIndex: 0,
      autocompleteMode: "command",
      argumentHint: action === "complete" && !isMention ? (command.argumentHint || "") : "",
    });

    if (action === "complete") {
      // Replace input with completed command/mention + space for arguments
      textareaRef.current.insertText(`${prefix}${command.name} `);
    } else if (action === "execute") {
      if (isMention && command.category !== "agent") {
        // File @ mention: insert into text for processing on submit
        textareaRef.current.insertText(`@${command.name} `);
      } else {
        // Slash command or agent @ mention: execute immediately
        addMessage("user", `${prefix}${command.name}`);
        void executeCommand(command.name, "");
      }
    }
  }, [updateWorkflowState, executeCommand, addMessage, workflowState.autocompleteMode]);

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
  const handleCopy = useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Check if there's a selection in the textarea
    if (textarea.hasSelection()) {
      const selectedText = textarea.getSelectedText();
      if (selectedText) {
        try {
          await copyToClipboard(selectedText);
        } catch {
          // Silently fail - clipboard may not be available
        }
      }
    }
  }, []);

  // Handle clipboard paste via Ctrl+V - inserts text from system clipboard
  // This is a fallback for terminals that don't use bracketed paste mode
  const handlePaste = useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    try {
      const text = await pasteFromClipboard();
      if (text) {
        textarea.insertText(normalizePastedText(text));
        handleInputChange(textarea.plainText ?? "");
      }
    } catch {
      // Silently fail - clipboard may not be available
    }
  }, [handleInputChange, normalizePastedText]);

  // Handle bracketed paste events from OpenTUI
  // This is the primary paste handler for modern terminals that support bracketed paste mode
  const handleBracketedPaste = useCallback((event: PasteEvent) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    event.preventDefault();
    textarea.insertText(normalizePastedText(event.text));
    handleInputChange(textarea.plainText ?? "");
  }, [handleInputChange, normalizePastedText]);

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
        // Ctrl+C handling must work everywhere (even in dialogs) for double-press exit
        if (event.ctrl && event.name === "c") {
          const textarea = textareaRef.current;
          // If textarea has selection and no dialog is active, copy instead of interrupt/exit
          if (!activeQuestion && !showModelSelector && textarea?.hasSelection()) {
            void handleCopy();
            return;
          }

          // If streaming, interrupt (abort) the current operation
          if (isStreaming) {
            const interruptedId = streamingMessageIdRef.current;
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
            if (interruptedId) {
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === interruptedId
                    ? { ...msg, wasInterrupted: true, streaming: false, parallelAgents: interruptedAgents }
                    : msg
                )
              );
            }

            // Stop streaming state immediately so UI reflects interrupted state
            isStreamingRef.current = false;
            setIsStreaming(false);
            onInterrupt?.();

            // Cancel running sub-agents (from SubagentSessionManager)
            if (subagentManagerRef.current) {
              void subagentManagerRef.current.cancelAll();
            }
          }

          // If not streaming but subagents are still running, cancel them
          if (!isStreaming && subagentManagerRef.current) {
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
                      ? { ...msg, parallelAgents: interruptedAgents }
                      : msg
                  )
                );
              }
              parallelAgentsRef.current = [];
              setParallelAgents([]);
              void subagentManagerRef.current.cancelAll();
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
          // If streaming but no workflow, just interrupt
          if (isStreaming) {
            setInterruptCount(0);
            if (interruptTimeoutRef.current) {
              clearTimeout(interruptTimeoutRef.current);
              interruptTimeoutRef.current = null;
            }
            setCtrlCPressed(false);
            return;
          }

          // Not streaming: use double-press to exit
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

        // Ctrl+O - unified verbose toggle: expand/collapse tool outputs and agent tree
        if (event.ctrl && event.name === "o") {
          if (compactionSummary && parallelAgents.length === 0) {
            // No agents but compaction summary exists: toggle compaction history
            setShowCompactionHistory(prev => !prev);
          } else {
            // Toggle verbose mode (expands tool outputs) and agent tree together
            setVerboseMode(prev => !prev);
            setAgentTreeExpanded(prev => !prev);
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
          if (isStreaming) {
            const interruptedId = streamingMessageIdRef.current;
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
            if (interruptedId) {
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === interruptedId
                    ? { ...msg, wasInterrupted: true, streaming: false, parallelAgents: interruptedAgents }
                    : msg
                )
              );
            }

            // Stop streaming state immediately so UI reflects interrupted state
            isStreamingRef.current = false;
            setIsStreaming(false);
            onInterrupt?.();

            // Cancel running sub-agents (from SubagentSessionManager)
            if (subagentManagerRef.current) {
              void subagentManagerRef.current.cancelAll();
            }
          }

          // If not streaming but subagents are still running, cancel them
          if (!isStreaming && subagentManagerRef.current) {
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
                      ? { ...msg, parallelAgents: interruptedAgents }
                      : msg
                  )
                );
              }
              parallelAgentsRef.current = [];
              setParallelAgents([]);
              void subagentManagerRef.current.cancelAll();
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
          // If streaming but no workflow, just interrupt and return
          if (isStreaming) {
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
        if (
          ((event.name === "return" || event.name === "linefeed") && (event.shift || event.meta)) ||
          (event.name === "linefeed" && !event.ctrl && !event.shift && !event.meta)
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
          if (selectedCommand && textareaRef.current) {
            // Clear textarea and insert completed command
            textareaRef.current.gotoBufferHome();
            textareaRef.current.gotoBufferEnd({ select: true });
            textareaRef.current.deleteChar();
            const prefix = workflowState.autocompleteMode === "mention" ? "@" : "/";
            textareaRef.current.insertText(`${prefix}${selectedCommand.name} `);
            updateWorkflowState({
              showAutocomplete: false,
              autocompleteInput: "",
              selectedSuggestionIndex: 0,
              autocompleteMode: "command",
              argumentHint: workflowState.autocompleteMode === "command" ? (selectedCommand.argumentHint || "") : "",
            });
          }
          return;
        }

        // Autocomplete: Enter - execute the selected command immediately (skip if shift/meta held for newline)
        if (event.name === "return" && !event.shift && !event.meta && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
          const selectedCommand = autocompleteSuggestions[workflowState.selectedSuggestionIndex];
          if (selectedCommand && textareaRef.current) {
            // Clear textarea
            textareaRef.current.gotoBufferHome();
            textareaRef.current.gotoBufferEnd({ select: true });
            textareaRef.current.deleteChar();
            // Hide autocomplete
            updateWorkflowState({
              showAutocomplete: false,
              autocompleteInput: "",
              selectedSuggestionIndex: 0,
              autocompleteMode: "command",
            });
            if (workflowState.autocompleteMode === "mention" && selectedCommand.category === "agent") {
              // Agent @ mention: execute the agent command
              addMessage("user", `@${selectedCommand.name}`);
              void executeCommand(selectedCommand.name, "");
            } else if (workflowState.autocompleteMode === "mention") {
              // File @ mention: insert @filepath into text for later processing
              textareaRef.current.insertText(`@${selectedCommand.name} `);
            } else {
              // Slash command: execute immediately
              addMessage("user", `/${selectedCommand.name}`);
              void executeCommand(selectedCommand.name, "");
            }
          }
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

        // Ctrl+Shift+V - paste from clipboard (backup for bracketed paste)
        if (event.ctrl && event.shift && event.name === "v") {
          void handlePaste();
          return;
        }

        // Ctrl+V - paste from clipboard (backup for bracketed paste)
        if (event.ctrl && event.name === "v") {
          void handlePaste();
          return;
        }

        // After processing key, check input for slash command detection
        // Use setTimeout to let the textarea update first
        setTimeout(() => {
          const value = textareaRef.current?.plainText ?? "";
          handleInputChange(value);
          syncInputScrollbar();
        }, 0);
      },
      [onExit, onInterrupt, isStreaming, interruptCount, handleCopy, handlePaste, workflowState.showAutocomplete, workflowState.selectedSuggestionIndex, workflowState.autocompleteInput, workflowState.autocompleteMode, autocompleteSuggestions, updateWorkflowState, handleInputChange, syncInputScrollbar, executeCommand, activeQuestion, showModelSelector, ctrlCPressed, messageQueue, setIsEditingQueue, parallelAgents, compactionSummary, addMessage]
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
    (content: string) => {
      // Add user message
      const userMessage = createMessage("user", content);
      setMessages((prev: ChatMessage[]) => [...prev, userMessage]);

      // Call send handler (fire and forget for sync callback signature)
      if (onSendMessage) {
        void Promise.resolve(onSendMessage(content));
      }

      // Handle streaming response if handler provided
      if (onStreamMessage) {
        // Set ref immediately (synchronous) so handleSubmit can check it
        isStreamingRef.current = true;
        setIsStreaming(true);
        // Track when streaming started for duration calculation
        streamingStartRef.current = Date.now();

        // Create placeholder assistant message
        const assistantMessage = createMessage("assistant", "", true);
        streamingMessageIdRef.current = assistantMessage.id;
        setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);

        // Handle stream chunks
        const handleChunk = (chunk: string) => {
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
          const messageId = streamingMessageIdRef.current;
          // Calculate duration from streaming start
          const durationMs = streamingStartRef.current
            ? Date.now() - streamingStartRef.current
            : undefined;

          // If the interrupt handler already finalized agents, skip overwriting
          if (wasInterruptedRef.current) {
            wasInterruptedRef.current = false;
            if (messageId) {
              setMessages((prev: ChatMessage[]) =>
                prev.map((msg: ChatMessage) =>
                  msg.id === messageId
                    ? { ...msg, streaming: false, durationMs, modelId: model }
                    : msg
                )
              );
            }
            setParallelAgents([]);
            streamingMessageIdRef.current = null;
            streamingStartRef.current = null;
            isStreamingRef.current = false;
            setIsStreaming(false);

            const nextMessage = messageQueue.dequeue();
            if (nextMessage) {
              setTimeout(() => {
                sendMessage(nextMessage.content);
              }, 50);
            }
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
                        modelId: model,
                        toolCalls: msg.toolCalls?.map((tc) =>
                          tc.status === "running" ? { ...tc, status: "interrupted" as const } : tc
                        ),
                        parallelAgents: finalizedAgents,
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
          // Clear ref immediately (synchronous) before state update
          isStreamingRef.current = false;
          setIsStreaming(false);

          // Process next queued message after 50ms delay
          const nextMessage = messageQueue.dequeue();
          if (nextMessage) {
            setTimeout(() => {
              sendMessage(nextMessage.content);
            }, 50);
          }
        };

        void Promise.resolve(onStreamMessage(content, handleChunk, handleComplete));
      }
    },
    [onSendMessage, onStreamMessage, messageQueue, model]
  );

  // Keep the sendMessageRef in sync with sendMessage callback
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Auto-submit initial prompt from CLI argument
  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (initialPrompt && !initialPromptSentRef.current) {
      initialPromptSentRef.current = true;
      const { message: processed } = processFileMentions(initialPrompt);
      sendMessage(processed);
    }
  }, [initialPrompt, sendMessage]);

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

      // Check if this is an @agent mention
      if (trimmedValue.startsWith("@")) {
        const afterAt = trimmedValue.slice(1);
        const spaceIndex = afterAt.indexOf(" ");
        const agentName = spaceIndex === -1 ? afterAt : afterAt.slice(0, spaceIndex);
        const agentArgs = spaceIndex === -1 ? "" : afterAt.slice(spaceIndex + 1).trim();

        const agentCommand = globalRegistry.get(agentName);
        if (agentCommand && agentCommand.category === "agent") {
          addMessage("user", trimmedValue);
          void executeCommand(agentName, agentArgs);
          return;
        }
      }

      // Process file @mentions (e.g., @src/file.ts) - prepend file content as context
      const { message: processedValue, filesRead } = processFileMentions(trimmedValue);

      // Display file read confirmations if files were referenced
      if (filesRead.length > 0) {
        const fileReadLines = filesRead.map(f => {
          if (f.isImage) {
            const sizeStr = f.sizeBytes >= 1024 ? `${(f.sizeBytes / 1024).toFixed(1)}KB` : `${f.sizeBytes}B`;
            return `  ⎿  Read ${f.path} (${sizeStr})`;
          }
          return `  ⎿  Read ${f.path} (${f.lineCount} lines)`;
        }).join("\n");
        addMessage("assistant", fileReadLines);
      }

      // If streaming, queue the message instead of sending immediately
      // Use ref for immediate check (state update is async and may not reflect yet)
      if (isStreamingRef.current) {
        messageQueue.enqueue(processedValue);
        return;
      }

      // Send the message
      sendMessage(processedValue);
    },
    [workflowState.showAutocomplete, workflowState.argumentHint, updateWorkflowState, addMessage, executeCommand, messageQueue, sendMessage]
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
          <text style={{ fg: MUTED_LAVENDER }}>
            ↑ {hiddenMessageCount} earlier message{hiddenMessageCount !== 1 ? "s" : ""} hidden
          </text>
        </box>
      )}
      {visibleMessages.map((msg, index) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isLast={index === visibleMessages.length - 1}
          syntaxStyle={syntaxStyle}
          verboseMode={verboseMode}
          hideAskUserQuestion={activeQuestion !== null}
          hideLoading={activeQuestion !== null}
          parallelAgents={index === visibleMessages.length - 1 ? parallelAgents : undefined}
          agentTreeExpanded={agentTreeExpanded}
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

      {/* Workflow Status Bar - shows workflow progress when active */}
      <WorkflowStatusBar
        workflowActive={workflowState.workflowActive}
        workflowType={workflowState.workflowType}
        currentNode={workflowState.currentNode}
        iteration={workflowState.iteration}
        maxIterations={workflowState.maxIterations}
        featureProgress={workflowState.featureProgress}
        queueCount={messageQueue.count}
      />

      {/* Compaction History - shows expanded compaction summary (Ctrl+O) */}
      {showCompactionHistory && compactionSummary && parallelAgents.length === 0 && (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
          <box flexDirection="column" border borderStyle="rounded" borderColor={MUTED_LAVENDER} paddingLeft={1} paddingRight={1}>
            <text style={{ fg: MUTED_LAVENDER }} attributes={1}>Compaction Summary</text>
            <text style={{ fg: "#E0E0E0" }} wrapMode="char">{compactionSummary}</text>
          </box>
          <text style={{ fg: MUTED_LAVENDER }}>
            Showing detailed transcript · ctrl+o to toggle
          </text>
        </box>
      )}

      {/* Main content area - scrollable when content overflows */}
      {/* stickyStart="bottom" keeps input visible, user can scroll up */}
      {/* ref enables PageUp/PageDown keyboard navigation */}
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
        )}

        {/* Input Area - inside scrollbox, flows after messages */}
        {/* Hidden when question dialog or model selector is active */}
        {!activeQuestion && !showModelSelector && (
          <>
            <box
              border
              borderStyle="rounded"
              borderColor={ATOMIC_PINK_DIM}
              paddingLeft={1}
              paddingRight={1}
              marginTop={messages.length > 0 ? 1 : 0}
              flexDirection="row"
              alignItems="flex-start"
            >
              <text style={{ fg: ATOMIC_PINK }}>❯{" "}</text>
              <textarea
                ref={textareaRef}
                placeholder={messages.length === 0 ? dynamicPlaceholder : ""}
                focused={inputFocused}
                keyBindings={textareaKeyBindings}
                onSubmit={handleSubmit}
                onPaste={handleBracketedPaste}
                onContentChange={handleTextareaContentChange}
                onCursorChange={handleTextareaCursorChange}
                wrapMode="char"
                flexGrow={workflowState.argumentHint ? 0 : 1}
                flexShrink={1}
                flexBasis={workflowState.argumentHint ? undefined : 0}
                minWidth={0}
                minHeight={1}
                maxHeight={8}
              />
              {workflowState.argumentHint && (
                <text style={{ fg: "#6A6A7C" }}>{workflowState.argumentHint}</text>
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
                        style={{ fg: inThumb ? INPUT_SCROLLBAR_FG : INPUT_SCROLLBAR_BG }}
                      >
                        {inThumb ? "█" : "│"}
                      </text>
                    );
                  })}
                </box>
              )}
            </box>
            {/* Streaming hint - shows "esc to interrupt" during streaming */}
            {isStreaming ? (
              <box paddingLeft={2}>
                <text style={{ fg: MUTED_LAVENDER }}>
                  esc to interrupt
                </text>
              </box>
            ) : null}
          </>
        )}

        {/* Autocomplete dropdown for slash commands and @ mentions - inside scrollbox */}
        {workflowState.showAutocomplete && (
          <box>
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
            <text style={{ fg: MUTED_LAVENDER }}>
              Press Ctrl-C again to exit
            </text>
          </box>
        )}
      </scrollbox>

    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatApp;
