/**
 * Tests for task_list tool registration in the conductor executor.
 *
 * Validates that `executeConductorWorkflow` creates a task_list tool via
 * `createTaskListTool()` and registers it on the CommandContext via
 * `context.registerTool()`, with proper event bus wiring for
 * `workflow.tasks.updated` events.
 *
 * Coverage:
 * 1. context.registerTool is called with a tool named "task_list"
 * 2. The tool is created with the correct sessionDir, sessionId, workflowName
 * 3. workflow.tasks.updated events are emitted when the tool's emitTaskUpdate fires
 * 4. No crash when context.registerTool is not provided (optional method)
 * 5. No crash when session directory is missing (best-effort tool creation)
 *
 * Strategy: Use a real temp directory so SQLite can open successfully.
 * Mock session-runtime to return the temp directory.
 */

import { describe, expect, test, mock, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StageDefinition, StageContext } from "@/services/workflows/conductor/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/index.ts";
import type { CommandContext } from "@/types/command.ts";
import type { ToolDefinition, Session, AgentMessage } from "@/services/agents/types.ts";
import type { BusEvent } from "@/services/events/bus-events/types.ts";
import type { BusEventDataMap } from "@/services/events/bus-events/types.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { createTaskListTool, type TaskListTool } from "@/services/agents/tools/task-list.ts";

// ---------------------------------------------------------------------------
// Setup: Create a real temp directory so SQLite can open workflow.db
// ---------------------------------------------------------------------------

let tempDir: string;

function createTempSessionDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "conductor-task-list-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const MOCK_SESSION_ID = "task-list-reg-session-1";
const MOCK_RUN_ID = 99;

// We need to defer sessionDir creation, so use a getter
let mockSessionDir = "/tmp/nonexistent-fallback";

mock.module("@/services/workflows/runtime/executor/session-runtime.ts", () => ({
  initializeWorkflowExecutionSession: mock(() => ({
    sessionDir: mockSessionDir,
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
  const stages = overrides?.conductorStages ?? [createStage("planner")];
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
          ? stages.slice(0, -1).map((s, i) => ({ from: s.id, to: stages[i + 1]!.id }))
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
    spawnSubagent: mock(async () => ({ success: true, output: "" })) as CommandContext["spawnSubagent"],
    streamAndWait: mock(async () => ({ success: true, content: "" })) as unknown as CommandContext["streamAndWait"],
    clearContext: mock(async () => {}),
    setTodoItems: mock(() => {}),
    setWorkflowSessionDir: mock(() => {}),
    setWorkflowSessionId: mock(() => {}),
    setWorkflowTaskIds: mock(() => {}),
    waitForUserInput: mock(async () => ""),
    updateWorkflowState: mock(() => {}),
    createAgentSession: mock(async () => mockSession) as CommandContext["createAgentSession"],
    ...overrides,
  } as unknown as CommandContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("task_list tool registration in conductor executor (§5.7)", () => {
  // -----------------------------------------------------------------------
  // 1. context.registerTool is called with a tool named "task_list"
  // -----------------------------------------------------------------------

  describe("registerTool invocation", () => {
    test("calls context.registerTool with a ToolDefinition named task_list", async () => {
      mockSessionDir = createTempSessionDir();
      const registerToolMock = mock((_tool: ToolDefinition) => {});
      const context = createMockContext({ registerTool: registerToolMock });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      expect(registerToolMock).toHaveBeenCalledTimes(1);
      const registeredTool = registerToolMock.mock.calls[0]![0] as ToolDefinition;
      expect(registeredTool.name).toBe("task_list");
    });

    test("registered tool has a description", async () => {
      mockSessionDir = createTempSessionDir();
      const registerToolMock = mock((_tool: ToolDefinition) => {});
      const context = createMockContext({ registerTool: registerToolMock });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      const registeredTool = registerToolMock.mock.calls[0]![0] as ToolDefinition;
      expect(registeredTool.description).toBeTruthy();
      expect(typeof registeredTool.description).toBe("string");
    });

    test("registered tool has an inputSchema", async () => {
      mockSessionDir = createTempSessionDir();
      const registerToolMock = mock((_tool: ToolDefinition) => {});
      const context = createMockContext({ registerTool: registerToolMock });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      const registeredTool = registerToolMock.mock.calls[0]![0] as ToolDefinition;
      expect(registeredTool.inputSchema).toBeDefined();
      expect(typeof registeredTool.inputSchema).toBe("object");
    });

    test("registered tool has a handler function", async () => {
      mockSessionDir = createTempSessionDir();
      const registerToolMock = mock((_tool: ToolDefinition) => {});
      const context = createMockContext({ registerTool: registerToolMock });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      const registeredTool = registerToolMock.mock.calls[0]![0] as ToolDefinition;
      expect(typeof registeredTool.handler).toBe("function");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Tool creation with correct config
  // -----------------------------------------------------------------------

  describe("tool configuration", () => {
    test("tool handler responds to list_tasks action", async () => {
      // Create a tool directly to verify handler behavior (the executor
      // closes the DB in its finally block, so captured tools are unusable
      // after executeConductorWorkflow returns).
      mockSessionDir = createTempSessionDir();
      const tool = createTaskListTool({
        workflowName: "my-workflow",
        sessionId: MOCK_SESSION_ID,
        sessionDir: mockSessionDir,
      });

      try {
        const result = tool.handler({ action: "list_tasks" }, {
          sessionID: "",
          messageID: "",
          agent: "test",
          directory: "",
          abort: new AbortController().signal,
        }) as Record<string, unknown>;
        expect(result).toHaveProperty("tasks");
        expect(result).toHaveProperty("statusSummary");
      } finally {
        tool.close();
      }
    });

    test("tool handler responds to create_tasks action", async () => {
      mockSessionDir = createTempSessionDir();
      const tool = createTaskListTool({
        workflowName: "test-workflow",
        sessionId: MOCK_SESSION_ID,
        sessionDir: mockSessionDir,
      });

      try {
        const tasks = [
          { id: "1", description: "Test task", status: "pending", summary: "Testing" },
        ];
        const result = tool.handler({ action: "create_tasks", tasks }, {
          sessionID: "",
          messageID: "",
          agent: "test",
          directory: "",
          abort: new AbortController().signal,
        }) as Record<string, unknown>;
        expect(result).toHaveProperty("created", 1);
        expect(result).toHaveProperty("tasks");
      } finally {
        tool.close();
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. workflow.tasks.updated event emission
  // -----------------------------------------------------------------------

  describe("workflow.tasks.updated event emission", () => {
    // Helper: create a task_list tool wired to an EventBus, matching the
    // emitTaskUpdate callback pattern from conductor-executor.
    function createToolWithBus(bus: EventBus, sessionDir: string): TaskListTool {
      return createTaskListTool({
        workflowName: "test-workflow",
        sessionId: MOCK_SESSION_ID,
        sessionDir,
        emitTaskUpdate: (tasks) => {
          const event: BusEvent<"workflow.tasks.updated"> = {
            type: "workflow.tasks.updated",
            sessionId: MOCK_SESSION_ID,
            runId: MOCK_RUN_ID,
            timestamp: Date.now(),
            data: {
              sessionId: MOCK_SESSION_ID,
              tasks: tasks.map((t) => ({
                id: t.id,
                description: t.description,
                status: t.status,
                summary: t.summary,
                ...(t.blockedBy && t.blockedBy.length > 0 ? { blockedBy: t.blockedBy } : {}),
              })),
            },
          };
          bus.publish(event);
        },
      });
    }

    const toolContext = {
      sessionID: "",
      messageID: "",
      agent: "test",
      directory: "",
      abort: new AbortController().signal,
    };

    test("emits workflow.tasks.updated when tool handler triggers emitTaskUpdate", () => {
      mockSessionDir = createTempSessionDir();
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const tool = createToolWithBus(bus, mockSessionDir);
      try {
        tool.handler({
          action: "create_tasks",
          tasks: [
            { id: "1", description: "Task A", status: "pending", summary: "A" },
            { id: "2", description: "Task B", status: "in_progress", summary: "B", blockedBy: ["1"] },
          ],
        }, toolContext);

        const taskUpdatedEvents = receivedEvents.filter(
          (e) => e.type === "workflow.tasks.updated",
        );
        expect(taskUpdatedEvents).toHaveLength(1);
      } finally {
        tool.close();
      }
    });

    test("workflow.tasks.updated event carries correct sessionId", () => {
      mockSessionDir = createTempSessionDir();
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const tool = createToolWithBus(bus, mockSessionDir);
      try {
        tool.handler({
          action: "create_tasks",
          tasks: [{ id: "1", description: "T", status: "pending", summary: "S" }],
        }, toolContext);

        const event = receivedEvents.find((e) => e.type === "workflow.tasks.updated")!;
        expect(event.sessionId).toBe(MOCK_SESSION_ID);
      } finally {
        tool.close();
      }
    });

    test("workflow.tasks.updated event carries correct runId", () => {
      mockSessionDir = createTempSessionDir();
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const tool = createToolWithBus(bus, mockSessionDir);
      try {
        tool.handler({
          action: "create_tasks",
          tasks: [{ id: "1", description: "T", status: "pending", summary: "S" }],
        }, toolContext);

        const event = receivedEvents.find((e) => e.type === "workflow.tasks.updated")!;
        expect(event.runId).toBe(MOCK_RUN_ID);
      } finally {
        tool.close();
      }
    });

    test("workflow.tasks.updated event data contains all tasks", () => {
      mockSessionDir = createTempSessionDir();
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const tool = createToolWithBus(bus, mockSessionDir);
      try {
        tool.handler({
          action: "create_tasks",
          tasks: [
            { id: "1", description: "Task A", status: "pending", summary: "A" },
            { id: "2", description: "Task B", status: "completed", summary: "B" },
          ],
        }, toolContext);

        const event = receivedEvents.find((e) => e.type === "workflow.tasks.updated")!;
        const data = event.data as BusEventDataMap["workflow.tasks.updated"];
        expect(data.tasks).toHaveLength(2);
        expect(data.tasks[0]!.id).toBe("1");
        expect(data.tasks[0]!.description).toBe("Task A");
        expect(data.tasks[0]!.status).toBe("pending");
        expect(data.tasks[1]!.id).toBe("2");
        expect(data.tasks[1]!.status).toBe("completed");
      } finally {
        tool.close();
      }
    });

    test("workflow.tasks.updated event preserves blockedBy when present", () => {
      mockSessionDir = createTempSessionDir();
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const tool = createToolWithBus(bus, mockSessionDir);
      try {
        tool.handler({
          action: "create_tasks",
          tasks: [
            { id: "1", description: "T", status: "pending", summary: "S" },
            { id: "2", description: "T2", status: "pending", summary: "S2", blockedBy: ["1"] },
          ],
        }, toolContext);

        const event = receivedEvents.find((e) => e.type === "workflow.tasks.updated")!;
        const data = event.data as BusEventDataMap["workflow.tasks.updated"];
        // Task without blockedBy should not have the property
        expect(data.tasks[0]!.blockedBy).toBeUndefined();
        // Task with blockedBy should have it
        expect(data.tasks[1]!.blockedBy).toEqual(["1"]);
      } finally {
        tool.close();
      }
    });

    test("workflow.tasks.updated emitted on update_task_status", () => {
      mockSessionDir = createTempSessionDir();
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const tool = createToolWithBus(bus, mockSessionDir);
      try {
        // First create a task
        tool.handler({
          action: "create_tasks",
          tasks: [{ id: "1", description: "T", status: "pending", summary: "S" }],
        }, toolContext);

        // Clear received events
        receivedEvents.length = 0;

        // Update its status
        tool.handler({
          action: "update_task_status",
          taskId: "1",
          status: "in_progress",
        }, toolContext);

        const taskUpdatedEvents = receivedEvents.filter(
          (e) => e.type === "workflow.tasks.updated",
        );
        expect(taskUpdatedEvents).toHaveLength(1);

        const data = taskUpdatedEvents[0]!.data as BusEventDataMap["workflow.tasks.updated"];
        expect(data.tasks[0]!.status).toBe("in_progress");
      } finally {
        tool.close();
      }
    });

    test("no workflow.tasks.updated event when emitTaskUpdate is absent", () => {
      mockSessionDir = createTempSessionDir();
      const tool = createTaskListTool({
        workflowName: "test-workflow",
        sessionId: MOCK_SESSION_ID,
        sessionDir: mockSessionDir,
      });

      try {
        // Invoke the tool — should not crash even without emitTaskUpdate
        const result = tool.handler({
          action: "create_tasks",
          tasks: [{ id: "1", description: "T", status: "pending", summary: "S" }],
        }, toolContext) as Record<string, unknown>;

        // Should still return a valid result
        expect(result).toHaveProperty("created", 1);
      } finally {
        tool.close();
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Graceful handling of missing registerTool
  // -----------------------------------------------------------------------

  describe("graceful degradation", () => {
    test("workflow executes successfully when context.registerTool is not provided", async () => {
      mockSessionDir = createTempSessionDir();
      const context = createMockContext({ registerTool: undefined });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "test prompt", context);

      expect(result.success).toBe(true);
    });

    test("workflow executes successfully when session directory does not exist", async () => {
      // Use a non-existent directory — createTaskListTool will fail,
      // but the try/catch should handle it gracefully
      mockSessionDir = "/tmp/nonexistent-dir-for-task-list-test-" + Date.now();
      const registerToolMock = mock((_tool: ToolDefinition) => {});
      const context = createMockContext({ registerTool: registerToolMock });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "test prompt", context);

      // Workflow should still succeed
      expect(result.success).toBe(true);
      // registerTool should NOT have been called (tool creation failed silently)
      expect(registerToolMock).toHaveBeenCalledTimes(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Tool is created once per workflow execution
  // -----------------------------------------------------------------------

  describe("tool lifecycle", () => {
    test("registerTool is called exactly once for a multi-stage workflow", async () => {
      mockSessionDir = createTempSessionDir();
      const registerToolMock = mock((_tool: ToolDefinition) => {});
      const stages = [createStage("planner"), createStage("reviewer"), createStage("debugger")];
      const context = createMockContext({ registerTool: registerToolMock });
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "test prompt", context);

      // Tool should be registered exactly once (not per-stage)
      expect(registerToolMock).toHaveBeenCalledTimes(1);
    });

    test("tool uses the workflow session directory for SQLite database", async () => {
      mockSessionDir = createTempSessionDir();
      const registerToolMock = mock((_tool: ToolDefinition) => {});
      const context = createMockContext({ registerTool: registerToolMock });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      // Verify the SQLite database file was created in the session directory
      const { existsSync } = await import("fs");
      expect(existsSync(join(mockSessionDir, "workflow.db"))).toBe(true);
    });
  });
});