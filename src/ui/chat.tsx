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
import { Autocomplete } from "./components/autocomplete.tsx";
import type { CommandDefinition } from "./commands/index.ts";

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
 * Props for the LoadingIndicator component.
 */
interface LoadingIndicatorProps {
  /** Speed of animation in milliseconds per frame */
  speed?: number;
}

/**
 * Animated loading indicator with a wave effect.
 * Three dots animate left-to-right with gradient colors.
 *
 * Returns span elements (not wrapped in text) so it can be composed
 * inside other text elements. Wrap in <text> when using standalone.
 */
export function LoadingIndicator({ speed = 120 }: LoadingIndicatorProps): React.ReactNode {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % LOADING_FRAMES.length);
    }, speed);

    return () => clearInterval(interval);
  }, [speed]);

  const frame = LOADING_FRAMES[frameIndex] as string[];

  return (
    <>
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
 * Clean, minimal design with Atomic branding.
 */
export function MessageBubble({ message, isLast, syntaxStyle }: MessageBubbleProps): React.ReactNode {
  const roleLabel = message.role === "user" ? "You" : message.role === "assistant" ? "Atomic" : "System";
  const roleColor = message.role === "user" ? USER_SKY : message.role === "assistant" ? ATOMIC_PINK : "#FBBF24";
  const timestamp = formatTimestamp(message.timestamp);

  // Show loading animation only before any content arrives
  const showLoadingAnimation = message.streaming && !message.content.trim();

  // Render content based on role and syntaxStyle availability
  const contentElement = showLoadingAnimation ? (
    <text marginTop={0}>
      <LoadingIndicator speed={120} />
    </text>
  ) : message.role === "assistant" && syntaxStyle ? (
    <markdown
      content={message.content}
      syntaxStyle={syntaxStyle}
      streaming={message.streaming}
      marginTop={0}
    />
  ) : (
    <text marginTop={0} wrapMode="word">
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
      {/* Message header with role and timestamp */}
      <box flexDirection="row" gap={1}>
        <text style={{ fg: roleColor, attributes: 1 }}>
          {roleLabel}
        </text>
        <text style={{ fg: MUTED_LAVENDER, attributes: 2 }}>
          {timestamp}
        </text>
      </box>

      {/* Message content */}
      {contentElement}
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

  // Refs for streaming message updates
  const streamingMessageIdRef = useRef<string | null>(null);

  /**
   * Update workflow state with partial values.
   * Convenience function for updating specific fields.
   */
  const updateWorkflowState = useCallback((updates: Partial<WorkflowChatState>) => {
    setWorkflowState((prev) => ({ ...prev, ...updates }));
  }, []);

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
   * Handle autocomplete selection (Tab for complete, Enter for execute).
   */
  const handleAutocompleteSelect = useCallback((
    command: CommandDefinition,
    action: "complete" | "execute"
  ) => {
    if (!textareaRef.current) return;

    if (action === "complete") {
      // Replace input with completed command + space for arguments
      textareaRef.current.gotoBufferHome();
      textareaRef.current.gotoBufferEnd({ select: true });
      textareaRef.current.deleteChar();
      textareaRef.current.insertText(`/${command.name} `);

      // Hide autocomplete after completion
      updateWorkflowState({
        showAutocomplete: false,
        autocompleteInput: "",
        selectedSuggestionIndex: 0,
      });
    } else if (action === "execute") {
      // For execute, we'll handle this in a later feature
      // For now, just complete the command
      textareaRef.current.gotoBufferHome();
      textareaRef.current.gotoBufferEnd({ select: true });
      textareaRef.current.deleteChar();
      textareaRef.current.insertText(`/${command.name}`);

      updateWorkflowState({
        showAutocomplete: false,
        autocompleteInput: "",
        selectedSuggestionIndex: 0,
      });
    }
  }, [updateWorkflowState]);

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

  // Handle keyboard events for exit, clipboard, and autocomplete detection
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

        // After processing key, check input for slash command detection
        // Use setTimeout to let the textarea update first
        setTimeout(() => {
          const value = textareaRef.current?.plainText ?? "";
          handleInputChange(value);
        }, 0);
      },
      [onExit, handleCopy, handlePaste, workflowState.showAutocomplete, updateWorkflowState, handleInputChange]
    )
  );

  /**
   * Handle message submission from textarea.
   * Gets value from textarea ref since onSubmit receives SubmitEvent, not value.
   */
  const handleSubmit = useCallback(
    () => {
      // Get value from textarea ref
      const value = textareaRef.current?.plainText ?? "";
      const trimmedValue = value.trim();
      if (!trimmedValue || isStreaming) {
        return;
      }

      // Clear textarea by selecting all and deleting
      if (textareaRef.current) {
        textareaRef.current.gotoBufferHome();
        textareaRef.current.gotoBufferEnd({ select: true });
        textareaRef.current.deleteChar();
      }

      // Add user message
      const userMessage = createMessage("user", trimmedValue);
      setMessages((prev: ChatMessage[]) => [...prev, userMessage]);

      // Call send handler (fire and forget for sync callback signature)
      if (onSendMessage) {
        void Promise.resolve(onSendMessage(trimmedValue));
      }

      // Handle streaming response if handler provided
      if (onStreamMessage) {
        setIsStreaming(true);

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

        // Handle stream completion
        const handleComplete = () => {
          const messageId = streamingMessageIdRef.current;
          if (messageId) {
            setMessages((prev: ChatMessage[]) =>
              prev.map((msg: ChatMessage) =>
                msg.id === messageId ? { ...msg, streaming: false } : msg
              )
            );
          }
          streamingMessageIdRef.current = null;
          setIsStreaming(false);
        };

        void Promise.resolve(onStreamMessage(trimmedValue, handleChunk, handleComplete));
      }
    },
    [isStreaming, onSendMessage, onStreamMessage]
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
        />
      ))}
    </>
  ) : null;

  // Status text
  const statusText = isStreaming
    ? "Assistant is typing..."
    : `${messages.length} message${messages.length === 1 ? "" : "s"}`;

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

      {/* Input Area - bordered box with prompt on same line */}
      <box
        border
        borderStyle="rounded"
        borderColor={ATOMIC_PINK_DIM}
        paddingLeft={1}
        paddingRight={1}
        marginLeft={1}
        marginRight={1}
        flexShrink={0}
        flexDirection="row"
        alignItems="center"
      >
        <text style={{ fg: ATOMIC_PINK }}>›{" "}</text>
        <textarea
          ref={textareaRef}
          placeholder={isStreaming ? "Waiting for response..." : placeholder}
          focused={inputFocused && !isStreaming}
          keyBindings={textareaKeyBindings}
          onSubmit={handleSubmit}
          flexGrow={1}
        />
      </box>

      {/* Autocomplete dropdown for slash commands */}
      <box marginLeft={1} marginRight={1}>
        <Autocomplete
          input={workflowState.autocompleteInput}
          visible={workflowState.showAutocomplete}
          selectedIndex={workflowState.selectedSuggestionIndex}
          onSelect={handleAutocompleteSelect}
          onIndexChange={handleAutocompleteIndexChange}
        />
      </box>

      {/* Message History - clean display below input */}
      <scrollbox
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        viewportCulling={true}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        marginTop={1}
      >
        {messageContent}
      </scrollbox>

      {/* Status Bar - minimal */}
      <box paddingLeft={2} paddingRight={1} paddingBottom={1} flexDirection="row" gap={1}>
        {isStreaming ? (
          <text style={{ fg: DIM_BLUE, attributes: 2 }}>
            <LoadingIndicator speed={100} />
            <span> thinking</span>
          </text>
        ) : (
          <text style={{ fg: DIM_BLUE, attributes: 2 }}>{statusText}</text>
        )}
      </box>
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatApp;
