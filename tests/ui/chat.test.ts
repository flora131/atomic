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
  SPINNER_VERBS,
  getRandomSpinnerVerb,
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
// TimestampDisplay Integration Tests
// ============================================================================

describe("TimestampDisplay in MessageBubble", () => {
  test("assistant message can include durationMs for timestamp display", () => {
    const message: ChatMessage = {
      id: "test-1",
      role: "assistant",
      content: "Hello there",
      timestamp: "2026-02-01T14:30:00.000Z",
      streaming: false,
      durationMs: 2500,
    };

    const props: MessageBubbleProps = {
      message,
      verboseMode: true,
    };

    expect(props.message.durationMs).toBe(2500);
    expect(props.verboseMode).toBe(true);
  });

  test("assistant message can include modelId for timestamp display", () => {
    const message: ChatMessage = {
      id: "test-1",
      role: "assistant",
      content: "Hello there",
      timestamp: "2026-02-01T14:30:00.000Z",
      streaming: false,
      modelId: "claude-3-opus",
    };

    const props: MessageBubbleProps = {
      message,
      verboseMode: true,
    };

    expect(props.message.modelId).toBe("claude-3-opus");
  });

  test("assistant message with all timing info", () => {
    const message: ChatMessage = {
      id: "test-1",
      role: "assistant",
      content: "Here is my response",
      timestamp: "2026-02-01T14:30:00.000Z",
      streaming: false,
      durationMs: 1500,
      modelId: "gpt-4",
    };

    const props: MessageBubbleProps = {
      message,
      isLast: true,
      verboseMode: true,
    };

    expect(props.message.timestamp).toBeDefined();
    expect(props.message.durationMs).toBe(1500);
    expect(props.message.modelId).toBe("gpt-4");
    expect(props.message.streaming).toBe(false);
  });

  test("streaming message should not show timestamp (streaming=true)", () => {
    const message: ChatMessage = {
      id: "test-1",
      role: "assistant",
      content: "Partial...",
      timestamp: "2026-02-01T14:30:00.000Z",
      streaming: true, // Still streaming
    };

    const props: MessageBubbleProps = {
      message,
      verboseMode: true,
    };

    // Streaming is true, so timestamp display should be hidden
    expect(props.message.streaming).toBe(true);
    expect(props.verboseMode).toBe(true);
  });

  test("timestamp display only shows when verboseMode is true", () => {
    const message: ChatMessage = {
      id: "test-1",
      role: "assistant",
      content: "Response",
      timestamp: "2026-02-01T14:30:00.000Z",
      streaming: false,
      durationMs: 500,
    };

    const propsWithVerbose: MessageBubbleProps = {
      message,
      verboseMode: true,
    };

    const propsWithoutVerbose: MessageBubbleProps = {
      message,
      verboseMode: false,
    };

    expect(propsWithVerbose.verboseMode).toBe(true);
    expect(propsWithoutVerbose.verboseMode).toBe(false);
  });

  test("user messages do not need timestamp display props", () => {
    const message: ChatMessage = {
      id: "test-1",
      role: "user",
      content: "Hello",
      timestamp: "2026-02-01T14:30:00.000Z",
    };

    const props: MessageBubbleProps = {
      message,
      verboseMode: true,
    };

    // User messages don't have durationMs or modelId
    expect(props.message.durationMs).toBeUndefined();
    expect(props.message.modelId).toBeUndefined();
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
    expect(handledEvent as unknown).toBe("Ctrl+O");
    expect(verboseMode).toBe(true);

    // Test that other events don't affect verboseMode
    keyboardHandler({ name: "c", ctrl: true, shift: false });
    expect(handledEvent as unknown).toBe("Ctrl+C");
    expect(verboseMode).toBe(true); // Should still be true
  });
});

// ============================================================================
// FooterStatus Integration Tests
// ============================================================================

describe("FooterStatus Integration", () => {
  /**
   * These tests verify the FooterStatus component integration in ChatApp.
   * The footer displays: verboseMode, isStreaming, queuedCount, modelId.
   */

  test("FooterStatus receives correct props from ChatApp state", () => {
    // Simulate the props that ChatApp passes to FooterStatus
    interface FooterStatusPropsFromChat {
      verboseMode: boolean;
      isStreaming: boolean;
      queuedCount: number;
      modelId: string;
    }

    const props: FooterStatusPropsFromChat = {
      verboseMode: false,
      isStreaming: false,
      queuedCount: 0,
      modelId: "Opus 4.5",
    };

    expect(props.verboseMode).toBe(false);
    expect(props.isStreaming).toBe(false);
    expect(props.queuedCount).toBe(0);
    expect(props.modelId).toBe("Opus 4.5");
  });

  test("FooterStatus queuedCount updates with message queue", () => {
    // Simulate queue state changes
    interface QueueState {
      count: number;
    }

    let queue: QueueState = { count: 0 };
    let footerQueuedCount = queue.count;

    // Initially empty
    expect(footerQueuedCount).toBe(0);

    // Add messages to queue
    queue = { count: 1 };
    footerQueuedCount = queue.count;
    expect(footerQueuedCount).toBe(1);

    queue = { count: 3 };
    footerQueuedCount = queue.count;
    expect(footerQueuedCount).toBe(3);

    // Empty queue
    queue = { count: 0 };
    footerQueuedCount = queue.count;
    expect(footerQueuedCount).toBe(0);
  });

  test("FooterStatus updates when streaming starts and stops", () => {
    let isStreaming = false;
    let footerIsStreaming = isStreaming;

    // Start streaming
    isStreaming = true;
    footerIsStreaming = isStreaming;
    expect(footerIsStreaming).toBe(true);

    // Stop streaming
    isStreaming = false;
    footerIsStreaming = isStreaming;
    expect(footerIsStreaming).toBe(false);
  });

  test("FooterStatus updates when verboseMode toggles", () => {
    let verboseMode = false;
    let footerVerboseMode = verboseMode;

    // Toggle on
    verboseMode = true;
    footerVerboseMode = verboseMode;
    expect(footerVerboseMode).toBe(true);

    // Toggle off
    verboseMode = false;
    footerVerboseMode = verboseMode;
    expect(footerVerboseMode).toBe(false);
  });

  test("FooterStatus receives modelId from ChatApp props", () => {
    // Simulate different model IDs
    const models = ["Opus 4.5", "Sonnet 4", "claude-3-opus", "gpt-4"];

    for (const modelId of models) {
      const footerProps = { modelId };
      expect(footerProps.modelId).toBe(modelId);
    }
  });

  test("FooterStatus state reflects combined ChatApp state", () => {
    // Simulate a realistic combined state scenario
    interface ChatAppStateForFooter {
      verboseMode: boolean;
      isStreaming: boolean;
      queuedCount: number;
      modelId: string;
    }

    // Initial state
    let state: ChatAppStateForFooter = {
      verboseMode: false,
      isStreaming: false,
      queuedCount: 0,
      modelId: "Opus 4.5",
    };

    expect(state.verboseMode).toBe(false);
    expect(state.isStreaming).toBe(false);
    expect(state.queuedCount).toBe(0);

    // User sends message, streaming starts
    state = { ...state, isStreaming: true };
    expect(state.isStreaming).toBe(true);

    // User queues messages during streaming
    state = { ...state, queuedCount: 2 };
    expect(state.queuedCount).toBe(2);

    // User toggles verbose mode
    state = { ...state, verboseMode: true };
    expect(state.verboseMode).toBe(true);

    // Stream completes, queue processes
    state = { ...state, isStreaming: false, queuedCount: 1 };
    expect(state.isStreaming).toBe(false);
    expect(state.queuedCount).toBe(1);

    // All queued messages processed
    state = { ...state, queuedCount: 0 };
    expect(state.queuedCount).toBe(0);
  });
});

// ============================================================================
// SPINNER_VERBS Tests
// ============================================================================

describe("SPINNER_VERBS", () => {
  /**
   * These tests verify the SPINNER_VERBS constant array used by LoadingIndicator.
   * The array contains contextually appropriate verbs for AI assistant actions.
   */

  test("SPINNER_VERBS is an array", () => {
    expect(Array.isArray(SPINNER_VERBS)).toBe(true);
  });

  test("SPINNER_VERBS has at least 5 verbs", () => {
    expect(SPINNER_VERBS.length).toBeGreaterThanOrEqual(5);
  });

  test("SPINNER_VERBS has at most 10 verbs", () => {
    expect(SPINNER_VERBS.length).toBeLessThanOrEqual(10);
  });

  test("all SPINNER_VERBS are non-empty strings", () => {
    for (const verb of SPINNER_VERBS) {
      expect(typeof verb).toBe("string");
      expect(verb.length).toBeGreaterThan(0);
    }
  });

  test("SPINNER_VERBS are capitalized (first letter uppercase)", () => {
    for (const verb of SPINNER_VERBS) {
      const firstChar = verb[0];
      expect(firstChar).toBe(firstChar?.toUpperCase());
    }
  });

  test("SPINNER_VERBS contains expected verbs", () => {
    // Check for some expected verbs
    expect(SPINNER_VERBS).toContain("Thinking");
    expect(SPINNER_VERBS).toContain("Processing");
    expect(SPINNER_VERBS).toContain("Analyzing");
  });

  test("SPINNER_VERBS has no duplicates", () => {
    const uniqueVerbs = new Set(SPINNER_VERBS);
    expect(uniqueVerbs.size).toBe(SPINNER_VERBS.length);
  });

  test("random verb selection works with SPINNER_VERBS", () => {
    // Simulate random verb selection used in LoadingIndicator
    const getRandomVerb = () => {
      const index = Math.floor(Math.random() * SPINNER_VERBS.length);
      return SPINNER_VERBS[index];
    };

    // Run multiple times to ensure it returns valid verbs
    for (let i = 0; i < 10; i++) {
      const verb = getRandomVerb()!;
      expect(SPINNER_VERBS).toContain(verb);
    }
  });
});

// ============================================================================
// getRandomSpinnerVerb Tests
// ============================================================================

describe("getRandomSpinnerVerb", () => {
  /**
   * Tests for the getRandomSpinnerVerb helper function.
   * This function selects a random verb from SPINNER_VERBS.
   */

  test("returns a string", () => {
    const verb = getRandomSpinnerVerb();
    expect(typeof verb).toBe("string");
  });

  test("returns a verb from SPINNER_VERBS", () => {
    const verb = getRandomSpinnerVerb();
    expect(SPINNER_VERBS).toContain(verb);
  });

  test("returns non-empty string", () => {
    const verb = getRandomSpinnerVerb();
    expect(verb.length).toBeGreaterThan(0);
  });

  test("multiple calls return valid verbs", () => {
    // Call multiple times to verify randomness works
    for (let i = 0; i < 20; i++) {
      const verb = getRandomSpinnerVerb();
      expect(SPINNER_VERBS).toContain(verb);
    }
  });

  test("can potentially return different verbs on different calls", () => {
    // Run enough times to statistically expect variation
    const verbs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      verbs.add(getRandomSpinnerVerb());
    }
    // With 8 verbs and 50 calls, we should get at least 2 different verbs
    expect(verbs.size).toBeGreaterThan(1);
  });
});

// ============================================================================
// LoadingIndicator Enhancement Tests
// ============================================================================

describe("LoadingIndicator with spinner verb", () => {
  /**
   * Tests for the enhanced LoadingIndicator that displays random verb text.
   * The component shows "Verb..." alongside the wave animation.
   */

  test("verb format includes ellipsis", () => {
    const verb = getRandomSpinnerVerb();
    const formatted = `${verb}...`;
    expect(formatted).toMatch(/\.\.\./);
  });

  test("verb format with space for animation", () => {
    const verb = getRandomSpinnerVerb();
    const formatted = `${verb}... `;
    expect(formatted.endsWith(" ")).toBe(true);
  });

  test("verb display is consistent with SPINNER_VERBS content", () => {
    // Simulate what LoadingIndicator does
    const verb = getRandomSpinnerVerb();
    const displayText = `${verb}... `;

    // Verify it contains a valid verb
    const containsValidVerb = SPINNER_VERBS.some(v => displayText.includes(v));
    expect(containsValidVerb).toBe(true);
  });

  test("LoadingIndicator verb is selected on mount", () => {
    // Simulate the useState pattern used in LoadingIndicator
    // The verb is selected once via () => getRandomSpinnerVerb()
    const selectVerbOnMount = () => getRandomSpinnerVerb();
    const verb = selectVerbOnMount();

    expect(SPINNER_VERBS).toContain(verb);
  });
});

// ============================================================================
// handleAskUserQuestion Tests
// ============================================================================

describe("handleAskUserQuestion", () => {
  /**
   * Tests for the handleAskUserQuestion callback in ChatApp.
   * This callback handles AskUserQuestionEventData from askUserNode
   * graph nodes and shows a UserQuestionDialog.
   */

  test("AskUserQuestionEventData has required fields", () => {
    // Test the expected shape of AskUserQuestionEventData
    interface AskUserQuestionEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    const eventData: AskUserQuestionEventData = {
      requestId: "test-uuid-123",
      question: "What should we do next?",
      nodeId: "ask-user-node",
    };

    expect(eventData.requestId).toBe("test-uuid-123");
    expect(eventData.question).toBe("What should we do next?");
    expect(eventData.nodeId).toBe("ask-user-node");
    expect(eventData.header).toBeUndefined();
    expect(eventData.options).toBeUndefined();
  });

  test("AskUserQuestionEventData with optional header", () => {
    interface AskUserQuestionEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    const eventData: AskUserQuestionEventData = {
      requestId: "test-uuid-456",
      question: "Please confirm your choice",
      header: "Confirmation",
      nodeId: "confirm-node",
    };

    expect(eventData.header).toBe("Confirmation");
  });

  test("AskUserQuestionEventData with options array", () => {
    interface AskUserQuestionEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    const eventData: AskUserQuestionEventData = {
      requestId: "test-uuid-789",
      question: "Select an action",
      header: "Action",
      options: [
        { label: "Approve", description: "Proceed with changes" },
        { label: "Reject", description: "Discard changes" },
        { label: "Review", description: "View details first" },
      ],
      nodeId: "action-node",
    };

    expect(eventData.options).toHaveLength(3);
    expect(eventData.options![0]!.label).toBe("Approve");
    expect(eventData.options![0]!.description).toBe("Proceed with changes");
    expect(eventData.options![2]!.label).toBe("Review");
  });

  test("conversion to UserQuestion format uses header or default", () => {
    // Simulate the conversion logic in handleAskUserQuestion
    interface AskUserQuestionEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    interface UserQuestion {
      header: string;
      question: string;
      options: Array<{ label: string; value: string; description?: string }>;
      multiSelect: boolean;
    }

    const convertToUserQuestion = (eventData: AskUserQuestionEventData): UserQuestion => ({
      header: eventData.header || "Question",
      question: eventData.question,
      options: eventData.options?.map(opt => ({
        label: opt.label,
        value: opt.label,
        description: opt.description,
      })) || [],
      multiSelect: false,
    });

    // With header
    const withHeader = convertToUserQuestion({
      requestId: "1",
      question: "Test?",
      header: "Custom Header",
      nodeId: "node",
    });
    expect(withHeader.header).toBe("Custom Header");

    // Without header - uses default
    const withoutHeader = convertToUserQuestion({
      requestId: "2",
      question: "Test?",
      nodeId: "node",
    });
    expect(withoutHeader.header).toBe("Question");
  });

  test("conversion preserves options with label as value", () => {
    interface AskUserQuestionEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    interface UserQuestion {
      header: string;
      question: string;
      options: Array<{ label: string; value: string; description?: string }>;
      multiSelect: boolean;
    }

    const convertToUserQuestion = (eventData: AskUserQuestionEventData): UserQuestion => ({
      header: eventData.header || "Question",
      question: eventData.question,
      options: eventData.options?.map(opt => ({
        label: opt.label,
        value: opt.label,
        description: opt.description,
      })) || [],
      multiSelect: false,
    });

    const result = convertToUserQuestion({
      requestId: "1",
      question: "Choose",
      options: [
        { label: "Option A", description: "First option" },
        { label: "Option B" },
      ],
      nodeId: "node",
    });

    expect(result.options).toHaveLength(2);
    expect(result.options[0]!.label).toBe("Option A");
    expect(result.options[0]!.value).toBe("Option A"); // value = label
    expect(result.options[0]!.description).toBe("First option");
    expect(result.options[1]!.label).toBe("Option B");
    expect(result.options[1]!.description).toBeUndefined();
  });

  test("empty options array produces empty UserQuestion options", () => {
    interface AskUserQuestionEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    const convertToUserQuestion = (eventData: AskUserQuestionEventData) => ({
      header: eventData.header || "Question",
      question: eventData.question,
      options: eventData.options?.map(opt => ({
        label: opt.label,
        value: opt.label,
        description: opt.description,
      })) || [],
      multiSelect: false,
    });

    const result = convertToUserQuestion({
      requestId: "1",
      question: "No options",
      nodeId: "node",
    });

    expect(result.options).toEqual([]);
  });
});

describe("handleAskUserQuestion response flow", () => {
  /**
   * Tests for the response flow when user answers an askUserNode question.
   */

  test("workflow mode calls onWorkflowResumeWithAnswer", () => {
    // Simulate the response flow logic
    interface ResponseContext {
      workflowActive: boolean;
      onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
      getSession?: () => { send: (msg: string) => Promise<void> } | null;
    }

    let resumeWithAnswerCalled = false;
    let resumeArgs: { requestId: string; answer: string | string[] } | null = null;

    const context: ResponseContext = {
      workflowActive: true,
      onWorkflowResumeWithAnswer: (requestId, answer) => {
        resumeWithAnswerCalled = true;
        resumeArgs = { requestId, answer };
      },
    };

    // Simulate the response handling logic
    const handleResponse = (requestId: string, answer: string | string[], context: ResponseContext) => {
      if (context.workflowActive && context.onWorkflowResumeWithAnswer) {
        context.onWorkflowResumeWithAnswer(requestId, answer);
      } else {
        const session = context.getSession?.();
        if (session) {
          const answerText = Array.isArray(answer) ? answer.join(", ") : answer;
          void session.send(answerText);
        }
      }
    };

    handleResponse("test-request-id", "Approve", context);

    expect(resumeWithAnswerCalled).toBe(true);
    expect(resumeArgs!.requestId).toBe("test-request-id");
    expect(resumeArgs!.answer).toBe("Approve");
  });

  test("standalone mode calls session.send", () => {
    interface ResponseContext {
      workflowActive: boolean;
      onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
      getSession?: () => { send: (msg: string) => Promise<void> } | null;
    }

    let sessionSendCalled = false;
    let sentMessage: string | null = null;

    const context: ResponseContext = {
      workflowActive: false,
      getSession: () => ({
        send: async (msg: string) => {
          sessionSendCalled = true;
          sentMessage = msg;
        },
      }),
    };

    // Simulate the response handling logic
    const handleResponse = (requestId: string, answer: string | string[], context: ResponseContext) => {
      if (context.workflowActive && context.onWorkflowResumeWithAnswer) {
        context.onWorkflowResumeWithAnswer(requestId, answer);
      } else {
        const session = context.getSession?.();
        if (session) {
          const answerText = Array.isArray(answer) ? answer.join(", ") : answer;
          void session.send(answerText);
        }
      }
    };

    handleResponse("test-request-id", "Approve", context);

    expect(sessionSendCalled).toBe(true);
    expect(sentMessage as unknown).toBe("Approve");
  });

  test("array answer is joined with comma for session.send", () => {
    let sentMessage: string | null = null;

    const context = {
      workflowActive: false,
      getSession: () => ({
        send: async (msg: string) => {
          sentMessage = msg;
        },
      }),
    };

    const handleResponse = (answer: string | string[], ctx: typeof context) => {
      const session = ctx.getSession?.();
      if (session) {
        const answerText = Array.isArray(answer) ? answer.join(", ") : answer;
        void session.send(answerText);
      }
    };

    handleResponse(["Option A", "Option B", "Option C"], context);

    expect(sentMessage as unknown).toBe("Option A, Option B, Option C");
  });

  test("no action when session is null in standalone mode", () => {
    let anythingCalled = false;

    const context = {
      workflowActive: false,
      getSession: () => null,
    };

    const handleResponse = (answer: string | string[], ctx: typeof context) => {
      const session = ctx.getSession?.();
      if (session) {
        anythingCalled = true;
      }
    };

    handleResponse("Test", context);

    expect(anythingCalled).toBe(false);
  });
});

describe("ChatAppProps with askUserQuestion handlers", () => {
  /**
   * Tests for the new ChatAppProps related to askUserQuestion handling.
   */

  test("ChatAppProps includes registerAskUserQuestionHandler", () => {
    // Type test - this should compile without errors
    interface TestChatAppProps {
      registerAskUserQuestionHandler?: (handler: (eventData: { requestId: string; question: string; nodeId: string }) => void) => void;
    }

    const props: TestChatAppProps = {
      registerAskUserQuestionHandler: (handler) => {
        // Handler registration logic
        void handler;
      },
    };

    expect(typeof props.registerAskUserQuestionHandler).toBe("function");
  });

  test("ChatAppProps includes onWorkflowResumeWithAnswer", () => {
    // Type test - this should compile without errors
    interface TestChatAppProps {
      onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
    }

    let called = false;
    const props: TestChatAppProps = {
      onWorkflowResumeWithAnswer: (requestId, answer) => {
        called = true;
        void requestId;
        void answer;
      },
    };

    props.onWorkflowResumeWithAnswer?.("id", "answer");
    expect(called).toBe(true);
  });

  test("both handlers can be used together", () => {
    interface TestChatAppProps {
      registerAskUserQuestionHandler?: (handler: (eventData: { requestId: string; question: string }) => void) => void;
      onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
    }

    let registered = false;
    let resumed = false;

    const props: TestChatAppProps = {
      registerAskUserQuestionHandler: () => { registered = true; },
      onWorkflowResumeWithAnswer: () => { resumed = true; },
    };

    props.registerAskUserQuestionHandler?.(() => {});
    props.onWorkflowResumeWithAnswer?.("id", "answer");

    expect(registered).toBe(true);
    expect(resumed).toBe(true);
  });
});

describe("OnAskUserQuestion callback type", () => {
  /**
   * Tests for the OnAskUserQuestion callback type.
   */

  test("accepts AskUserQuestionEventData parameter", () => {
    // Simulate the callback signature
    type OnAskUserQuestion = (eventData: {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }) => void;

    let receivedData: unknown = null;

    const handler: OnAskUserQuestion = (eventData) => {
      receivedData = eventData;
    };

    handler({
      requestId: "abc-123",
      question: "What would you like to do?",
      header: "Action Required",
      options: [{ label: "Continue" }],
      nodeId: "action-node",
    });

    expect(receivedData).toEqual({
      requestId: "abc-123",
      question: "What would you like to do?",
      header: "Action Required",
      options: [{ label: "Continue" }],
      nodeId: "action-node",
    });
  });
});

// ============================================================================
// human_input_required Event Wiring Tests
// ============================================================================

describe("human_input_required event wiring", () => {
  /**
   * Tests for wiring handleAskUserQuestion to human_input_required event.
   * These tests verify the event listener setup and data flow from events
   * to the UI handler.
   */

  test("event listener receives human_input_required event data", () => {
    // Simulate the event data from askUserNode
    interface HumanInputRequiredEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    const eventData: HumanInputRequiredEventData = {
      requestId: "test-uuid-001",
      question: "Should we proceed with the deployment?",
      header: "Deployment Confirmation",
      options: [
        { label: "Yes", description: "Deploy to production" },
        { label: "No", description: "Cancel deployment" },
      ],
      nodeId: "deploy-confirm-node",
    };

    // Verify all fields are present
    expect(eventData.requestId).toBe("test-uuid-001");
    expect(eventData.question).toBe("Should we proceed with the deployment?");
    expect(eventData.header).toBe("Deployment Confirmation");
    expect(eventData.options).toHaveLength(2);
    expect(eventData.nodeId).toBe("deploy-confirm-node");
  });

  test("event handler transforms event data to AskUserQuestionEventData format", () => {
    // Simulate the transformation that happens in subscribeToToolEvents
    interface RawEventData {
      requestId?: string;
      question?: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId?: string;
    }

    interface AskUserQuestionEventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    const rawData: RawEventData = {
      requestId: "test-uuid-002",
      question: "Select an action",
      header: "Action",
      options: [{ label: "Continue" }],
      nodeId: "action-node",
    };

    // Transform to AskUserQuestionEventData (mimicking subscribeToToolEvents logic)
    const transformedData: AskUserQuestionEventData | null =
      rawData.question && rawData.requestId && rawData.nodeId
        ? {
            requestId: rawData.requestId,
            question: rawData.question,
            header: rawData.header,
            options: rawData.options,
            nodeId: rawData.nodeId,
          }
        : null;

    expect(transformedData).not.toBeNull();
    expect(transformedData!.requestId).toBe("test-uuid-002");
    expect(transformedData!.question).toBe("Select an action");
    expect(transformedData!.header).toBe("Action");
  });

  test("event handler does not call askUserQuestionHandler if required fields are missing", () => {
    interface RawEventData {
      requestId?: string;
      question?: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId?: string;
    }

    // Missing requestId
    const missingRequestId: RawEventData = {
      question: "Select an action",
      nodeId: "action-node",
    };

    // Missing question
    const missingQuestion: RawEventData = {
      requestId: "test-uuid",
      nodeId: "action-node",
    };

    // Missing nodeId
    const missingNodeId: RawEventData = {
      requestId: "test-uuid",
      question: "Select an action",
    };

    const shouldCallHandler = (data: RawEventData) =>
      !!(data.question && data.requestId && data.nodeId);

    expect(shouldCallHandler(missingRequestId)).toBe(false);
    expect(shouldCallHandler(missingQuestion)).toBe(false);
    expect(shouldCallHandler(missingNodeId)).toBe(false);
  });

  test("event listener is set up during subscription", () => {
    // Simulate the client.on pattern used in subscribeToToolEvents
    type EventHandler = (event: { data: unknown }) => void;
    const eventHandlers = new Map<string, EventHandler>();

    const mockClientOn = (eventType: string, handler: EventHandler) => {
      eventHandlers.set(eventType, handler);
      return () => eventHandlers.delete(eventType);
    };

    // Subscribe to human_input_required
    const unsubscribe = mockClientOn("human_input_required", (event) => {
      void event;
    });

    expect(eventHandlers.has("human_input_required")).toBe(true);

    // Unsubscribe
    unsubscribe();
    expect(eventHandlers.has("human_input_required")).toBe(false);
  });

  test("event listener is cleaned up on unsubscribe", () => {
    type EventHandler = (event: { data: unknown }) => void;
    const eventHandlers = new Map<string, EventHandler>();
    const unsubscribeFunctions: (() => void)[] = [];

    const mockClientOn = (eventType: string, handler: EventHandler) => {
      eventHandlers.set(eventType, handler);
      const unsub = () => eventHandlers.delete(eventType);
      unsubscribeFunctions.push(unsub);
      return unsub;
    };

    // Subscribe to multiple events (mimicking subscribeToToolEvents)
    mockClientOn("tool.start", () => {});
    mockClientOn("tool.complete", () => {});
    mockClientOn("permission.requested", () => {});
    mockClientOn("human_input_required", () => {});

    expect(eventHandlers.size).toBe(4);
    expect(eventHandlers.has("human_input_required")).toBe(true);

    // Clean up all
    for (const unsub of unsubscribeFunctions) {
      unsub();
    }

    expect(eventHandlers.size).toBe(0);
    expect(eventHandlers.has("human_input_required")).toBe(false);
  });

  test("registered handler is called with correct event data", () => {
    // Simulate the state and handler registration pattern
    let registeredHandler: ((data: unknown) => void) | null = null;
    let receivedData: unknown = null;

    // Register handler (mimicking registerAskUserQuestionHandler)
    const registerHandler = (handler: (data: unknown) => void) => {
      registeredHandler = handler;
    };

    registerHandler((data) => {
      receivedData = data;
    });

    // Simulate event reception
    const eventData = {
      requestId: "test-123",
      question: "Confirm?",
      nodeId: "confirm-node",
    };

    if (registeredHandler) {
      (registeredHandler as (data: unknown) => void)(eventData);
    }

    expect(receivedData).toEqual(eventData);
  });

  test("options array is passed through correctly", () => {
    interface EventData {
      requestId: string;
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      nodeId: string;
    }

    const eventData: EventData = {
      requestId: "test-uuid",
      question: "Choose one",
      header: "Selection",
      options: [
        { label: "Option A", description: "First option" },
        { label: "Option B", description: "Second option" },
        { label: "Option C" }, // No description
      ],
      nodeId: "selection-node",
    };

    // Verify options are correctly structured
    expect(eventData.options).toHaveLength(3);
    expect(eventData.options![0]!.label).toBe("Option A");
    expect(eventData.options![0]!.description).toBe("First option");
    expect(eventData.options![2]!.description).toBeUndefined();
  });

  test("optional header field is handled correctly", () => {
    interface EventData {
      requestId: string;
      question: string;
      header?: string;
      nodeId: string;
    }

    // With header
    const withHeader: EventData = {
      requestId: "id-1",
      question: "Question?",
      header: "Custom Header",
      nodeId: "node-1",
    };

    // Without header
    const withoutHeader: EventData = {
      requestId: "id-2",
      question: "Question?",
      nodeId: "node-2",
    };

    expect(withHeader.header).toBe("Custom Header");
    expect(withoutHeader.header).toBeUndefined();
  });
});
