/**
 * Terminal Chat UI Component
 *
 * React components for a terminal-based chat interface using OpenTUI.
 * Supports message streaming, sticky scroll, and keyboard navigation.
 *
 * Reference: Feature 15 - Implement terminal chat UI
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import type {
  KeyEvent,
  SyntaxStyle,
  TextareaRenderable,
  KeyBinding,
} from "@opentui/core";
import { copyToClipboard, pasteFromClipboard } from "../utils/clipboard.ts";
import { Autocomplete, navigateUp, navigateDown } from "./components/autocomplete.tsx";
import { WorkflowStatusBar, type FeatureProgress } from "./components/workflow-status-bar.tsx";
import { ToolResult } from "./components/tool-result.tsx";
import { TimestampDisplay } from "./components/timestamp-display.tsx";
import { FooterStatus } from "./components/footer-status.tsx";
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
    <box flexDirection="row" alignItems="flex-start" marginBottom={1} marginLeft={1}>
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
 * Renders a single chat message with role-based styling.
 * Clean, minimal design matching the reference UI:
 * - User messages: highlighted inline box with just the text
 * - Assistant messages: bullet point (●) prefix, no header
 * Includes tool results for assistant messages that contain tool calls.
 */
export function MessageBubble({ message, isLast, syntaxStyle, verboseMode = false }: MessageBubbleProps): React.ReactNode {
  // Show loading animation only before any content arrives
  const showLoadingAnimation = message.streaming && !message.content.trim();

  // Check if message has tool calls
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

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

  // Assistant message: bullet point prefix, no header/timestamp
  if (message.role === "assistant") {
    // Render content based on syntaxStyle availability
    // Loading animation shows without bullet; bullet appears only with content
    const contentElement = showLoadingAnimation ? (
      <text>
        <span style={{ fg: ATOMIC_PINK }}>  </span>
        <LoadingIndicator speed={120} />
      </text>
    ) : syntaxStyle ? (
      <box flexDirection="row" alignItems="flex-start">
        <text style={{ fg: ATOMIC_PINK }}>● </text>
        <box flexGrow={1}>
          <markdown
            content={message.content}
            syntaxStyle={syntaxStyle}
            streaming={message.streaming}
          />
        </box>
      </box>
    ) : (
      <text wrapMode="word">
        <span style={{ fg: ATOMIC_PINK }}>● </span>
        {message.content}
      </text>
    );

    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? 0 : 1}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Tool results for assistant messages */}
        {hasToolCalls && (
          <box flexDirection="column" marginBottom={1}>
            {message.toolCalls!.map((toolCall) => (
              <ToolResult
                key={toolCall.id}
                toolName={toolCall.toolName}
                input={toolCall.input}
                output={toolCall.output}
                status={toolCall.status}
                verboseMode={verboseMode}
              />
            ))}
          </box>
        )}

        {/* Message content with bullet prefix */}
        {contentElement}

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
  placeholder = "Type a message...",
  title: _title,
  syntaxStyle,
  version = "0.1.0",
  model = "Opus 4.5",
  tier = "Claude Max",
  workingDir = "~/",
  suggestion: _suggestion,
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

  // Streaming state hook for tool executions and pending questions
  const streamingState = useStreamingState();

  // Message queue for queuing messages during streaming
  const messageQueue = useMessageQueue();

  // Verbose mode state for expanded tool outputs and timestamps
  const [verboseMode, setVerboseMode] = useState(false);

  // State for showing user question dialog
  const [activeQuestion, setActiveQuestion] = useState<UserQuestion | null>(null);

  // Refs for streaming message updates
  const streamingMessageIdRef = useRef<string | null>(null);
  // Ref to track when streaming started for duration calculation
  const streamingStartRef = useRef<number | null>(null);

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
   */
  const handleToolStart = useCallback((
    toolId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => {
    // Update streaming state
    streamingState.handleToolStart(toolId, toolName, input);

    // Add tool call to current streaming message
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            const newToolCall: MessageToolCall = {
              id: toolId,
              toolName,
              input,
              status: "running",
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
   */
  const handleToolComplete = useCallback((
    toolId: string,
    output: unknown,
    success: boolean,
    error?: string
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
                  return {
                    ...tc,
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

  /**
   * Handle human_input_required signal.
   * Shows UserQuestionDialog for HITL interactions.
   */
  const handleHumanInputRequired = useCallback((question: UserQuestion) => {
    // Add to pending questions queue
    streamingState.addPendingQuestion(question);

    // Show the question dialog if not already showing one
    if (!activeQuestion) {
      setActiveQuestion(question);
    }
  }, [streamingState, activeQuestion]);

  /**
   * Handle user answering a question from UserQuestionDialog.
   */
  const handleQuestionAnswer = useCallback((answer: QuestionAnswer) => {
    // Clear active question
    setActiveQuestion(null);

    // Remove from pending questions
    streamingState.removePendingQuestion();

    // If cancelled, add assistant message
    if (answer.cancelled) {
      const msg = createMessage("assistant", "User cancelled the question.");
      setMessages((prev) => [...prev, msg]);
    } else {
      // Add assistant message with selected options
      const selectedLabels = answer.selected.join(", ");
      const msg = createMessage("assistant", `User selected: ${selectedLabels}`);
      setMessages((prev) => [...prev, msg]);

      // Update workflow state if this was spec approval
      if (answer.selected.includes("Approve")) {
        updateWorkflowState({ specApproved: true, pendingApproval: false });
      } else if (answer.selected.includes("Reject")) {
        updateWorkflowState({ specApproved: false, pendingApproval: false });
      }
    }

    // Check if there are more pending questions
    const nextQuestion = streamingState.state.pendingQuestions[0];
    if (nextQuestion) {
      setActiveQuestion(nextQuestion);
    }
  }, [streamingState, updateWorkflowState]);

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
      session: null, // Session will be passed from parent in production
      state: contextState,
      addMessage,
      setStreaming: setIsStreaming,
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
        // ESC key - hide autocomplete or exit
        if (event.name === "escape") {
          if (workflowState.showAutocomplete) {
            updateWorkflowState({
              showAutocomplete: false,
              autocompleteInput: "",
              selectedSuggestionIndex: 0,
            });
            return;
          }
          onExit?.();
          return;
        }

        // Autocomplete navigation: Up arrow - navigate up
        if (event.name === "up" && workflowState.showAutocomplete && autocompleteSuggestions.length > 0) {
          const newIndex = navigateUp(workflowState.selectedSuggestionIndex, autocompleteSuggestions.length);
          updateWorkflowState({ selectedSuggestionIndex: newIndex });
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

        // Ctrl+C - exit only if no selection (otherwise it's a copy intent)
        if (event.ctrl && event.name === "c") {
          const textarea = textareaRef.current;
          // If textarea has selection, copy instead of exit
          if (textarea?.hasSelection()) {
            void handleCopy();
          } else {
            onExit?.();
          }
          return;
        }

        // Ctrl+V - paste from clipboard (backup for bracketed paste)
        if (event.ctrl && event.name === "v") {
          void handlePaste();
          return;
        }

        // Ctrl+O - toggle verbose mode (expand/collapse all tool outputs)
        if (event.ctrl && event.name === "o") {
          setVerboseMode((prev) => !prev);
          return;
        }

        // After processing key, check input for slash command detection
        // Use setTimeout to let the textarea update first
        setTimeout(() => {
          const value = textareaRef.current?.plainText ?? "";
          handleInputChange(value);
        }, 0);
      },
      [onExit, handleCopy, handlePaste, workflowState.showAutocomplete, workflowState.selectedSuggestionIndex, workflowState.autocompleteInput, autocompleteSuggestions, updateWorkflowState, handleInputChange, executeCommand, setVerboseMode]
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
      if (isStreaming) {
        messageQueue.enqueue(trimmedValue);
        return;
      }

      // Send the message
      sendMessage(trimmedValue);
    },
    [isStreaming, workflowState.showAutocomplete, updateWorkflowState, executeCommand, messageQueue, sendMessage]
  );

  // Render message list (no empty state text)
  const messageContent = messages.length > 0 ? (
    <>
      {messages.map((msg, index) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isLast={index === messages.length - 1}
          syntaxStyle={syntaxStyle}
          verboseMode={verboseMode}
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
      />

      {/* Main content area - scrollable when content overflows */}
      {/* Messages and input flow together; scrolls when needed */}
      <scrollbox
        flexGrow={1}
        stickyScroll={true}
        viewportCulling={true}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Messages */}
        {messageContent}

        {/* Input Area - flows after messages, margin only when there are messages */}
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
          <text style={{ fg: ATOMIC_PINK }}>›{" "}</text>
          <textarea
            ref={textareaRef}
            placeholder={messages.length === 0 ? placeholder : ""}
            focused={inputFocused && !isStreaming}
            keyBindings={textareaKeyBindings}
            onSubmit={handleSubmit}
            flexGrow={1}
            height={1}
          />
        </box>

        {/* Autocomplete dropdown for slash commands - appears below input */}
        <box>
          <Autocomplete
            input={workflowState.autocompleteInput}
            visible={workflowState.showAutocomplete}
            selectedIndex={workflowState.selectedSuggestionIndex}
            onSelect={handleAutocompleteSelect}
            onIndexChange={handleAutocompleteIndexChange}
          />
        </box>
      </scrollbox>

      {/* Footer Status - shows status line at bottom */}
      <FooterStatus
        verboseMode={verboseMode}
        isStreaming={isStreaming}
        queuedCount={messageQueue.count}
        modelId={model}
      />

      {/* User Question Dialog - for HITL interactions */}
      {activeQuestion && (
        <UserQuestionDialog
          question={activeQuestion}
          onAnswer={handleQuestionAnswer}
          visible={true}
        />
      )}
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatApp;
