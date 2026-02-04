/**
 * Terminal Chat UI Component
 *
 * React components for a terminal-based chat interface using OpenTUI.
 * Supports message streaming, sticky scroll, and keyboard navigation.
 *
 * Reference: Feature 15 - Implement terminal chat UI
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type {
  KeyEvent,
  SyntaxStyle,
  TextareaRenderable,
  KeyBinding,
} from "@opentui/core";
import { MacOSScrollAccel } from "@opentui/core";
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
  UserQuestionDialog,
  type UserQuestion,
  type QuestionAnswer,
} from "./components/user-question-dialog.tsx";
import {
  useStreamingState,
  type ToolExecutionStatus,
  type ToolExecutionState,
} from "./hooks/use-streaming-state.ts";
import { useMessageQueue } from "./hooks/use-message-queue.ts";
import {
  globalRegistry,
  parseSlashCommand,
  type CommandDefinition,
  type CommandContext,
  type CommandContextState,
} from "./commands/index.ts";
import type { AskUserQuestionEventData } from "../graph/index.ts";
import type { AgentType, ModelOperations } from "../models";

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
];

/**
 * Animation frames for the wave dot loading indicator.
 * Creates a smooth left-to-right wave effect using varying dot sizes.
 */
const LOADING_FRAMES = [
  ["●", "∙", "∙"],
  ["●", "•", "∙"],
  ["•", "●", "∙"],
  ["∙", "●", "•"],
  ["∙", "•", "●"],
  ["∙", "∙", "●"],
  ["∙", "•", "●"],
  ["∙", "●", "•"],
  ["•", "●", "∙"],
  ["●", "•", "∙"],
];

/**
 * Gradient colors for the loading dots - uses ATOMIC branding
 */
const LOADING_DOT_COLORS = [
  "#E8B4B8", // Dusty pink
  "#D49CA0", // Soft rose
  "#8AA0B4", // Pale steel blue
];

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
 * Animated loading indicator with a wave effect and random verb text.
 * Three dots animate left-to-right with gradient colors.
 * A random verb is selected on mount and displayed as "Verb..." with the animation.
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
      setFrameIndex((prev) => (prev + 1) % LOADING_FRAMES.length);
    }, speed);

    return () => clearInterval(interval);
  }, [speed]);

  const frame = LOADING_FRAMES[frameIndex] as string[];

  return (
    <>
      <span style={{ fg: "#9A9AAC" }}>{verb}... </span>
      {frame.map((dot, i) => (
        <span key={i} style={{ fg: LOADING_DOT_COLORS[i] }}>
          {dot}
        </span>
      ))}
    </>
  );
}

// ============================================================================
// DESIGN TOKENS - ATOMIC BRANDING (Muted Pink & Pale Blue Theme)
// ============================================================================

/** Primary pink - soft dusty rose brand color */
const ATOMIC_PINK = "#D4A5A5";
/** Secondary pink - muted rose for borders */
const ATOMIC_PINK_DIM = "#B8878A";
/** User message color - pale sky blue for contrast */
const USER_SKY = "#A8C5D8";
/** Muted color for timestamps and secondary text */
const MUTED_LAVENDER = "#9A9AAC";
/** Dim text for subtle elements */
const DIM_BLUE = "#8899AA";

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
  model = "Opus 4.5",
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
    tc.toolName !== "AskUserQuestion" && tc.toolName !== "question"
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
export function MessageBubble({ message, isLast, syntaxStyle, verboseMode = false, hideAskUserQuestion = false, hideLoading = false }: MessageBubbleProps): React.ReactNode {
  // Show loading animation only before any content arrives, and not when question dialog is active
  const showLoadingAnimation = message.streaming && !message.content.trim() && !hideLoading;

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
        <text>
          <span style={{ bg: "#3A3A4A", fg: "#E0E0E0" }}> {message.content} </span>
        </text>
      </box>
    );
  }

  // Assistant message: bullet point prefix, with tool calls interleaved at correct positions
  if (message.role === "assistant") {
    // Build interleaved content segments
    const segments = buildContentSegments(message.content, message.toolCalls || []);
    const hasContent = segments.length > 0;

    // Check if first segment is text (for bullet point prefix)
    const firstTextSegment = segments.find(s => s.type === "text");
    const hasLeadingText = segments.length > 0 && segments[0].type === "text";

    // Loading animation when no content yet
    if (showLoadingAnimation) {
      return (
        <box
          flexDirection="column"
          marginBottom={isLast ? 0 : 1}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="row" alignItems="flex-start">
            <text style={{ fg: ATOMIC_PINK }}>● </text>
            <text>
              <LoadingIndicator speed={120} />
            </text>
          </box>
        </box>
      );
    }

    // Render interleaved segments
    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? 0 : 1}
        paddingLeft={1}
        paddingRight={1}
      >
        {!hideEntireMessage && segments.map((segment, index) => {
          if (segment.type === "text" && segment.content) {
            // Text segment - add bullet prefix to first text segment
            const isFirst = segment === firstTextSegment;
            return syntaxStyle ? (
              <box key={segment.key} flexDirection="row" alignItems="flex-start" marginBottom={index < segments.length - 1 ? 1 : 0}>
                {isFirst && <text style={{ fg: ATOMIC_PINK }}>● </text>}
                {!isFirst && <text>  </text>}
                <box flexGrow={1}>
                  <markdown
                    content={segment.content}
                    syntaxStyle={syntaxStyle}
                    streaming={message.streaming && index === segments.length - 1}
                  />
                </box>
              </box>
            ) : (
              <text key={segment.key} wrapMode="word">
                {isFirst && <span style={{ fg: ATOMIC_PINK }}>● </span>}
                {!isFirst && "  "}
                {segment.content}
              </text>
            );
          } else if (segment.type === "tool" && segment.toolCall) {
            // Tool call segment
            return (
              <box key={segment.key} marginTop={index > 0 ? 1 : 0} marginBottom={index < segments.length - 1 ? 1 : 0}>
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

  // System message: keep with header for visibility (yellow)
  return (
    <box
      flexDirection="column"
      marginBottom={isLast ? 0 : 1}
      paddingLeft={1}
      paddingRight={1}
    >
      <text style={{ fg: "#FBBF24", attributes: 1 }}>System</text>
      <text wrapMode="word">{message.content}</text>
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
  onInterrupt,
  placeholder = "Type a message...",
  title: _title,
  syntaxStyle,
  version = "0.1.0",
  model = "Opus 4.5",
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

  // Streaming state hook for tool executions and pending questions
  const streamingState = useStreamingState();

  // Message queue for queuing messages during streaming
  const messageQueue = useMessageQueue();

  // Verbose mode state for expanded tool outputs and timestamps
  const [verboseMode, setVerboseMode] = useState(false);

  // State for showing user question dialog
  const [activeQuestion, setActiveQuestion] = useState<UserQuestion | null>(null);

  // State for queue editing mode
  const [isEditingQueue, setIsEditingQueue] = useState(false);

  // State for parallel agents display
  const [parallelAgents, setParallelAgents] = useState<ParallelAgent[]>(initialParallelAgents);

  // Refs for streaming message updates
  const streamingMessageIdRef = useRef<string | null>(null);
  // Ref to track when streaming started for duration calculation
  const streamingStartRef = useRef<number | null>(null);
  // Ref to track streaming state synchronously (for immediate check in handleSubmit)
  // This avoids race conditions where React state hasn't updated yet
  const isStreamingRef = useRef(false);
  // Ref for scrollbox to enable programmatic scrolling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrollboxRef = useRef<any>(null);

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
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
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
                timestamp: new Date(),
                streaming: true,
                toolCalls: [],
              };
              streamingMessageIdRef.current = newMessage.id;
              return [...prev, newMessage];
            });
          },
          // onComplete: mark message as complete
          () => {
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
                return [
                  ...prev.slice(0, -1),
                  {
                    ...lastMsg,
                    streaming: false,
                    completedAt: new Date(),
                  },
                ];
              }
              return prev;
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
  }, [handleHumanInputRequired]);

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
  }, [handleHumanInputRequired]);

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

  // Register parallel agent handler with parent component
  useEffect(() => {
    if (registerParallelAgentHandler) {
      registerParallelAgentHandler(setParallelAgents);
    }
  }, [registerParallelAgentHandler]);

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
  const updateWorkflowProgress = useCallback((updates: {
    currentNode?: string | null;
    iteration?: number;
    featureProgress?: FeatureProgress | null;
  }) => {
    updateWorkflowState(updates);
  }, [updateWorkflowState]);

  // Ref for textarea to access value and clear it
  const textareaRef = useRef<TextareaRenderable>(null);

  // Ref for sendMessage to allow executeCommand to call it without circular dependencies
  const sendMessageRef = useRef<((content: string) => void) | null>(null);

  /**
   * Handle input changes to detect slash command prefix.
   * Shows autocomplete when input starts with "/" and has no space.
   */
  const handleInputChange = useCallback((value: string) => {
    // Check if input starts with "/" (slash command)
    if (value.startsWith("/")) {
      // Extract the command prefix (text after "/" without spaces)
      const afterSlash = value.slice(1);

      // Only show autocomplete if there's no space (still typing command name)
      if (!afterSlash.includes(" ")) {
        updateWorkflowState({
          showAutocomplete: true,
          autocompleteInput: afterSlash,
          selectedSuggestionIndex: 0, // Reset selection on input change
        });
      } else {
        // Hide autocomplete when there's a space (user is typing arguments)
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
        });
      }
    } else {
      // Hide autocomplete for non-slash commands
      if (workflowState.showAutocomplete) {
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          selectedSuggestionIndex: 0,
        });
      }
    }
  }, [workflowState.showAutocomplete, updateWorkflowState]);

  /**
   * Helper to add a message to the chat.
   * Used by command execution context.
   */
  const addMessage = useCallback((role: "user" | "assistant" | "system", content: string) => {
    const msg = createMessage(role, content);
    setMessages((prev) => [...prev, msg]);
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
      spawnSubagent: async (options) => {
        // Implementation for spawning a sub-agent
        // This is a placeholder that sends the task through the normal message flow
        // In the future, this should spawn a dedicated sub-agent session
        const session = getSession?.();
        if (!session) {
          return {
            success: false,
            output: "",
            error: "No active session to spawn sub-agent",
          };
        }

        try {
          // Build the combined prompt with system prompt context
          const taskMessage = `[Sub-agent task]\n\nSystem Context: ${options.systemPrompt}\n\nTask: ${options.message}`;

          // Send through normal message flow
          if (sendMessageRef.current) {
            sendMessageRef.current(taskMessage);
          }

          return {
            success: true,
            output: "Sub-agent task sent through message flow",
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: error instanceof Error ? error.message : "Unknown error spawning sub-agent",
          };
        }
      },
      agentType,
      modelOps,
    };

    try {
      // Execute the command (may be sync or async)
      const result = await Promise.resolve(command.execute(args, context));

      // Handle clearMessages flag
      if (result.clearMessages) {
        setMessages([]);
      }

      // Apply state updates if present
      if (result.stateUpdate) {
        updateWorkflowState({
          workflowActive: result.stateUpdate.workflowActive ?? workflowState.workflowActive,
          workflowType: result.stateUpdate.workflowType ?? workflowState.workflowType,
          initialPrompt: result.stateUpdate.initialPrompt ?? workflowState.initialPrompt,
          currentNode: result.stateUpdate.currentNode ?? workflowState.currentNode,
          iteration: result.stateUpdate.iteration ?? workflowState.iteration,
          maxIterations: result.stateUpdate.maxIterations ?? workflowState.maxIterations,
          featureProgress: result.stateUpdate.featureProgress ?? workflowState.featureProgress,
          pendingApproval: result.stateUpdate.pendingApproval ?? workflowState.pendingApproval,
          specApproved: result.stateUpdate.specApproved ?? workflowState.specApproved,
          feedback: result.stateUpdate.feedback ?? workflowState.feedback,
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

      return result.success;
    } catch (error) {
      // Handle execution error (as assistant message, not system)
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Error executing /${commandName}: ${errorMessage}`);
      return false;
    }
  }, [isStreaming, messages.length, workflowState, addMessage, updateWorkflowState]);

  /**
   * Handle autocomplete selection (Tab for complete, Enter for execute).
   */
  const handleAutocompleteSelect = useCallback((
    command: CommandDefinition,
    action: "complete" | "execute"
  ) => {
    if (!textareaRef.current) return;

    // Clear the textarea first
    textareaRef.current.gotoBufferHome();
    textareaRef.current.gotoBufferEnd({ select: true });
    textareaRef.current.deleteChar();

    // Hide autocomplete
    updateWorkflowState({
      showAutocomplete: false,
      autocompleteInput: "",
      selectedSuggestionIndex: 0,
    });

    if (action === "complete") {
      // Replace input with completed command + space for arguments
      textareaRef.current.insertText(`/${command.name} `);
    } else if (action === "execute") {
      // Execute the command immediately with no arguments
      void executeCommand(command.name, "");
    }
  }, [updateWorkflowState, executeCommand]);

  /**
   * Handle autocomplete index changes (up/down navigation).
   */
  const handleAutocompleteIndexChange = useCallback((index: number) => {
    updateWorkflowState({ selectedSuggestionIndex: index });
  }, [updateWorkflowState]);

  // Key bindings for textarea: Enter submits, Shift+Enter adds newline
  const textareaKeyBindings: KeyBinding[] = [
    { name: "return", action: "submit" },
    { name: "return", shift: true, action: "newline" },
  ];

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

  // Handle clipboard paste - inserts text from system clipboard
  const handlePaste = useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    try {
      const text = await pasteFromClipboard();
      if (text) {
        textarea.insertText(text);
      }
    } catch {
      // Silently fail - clipboard may not be available
    }
  }, []);

  // Get current autocomplete suggestions count for navigation
  const autocompleteSuggestions = workflowState.showAutocomplete
    ? globalRegistry.search(workflowState.autocompleteInput)
    : [];

  // Handle keyboard events for exit, clipboard, and autocomplete navigation
  useKeyboard(
    useCallback(
      (event: KeyEvent) => {
        // Skip ALL keyboard handling when question dialog is active
        // The dialog component handles its own keyboard events via its own useKeyboard hook
        if (activeQuestion) {
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
            onInterrupt?.();
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

        // Autocomplete: Tab - complete the selected command
        if (event.name === "tab" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
          const selectedCommand = autocompleteSuggestions[workflowState.selectedSuggestionIndex];
          if (selectedCommand && textareaRef.current) {
            // Clear textarea and insert completed command
            textareaRef.current.gotoBufferHome();
            textareaRef.current.gotoBufferEnd({ select: true });
            textareaRef.current.deleteChar();
            textareaRef.current.insertText(`/${selectedCommand.name} `);
            updateWorkflowState({
              showAutocomplete: false,
              autocompleteInput: "",
              selectedSuggestionIndex: 0,
            });
          }
          return;
        }

        // Autocomplete: Enter - execute the selected command immediately
        if (event.name === "return" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
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
            });
            // Execute the command
            void executeCommand(selectedCommand.name, "");
          }
          return;
        }

        // Queue editing: Enter - exit edit mode and allow submission
        if (event.name === "return" && isEditingQueue) {
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

        // Ctrl+C - interrupt streaming, or double-press to exit when idle
        // Handled as keyboard event since exitOnCtrlC is disabled in renderer
        if (event.ctrl && event.name === "c") {
          const textarea = textareaRef.current;
          // If textarea has selection, copy instead of interrupt/exit
          if (textarea?.hasSelection()) {
            void handleCopy();
            return;
          }

          // If streaming, interrupt (abort) the current operation
          if (isStreaming) {
            onInterrupt?.();
            // Reset interrupt counter after interrupting
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
        }, 0);
      },
      [onExit, onInterrupt, isStreaming, interruptCount, handleCopy, handlePaste, workflowState.showAutocomplete, workflowState.selectedSuggestionIndex, workflowState.autocompleteInput, autocompleteSuggestions, updateWorkflowState, handleInputChange, executeCommand, activeQuestion, ctrlCPressed, messageQueue, setIsEditingQueue]
    )
  );

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

          if (messageId) {
            setMessages((prev: ChatMessage[]) =>
              prev.map((msg: ChatMessage) =>
                msg.id === messageId
                  ? { ...msg, streaming: false, durationMs, modelId: model }
                  : msg
              )
            );
          }
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

      // Clear textarea by selecting all and deleting
      if (textareaRef.current) {
        textareaRef.current.gotoBufferHome();
        textareaRef.current.gotoBufferEnd({ select: true });
        textareaRef.current.deleteChar();
      }

      // Hide autocomplete if visible
      if (workflowState.showAutocomplete) {
        updateWorkflowState({
          showAutocomplete: false,
          autocompleteInput: "",
          selectedSuggestionIndex: 0,
        });
      }

      // Check if this is a slash command
      const parsed = parseSlashCommand(trimmedValue);
      if (parsed.isCommand) {
        // Execute the slash command (allowed even during streaming)
        void executeCommand(parsed.name, parsed.args);
        return;
      }

      // If streaming, queue the message instead of sending immediately
      // Use ref for immediate check (state update is async and may not reflect yet)
      if (isStreamingRef.current) {
        messageQueue.enqueue(trimmedValue);
        return;
      }

      // Send the message
      sendMessage(trimmedValue);
    },
    [workflowState.showAutocomplete, updateWorkflowState, executeCommand, messageQueue, sendMessage]
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
        />
      ))}
    </>
  ) : null;

  return (
    <box
      flexDirection="column"
      height="100%"
      width="100%"
    >
      {/* Header */}
      <AtomicHeader
        version={version}
        model={model}
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

      {/* Parallel Agents Tree - shows running sub-agents */}
      {parallelAgents.length > 0 && (
        <ParallelAgentsTree
          agents={parallelAgents}
          compact={true}
          maxVisible={5}
        />
      )}

      {/* Main content area - scrollable when content overflows */}
      {/* stickyStart="bottom" keeps input visible, user can scroll up */}
      {/* ref enables PageUp/PageDown keyboard navigation */}
      <scrollbox
        ref={scrollboxRef}
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        viewportCulling={false}
        paddingLeft={1}
        paddingRight={1}
        scrollbarOptions={{ visible: false }}
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
        {/* Hidden when question dialog is active (Claude Code behavior) */}
        {!activeQuestion && (
          <>
            <box
              border
              borderStyle="rounded"
              borderColor={ATOMIC_PINK_DIM}
              paddingLeft={1}
              paddingRight={1}
              marginTop={messages.length > 0 ? 1 : 0}
              flexDirection="row"
              alignItems="center"
            >
              <text style={{ fg: ATOMIC_PINK }}>❯{" "}</text>
              <textarea
                ref={textareaRef}
                placeholder={messages.length === 0 ? dynamicPlaceholder : ""}
                focused={inputFocused}
                keyBindings={textareaKeyBindings}
                onSubmit={handleSubmit}
                flexGrow={1}
                height={1}
              />
            </box>
            {/* Streaming hint - shows "esc to interrupt" during streaming */}
            {isStreaming && (
              <box marginLeft={2}>
                <text style={{ fg: MUTED_LAVENDER }}>
                  esc to interrupt
                </text>
              </box>
            )}
          </>
        )}

        {/* Autocomplete dropdown for slash commands - inside scrollbox */}
        {workflowState.showAutocomplete && (
          <box>
            <Autocomplete
              input={workflowState.autocompleteInput}
              visible={workflowState.showAutocomplete}
              selectedIndex={workflowState.selectedSuggestionIndex}
              onSelect={handleAutocompleteSelect}
              onIndexChange={handleAutocompleteIndexChange}
            />
          </box>
        )}

        {/* Ctrl+C warning message */}
        {ctrlCPressed && (
          <box marginTop={1}>
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
