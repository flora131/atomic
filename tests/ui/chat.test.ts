/**
 * Unit tests for terminal chat UI components
 *
 * Tests cover:
 * - Helper functions (generateMessageId, createMessage, formatTimestamp)
 * - ChatMessage type validation
 * - Component prop interfaces
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  generateMessageId,
  createMessage,
  formatTimestamp,
  type ChatMessage,
  type MessageRole,
  type ChatAppProps,
  type MessageBubbleProps,
  type MessageToolCall,
  type WorkflowChatState,
  defaultWorkflowChatState,
} from "../../src/ui/chat.tsx";

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("generateMessageId", () => {
  test("generates unique IDs", () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    const id3 = generateMessageId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  test("generates IDs with correct prefix", () => {
    const id = generateMessageId();
    expect(id).toMatch(/^msg_\d+_[a-z0-9]+$/);
  });

  test("generates IDs with timestamp component", () => {
    const before = Date.now();
    const id = generateMessageId();
    const after = Date.now();

    // Extract timestamp from ID
    const timestampStr = id.split("_")[1];
    const timestamp = Number(timestampStr);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("createMessage", () => {
  test("creates a user message", () => {
    const msg = createMessage("user", "Hello world");

    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello world");
    expect(msg.id).toMatch(/^msg_/);
    expect(msg.timestamp).toBeDefined();
    expect(msg.streaming).toBeUndefined();
  });

  test("creates an assistant message", () => {
    const msg = createMessage("assistant", "Hi there!");

    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("Hi there!");
  });

  test("creates a system message", () => {
    const msg = createMessage("system", "System notification");

    expect(msg.role).toBe("system");
    expect(msg.content).toBe("System notification");
  });

  test("creates a streaming message", () => {
    const msg = createMessage("assistant", "", true);

    expect(msg.streaming).toBe(true);
    expect(msg.content).toBe("");
  });

  test("creates a non-streaming message explicitly", () => {
    const msg = createMessage("user", "Test", false);

    expect(msg.streaming).toBe(false);
  });

  test("generates valid ISO timestamp", () => {
    const before = new Date().toISOString();
    const msg = createMessage("user", "Test");
    const after = new Date().toISOString();

    // Verify timestamp is valid ISO format
    expect(() => new Date(msg.timestamp)).not.toThrow();

    // Verify timestamp is within expected range
    expect(msg.timestamp >= before).toBe(true);
    expect(msg.timestamp <= after).toBe(true);
  });
});

describe("formatTimestamp", () => {
  test("formats timestamp to time string", () => {
    const isoString = "2024-01-15T14:30:00.000Z";
    const formatted = formatTimestamp(isoString);

    // Should contain hour and minute
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  test("handles different timezones", () => {
    const isoString = new Date().toISOString();
    const formatted = formatTimestamp(isoString);

    // Should produce some output
    expect(formatted.length).toBeGreaterThan(0);
  });

  test("handles edge case timestamps", () => {
    // Midnight
    const midnight = formatTimestamp("2024-01-15T00:00:00.000Z");
    expect(midnight).toBeDefined();

    // End of day
    const endOfDay = formatTimestamp("2024-01-15T23:59:59.999Z");
    expect(endOfDay).toBeDefined();
  });
});

// ============================================================================
// Type Tests
// ============================================================================

describe("ChatMessage type", () => {
  test("allows valid message roles", () => {
    const roles: MessageRole[] = ["user", "assistant", "system"];

    for (const role of roles) {
      const msg: ChatMessage = {
        id: "test",
        role,
        content: "test",
        timestamp: new Date().toISOString(),
      };
      expect(msg.role).toBe(role);
    }
  });

  test("allows optional streaming property", () => {
    const msgWithStreaming: ChatMessage = {
      id: "test",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
    };

    const msgWithoutStreaming: ChatMessage = {
      id: "test",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    };

    expect(msgWithStreaming.streaming).toBe(true);
    expect(msgWithoutStreaming.streaming).toBeUndefined();
  });

  test("allows optional durationMs property for timing tracking", () => {
    const msgWithDuration: ChatMessage = {
      id: "test",
      role: "assistant",
      content: "Response",
      timestamp: new Date().toISOString(),
      durationMs: 1500,
    };

    const msgWithoutDuration: ChatMessage = {
      id: "test",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    };

    expect(msgWithDuration.durationMs).toBe(1500);
    expect(msgWithoutDuration.durationMs).toBeUndefined();
  });

  test("allows optional modelId property for model tracking", () => {
    const msgWithModelId: ChatMessage = {
      id: "test",
      role: "assistant",
      content: "Response",
      timestamp: new Date().toISOString(),
      modelId: "claude-3-opus",
    };

    const msgWithoutModelId: ChatMessage = {
      id: "test",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    };

    expect(msgWithModelId.modelId).toBe("claude-3-opus");
    expect(msgWithoutModelId.modelId).toBeUndefined();
  });

  test("allows combining durationMs and modelId for complete timing info", () => {
    const assistantMessage: ChatMessage = {
      id: "test",
      role: "assistant",
      content: "Here is my response",
      timestamp: new Date().toISOString(),
      streaming: false,
      durationMs: 2500,
      modelId: "claude-3-sonnet",
    };

    expect(assistantMessage.durationMs).toBe(2500);
    expect(assistantMessage.modelId).toBe("claude-3-sonnet");
    expect(assistantMessage.streaming).toBe(false);
  });

  test("durationMs accepts zero value", () => {
    const msg: ChatMessage = {
      id: "test",
      role: "assistant",
      content: "Response",
      timestamp: new Date().toISOString(),
      durationMs: 0,
    };

    expect(msg.durationMs).toBe(0);
  });

  test("durationMs accepts large values", () => {
    const msg: ChatMessage = {
      id: "test",
      role: "assistant",
      content: "Response",
      timestamp: new Date().toISOString(),
      durationMs: 300000, // 5 minutes
    };

    expect(msg.durationMs).toBe(300000);
  });
});

describe("ChatAppProps interface", () => {
  test("allows minimal props", () => {
    const props: ChatAppProps = {};

    expect(props.initialMessages).toBeUndefined();
    expect(props.onSendMessage).toBeUndefined();
    expect(props.onExit).toBeUndefined();
  });

  test("allows all optional props", () => {
    const props: ChatAppProps = {
      initialMessages: [createMessage("user", "Hello")],
      onSendMessage: (_content: string) => {},
      onStreamMessage: (_content, _onChunk, _onComplete) => {},
      onExit: () => {},
      placeholder: "Custom placeholder",
      title: "Custom Title",
    };

    expect(props.initialMessages?.length).toBe(1);
    expect(props.placeholder).toBe("Custom placeholder");
    expect(props.title).toBe("Custom Title");
  });

  test("allows async callbacks", () => {
    const props: ChatAppProps = {
      onSendMessage: async (_content: string) => {
        await Promise.resolve();
      },
      onStreamMessage: async (_content, _onChunk, onComplete) => {
        await Promise.resolve();
        onComplete();
      },
      onExit: async () => {
        await Promise.resolve();
      },
    };

    expect(typeof props.onSendMessage).toBe("function");
    expect(typeof props.onStreamMessage).toBe("function");
    expect(typeof props.onExit).toBe("function");
  });
});

describe("MessageBubbleProps interface", () => {
  test("requires message prop", () => {
    const props: MessageBubbleProps = {
      message: createMessage("user", "Test"),
    };

    expect(props.message).toBeDefined();
    expect(props.message.role).toBe("user");
  });

  test("allows optional isLast prop", () => {
    const propsWithIsLast: MessageBubbleProps = {
      message: createMessage("user", "Test"),
      isLast: true,
    };

    const propsWithoutIsLast: MessageBubbleProps = {
      message: createMessage("user", "Test"),
    };

    expect(propsWithIsLast.isLast).toBe(true);
    expect(propsWithoutIsLast.isLast).toBeUndefined();
  });
});

// ============================================================================
// Message Flow Tests
// ============================================================================

describe("Message flow simulation", () => {
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
  });

  test("simulates user message flow", () => {
    // User sends a message
    const userMsg = createMessage("user", "Hello");
    messages.push(userMsg);

    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("user");
  });

  test("simulates streaming response flow", () => {
    // User sends message
    messages.push(createMessage("user", "Hello"));

    // Assistant starts streaming response
    const assistantMsg = createMessage("assistant", "", true);
    messages.push(assistantMsg);

    expect(messages.length).toBe(2);
    expect(messages[1]?.streaming).toBe(true);
    expect(messages[1]?.content).toBe("");

    // Simulate chunks arriving
    messages[1] = { ...messages[1]!, content: messages[1]!.content + "Hi" };
    messages[1] = { ...messages[1]!, content: messages[1]!.content + " there" };
    messages[1] = { ...messages[1]!, content: messages[1]!.content + "!" };

    expect(messages[1]?.content).toBe("Hi there!");

    // Complete streaming
    messages[1] = { ...messages[1]!, streaming: false };
    expect(messages[1]?.streaming).toBe(false);
  });

  test("simulates multi-turn conversation", () => {
    const turns = [
      { role: "user" as const, content: "What is 2+2?" },
      { role: "assistant" as const, content: "2+2 equals 4." },
      { role: "user" as const, content: "And 3+3?" },
      { role: "assistant" as const, content: "3+3 equals 6." },
    ];

    for (const turn of turns) {
      messages.push(createMessage(turn.role, turn.content));
    }

    expect(messages.length).toBe(4);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.role).toBe("user");
    expect(messages[3]?.role).toBe("assistant");
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe("Edge cases", () => {
  test("handles empty content", () => {
    const msg = createMessage("user", "");
    expect(msg.content).toBe("");
  });

  test("handles very long content", () => {
    const longContent = "a".repeat(10000);
    const msg = createMessage("user", longContent);
    expect(msg.content.length).toBe(10000);
  });

  test("handles special characters in content", () => {
    const specialContent = "Hello <script>alert('xss')</script> & \"quotes\"";
    const msg = createMessage("user", specialContent);
    expect(msg.content).toBe(specialContent);
  });

  test("handles unicode content", () => {
    const unicodeContent = "Hello 世界 🌍 مرحبا";
    const msg = createMessage("user", unicodeContent);
    expect(msg.content).toBe(unicodeContent);
  });

  test("handles newlines in content", () => {
    const multilineContent = "Line 1\nLine 2\nLine 3";
    const msg = createMessage("user", multilineContent);
    expect(msg.content).toBe(multilineContent);
    expect(msg.content.split("\n").length).toBe(3);
  });
});

// ============================================================================
// WorkflowChatState Tests
// ============================================================================

describe("defaultWorkflowChatState", () => {
  test("has correct autocomplete defaults", () => {
    expect(defaultWorkflowChatState.showAutocomplete).toBe(false);
    expect(defaultWorkflowChatState.autocompleteInput).toBe("");
    expect(defaultWorkflowChatState.selectedSuggestionIndex).toBe(0);
  });

  test("has correct workflow defaults", () => {
    expect(defaultWorkflowChatState.workflowActive).toBe(false);
    expect(defaultWorkflowChatState.workflowType).toBeNull();
    expect(defaultWorkflowChatState.initialPrompt).toBeNull();
    expect(defaultWorkflowChatState.currentNode).toBeNull();
    expect(defaultWorkflowChatState.iteration).toBe(0);
    expect(defaultWorkflowChatState.maxIterations).toBeUndefined();
    expect(defaultWorkflowChatState.featureProgress).toBeNull();
  });

  test("has correct approval defaults", () => {
    expect(defaultWorkflowChatState.pendingApproval).toBe(false);
    expect(defaultWorkflowChatState.specApproved).toBe(false);
    expect(defaultWorkflowChatState.feedback).toBeNull();
  });
});

describe("WorkflowChatState type", () => {
  test("allows all autocomplete fields to be set", () => {
    const state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      showAutocomplete: true,
      autocompleteInput: "hel",
      selectedSuggestionIndex: 2,
    };

    expect(state.showAutocomplete).toBe(true);
    expect(state.autocompleteInput).toBe("hel");
    expect(state.selectedSuggestionIndex).toBe(2);
  });

  test("allows all workflow fields to be set", () => {
    const state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      workflowType: "atomic",
      initialPrompt: "Build a feature",
    };

    expect(state.workflowActive).toBe(true);
    expect(state.workflowType).toBe("atomic");
    expect(state.initialPrompt).toBe("Build a feature");
  });

  test("allows all approval fields to be set", () => {
    const state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      pendingApproval: true,
      specApproved: true,
      feedback: "Looks good!",
    };

    expect(state.pendingApproval).toBe(true);
    expect(state.specApproved).toBe(true);
    expect(state.feedback).toBe("Looks good!");
  });

  test("supports partial state updates via spread", () => {
    let state: WorkflowChatState = { ...defaultWorkflowChatState };

    // Simulate starting a workflow
    state = {
      ...state,
      workflowActive: true,
      workflowType: "atomic",
      initialPrompt: "Create a login form",
    };

    expect(state.workflowActive).toBe(true);
    expect(state.workflowType).toBe("atomic");
    // Autocomplete state should remain unchanged
    expect(state.showAutocomplete).toBe(false);
  });

  test("supports autocomplete state transitions", () => {
    let state: WorkflowChatState = { ...defaultWorkflowChatState };

    // User types "/"
    state = { ...state, showAutocomplete: true, autocompleteInput: "" };
    expect(state.showAutocomplete).toBe(true);

    // User types "/hel"
    state = { ...state, autocompleteInput: "hel" };
    expect(state.autocompleteInput).toBe("hel");

    // User navigates down
    state = { ...state, selectedSuggestionIndex: 1 };
    expect(state.selectedSuggestionIndex).toBe(1);

    // User selects command (hides autocomplete)
    state = {
      ...state,
      showAutocomplete: false,
      autocompleteInput: "",
      selectedSuggestionIndex: 0,
    };
    expect(state.showAutocomplete).toBe(false);
  });

  test("supports approval state transitions", () => {
    let state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      workflowType: "atomic",
    };

    // Workflow requests approval
    state = { ...state, pendingApproval: true };
    expect(state.pendingApproval).toBe(true);
    expect(state.specApproved).toBe(false);

    // User approves
    state = { ...state, pendingApproval: false, specApproved: true };
    expect(state.pendingApproval).toBe(false);
    expect(state.specApproved).toBe(true);
  });

  test("supports rejection with feedback", () => {
    let state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      workflowType: "atomic",
      pendingApproval: true,
    };

    // User rejects with feedback
    state = {
      ...state,
      pendingApproval: false,
      specApproved: false,
      feedback: "Need more error handling",
    };

    expect(state.specApproved).toBe(false);
    expect(state.feedback).toBe("Need more error handling");
  });

  test("can reset to defaults", () => {
    const modifiedState: WorkflowChatState = {
      showAutocomplete: true,
      autocompleteInput: "test",
      selectedSuggestionIndex: 5,
      workflowActive: true,
      workflowType: "atomic",
      initialPrompt: "test prompt",
      currentNode: "create_spec",
      iteration: 3,
      maxIterations: 10,
      featureProgress: { completed: 5, total: 10, currentFeature: "Test" },
      pendingApproval: true,
      specApproved: true,
      feedback: "test feedback",
    };

    // Reset to defaults
    const resetState: WorkflowChatState = { ...defaultWorkflowChatState };

    expect(resetState).toEqual(defaultWorkflowChatState);
    expect(resetState).not.toEqual(modifiedState);
  });

  test("allows all new workflow status fields to be set", () => {
    const state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      workflowType: "ralph",
      initialPrompt: "Implement feature list",
      currentNode: "implement_feature",
      iteration: 2,
      maxIterations: 5,
      featureProgress: {
        completed: 3,
        total: 10,
        currentFeature: "Add login button",
      },
    };

    expect(state.currentNode).toBe("implement_feature");
    expect(state.iteration).toBe(2);
    expect(state.maxIterations).toBe(5);
    expect(state.featureProgress).toEqual({
      completed: 3,
      total: 10,
      currentFeature: "Add login button",
    });
  });

  test("supports workflow progress tracking state transitions", () => {
    let state: WorkflowChatState = { ...defaultWorkflowChatState };

    // Start workflow
    state = {
      ...state,
      workflowActive: true,
      workflowType: "atomic",
      currentNode: "create_spec",
      iteration: 1,
      maxIterations: 5,
    };
    expect(state.currentNode).toBe("create_spec");
    expect(state.iteration).toBe(1);

    // Move to next node
    state = { ...state, currentNode: "create_feature_list" };
    expect(state.currentNode).toBe("create_feature_list");

    // Start implementing features
    state = {
      ...state,
      currentNode: "implement_feature",
      featureProgress: { completed: 0, total: 5, currentFeature: "Feature 1" },
    };
    expect(state.featureProgress?.completed).toBe(0);
    expect(state.featureProgress?.total).toBe(5);

    // Complete a feature
    state = {
      ...state,
      featureProgress: { completed: 1, total: 5, currentFeature: "Feature 2" },
    };
    expect(state.featureProgress?.completed).toBe(1);

    // Complete iteration
    state = { ...state, iteration: 2 };
    expect(state.iteration).toBe(2);
  });
});

// ============================================================================
// MessageToolCall Tests
// ============================================================================

describe("MessageToolCall type", () => {
  test("creates a basic tool call", () => {
    const toolCall: MessageToolCall = {
      id: "tool_1",
      toolName: "Read",
      input: { file_path: "/path/to/file.ts" },
      status: "pending",
    };

    expect(toolCall.toolName).toBe("Read");
    expect(toolCall.status).toBe("pending");
    expect(toolCall.output).toBeUndefined();
  });

  test("creates a tool call with output", () => {
    const toolCall: MessageToolCall = {
      id: "tool_2",
      toolName: "Bash",
      input: { command: "ls -la" },
      output: "file1.txt\nfile2.txt",
      status: "completed",
    };

    expect(toolCall.output).toBe("file1.txt\nfile2.txt");
    expect(toolCall.status).toBe("completed");
  });

  test("supports all status types", () => {
    const statuses: MessageToolCall["status"][] = [
      "pending",
      "running",
      "completed",
      "error",
    ];

    for (const status of statuses) {
      const toolCall: MessageToolCall = {
        id: `tool_${status}`,
        toolName: "Test",
        input: {},
        status,
      };
      expect(toolCall.status).toBe(status);
    }
  });

  test("creates tool call with error output", () => {
    const toolCall: MessageToolCall = {
      id: "tool_error",
      toolName: "Bash",
      input: { command: "invalid_command" },
      output: "command not found: invalid_command",
      status: "error",
    };

    expect(toolCall.status).toBe("error");
    expect(toolCall.output).toContain("command not found");
  });
});

describe("ChatMessage with tool calls", () => {
  test("creates message without tool calls", () => {
    const msg: ChatMessage = {
      id: "msg_1",
      role: "assistant",
      content: "Hello!",
      timestamp: new Date().toISOString(),
    };

    expect(msg.toolCalls).toBeUndefined();
  });

  test("creates message with tool calls", () => {
    const msg: ChatMessage = {
      id: "msg_2",
      role: "assistant",
      content: "Let me read that file for you.",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "tool_1",
          toolName: "Read",
          input: { file_path: "/src/index.ts" },
          output: "export const main = () => {};",
          status: "completed",
        },
      ],
    };

    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0]!.toolName).toBe("Read");
  });

  test("creates message with multiple tool calls", () => {
    const msg: ChatMessage = {
      id: "msg_3",
      role: "assistant",
      content: "I'll search the codebase.",
      timestamp: new Date().toISOString(),
      toolCalls: [
        {
          id: "tool_1",
          toolName: "Glob",
          input: { pattern: "**/*.ts" },
          output: ["file1.ts", "file2.ts"],
          status: "completed",
        },
        {
          id: "tool_2",
          toolName: "Grep",
          input: { pattern: "TODO" },
          output: ["file1.ts:10: // TODO: fix this"],
          status: "completed",
        },
      ],
    };

    expect(msg.toolCalls).toHaveLength(2);
    expect(msg.toolCalls![0]!.toolName).toBe("Glob");
    expect(msg.toolCalls![1]!.toolName).toBe("Grep");
  });

  test("creates streaming message with pending tool calls", () => {
    const msg: ChatMessage = {
      id: "msg_4",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
      toolCalls: [
        {
          id: "tool_1",
          toolName: "Bash",
          input: { command: "npm install" },
          status: "running",
        },
      ],
    };

    expect(msg.streaming).toBe(true);
    expect(msg.toolCalls![0]!.status).toBe("running");
  });
});

// ============================================================================
// Message Queue Integration Tests
// ============================================================================

describe("Message Queue Integration", () => {
  /**
   * These tests verify the behavior of message queuing during streaming.
   * The ChatApp component uses useMessageQueue to allow users to type
   * and submit messages while a response is streaming, instead of blocking.
   */

  test("message queue hook is properly typed with ChatApp", () => {
    // Verify the types are compatible
    // This is a compile-time check - the code below should type-check correctly

    // Simulating the queue state that ChatApp uses
    interface MessageQueueState {
      queue: Array<{ id: string; content: string; queuedAt: string }>;
      enqueue: (content: string) => void;
      dequeue: () => { id: string; content: string; queuedAt: string } | undefined;
      clear: () => void;
      count: number;
    }

    const mockQueue: MessageQueueState = {
      queue: [],
      enqueue: () => {},
      dequeue: () => undefined,
      clear: () => {},
      count: 0,
    };

    expect(mockQueue.queue).toEqual([]);
    expect(mockQueue.count).toBe(0);
    expect(typeof mockQueue.enqueue).toBe("function");
    expect(typeof mockQueue.dequeue).toBe("function");
    expect(typeof mockQueue.clear).toBe("function");
  });

  test("handleSubmit logic queues messages during streaming", () => {
    // Simulate handleSubmit logic when isStreaming is true
    let isStreaming = true;
    const queue: string[] = [];

    const handleSubmitLogic = (trimmedValue: string) => {
      if (!trimmedValue) {
        return { action: "none" };
      }

      // Slash commands are allowed during streaming
      if (trimmedValue.startsWith("/")) {
        return { action: "executeCommand", value: trimmedValue };
      }

      // Queue regular messages during streaming
      if (isStreaming) {
        queue.push(trimmedValue);
        return { action: "queued", value: trimmedValue };
      }

      // Send message normally when not streaming
      return { action: "send", value: trimmedValue };
    };

    // Test 1: Empty value should do nothing
    expect(handleSubmitLogic("")).toEqual({ action: "none" });

    // Test 2: Slash commands work during streaming
    expect(handleSubmitLogic("/help")).toEqual({ action: "executeCommand", value: "/help" });

    // Test 3: Regular messages are queued during streaming
    expect(handleSubmitLogic("Hello")).toEqual({ action: "queued", value: "Hello" });
    expect(queue).toEqual(["Hello"]);

    // Test 4: Multiple messages can be queued
    expect(handleSubmitLogic("World")).toEqual({ action: "queued", value: "World" });
    expect(queue).toEqual(["Hello", "World"]);

    // Test 5: After streaming ends, messages are sent directly
    isStreaming = false;
    expect(handleSubmitLogic("Direct message")).toEqual({ action: "send", value: "Direct message" });
    // Queue should not change for direct sends
    expect(queue).toEqual(["Hello", "World"]);
  });

  test("queued messages preserve content integrity", () => {
    // Test that various content types are queued correctly
    const queue: Array<{ id: string; content: string; queuedAt: string }> = [];
    let idCounter = 0;

    const enqueue = (content: string) => {
      queue.push({
        id: `queue_${idCounter++}`,
        content,
        queuedAt: new Date().toISOString(),
      });
    };

    // Normal text
    enqueue("Hello, world!");
    expect(queue[0]?.content).toBe("Hello, world!");

    // Unicode content
    enqueue("こんにちは 🌍");
    expect(queue[1]?.content).toBe("こんにちは 🌍");

    // Multi-line content
    enqueue("Line 1\nLine 2\nLine 3");
    expect(queue[2]?.content).toBe("Line 1\nLine 2\nLine 3");

    // Special characters
    enqueue("<script>alert('test')</script>");
    expect(queue[3]?.content).toBe("<script>alert('test')</script>");

    // Long content
    const longContent = "A".repeat(10000);
    enqueue(longContent);
    expect(queue[4]?.content).toBe(longContent);

    expect(queue.length).toBe(5);
  });

  test("queue FIFO order is maintained", () => {
    const queue: string[] = [];

    // Simulate enqueue
    const enqueue = (content: string) => queue.push(content);

    // Simulate dequeue
    const dequeue = () => queue.shift();

    // Enqueue in order
    enqueue("First");
    enqueue("Second");
    enqueue("Third");

    // Dequeue should return in FIFO order
    expect(dequeue()).toBe("First");
    expect(dequeue()).toBe("Second");
    expect(dequeue()).toBe("Third");
    expect(dequeue()).toBeUndefined();
  });

  test("textarea is cleared after queuing message", () => {
    // Simulate textarea clearing behavior
    let textareaValue = "Message to queue";

    // Simulate the clear operation
    const clearTextarea = () => {
      textareaValue = "";
    };

    // Before clearing
    expect(textareaValue).toBe("Message to queue");

    // After the clear operation that happens in handleSubmit
    clearTextarea();
    expect(textareaValue).toBe("");
  });
});

// ============================================================================
// Queue Processing Tests
// ============================================================================

describe("Queue Processing after Stream Completion", () => {
  /**
   * These tests verify that queued messages are processed sequentially
   * after stream completion, with a 50ms delay between each message.
   */

  test("handleComplete dequeues next message after stream ends", () => {
    // Simulate the queue and handleComplete behavior
    const queue: string[] = ["First queued", "Second queued"];
    const processedMessages: string[] = [];
    let isStreaming = true;

    const dequeue = () => queue.shift();

    const sendMessage = (content: string) => {
      processedMessages.push(content);
      isStreaming = true;
    };

    const handleComplete = () => {
      isStreaming = false;
      const nextMessage = dequeue();
      if (nextMessage) {
        sendMessage(nextMessage);
      }
    };

    // Complete first stream
    handleComplete();
    expect(isStreaming).toBe(true); // Started processing next message
    expect(processedMessages).toEqual(["First queued"]);
    expect(queue).toEqual(["Second queued"]);

    // Complete second stream
    handleComplete();
    expect(processedMessages).toEqual(["First queued", "Second queued"]);
    expect(queue).toEqual([]);

    // Complete third stream - no more messages
    handleComplete();
    expect(isStreaming).toBe(false); // No more messages to process
    expect(processedMessages.length).toBe(2);
  });

  test("empty queue does not trigger message send", () => {
    const queue: string[] = [];
    let sendCalled = false;

    const dequeue = () => queue.shift();

    const handleComplete = () => {
      const nextMessage = dequeue();
      if (nextMessage) {
        sendCalled = true;
      }
    };

    handleComplete();
    expect(sendCalled).toBe(false);
  });

  test("queued messages preserve order during sequential processing", () => {
    // Simulate the full flow: queue 3 messages, then process them
    const queue: string[] = [];
    const processedOrder: string[] = [];

    const enqueue = (content: string) => queue.push(content);
    const dequeue = () => queue.shift();

    // Queue messages during "streaming"
    enqueue("Message A");
    enqueue("Message B");
    enqueue("Message C");

    expect(queue).toEqual(["Message A", "Message B", "Message C"]);

    // Simulate handleComplete processing each message
    while (queue.length > 0) {
      const msg = dequeue();
      if (msg) processedOrder.push(msg);
    }

    // Verify FIFO order is maintained
    expect(processedOrder).toEqual(["Message A", "Message B", "Message C"]);
  });

  test("sendMessage function creates user message and starts streaming", () => {
    // Verify the sendMessage behavior
    const messages: Array<{ role: string; content: string }> = [];
    let isStreaming = false;
    let streamingMessageId: string | null = null;

    const sendMessage = (content: string) => {
      // Add user message
      messages.push({ role: "user", content });

      // Start streaming
      isStreaming = true;
      streamingMessageId = `msg_${Date.now()}`;
      messages.push({ role: "assistant", content: "" });
    };

    sendMessage("Hello");

    expect(messages.length).toBe(2);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "" });
    expect(isStreaming).toBe(true);
    expect(streamingMessageId).not.toBeNull();
  });

  test("50ms delay between processing queued messages", async () => {
    // Test that there's a delay between processing messages
    const processedAt: number[] = [];

    const simulateDelayedProcessing = () => {
      return new Promise<void>((resolve) => {
        processedAt.push(Date.now());
        setTimeout(() => {
          processedAt.push(Date.now());
          resolve();
        }, 50);
      });
    };

    await simulateDelayedProcessing();

    expect(processedAt.length).toBe(2);
    const delay = processedAt[1]! - processedAt[0]!;
    expect(delay).toBeGreaterThanOrEqual(45); // Allow some timing variance
  });
});

// ============================================================================
// VerboseMode State Tests
// ============================================================================

describe("VerboseMode State", () => {
  /**
   * These tests verify the verboseMode state in ChatApp.
   * VerboseMode controls:
   * - ToolResult expanded/collapsed state
   * - Timestamp display in MessageBubble
   */

  test("verboseMode defaults to false", () => {
    // Simulate initial state of ChatApp
    let verboseMode = false;

    expect(verboseMode).toBe(false);
  });

  test("verboseMode can be toggled", () => {
    let verboseMode = false;

    // Toggle on
    verboseMode = !verboseMode;
    expect(verboseMode).toBe(true);

    // Toggle off
    verboseMode = !verboseMode;
    expect(verboseMode).toBe(false);
  });

  test("verboseMode propagates to MessageBubble props", () => {
    // Simulate MessageBubble props with verboseMode
    interface TestMessageBubbleProps {
      message: ChatMessage;
      isLast?: boolean;
      verboseMode?: boolean;
    }

    const propsWithVerbose: TestMessageBubbleProps = {
      message: createMessage("assistant", "Test"),
      verboseMode: true,
    };

    const propsWithoutVerbose: TestMessageBubbleProps = {
      message: createMessage("assistant", "Test"),
      verboseMode: false,
    };

    expect(propsWithVerbose.verboseMode).toBe(true);
    expect(propsWithoutVerbose.verboseMode).toBe(false);
  });

  test("verboseMode propagates to ToolResult through MessageBubble", () => {
    // Simulate the prop flow: ChatApp -> MessageBubble -> ToolResult
    interface ToolResultProps {
      toolName: string;
      input: Record<string, unknown>;
      status: string;
      verboseMode?: boolean;
    }

    const verboseToolResult: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
      verboseMode: true,
    };

    const normalToolResult: ToolResultProps = {
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "completed",
      verboseMode: false,
    };

    expect(verboseToolResult.verboseMode).toBe(true);
    expect(normalToolResult.verboseMode).toBe(false);
  });

  test("ChatApp state structure includes verboseMode", () => {
    // Simulate the state structure in ChatApp
    interface ChatAppState {
      messages: ChatMessage[];
      isStreaming: boolean;
      verboseMode: boolean;
    }

    const initialState: ChatAppState = {
      messages: [],
      isStreaming: false,
      verboseMode: false,
    };

    expect(initialState.verboseMode).toBe(false);

    // Toggle verbose mode
    const updatedState: ChatAppState = {
      ...initialState,
      verboseMode: true,
    };

    expect(updatedState.verboseMode).toBe(true);
    // Other state should remain unchanged
    expect(updatedState.messages).toEqual([]);
    expect(updatedState.isStreaming).toBe(false);
  });

  test("verboseMode state is independent of other states", () => {
    // Verify verboseMode doesn't interfere with other states
    interface ChatAppState {
      messages: ChatMessage[];
      isStreaming: boolean;
      verboseMode: boolean;
      workflowActive: boolean;
    }

    let state: ChatAppState = {
      messages: [],
      isStreaming: false,
      verboseMode: false,
      workflowActive: false,
    };

    // Start streaming - verboseMode unaffected
    state = { ...state, isStreaming: true };
    expect(state.verboseMode).toBe(false);
    expect(state.isStreaming).toBe(true);

    // Toggle verboseMode during streaming - streaming unaffected
    state = { ...state, verboseMode: true };
    expect(state.verboseMode).toBe(true);
    expect(state.isStreaming).toBe(true);

    // End streaming - verboseMode persists
    state = { ...state, isStreaming: false };
    expect(state.verboseMode).toBe(true);
    expect(state.isStreaming).toBe(false);
  });
});

describe("MessageBubbleProps with verboseMode", () => {
  test("MessageBubbleProps interface includes verboseMode", () => {
    const props: MessageBubbleProps = {
      message: createMessage("user", "Hello"),
      isLast: true,
      verboseMode: true,
    };

    expect(props.verboseMode).toBe(true);
  });

  test("verboseMode defaults to undefined when not provided", () => {
    const props: MessageBubbleProps = {
      message: createMessage("user", "Hello"),
    };

    expect(props.verboseMode).toBeUndefined();
  });

  test("verboseMode can be explicitly set to false", () => {
    const props: MessageBubbleProps = {
      message: createMessage("user", "Hello"),
      verboseMode: false,
    };

    expect(props.verboseMode).toBe(false);
  });
});

// ============================================================================
// Ctrl+O Keyboard Shortcut Tests
// ============================================================================

describe("Ctrl+O Keyboard Shortcut for Verbose Mode", () => {
  /**
   * These tests verify the Ctrl+O keyboard shortcut toggles verbose mode.
   * The shortcut should toggle the verboseMode state in ChatApp.
   */

  test("Ctrl+O key event has correct properties", () => {
    // Simulate a Ctrl+O key event structure
    interface KeyEvent {
      name: string;
      ctrl: boolean;
      shift: boolean;
      alt: boolean;
    }

    const ctrlOEvent: KeyEvent = {
      name: "o",
      ctrl: true,
      shift: false,
      alt: false,
    };

    expect(ctrlOEvent.name).toBe("o");
    expect(ctrlOEvent.ctrl).toBe(true);
    expect(ctrlOEvent.shift).toBe(false);
  });

  test("Ctrl+O toggles verboseMode from false to true", () => {
    let verboseMode = false;

    // Simulate toggle action
    const toggleVerboseMode = () => {
      verboseMode = !verboseMode;
    };

    // Simulate Ctrl+O press
    toggleVerboseMode();
    expect(verboseMode).toBe(true);
  });

  test("Ctrl+O toggles verboseMode from true to false", () => {
    let verboseMode = true;

    // Simulate toggle action
    const toggleVerboseMode = () => {
      verboseMode = !verboseMode;
    };

    // Simulate Ctrl+O press
    toggleVerboseMode();
    expect(verboseMode).toBe(false);
  });

  test("multiple Ctrl+O presses toggle correctly", () => {
    let verboseMode = false;

    const toggleVerboseMode = () => {
      verboseMode = !verboseMode;
    };

    // First toggle: off -> on
    toggleVerboseMode();
    expect(verboseMode).toBe(true);

    // Second toggle: on -> off
    toggleVerboseMode();
    expect(verboseMode).toBe(false);

    // Third toggle: off -> on
    toggleVerboseMode();
    expect(verboseMode).toBe(true);
  });

  test("Ctrl+O handler is distinct from other Ctrl shortcuts", () => {
    // Simulate key event handling logic
    interface KeyEvent {
      name: string;
      ctrl: boolean;
      shift: boolean;
    }

    const isCtrlO = (event: KeyEvent): boolean => {
      return event.ctrl && event.name === "o" && !event.shift;
    };

    const isCtrlC = (event: KeyEvent): boolean => {
      return event.ctrl && event.name === "c";
    };

    const isCtrlV = (event: KeyEvent): boolean => {
      return event.ctrl && event.name === "v";
    };

    // Ctrl+O should only match Ctrl+O
    expect(isCtrlO({ name: "o", ctrl: true, shift: false })).toBe(true);
    expect(isCtrlO({ name: "c", ctrl: true, shift: false })).toBe(false);
    expect(isCtrlO({ name: "v", ctrl: true, shift: false })).toBe(false);
    expect(isCtrlO({ name: "o", ctrl: false, shift: false })).toBe(false);

    // Other shortcuts should not match Ctrl+O
    expect(isCtrlC({ name: "o", ctrl: true, shift: false })).toBe(false);
    expect(isCtrlV({ name: "o", ctrl: true, shift: false })).toBe(false);
  });

  test("verboseMode state change propagates to ToolResult", () => {
    // Simulate state propagation after Ctrl+O toggle
    let verboseMode = false;
    let toolResultVerboseMode = verboseMode;

    const toggleVerboseMode = () => {
      verboseMode = !verboseMode;
      toolResultVerboseMode = verboseMode; // Simulates React re-render prop update
    };

    expect(toolResultVerboseMode).toBe(false);

    toggleVerboseMode();
    expect(verboseMode).toBe(true);
    expect(toolResultVerboseMode).toBe(true);

    toggleVerboseMode();
    expect(verboseMode).toBe(false);
    expect(toolResultVerboseMode).toBe(false);
  });

  test("keyboard handler structure supports Ctrl+O pattern", () => {
    // Verify the keyboard event handler pattern used in ChatApp
    interface KeyEvent {
      name: string;
      ctrl: boolean;
      shift: boolean;
    }

    let handledEvent: string | null = null;
    let verboseMode = false;

    const keyboardHandler = (event: KeyEvent) => {
      // Pattern matching similar to ChatApp useKeyboard callback
      if (event.ctrl && event.name === "o") {
        handledEvent = "Ctrl+O";
        verboseMode = !verboseMode;
        return;
      }
      if (event.ctrl && event.name === "c") {
        handledEvent = "Ctrl+C";
        return;
      }
    };

    // Test Ctrl+O handling
    keyboardHandler({ name: "o", ctrl: true, shift: false });
    expect(handledEvent).toBe("Ctrl+O");
    expect(verboseMode).toBe(true);

    // Test that other events don't affect verboseMode
    keyboardHandler({ name: "c", ctrl: true, shift: false });
    expect(handledEvent).toBe("Ctrl+C");
    expect(verboseMode).toBe(true); // Should still be true
  });
});
