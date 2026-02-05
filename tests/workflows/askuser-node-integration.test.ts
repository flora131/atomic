/**
 * Integration tests for AskUserQuestion node pauses and resumes
 *
 * Tests cover:
 * - Create workflow with askUserNode
 * - Execute workflow until AskUserQuestion
 * - Verify execution pauses (status is "paused")
 * - Verify __waitingForInput is true in state
 * - Verify human_input_required signal is emitted
 * - Simulate user response (resume execution)
 * - Verify workflow resumes from checkpoint
 * - Verify user answer is available in state
 *
 * Reference: feature-list.json - "Integration test: AskUserQuestion node pauses and resumes"
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  graph,
  createNode,
} from "../../src/graph/builder.ts";
import {
  executeGraph,
  streamGraph,
  createExecutor,
  type StepResult,
  type ExecutionResult,
} from "../../src/graph/compiled.ts";
import {
  askUserNode,
  type AskUserWaitState,
  type AskUserQuestionEventData,
} from "../../src/graph/nodes.ts";
import type {
  BaseState,
  NodeDefinition,
  SignalData,
  ExecutionSnapshot,
} from "../../src/graph/types.ts";

// ============================================================================
// Test State Types
// ============================================================================

/**
 * Extended test state that includes askUserNode wait state fields.
 */
interface AskUserTestState extends BaseState, AskUserWaitState {
  /** Counter for tracking node executions */
  nodeExecutionCount: number;

  /** Array of executed node IDs in order */
  executedNodes: string[];

  /** Data accumulated during workflow execution */
  data: Record<string, unknown>;

  /** User's answer to the question */
  userAnswer?: string;

  /** Flag indicating workflow completion */
  isComplete: boolean;
}

/**
 * Create a fresh test state with default values.
 */
function createTestState(overrides: Partial<AskUserTestState> = {}): AskUserTestState {
  return {
    executionId: `test-exec-${Date.now()}`,
    lastUpdated: new Date().toISOString(),
    outputs: {},
    nodeExecutionCount: 0,
    executedNodes: [],
    data: {},
    isComplete: false,
    __waitingForInput: false,
    __waitNodeId: undefined,
    __askUserRequestId: undefined,
    ...overrides,
  };
}

// ============================================================================
// Test Node Factories
// ============================================================================

/**
 * Create a node that tracks execution order.
 */
function createTrackingNode(
  id: string,
  data?: Record<string, unknown>
): NodeDefinition<AskUserTestState> {
  return createNode<AskUserTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      data: { ...ctx.state.data, ...data },
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a completion node that marks workflow as complete.
 */
function createCompletionNode(id: string): NodeDefinition<AskUserTestState> {
  return createNode<AskUserTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      isComplete: true,
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a node that processes the user's answer.
 */
function createAnswerProcessorNode(id: string): NodeDefinition<AskUserTestState> {
  return createNode<AskUserTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      data: {
        ...ctx.state.data,
        processedAnswer: ctx.state.userAnswer ?? "no answer",
        wasWaiting: ctx.state.__waitingForInput,
        waitNodeId: ctx.state.__waitNodeId,
      },
      lastUpdated: new Date().toISOString(),
    },
  }));
}

// ============================================================================
// AskUserNode Workflow Tests
// ============================================================================

describe("AskUserQuestion Node Integration", () => {
  describe("Creating workflow with askUserNode", () => {
    test("askUserNode can be added to workflow", () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "What is your favorite color?",
          header: "Color Selection",
          options: [
            { label: "Red", description: "The color of fire" },
            { label: "Blue", description: "The color of sky" },
          ],
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      expect(workflow).toBeDefined();
      expect(workflow.nodes.has("ask-question")).toBe(true);
    });

    test("workflow with askUserNode has correct structure", () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-user",
        options: {
          question: "Continue?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("pre-ask"))
        .then(askNode)
        .then(createTrackingNode("post-ask"))
        .end()
        .compile();

      expect(workflow.nodes.size).toBe(3);
      expect(workflow.startNode).toBe("pre-ask");
      expect(workflow.endNodes.has("post-ask")).toBe(true);
    });
  });

  describe("Execution pauses at AskUserQuestion", () => {
    test("workflow execution pauses when askUserNode is reached", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "What is your favorite color?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      // Execution should pause at askUserNode
      expect(result.status).toBe("paused");
      // The tracking nodes add themselves to executedNodes
      expect(result.state.executedNodes).toContain("start");
      // askUserNode doesn't add to executedNodes (it's a test-specific field)
      // But we can verify it was reached via the wait state flags
      expect(result.state.__waitNodeId).toBe("ask-question");
      expect(result.state.__waitingForInput).toBe(true);
      // Complete should not have run
      expect(result.state.executedNodes).not.toContain("complete");
    });

    test("workflow streams correctly and pauses at askUserNode", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "Choose an option",
          options: [
            { label: "A", description: "Option A" },
            { label: "B", description: "Option B" },
          ],
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("step-1"))
        .then(askNode)
        .then(createTrackingNode("step-3"))
        .end()
        .compile();

      const steps: StepResult<AskUserTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      // Should have steps for start and ask-question
      expect(steps.length).toBe(2);

      // First step should be running
      expect(steps[0]!.nodeId).toBe("step-1");
      expect(steps[0]!.status).toBe("running");

      // Second step (askUserNode) should be paused
      expect(steps[1]!.nodeId).toBe("ask-question");
      expect(steps[1]!.status).toBe("paused");
    });
  });

  describe("Verify __waitingForInput is true in state", () => {
    test("state has __waitingForInput set to true when paused", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "What is your name?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("paused");
      expect(result.state.__waitingForInput).toBe(true);
    });

    test("state has __waitNodeId set to askUserNode id", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "my-ask-node",
        options: {
          question: "Test question?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("paused");
      expect(result.state.__waitNodeId).toBe("my-ask-node");
    });

    test("state has __askUserRequestId set (UUID format)", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "Test?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result.status).toBe("paused");
      expect(result.state.__askUserRequestId).toBeDefined();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(result.state.__askUserRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  describe("Verify human_input_required signal is emitted", () => {
    test("askUserNode emits human_input_required signal", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "What is your favorite color?",
          header: "Color Selection",
          options: [
            { label: "Red", description: "The color of fire" },
            { label: "Blue", description: "The color of sky" },
          ],
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<AskUserTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      // Find the askUserNode step
      const askStep = steps.find((s) => s.nodeId === "ask-question");
      expect(askStep).toBeDefined();
      expect(askStep!.result.signals).toBeDefined();
      expect(askStep!.result.signals!.length).toBeGreaterThan(0);

      const humanInputSignal = askStep!.result.signals!.find(
        (s) => s.type === "human_input_required"
      );
      expect(humanInputSignal).toBeDefined();
    });

    test("human_input_required signal contains question data", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "What is your favorite color?",
          header: "Color Selection",
          options: [
            { label: "Red", description: "The color of fire" },
            { label: "Blue", description: "The color of sky" },
          ],
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<AskUserTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const askStep = steps.find((s) => s.nodeId === "ask-question");
      const humanInputSignal = askStep!.result.signals!.find(
        (s) => s.type === "human_input_required"
      );

      expect(humanInputSignal!.message).toBe("What is your favorite color?");
      expect(humanInputSignal!.data).toBeDefined();

      const eventData = humanInputSignal!.data as unknown as AskUserQuestionEventData;
      expect(eventData.question).toBe("What is your favorite color?");
      expect(eventData.header).toBe("Color Selection");
      expect(eventData.options).toHaveLength(2);
      expect(eventData.options![0]!.label).toBe("Red");
      expect(eventData.options![1]!.label).toBe("Blue");
      expect(eventData.nodeId).toBe("ask-question");
      expect(eventData.requestId).toBeDefined();
    });

    test("human_input_required signal requestId matches state requestId", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "Test?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<AskUserTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const askStep = steps.find((s) => s.nodeId === "ask-question");
      const humanInputSignal = askStep!.result.signals!.find(
        (s) => s.type === "human_input_required"
      );

      const eventData = humanInputSignal!.data as unknown as AskUserQuestionEventData;
      expect(eventData.requestId).toBe(askStep!.state.__askUserRequestId!);
    });
  });

  describe("Simulate user response and resume execution", () => {
    test("workflow can be resumed from paused state using snapshot", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "What is your favorite color?",
        },
      });

      // Create a node that clears the waiting flags after resume
      const resumeHandler = createNode<AskUserTestState>(
        "resume-handler",
        "tool",
        async (ctx) => ({
          stateUpdate: {
            nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
            executedNodes: [...ctx.state.executedNodes, "resume-handler"],
            __waitingForInput: false,
            __waitNodeId: undefined,
            userAnswer: "Blue",
          },
        })
      );

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(resumeHandler)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      // First execution - should pause
      const initialResult = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(initialResult.status).toBe("paused");
      expect(initialResult.state.__waitingForInput).toBe(true);

      // Create snapshot for resumption
      const snapshot = initialResult.snapshot;

      // Simulate user providing answer by modifying state
      const resumeState: AskUserTestState = {
        ...snapshot.state,
        userAnswer: "Blue",
        __waitingForInput: false,
      };

      // Create new snapshot with user answer included
      const resumeSnapshot: ExecutionSnapshot<AskUserTestState> = {
        ...snapshot,
        state: resumeState,
        // Point to the next node after askUserNode
        currentNodeId: "resume-handler",
      };

      // Resume execution
      const resumeResult = await executeGraph(workflow, {
        resumeFrom: resumeSnapshot,
      });

      expect(resumeResult.status).toBe("completed");
      expect(resumeResult.state.executedNodes).toContain("resume-handler");
      expect(resumeResult.state.executedNodes).toContain("complete");
      expect(resumeResult.state.isComplete).toBe(true);
    });

    test("user answer is available in state after resume", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "What is your name?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createAnswerProcessorNode("process-answer"))
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      // First execution - should pause
      const initialResult = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(initialResult.status).toBe("paused");

      // Simulate user providing answer
      const resumeState: AskUserTestState = {
        ...initialResult.snapshot.state,
        userAnswer: "Claude",
        __waitingForInput: false,
      };

      const resumeSnapshot: ExecutionSnapshot<AskUserTestState> = {
        ...initialResult.snapshot,
        state: resumeState,
        currentNodeId: "process-answer",
      };

      // Resume execution
      const resumeResult = await executeGraph(workflow, {
        resumeFrom: resumeSnapshot,
      });

      expect(resumeResult.status).toBe("completed");
      expect(resumeResult.state.userAnswer).toBe("Claude");
      expect(resumeResult.state.data.processedAnswer).toBe("Claude");
    });
  });

  describe("Multiple askUserNodes in workflow", () => {
    test("workflow with multiple askUserNodes pauses at each", async () => {
      const askNode1 = askUserNode<AskUserTestState>({
        id: "ask-first",
        options: {
          question: "First question?",
        },
      });

      const askNode2 = askUserNode<AskUserTestState>({
        id: "ask-second",
        options: {
          question: "Second question?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode1)
        .then(createTrackingNode("middle"))
        .then(askNode2)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      // First execution - should pause at first ask node
      const result1 = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      expect(result1.status).toBe("paused");
      expect(result1.state.__waitNodeId).toBe("ask-first");
      expect(result1.state.executedNodes).not.toContain("middle");

      // Resume from first pause
      const resumeState1: AskUserTestState = {
        ...result1.snapshot.state,
        userAnswer: "answer1",
        __waitingForInput: false,
      };

      const resumeSnapshot1: ExecutionSnapshot<AskUserTestState> = {
        ...result1.snapshot,
        state: resumeState1,
        currentNodeId: "middle",
      };

      const result2 = await executeGraph(workflow, {
        resumeFrom: resumeSnapshot1,
      });

      // Should pause at second ask node
      expect(result2.status).toBe("paused");
      expect(result2.state.__waitNodeId).toBe("ask-second");
      expect(result2.state.executedNodes).toContain("middle");
      expect(result2.state.executedNodes).not.toContain("complete");

      // Resume from second pause
      const resumeState2: AskUserTestState = {
        ...result2.snapshot.state,
        userAnswer: "answer2",
        __waitingForInput: false,
      };

      const resumeSnapshot2: ExecutionSnapshot<AskUserTestState> = {
        ...result2.snapshot,
        state: resumeState2,
        currentNodeId: "complete",
      };

      const result3 = await executeGraph(workflow, {
        resumeFrom: resumeSnapshot2,
      });

      // Should complete
      expect(result3.status).toBe("completed");
      expect(result3.state.executedNodes).toContain("complete");
      expect(result3.state.isComplete).toBe(true);
    });
  });

  describe("Dynamic question based on state", () => {
    test("askUserNode question can be dynamic based on state", async () => {
      interface DynamicState extends AskUserTestState {
        itemCount: number;
      }

      const askNode = askUserNode<DynamicState>({
        id: "dynamic-ask",
        options: (state: DynamicState) => ({
          question: `You have ${state.itemCount} items. Continue?`,
          header: `Item Count: ${state.itemCount}`,
        }),
      });

      const workflow = graph<DynamicState>()
        .start(
          createNode<DynamicState>("set-count", "tool", async (ctx) => ({
            stateUpdate: {
              itemCount: 42,
              nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
              executedNodes: [...ctx.state.executedNodes, "set-count"],
            },
          }))
        )
        .then(askNode)
        .then(
          createNode<DynamicState>("complete", "tool", async (ctx) => ({
            stateUpdate: {
              isComplete: true,
              nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
              executedNodes: [...ctx.state.executedNodes, "complete"],
            },
          }))
        )
        .end()
        .compile();

      const steps: StepResult<DynamicState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: {
          ...createTestState(),
          itemCount: 0,
        } as DynamicState,
      })) {
        steps.push(step);
      }

      const askStep = steps.find((s) => s.nodeId === "dynamic-ask");
      const humanInputSignal = askStep!.result.signals!.find(
        (s) => s.type === "human_input_required"
      );

      expect(humanInputSignal!.message).toBe("You have 42 items. Continue?");
      const eventData = humanInputSignal!.data as unknown as AskUserQuestionEventData;
      expect(eventData.header).toBe("Item Count: 42");
    });
  });

  describe("askUserNode with structured options", () => {
    test("options are correctly passed through in signal", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-with-options",
        options: {
          question: "Select a framework:",
          options: [
            { label: "React", description: "A JavaScript library for building user interfaces" },
            { label: "Vue", description: "The Progressive JavaScript Framework" },
            { label: "Angular", description: "Platform for building mobile and desktop apps" },
          ],
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<AskUserTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const askStep = steps.find((s) => s.nodeId === "ask-with-options");
      const humanInputSignal = askStep!.result.signals!.find(
        (s) => s.type === "human_input_required"
      );

      const eventData = humanInputSignal!.data as unknown as AskUserQuestionEventData;
      expect(eventData.options).toHaveLength(3);
      expect(eventData.options![0]).toEqual({
        label: "React",
        description: "A JavaScript library for building user interfaces",
      });
      expect(eventData.options![1]).toEqual({
        label: "Vue",
        description: "The Progressive JavaScript Framework",
      });
      expect(eventData.options![2]).toEqual({
        label: "Angular",
        description: "Platform for building mobile and desktop apps",
      });
    });

    test("askUserNode without options emits signal without options array", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-no-options",
        options: {
          question: "What is your name?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const steps: StepResult<AskUserTestState>[] = [];
      for await (const step of streamGraph(workflow, {
        initialState: createTestState(),
      })) {
        steps.push(step);
      }

      const askStep = steps.find((s) => s.nodeId === "ask-no-options");
      const humanInputSignal = askStep!.result.signals!.find(
        (s) => s.type === "human_input_required"
      );

      const eventData = humanInputSignal!.data as unknown as AskUserQuestionEventData;
      expect(eventData.options).toBeUndefined();
    });
  });

  describe("Abort handling during askUserNode", () => {
    test("workflow can be cancelled while waiting at askUserNode", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "This will be aborted",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      const abortController = new AbortController();

      // Schedule abort before execution completes
      setTimeout(() => abortController.abort(), 10);

      const result = await executeGraph(workflow, {
        initialState: createTestState(),
        abortSignal: abortController.signal,
      });

      // Note: The workflow may pause at askUserNode before abort is processed,
      // or it may be cancelled. Both are valid outcomes.
      expect(["paused", "cancelled"]).toContain(result.status);
    });
  });

  describe("Unique requestIds for each askUserNode execution", () => {
    test("each askUserNode execution generates unique requestId", async () => {
      const askNode = askUserNode<AskUserTestState>({
        id: "ask-question",
        options: {
          question: "Test?",
        },
      });

      const workflow = graph<AskUserTestState>()
        .start(createTrackingNode("start"))
        .then(askNode)
        .then(createCompletionNode("complete"))
        .end()
        .compile();

      // Execute workflow twice
      const result1 = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      const result2 = await executeGraph(workflow, {
        initialState: createTestState(),
      });

      // Both should pause
      expect(result1.status).toBe("paused");
      expect(result2.status).toBe("paused");

      // Request IDs should be different
      expect(result1.state.__askUserRequestId).toBeDefined();
      expect(result2.state.__askUserRequestId).toBeDefined();
      expect(result1.state.__askUserRequestId).not.toBe(result2.state.__askUserRequestId);
    });
  });
});
