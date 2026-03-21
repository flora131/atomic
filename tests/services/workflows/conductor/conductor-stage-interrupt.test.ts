/**
 * Tests for stage-aware interrupt wiring (§5.5).
 *
 * Validates:
 * 1. `registerConductorInterrupt` is called with conductor.interrupt() before execution.
 * 2. `registerConductorInterrupt(null)` is called after execution completes.
 * 3. `registerConductorInterrupt(null)` is called even when execution throws.
 * 4. The registered interrupt function actually calls conductor.interrupt().
 * 5. `onStageTransition` updates `currentStage` and `stageIndicator` in workflow state.
 *
 * Strategy: Mock `initializeWorkflowExecutionSession` to avoid filesystem
 * side effects and return controlled IDs. Use real `WorkflowSessionConductor`
 * with mock sessions to verify interrupt registration end-to-end.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { StageDefinition, StageContext } from "@/services/workflows/conductor/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/index.ts";
import type { CommandContext } from "@/types/command.ts";
import type { Session, AgentMessage } from "@/services/agents/types.ts";

// ---------------------------------------------------------------------------
// Module mocks — avoid side effects from session-runtime and logging
// ---------------------------------------------------------------------------

const MOCK_SESSION_ID = "interrupt-session-abc";
const MOCK_SESSION_DIR = "/tmp/interrupt-session-dir";
const MOCK_RUN_ID = 99;

mock.module("@/services/workflows/runtime/executor/session-runtime.ts", () => ({
  initializeWorkflowExecutionSession: mock(() => ({
    sessionDir: MOCK_SESSION_DIR,
    sessionId: MOCK_SESSION_ID,
    workflowRunId: MOCK_RUN_ID,
  })),
}));

mock.module("@/services/events/pipeline-logger.ts", () => ({
  pipelineLog: mock(() => {}),
  pipelineError: mock(() => {}),
}));

// ---------------------------------------------------------------------------
// Import the function under test
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

function createStage(
  id: string,
  overrides?: Partial<StageDefinition>,
): StageDefinition {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
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
          ? stages
              .slice(0, -1)
              .map((s, i) => ({ from: s.id, to: stages[i + 1]!.id }))
          : [],
      startNode: stages[0]!.id,
      endNodes: new Set([stages[stages.length - 1]!.id]),
      config: {},
    }),
    ...overrides,
  };
}

function createMockContext(
  overrides?: Partial<CommandContext>,
): CommandContext {
  const mockSession = createMockSession("stage response");
  return {
    session: null,
    state: { isStreaming: false, messageCount: 0 } as CommandContext["state"],
    addMessage: mock(() => {}),
    setStreaming: mock(() => {}),
    sendMessage: mock(() => {}),
    sendSilentMessage: mock(() => {}),
    spawnSubagent: mock(async () => ({
      success: true,
      output: "",
    })) as any,
    streamAndWait: mock(async () => ({
      success: true,
      content: "",
    })) as any,
    clearContext: mock(async () => {}),
    setTodoItems: mock(() => {}),
    setWorkflowSessionDir: mock(() => {}),
    setWorkflowSessionId: mock(() => {}),
    setWorkflowTaskIds: mock(() => {}),
    waitForUserInput: mock(async () => ""),
    updateWorkflowState: mock(() => {}),
    registerConductorInterrupt: mock(() => {}),
    createAgentSession: mock(async () => mockSession) as any,
    ...overrides,
  } as unknown as CommandContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeConductorWorkflow — stage-aware interrupt wiring (§5.5)", () => {
  // -----------------------------------------------------------------------
  // 1. registerConductorInterrupt lifecycle
  // -----------------------------------------------------------------------

  describe("registerConductorInterrupt lifecycle", () => {
    test("registers conductor.interrupt before execution and deregisters after success", async () => {
      const registerMock = mock((_fn: (() => void) | null) => {});
      const context = createMockContext({
        registerConductorInterrupt: registerMock,
      });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      // First call: register with a function (conductor.interrupt)
      expect(registerMock).toHaveBeenCalledTimes(2);
      const firstCall = registerMock.mock.calls[0];
      expect(typeof firstCall![0]).toBe("function");

      // Second call: deregister with null
      const secondCall = registerMock.mock.calls[1];
      expect(secondCall![0]).toBeNull();
    });

    test("deregisters conductor interrupt even when execution fails", async () => {
      const registerMock = mock((_fn: (() => void) | null) => {});

      // Create a session that throws during streaming
      const failingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          throw new Error("Stage execution failed");
        },
      };

      const context = createMockContext({
        registerConductorInterrupt: registerMock,
        createAgentSession: mock(async () => failingSession) as any,
      });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(
        definition,
        "test prompt",
        context,
      );

      // Even on failure, should still have registered and deregistered
      expect(registerMock).toHaveBeenCalledTimes(2);

      // First call: register with a function
      expect(typeof registerMock.mock.calls[0]![0]).toBe("function");

      // Second call: deregister with null
      expect(registerMock.mock.calls[1]![0]).toBeNull();
    });

    test("works when registerConductorInterrupt is not provided", async () => {
      const context = createMockContext({
        registerConductorInterrupt: undefined,
      });
      const definition = createDefinition();

      // Should not throw when registerConductorInterrupt is undefined
      const result = await executeConductorWorkflow(
        definition,
        "test prompt",
        context,
      );

      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Registered function actually interrupts the conductor
  // -----------------------------------------------------------------------

  describe("registered interrupt function", () => {
    test("calling the registered function aborts the conductor's active session", async () => {
      const abortMock = mock(() => Promise.resolve());
      let capturedInterruptFn: (() => void) | null = null;
      let resolveStream: (() => void) | undefined;

      const blockingSession: Session = {
        ...createMockSession(""),
        stream: async function* () {
          yield { type: "text" as const, content: "partial" } as AgentMessage;
          // Block until resolved externally
          await new Promise<void>((resolve) => {
            resolveStream = resolve;
          });
        },
        abort: abortMock,
      };

      const registerMock = mock((fn: (() => void) | null) => {
        capturedInterruptFn = fn;
      });

      const context = createMockContext({
        registerConductorInterrupt: registerMock,
        createAgentSession: mock(async () => blockingSession) as any,
      });
      const definition = createDefinition();

      // Start execution in the background
      const executePromise = executeConductorWorkflow(
        definition,
        "test prompt",
        context,
      );

      // Wait for the session to start streaming
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The interrupt function should have been registered
      expect(capturedInterruptFn).not.toBeNull();

      // Call the registered interrupt function (simulates keyboard Ctrl+C)
      capturedInterruptFn!();

      // abort should have been called on the blocking session
      expect(abortMock).toHaveBeenCalledTimes(1);

      // Resolve the stream so execution can complete
      resolveStream?.();
      await executePromise;
    });
  });

  // -----------------------------------------------------------------------
  // 3. onStageTransition updates currentStage and stageIndicator
  // -----------------------------------------------------------------------

  describe("onStageTransition stage state updates", () => {
    test("updates currentStage and stageIndicator on stage transition", async () => {
      const updateWorkflowStateMock = mock((_update: any) => {});
      const stages = [createStage("research"), createStage("implement")];

      const context = createMockContext({
        updateWorkflowState: updateWorkflowStateMock,
      });
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "test prompt", context);

      // Find calls that include currentStage
      const stageUpdateCalls = updateWorkflowStateMock.mock.calls.filter(
        (call) => call[0] && "currentStage" in call[0],
      );

      // Should have at least one call with currentStage set
      expect(stageUpdateCalls.length).toBeGreaterThanOrEqual(1);

      // First stage transition should set currentStage to "research"
      const firstTransition = stageUpdateCalls[0]![0];
      expect(firstTransition.currentStage).toBe("research");
      expect(firstTransition.stageIndicator).toBe(
        "Stage 1/2: [RESEARCH]",
      );
    });

    test("sets correct stageIndicator with stage index for multi-stage workflow", async () => {
      const updateWorkflowStateMock = mock((_update: any) => {});
      const stages = [
        createStage("research"),
        createStage("plan"),
        createStage("implement"),
      ];

      const context = createMockContext({
        updateWorkflowState: updateWorkflowStateMock,
      });
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "test prompt", context);

      const stageUpdateCalls = updateWorkflowStateMock.mock.calls.filter(
        (call) => call[0] && "currentStage" in call[0],
      );

      // Should have transitions for each stage
      expect(stageUpdateCalls.length).toBe(3);

      // Verify stage indicators include correct index/total
      expect(stageUpdateCalls[0]![0].stageIndicator).toBe(
        "Stage 1/3: [RESEARCH]",
      );
      expect(stageUpdateCalls[1]![0].stageIndicator).toBe(
        "Stage 2/3: [PLAN]",
      );
      expect(stageUpdateCalls[2]![0].stageIndicator).toBe(
        "Stage 3/3: [IMPLEMENT]",
      );
    });

    test("stageIndicator includes workflowConfig alongside currentStage", async () => {
      const updateWorkflowStateMock = mock((_update: any) => {});
      const stages = [createStage("research")];

      const context = createMockContext({
        updateWorkflowState: updateWorkflowStateMock,
      });
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "my prompt", context);

      const stageUpdateCalls = updateWorkflowStateMock.mock.calls.filter(
        (call) => call[0] && "currentStage" in call[0],
      );

      expect(stageUpdateCalls.length).toBe(1);
      const update = stageUpdateCalls[0]![0];

      // Should include both stage info AND workflowConfig
      expect(update.currentStage).toBe("research");
      expect(update.stageIndicator).toBe("Stage 1/1: [RESEARCH]");
      expect(update.workflowConfig).toEqual({
        userPrompt: "my prompt",
        sessionId: MOCK_SESSION_ID,
        workflowName: "test-workflow",
      });
    });
  });
});
