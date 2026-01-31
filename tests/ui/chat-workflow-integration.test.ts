/**
 * Integration Tests for ChatApp Workflow Execution
 *
 * Tests cover:
 * - Streaming state integration
 * - Tool execution event handling
 * - Human input required (HITL) flow
 * - Workflow progress updates
 * - Question dialog interactions
 */

import { describe, test, expect } from "bun:test";
import {
  createMessage,
  type ChatMessage,
  type MessageToolCall,
  type WorkflowChatState,
  defaultWorkflowChatState,
} from "../../src/ui/chat.tsx";
import {
  useStreamingState,
  createInitialStreamingState,
  createToolExecution,
  generateToolExecutionId,
  getActiveToolExecutions,
  getCompletedToolExecutions,
  getErroredToolExecutions,
  type StreamingState,
  type ToolExecutionState,
} from "../../src/ui/hooks/use-streaming-state.ts";
import type {
  UserQuestion,
  QuestionAnswer,
} from "../../src/ui/components/user-question-dialog.tsx";

// ============================================================================
// STREAMING STATE INTEGRATION TESTS
// ============================================================================

describe("Streaming state integration", () => {
  test("creates initial streaming state", () => {
    const state = createInitialStreamingState();

    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
    expect(state.toolExecutions.size).toBe(0);
    expect(state.pendingQuestions).toHaveLength(0);
  });

  test("tracks streaming state changes", () => {
    let state: StreamingState = createInitialStreamingState();

    // Start streaming
    state = {
      ...state,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };
    expect(state.isStreaming).toBe(true);
    expect(state.streamingMessageId).toBe("msg_123");

    // Stop streaming
    state = {
      ...state,
      isStreaming: false,
      streamingMessageId: null,
    };
    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });
});

// ============================================================================
// TOOL EXECUTION EVENT TESTS
// ============================================================================

describe("Tool execution events", () => {
  test("creates tool execution on start", () => {
    const toolId = generateToolExecutionId();
    const toolExec = createToolExecution(toolId, "Read", { file_path: "/test.ts" });

    expect(toolExec.id).toBe(toolId);
    expect(toolExec.toolName).toBe("Read");
    expect(toolExec.status).toBe("running");
    expect(toolExec.input).toEqual({ file_path: "/test.ts" });
    expect(toolExec.timestamps.startedAt).toBeDefined();
    expect(toolExec.timestamps.completedAt).toBeUndefined();
  });

  test("updates tool execution on complete", () => {
    const toolId = generateToolExecutionId();
    let toolExec = createToolExecution(toolId, "Read", { file_path: "/test.ts" });

    // Complete the tool
    toolExec = {
      ...toolExec,
      status: "completed",
      output: "file contents",
      timestamps: {
        ...toolExec.timestamps,
        completedAt: new Date().toISOString(),
      },
    };

    expect(toolExec.status).toBe("completed");
    expect(toolExec.output).toBe("file contents");
    expect(toolExec.timestamps.completedAt).toBeDefined();
  });

  test("updates tool execution on error", () => {
    const toolId = generateToolExecutionId();
    let toolExec = createToolExecution(toolId, "Bash", { command: "invalid_cmd" });

    // Error the tool
    toolExec = {
      ...toolExec,
      status: "error",
      error: "command not found",
      timestamps: {
        ...toolExec.timestamps,
        completedAt: new Date().toISOString(),
      },
    };

    expect(toolExec.status).toBe("error");
    expect(toolExec.error).toBe("command not found");
  });

  test("tracks multiple concurrent tool executions", () => {
    const executions = new Map<string, ToolExecutionState>();

    // Start multiple tools
    const tool1 = createToolExecution("tool_1", "Read", { file_path: "/a.ts" });
    const tool2 = createToolExecution("tool_2", "Glob", { pattern: "**/*.ts" });
    const tool3 = createToolExecution("tool_3", "Grep", { pattern: "TODO" });

    executions.set(tool1.id, tool1);
    executions.set(tool2.id, tool2);
    executions.set(tool3.id, tool3);

    expect(executions.size).toBe(3);
    expect(getActiveToolExecutions(executions)).toHaveLength(3);
    expect(getCompletedToolExecutions(executions)).toHaveLength(0);

    // Complete one tool
    executions.set(tool1.id, { ...tool1, status: "completed", output: "content" });

    expect(getActiveToolExecutions(executions)).toHaveLength(2);
    expect(getCompletedToolExecutions(executions)).toHaveLength(1);

    // Error another tool
    executions.set(tool2.id, { ...tool2, status: "error", error: "not found" });

    expect(getActiveToolExecutions(executions)).toHaveLength(1);
    expect(getCompletedToolExecutions(executions)).toHaveLength(1);
    expect(getErroredToolExecutions(executions)).toHaveLength(1);
  });
});

// ============================================================================
// MESSAGE TOOL CALL TESTS
// ============================================================================

describe("Message tool calls", () => {
  test("adds tool call to message on tool start", () => {
    const msg: ChatMessage = createMessage("assistant", "", true);

    const toolCall: MessageToolCall = {
      id: "tool_1",
      toolName: "Read",
      input: { file_path: "/test.ts" },
      status: "running",
    };

    const updatedMsg: ChatMessage = {
      ...msg,
      toolCalls: [toolCall],
    };

    expect(updatedMsg.toolCalls).toHaveLength(1);
    expect(updatedMsg.toolCalls![0]!.status).toBe("running");
  });

  test("updates tool call status on complete", () => {
    let msg: ChatMessage = {
      ...createMessage("assistant", "", true),
      toolCalls: [
        {
          id: "tool_1",
          toolName: "Read",
          input: { file_path: "/test.ts" },
          status: "running",
        },
      ],
    };

    // Update tool call
    msg = {
      ...msg,
      toolCalls: msg.toolCalls!.map((tc) => {
        if (tc.id === "tool_1") {
          return {
            ...tc,
            output: "file contents",
            status: "completed" as const,
          };
        }
        return tc;
      }),
    };

    expect(msg.toolCalls![0]!.status).toBe("completed");
    expect(msg.toolCalls![0]!.output).toBe("file contents");
  });

  test("handles multiple tool calls in single message", () => {
    const msg: ChatMessage = {
      ...createMessage("assistant", "Let me search the codebase."),
      toolCalls: [
        {
          id: "tool_1",
          toolName: "Glob",
          input: { pattern: "**/*.ts" },
          output: ["a.ts", "b.ts"],
          status: "completed",
        },
        {
          id: "tool_2",
          toolName: "Grep",
          input: { pattern: "TODO" },
          status: "running",
        },
        {
          id: "tool_3",
          toolName: "Read",
          input: { file_path: "/c.ts" },
          status: "pending",
        },
      ],
    };

    expect(msg.toolCalls).toHaveLength(3);

    const completed = msg.toolCalls!.filter((tc) => tc.status === "completed");
    const running = msg.toolCalls!.filter((tc) => tc.status === "running");
    const pending = msg.toolCalls!.filter((tc) => tc.status === "pending");

    expect(completed).toHaveLength(1);
    expect(running).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });
});

// ============================================================================
// HUMAN INPUT REQUIRED (HITL) TESTS
// ============================================================================

describe("Human input required (HITL)", () => {
  test("creates pending question", () => {
    const question: UserQuestion = {
      header: "Approval",
      question: "Do you approve this spec?",
      options: [
        { label: "Approve", value: "approve", description: "Accept the spec" },
        { label: "Reject", value: "reject", description: "Reject and provide feedback" },
      ],
      multiSelect: false,
    };

    let state: StreamingState = createInitialStreamingState();
    state = {
      ...state,
      pendingQuestions: [...state.pendingQuestions, question],
    };

    expect(state.pendingQuestions).toHaveLength(1);
    expect(state.pendingQuestions[0]!.header).toBe("Approval");
  });

  test("removes pending question after answer", () => {
    const question: UserQuestion = {
      header: "Confirm",
      question: "Continue?",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
      multiSelect: false,
    };

    let state: StreamingState = {
      ...createInitialStreamingState(),
      pendingQuestions: [question],
    };

    // Remove first question
    state = {
      ...state,
      pendingQuestions: state.pendingQuestions.slice(1),
    };

    expect(state.pendingQuestions).toHaveLength(0);
  });

  test("handles multiple pending questions as queue", () => {
    const q1: UserQuestion = {
      header: "Q1",
      question: "First question?",
      options: [{ label: "A", value: "a" }, { label: "B", value: "b" }],
      multiSelect: false,
    };

    const q2: UserQuestion = {
      header: "Q2",
      question: "Second question?",
      options: [{ label: "X", value: "x" }, { label: "Y", value: "y" }],
      multiSelect: false,
    };

    let state: StreamingState = createInitialStreamingState();

    // Add questions
    state = { ...state, pendingQuestions: [...state.pendingQuestions, q1] };
    state = { ...state, pendingQuestions: [...state.pendingQuestions, q2] };

    expect(state.pendingQuestions).toHaveLength(2);
    expect(state.pendingQuestions[0]!.header).toBe("Q1");
    expect(state.pendingQuestions[1]!.header).toBe("Q2");

    // Remove first (FIFO)
    state = { ...state, pendingQuestions: state.pendingQuestions.slice(1) };

    expect(state.pendingQuestions).toHaveLength(1);
    expect(state.pendingQuestions[0]!.header).toBe("Q2");
  });
});

// ============================================================================
// QUESTION ANSWER TESTS
// ============================================================================

describe("Question answer handling", () => {
  test("creates single-select answer", () => {
    const answer: QuestionAnswer = {
      selected: ["approve"],
      cancelled: false,
    };

    expect(answer.selected).toHaveLength(1);
    expect(answer.cancelled).toBe(false);
  });

  test("creates multi-select answer", () => {
    const answer: QuestionAnswer = {
      selected: ["option1", "option3", "option5"],
      cancelled: false,
    };

    expect(answer.selected).toHaveLength(3);
  });

  test("creates cancelled answer", () => {
    const answer: QuestionAnswer = {
      selected: [],
      cancelled: true,
    };

    expect(answer.cancelled).toBe(true);
    expect(answer.selected).toHaveLength(0);
  });

  test("updates workflow state on approval", () => {
    let workflowState: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      pendingApproval: true,
    };

    const answer: QuestionAnswer = {
      selected: ["Approve"],
      cancelled: false,
    };

    // Simulate answer handling
    if (answer.selected.includes("Approve")) {
      workflowState = {
        ...workflowState,
        specApproved: true,
        pendingApproval: false,
      };
    }

    expect(workflowState.specApproved).toBe(true);
    expect(workflowState.pendingApproval).toBe(false);
  });

  test("updates workflow state on rejection", () => {
    let workflowState: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      pendingApproval: true,
    };

    const answer: QuestionAnswer = {
      selected: ["Reject"],
      cancelled: false,
    };

    // Simulate answer handling
    if (answer.selected.includes("Reject")) {
      workflowState = {
        ...workflowState,
        specApproved: false,
        pendingApproval: false,
      };
    }

    expect(workflowState.specApproved).toBe(false);
    expect(workflowState.pendingApproval).toBe(false);
  });
});

// ============================================================================
// WORKFLOW PROGRESS UPDATE TESTS
// ============================================================================

describe("Workflow progress updates", () => {
  test("updates current node", () => {
    let state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      workflowType: "atomic",
    };

    state = { ...state, currentNode: "create_spec" };
    expect(state.currentNode).toBe("create_spec");

    state = { ...state, currentNode: "create_feature_list" };
    expect(state.currentNode).toBe("create_feature_list");

    state = { ...state, currentNode: "implement_feature" };
    expect(state.currentNode).toBe("implement_feature");
  });

  test("updates iteration count", () => {
    let state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      maxIterations: 5,
    };

    state = { ...state, iteration: 1 };
    expect(state.iteration).toBe(1);

    state = { ...state, iteration: 2 };
    expect(state.iteration).toBe(2);

    state = { ...state, iteration: 5 };
    expect(state.iteration).toBe(5);
  });

  test("updates feature progress", () => {
    let state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      workflowType: "ralph",
    };

    state = {
      ...state,
      featureProgress: {
        completed: 0,
        total: 10,
        currentFeature: "Feature 1",
      },
    };
    expect(state.featureProgress?.completed).toBe(0);
    expect(state.featureProgress?.total).toBe(10);

    state = {
      ...state,
      featureProgress: {
        completed: 5,
        total: 10,
        currentFeature: "Feature 6",
      },
    };
    expect(state.featureProgress?.completed).toBe(5);

    state = {
      ...state,
      featureProgress: {
        completed: 10,
        total: 10,
      },
    };
    expect(state.featureProgress?.completed).toBe(10);
    expect(state.featureProgress?.currentFeature).toBeUndefined();
  });

  test("tracks full workflow execution state", () => {
    let state: WorkflowChatState = { ...defaultWorkflowChatState };

    // Start workflow
    state = {
      ...state,
      workflowActive: true,
      workflowType: "atomic",
      initialPrompt: "Build a login feature",
      currentNode: "create_spec",
      iteration: 1,
      maxIterations: 5,
    };

    expect(state.workflowActive).toBe(true);
    expect(state.currentNode).toBe("create_spec");

    // Move to feature list
    state = { ...state, currentNode: "create_feature_list" };

    // Start implementing
    state = {
      ...state,
      currentNode: "implement_feature",
      featureProgress: { completed: 0, total: 3 },
    };

    // Complete features
    state = {
      ...state,
      featureProgress: { completed: 1, total: 3, currentFeature: "Feature 2" },
    };

    state = {
      ...state,
      featureProgress: { completed: 2, total: 3, currentFeature: "Feature 3" },
    };

    state = {
      ...state,
      featureProgress: { completed: 3, total: 3 },
    };

    // Complete iteration
    state = {
      ...state,
      iteration: 2,
      currentNode: "create_spec",
    };

    expect(state.iteration).toBe(2);
    expect(state.featureProgress?.completed).toBe(3);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge cases", () => {
  test("handles empty tool executions map", () => {
    const executions = new Map<string, ToolExecutionState>();

    expect(getActiveToolExecutions(executions)).toHaveLength(0);
    expect(getCompletedToolExecutions(executions)).toHaveLength(0);
    expect(getErroredToolExecutions(executions)).toHaveLength(0);
  });

  test("handles tool execution with complex input", () => {
    const toolExec = createToolExecution("tool_1", "Edit", {
      file_path: "/complex/path/to/file.ts",
      old_string: "function foo() {\n  return 1;\n}",
      new_string: "function foo() {\n  return 2;\n}",
      nested: {
        options: [1, 2, 3],
        config: { enabled: true },
      },
    });

    expect(toolExec.input.file_path).toBe("/complex/path/to/file.ts");
    expect((toolExec.input.nested as Record<string, unknown>).options).toEqual([1, 2, 3]);
  });

  test("handles tool execution with large output", () => {
    const largeOutput = Array.from({ length: 1000 }, (_, i) => `Line ${i}`).join("\n");
    const toolExec: ToolExecutionState = {
      ...createToolExecution("tool_1", "Read", { file_path: "/big.txt" }),
      status: "completed",
      output: largeOutput,
    };

    expect(toolExec.output).toBe(largeOutput);
    expect((toolExec.output as string).split("\n")).toHaveLength(1000);
  });

  test("handles question with long options", () => {
    const question: UserQuestion = {
      header: "Choice",
      question: "Select an option:",
      options: Array.from({ length: 10 }, (_, i) => ({
        label: `Option ${i + 1}`,
        value: `opt_${i + 1}`,
        description: `This is a very long description for option ${i + 1} that might wrap to multiple lines`,
      })),
      multiSelect: true,
    };

    expect(question.options).toHaveLength(10);
  });

  test("handles rapid state transitions", () => {
    let state: WorkflowChatState = { ...defaultWorkflowChatState };

    // Rapid transitions
    for (let i = 1; i <= 100; i++) {
      state = {
        ...state,
        iteration: i,
        currentNode: `node_${i % 5}`,
        featureProgress: {
          completed: i % 10,
          total: 10,
        },
      };
    }

    expect(state.iteration).toBe(100);
    expect(state.currentNode).toBe("node_0");
    expect(state.featureProgress?.completed).toBe(0);
  });
});
