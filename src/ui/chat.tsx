/**
 * Terminal Chat UI Component
 *
 * React components for a terminal-based chat interface using OpenTUI.
 * Supports message streaming, sticky scroll, and keyboard navigation.
 *
 * Reference: Feature 15 - Implement terminal chat UI
 */

import React, { useState, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyEvent, SyntaxStyle } from "@opentui/core";

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
  /** Title for the chat window */
  title?: string;
  /** Optional syntax style for markdown rendering */
  syntaxStyle?: SyntaxStyle;
}

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
// MESSAGE BUBBLE COMPONENT
// ============================================================================

/**
 * Renders a single chat message with role-based styling.
 */
export function MessageBubble({ message, isLast, syntaxStyle }: MessageBubbleProps): React.ReactNode {
  const roleLabel = message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System";
  const roleColor = message.role === "user" ? "cyan" : message.role === "assistant" ? "green" : "yellow";
  const timestamp = formatTimestamp(message.timestamp);

  // Show typing indicator if streaming and content is empty
  const displayContent = message.streaming && !message.content.trim()
    ? "..."
    : message.content;

  // Render streaming indicator conditionally
  const streamingIndicator = message.streaming ? (
    <text fg="magenta" attributes={4}>
      (streaming)
    </text>
  ) : null;

  // Render content based on role and syntaxStyle availability
  const contentElement = message.role === "assistant" && syntaxStyle ? (
    <markdown
      content={displayContent}
      syntaxStyle={syntaxStyle}
      streaming={message.streaming}
      marginTop={0}
    />
  ) : (
    <text marginTop={0} wrapMode="word">
      {displayContent}
    </text>
  );

  return (
    <>
      <box
        flexDirection="column"
        marginBottom={isLast ? 0 : 1}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Message header with role and timestamp */}
        <box flexDirection="row" gap={1}>
          <text fg={roleColor} attributes={1}>
            {roleLabel}
          </text>
          <text fg="gray" attributes={2}>
            {timestamp}
          </text>
          {streamingIndicator}
        </box>

        {/* Message content */}
        {contentElement}
      </box>
    </>
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
  title = "Atomic Chat",
  syntaxStyle,
}: ChatAppProps): React.ReactNode {
  // State
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputFocused] = useState(true);

  // Refs for streaming message updates
  const streamingMessageIdRef = useRef<string | null>(null);

  // Handle keyboard events for exit
  useKeyboard(
    useCallback(
      (event: KeyEvent) => {
        // ESC key
        if (event.name === "escape") {
          onExit?.();
          return;
        }

        // Ctrl+C
        if (event.ctrl && event.name === "c") {
          onExit?.();
          return;
        }
      },
      [onExit]
    )
  );

  /**
   * Handle message submission.
   */
  const handleSubmit = useCallback(
    (value: string) => {
      const trimmedValue = value.trim();
      if (!trimmedValue || isStreaming) {
        return;
      }

      // Clear input
      setInputValue("");

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

  // Render empty state or message list
  const messageContent = messages.length === 0 ? (
    <text fg="gray" attributes={4}>
      No messages yet. Start a conversation!
    </text>
  ) : (
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
  );

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
      <box
        borderStyle="single"
        borderColor="blue"
        paddingLeft={1}
        paddingRight={1}
        marginBottom={1}
      >
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text attributes={1} fg="blue">
            {title}
          </text>
          <text fg="gray" attributes={2}>
            ESC or Ctrl+C to exit
          </text>
        </box>
      </box>

      {/* Message History */}
      <scrollbox
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        viewportCulling={true}
        borderStyle="single"
        borderColor="gray"
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        {messageContent}
      </scrollbox>

      {/* Input Area */}
      <box
        borderStyle="single"
        borderColor={isStreaming ? "yellow" : "green"}
        marginTop={1}
        paddingLeft={1}
        paddingRight={1}
      >
<input
          placeholder={isStreaming ? "Waiting for response..." : placeholder}
          value={inputValue}
          focused={inputFocused && !isStreaming}
          onInput={setInputValue}
          // @ts-ignore OpenTUI InputProps has conflicting onSubmit types from TextareaOptions
          onSubmit={handleSubmit}
          width="100%"
        />
      </box>

      {/* Status Bar */}
      <box paddingLeft={1} paddingRight={1} marginTop={0}>
        <text fg="gray" attributes={2}>
          {statusText}
        </text>
      </box>
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatApp;
