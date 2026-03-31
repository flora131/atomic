/**
 * Tests for task update event flow — verifies that `executeConductorWorkflow`
 * correctly publishes `workflow.task.update` events to the EventBus when
 * the conductor's `onTaskUpdate` callback fires.
 *
 * This validates the §5.6 spec path:
 *   conductor.onTaskUpdate() → bus.publish(workflow.task.update) → stream-workflow-task.ts handler
 *
 * Also verifies:
 * - Task persistence callback (`saveTasksToSession`) is invoked
 * - `context.updateTaskList` receives formatted tasks
 * - No crash when eventBus is absent
 * - `workflow.task.update` event has correct payload shape
 *
 * Strategy: Use stages with `parseOutput` returning a task array to trigger
 * `onTaskUpdate`. Same mock approach as conductor-executor-wiring.test.ts.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StageDefinition, StageContext } from "@/services/workflows/conductor/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/index.ts";
import type { CommandContext } from "@/types/command.ts";
import type { BusEvent } from "@/services/events/bus-events/types.ts";
import type { BusEventDataMap } from "@/services/events/bus-events/types.ts";
import type { Session, AgentMessage } from "@/services/agents/types.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import { EventBus } from "@/services/events/event-bus.ts";

// ---------------------------------------------------------------------------
// Module mocks — same isolation as conductor-executor-wiring.test.ts
// ---------------------------------------------------------------------------

const MOCK_SESSION_ID = "task-flow-session-1";
const MOCK_SESSION_DIR = mkdtempSync(join(tmpdir(), "conductor-task-event-flow-test-"));
const MOCK_RUN_ID = 7;

process.on("exit", () => {
  try { rmSync(MOCK_SESSION_DIR, { recursive: true, force: true }); } catch {}
});

mock.module("@/services/workflows/runtime/executor/session-runtime.ts", () => ({
  initializeWorkflowExecutionSession: mock(() => ({
    sessionDir: MOCK_SESSION_DIR,
    sessionId: MOCK_SESSION_ID,
    workflowRunId: MOCK_RUN_ID,
  })),
}));

mock.module("@/services/events/pipeline-logger.ts", () => ({
  isPipelineDebug: mock(() => false),
  resetPipelineDebugCache: mock(() => {}),
  pipelineLog: mock(() => {}),
  pipelineError: mock(() => {}),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

const { executeConductorWorkflow } = await import(
  "@/services/workflows/runtime/executor/conductor-executor.ts"
);

// ---------------------------------------------------------------------------
// Sample task data (returned by parseOutput to trigger onTaskUpdate)
// ---------------------------------------------------------------------------

const SAMPLE_TASKS = [
  { id: "#1", description: "Implement feature A", status: "pending", summary: "Feature A" },
  { id: "#2", description: "Fix bug B", status: "in-progress", summary: "Bug B", blockedBy: ["#1"] },
  { id: "#3", description: "Write tests", status: "complete", summary: "Tests" },
];

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockSession(response: string, id = "session-1"): Session {
  return {
    id,
    send: mock(async () => ({ type: "text" as const, content: response })),
    stream: async function* (
      _message: string,
      _options?: { agent?: string; abortSignal?: AbortSignal },
    ) {
      yield { type: "text" as const, content: response } as AgentMessage;
    },
    summarize: mock(async () => {}),
    getContextUsage: mock(async () => ({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 100000,
      usagePercentage: 0.15,
    })),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {}),
  };
}

/**
 * Create a stage that returns task data from parseOutput, triggering onTaskUpdate.
 */
function createTaskProducingStage(
  id: string,
  tasks: unknown[] = SAMPLE_TASKS,
  overrides?: Partial<StageDefinition>,
): StageDefinition {
  return {
    id,
    indicator: `[${id.toUpperCase()}]`,
    buildPrompt: (_ctx: StageContext) => `Prompt for ${id}`,
    parseOutput: (_response: string) => ({ tasks }),
    ...overrides,
  };
}

function createStage(id: string, overrides?: Partial<StageDefinition>): StageDefinition {
  return {
    id,
    indicator: `[${id.toUpperCase()}]`,
    buildPrompt: (_ctx: StageContext) => `Prompt for ${id}`,
    ...overrides,
  };
}

function createDefinition(
  overrides?: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  const stages = overrides?.conductorStages ?? [createTaskProducingStage("planner")];
  return {
    name: "test-workflow",
    description: "A test workflow",
    conductorStages: stages,
    createConductorGraph: () => ({
      nodes: new Map(
        stages.map((s) => [
          s.id,
          { id: s.id, type: "agent" as const, execute: async () => ({}) },
        ]),
      ),
      edges:
        stages.length > 1
          ? stages.slice(0, -1).map((s, i) => ({
              from: s.id,
              to: stages[i + 1]!.id,
            }))
          : [],
      startNode: stages[0]!.id,
      endNodes: new Set([stages[stages.length - 1]!.id]),
      config: {},
    }),
    ...overrides,
  };
}

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  const mockSession = createMockSession("stage response");
  return {
    session: null,
    state: { isStreaming: false, messageCount: 0 } as CommandContext["state"],
    addMessage: mock(() => {}),
    setStreaming: mock(() => {}),
    sendMessage: mock(() => {}),
    sendSilentMessage: mock(() => {}),
    spawnSubagent: mock(async () => ({ success: true, output: "" })) as any,
    streamAndWait: mock(async () => ({ success: true, content: "" })) as any,
    clearContext: mock(async () => {}),
    setTodoItems: mock(() => {}),
    setWorkflowSessionDir: mock(() => {}),
    setWorkflowSessionId: mock(() => {}),
    setWorkflowTaskIds: mock(() => {}),
    waitForUserInput: mock(async () => ""),
    updateWorkflowState: mock(() => {}),
    updateTaskList: mock(() => {}),
    createAgentSession: mock(async () => mockSession) as any,
    ...overrides,
  } as unknown as CommandContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("task update event flow (§5.6)", () => {
  // -----------------------------------------------------------------------
  // 1. workflow.task.update bus event emission
  // -----------------------------------------------------------------------

  describe("workflow.task.update bus event emission", () => {
    test("publishes workflow.task.update to EventBus when stage parseOutput returns tasks", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvents = receivedEvents.filter(
        (e) => e.type === "workflow.task.update",
      );
      expect(taskEvents).toHaveLength(1);
    });

    test("workflow.task.update event carries correct sessionId and runId", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvent = receivedEvents.find(
        (e) => e.type === "workflow.task.update",
      )!;
      expect(taskEvent).toBeDefined();
      expect(taskEvent.sessionId).toBe(MOCK_SESSION_ID);
      expect(taskEvent.runId).toBe(MOCK_RUN_ID);
    });

    test("workflow.task.update event data contains all tasks from parseOutput", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvent = receivedEvents.find(
        (e) => e.type === "workflow.task.update",
      )!;
      const data = taskEvent.data as BusEventDataMap["workflow.task.update"];
      expect(data.tasks).toHaveLength(3);
      expect(data.tasks[0]!.description).toBe("Implement feature A");
      expect(data.tasks[1]!.description).toBe("Fix bug B");
      expect(data.tasks[2]!.description).toBe("Write tests");
    });

    test("workflow.task.update event preserves task IDs", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvent = receivedEvents.find(
        (e) => e.type === "workflow.task.update",
      )!;
      const data = taskEvent.data as BusEventDataMap["workflow.task.update"];
      const ids = data.tasks.map((t) => t.id);
      expect(ids).toEqual(["#1", "#2", "#3"]);
    });

    test("workflow.task.update event preserves blockedBy arrays", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvent = receivedEvents.find(
        (e) => e.type === "workflow.task.update",
      )!;
      const data = taskEvent.data as BusEventDataMap["workflow.task.update"];
      expect(data.tasks[1]!.blockedBy).toEqual(["#1"]);
      // Task without blockedBy should not have the property
      expect(data.tasks[0]!.blockedBy).toBeUndefined();
    });

    test("workflow.task.update event preserves status values", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvent = receivedEvents.find(
        (e) => e.type === "workflow.task.update",
      )!;
      const data = taskEvent.data as BusEventDataMap["workflow.task.update"];
      expect(data.tasks[0]!.status).toBe("pending");
      expect(data.tasks[1]!.status).toBe("in-progress");
      expect(data.tasks[2]!.status).toBe("complete");
    });

    test("no workflow.task.update event when stage has no parseOutput", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      // Stage without parseOutput — no task update
      const stages = [createStage("planner")];
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvents = receivedEvents.filter(
        (e) => e.type === "workflow.task.update",
      );
      expect(taskEvents).toHaveLength(0);
    });

    test("no workflow.task.update event when parseOutput returns non-task data", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      // parseOutput returns a string, not a task array
      const stages = [
        createTaskProducingStage("planner", undefined, {
          parseOutput: () => ({ value: "not a task array" }),
        }),
      ];
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "plan tasks", context);

      const taskEvents = receivedEvents.filter(
        (e) => e.type === "workflow.task.update",
      );
      expect(taskEvents).toHaveLength(0);
    });

    test("no crash when eventBus is absent and tasks are parsed", async () => {
      const context = createMockContext({ eventBus: undefined });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "plan tasks", context);

      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Task persistence callback (saveTasksToSession)
  // -----------------------------------------------------------------------

  describe("task persistence callback", () => {
    test("calls saveTasksToSession with normalized tasks and sessionId", async () => {
      const saveTasksToSession = mock(async (_tasks: unknown, _sid: unknown) => {});
      const context = createMockContext();
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context, {
        saveTasksToSession: saveTasksToSession as any,
      });

      expect(saveTasksToSession).toHaveBeenCalledTimes(1);
      const [tasks, sid] = saveTasksToSession.mock.calls[0]!;
      expect(sid).toBe(MOCK_SESSION_ID);
      const normalizedTasks = tasks as NormalizedTodoItem[];
      expect(normalizedTasks).toHaveLength(3);
      expect(normalizedTasks[0]!.id).toBe("#1");
      expect(normalizedTasks[0]!.description).toBe("Implement feature A");
    });

    test("does not call saveTasksToSession when callback is not provided", async () => {
      const context = createMockContext();
      const definition = createDefinition();

      // No saveTasksToSession in options — should not crash
      const result = await executeConductorWorkflow(definition, "plan tasks", context);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Session tracking on task update
  // -----------------------------------------------------------------------

  describe("session tracking on task update", () => {
    test("sets workflow session dir and ID on task update", async () => {
      const setWorkflowSessionDir = mock(() => {});
      const setWorkflowSessionId = mock(() => {});
      const setWorkflowTaskIds = mock(() => {});
      const context = createMockContext({
        setWorkflowSessionDir,
        setWorkflowSessionId,
        setWorkflowTaskIds,
      });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      expect(setWorkflowSessionDir).toHaveBeenCalledWith(MOCK_SESSION_DIR);
      expect(setWorkflowSessionId).toHaveBeenCalledWith(MOCK_SESSION_ID);
    });

    test("sets workflow task IDs from parsed tasks", async () => {
      const setWorkflowTaskIds = mock((_ids: unknown) => {});
      const context = createMockContext({ setWorkflowTaskIds: setWorkflowTaskIds as any });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "plan tasks", context);

      expect(setWorkflowTaskIds).toHaveBeenCalled();
      const taskIds = setWorkflowTaskIds.mock.calls[0]![0] as Set<string>;
      expect(taskIds).toBeInstanceOf(Set);
      expect(taskIds.has("#1")).toBe(true);
      expect(taskIds.has("#2")).toBe(true);
      expect(taskIds.has("#3")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Multi-stage task updates
  // -----------------------------------------------------------------------

  describe("multi-stage task updates", () => {
    test("emits workflow.task.update for each stage that produces tasks", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const plannerTasks = [
        { id: "#1", description: "Task from planner", status: "pending", summary: "Planner task" },
      ];
      const reviewerTasks = [
        { id: "#1", description: "Task from planner", status: "complete", summary: "Planner task" },
        { id: "#2", description: "Task from reviewer", status: "pending", summary: "Reviewer task" },
      ];

      const stages = [
        createTaskProducingStage("planner", plannerTasks),
        createTaskProducingStage("reviewer", reviewerTasks),
      ];
      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "plan and review", context);

      const taskEvents = receivedEvents.filter(
        (e) => e.type === "workflow.task.update",
      );
      expect(taskEvents).toHaveLength(2);

      // First event from planner
      const plannerData = taskEvents[0]!.data as BusEventDataMap["workflow.task.update"];
      expect(plannerData.tasks).toHaveLength(1);

      // Second event from reviewer — conductor replaces entire task list
      const reviewerData = taskEvents[1]!.data as BusEventDataMap["workflow.task.update"];
      expect(reviewerData.tasks).toHaveLength(2);
    });

    test("no task event from non-task-producing stages in a multi-stage pipeline", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const tasks = [
        { id: "#1", description: "A task", status: "pending", summary: "Task" },
      ];
      const stages = [
        createTaskProducingStage("planner", tasks),
        createStage("reviewer"), // No parseOutput — no tasks
      ];
      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "plan and review", context);

      const taskEvents = receivedEvents.filter(
        (e) => e.type === "workflow.task.update",
      );
      // Only the planner produces tasks; reviewer does not
      expect(taskEvents).toHaveLength(1);
    });
  });
});
