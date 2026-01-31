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
