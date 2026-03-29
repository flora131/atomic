/**
 * Tests for conductor-executor.ts wiring — verifies that
 * `executeConductorWorkflow` correctly builds `ConductorConfig`
 * from the `CommandContext` and `WorkflowDefinition`.
 *
 * Validates:
 * 1. When `context.eventBus` is provided, `dispatchEvent` is wired and
 *    bus events are emitted during execution.
 * 2. When `context.eventBus` is NOT provided, execution still works (no crash).
 * 3. `workflowId`, `sessionId`, `runId` are passed correctly to the conductor.
 * 4. `partsTruncation` is included in the config.
 *
 * Strategy: Mock `initializeWorkflowExecutionSession` to avoid filesystem
 * side effects and return controlled IDs. Use the real
 * `WorkflowSessionConductor` with mock sessions so we can observe
 * event bus emissions end-to-end without leaking `mock.module` to other
 * test files in the same bun process.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { StageDefinition, StageContext } from "@/services/workflows/conductor/types.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/index.ts";
import type { CommandContext } from "@/types/command.ts";
import type { BusEvent } from "@/services/events/bus-events/types.ts";
import type { BusEventDataMap } from "@/services/events/bus-events/types.ts";
import type { Session, AgentMessage } from "@/services/agents/types.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { createDefaultPartsTruncationConfig } from "@/state/parts/truncation.ts";

// ---------------------------------------------------------------------------
// Module mocks — avoid side effects from session-runtime and logging.
// NOTE: We intentionally do NOT mock WorkflowSessionConductor to prevent
// mock.module leakage to other test files in the conductor/ directory.
// ---------------------------------------------------------------------------

const MOCK_SESSION_ID = "test-session-abc";
const MOCK_SESSION_DIR = "/tmp/test-session-dir";
const MOCK_RUN_ID = 42;

mock.module("@/services/workflows/runtime/executor/session-runtime.ts", () => ({
  initializeWorkflowExecutionSession: mock(() => ({
    sessionDir: MOCK_SESSION_DIR,
    sessionId: MOCK_SESSION_ID,
    workflowRunId: MOCK_RUN_ID,
  })),
}));

// Suppress pipeline logger side effects
mock.module("@/services/events/pipeline-logger.ts", () => ({
  isPipelineDebug: mock(() => false),
  resetPipelineDebugCache: mock(() => {}),
  pipelineLog: mock(() => {}),
  pipelineError: mock(() => {}),
}));

// Suppress runtime parity side effects
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
    stream: async function* (_message: string, _options?: { agent?: string; abortSignal?: AbortSignal }) {
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

/**
 * Build a minimal WorkflowDefinition with a conductor graph and stages.
 * The graph matches the stage IDs so the conductor's validateStagesCoverAgentNodes
 * passes without warnings.
 */
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

/**
 * Build a minimal CommandContext with just enough surface for
 * `executeConductorWorkflow` to run. The `createAgentSession` callback
 * returns a mock session that responds with a fixed string.
 */
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
    createAgentSession: mock(async () => mockSession) as any,
    ...overrides,
  } as unknown as CommandContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeConductorWorkflow — ConductorConfig wiring", () => {
  // -----------------------------------------------------------------------
  // 1. eventBus → dispatchEvent wiring
  // -----------------------------------------------------------------------

  describe("eventBus → dispatchEvent wiring", () => {
    test("bus events are emitted during execution when context.eventBus is present", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "test prompt", context);

      // The real conductor should have emitted workflow.step.start and
      // workflow.step.complete for the single "planner" stage.
      const startEvents = receivedEvents.filter((e) => e.type === "workflow.step.start");
      const completeEvents = receivedEvents.filter((e) => e.type === "workflow.step.complete");

      expect(startEvents).toHaveLength(1);
      expect(completeEvents).toHaveLength(1);
    });

    test("workflow.step.start event has correct workflowId and nodeId", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition({ name: "my-wf" });

      await executeConductorWorkflow(definition, "test prompt", context);

      const startEvent = receivedEvents.find((e) => e.type === "workflow.step.start")!;
      const data = startEvent.data as BusEventDataMap["workflow.step.start"];
      expect(data.workflowId).toBe("my-wf");
      expect(data.nodeId).toBe("planner");
      expect(data.indicator).toBe("[PLANNER]");
    });

    test("multi-stage workflow emits start/complete for each stage", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const stages = [createStage("planner"), createStage("reviewer")];
      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition({ conductorStages: stages });

      await executeConductorWorkflow(definition, "test prompt", context);

      const startEvents = receivedEvents.filter((e) => e.type === "workflow.step.start");
      const completeEvents = receivedEvents.filter((e) => e.type === "workflow.step.complete");

      expect(startEvents).toHaveLength(2);
      expect(completeEvents).toHaveLength(2);

      const startNodeIds = startEvents.map(
        (e) => (e.data as BusEventDataMap["workflow.step.start"]).nodeId,
      );
      expect(startNodeIds).toEqual(["planner", "reviewer"]);
    });

    test("dispatchEvent is NOT set when context.eventBus is absent — no events emitted", async () => {
      // We cannot inspect the config directly since we use the real conductor,
      // but we can verify that execution succeeds silently without an eventBus.
      const context = createMockContext({ eventBus: undefined });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "test prompt", context);

      // If dispatchEvent were incorrectly wired, the conductor would
      // throw when trying to call undefined as a function.
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Execution without eventBus — no crash
  // -----------------------------------------------------------------------

  describe("execution without eventBus", () => {
    test("completes successfully when context.eventBus is absent", async () => {
      const context = createMockContext({ eventBus: undefined });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "no bus prompt", context);

      expect(result.success).toBe(true);
    });

    test("multi-stage execution works without eventBus", async () => {
      const stages = [createStage("planner"), createStage("reviewer")];
      const context = createMockContext({ eventBus: undefined });
      const definition = createDefinition({ conductorStages: stages });

      const result = await executeConductorWorkflow(definition, "multi-stage", context);

      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 3. workflowId, sessionId, runId are passed correctly
  // -----------------------------------------------------------------------

  describe("workflowId, sessionId, runId propagation", () => {
    test("events carry the workflowId from definition.name", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition({ name: "ralph" });

      await executeConductorWorkflow(definition, "prompt", context);

      const startEvent = receivedEvents.find((e) => e.type === "workflow.step.start")!;
      expect((startEvent.data as BusEventDataMap["workflow.step.start"]).workflowId).toBe("ralph");
    });

    test("events carry the sessionId from initializeWorkflowExecutionSession", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "prompt", context);

      const startEvent = receivedEvents.find((e) => e.type === "workflow.step.start")!;
      expect(startEvent.sessionId).toBe(MOCK_SESSION_ID);
    });

    test("events carry the runId from initializeWorkflowExecutionSession", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "prompt", context);

      const startEvent = receivedEvents.find((e) => e.type === "workflow.step.start")!;
      expect(startEvent.runId).toBe(MOCK_RUN_ID);
    });

    test("all three IDs are present on every emitted event (canDispatch satisfied)", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition({ name: "my-workflow" });

      await executeConductorWorkflow(definition, "prompt", context);

      // Every emitted event should have sessionId, runId, and workflowId in data
      expect(receivedEvents.length).toBeGreaterThan(0);
      for (const event of receivedEvents) {
        expect(event.sessionId).toBe(MOCK_SESSION_ID);
        expect(event.runId).toBe(MOCK_RUN_ID);
        const data = event.data as { workflowId?: string };
        expect(data.workflowId).toBe("my-workflow");
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. partsTruncation is included in the config
  // -----------------------------------------------------------------------

  describe("partsTruncation config", () => {
    test("workflow.step.complete events include truncation config for completed stages", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "prompt", context);

      const completeEvent = receivedEvents.find((e) => e.type === "workflow.step.complete")!;
      expect(completeEvent).toBeDefined();

      const data = completeEvent.data as BusEventDataMap["workflow.step.complete"];
      expect(data.status).toBe("completed");
      // The conductor attaches partsTruncation as `truncation` on completed stages
      expect((data as any).truncation).toBeDefined();
    });

    test("truncation config matches createDefaultPartsTruncationConfig()", async () => {
      const expected = createDefaultPartsTruncationConfig();

      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "prompt", context);

      const completeEvent = receivedEvents.find((e) => e.type === "workflow.step.complete")!;
      const data = completeEvent.data as any;
      expect(data.truncation).toEqual(expected);
    });

    test("truncation config has the expected default shape", async () => {
      const bus = new EventBus({ validatePayloads: false });
      const receivedEvents: BusEvent[] = [];
      bus.onAll((event) => receivedEvents.push(event));

      const context = createMockContext({ eventBus: bus });
      const definition = createDefinition();

      await executeConductorWorkflow(definition, "prompt", context);

      const completeEvent = receivedEvents.find((e) => e.type === "workflow.step.complete")!;
      const truncation = (completeEvent.data as any).truncation;
      expect(truncation.minTruncationParts).toBeGreaterThan(0);
      expect(typeof truncation.truncateText).toBe("boolean");
      expect(typeof truncation.truncateReasoning).toBe("boolean");
      expect(typeof truncation.truncateTools).toBe("boolean");
    });
  });

  // -----------------------------------------------------------------------
  // Additional wiring validations
  // -----------------------------------------------------------------------

  describe("graph compilation precedence", () => {
    test("prefers createConductorGraph over createGraph", async () => {
      const conductorGraphFactory = mock(() => ({
        nodes: new Map([["planner", { id: "planner", type: "agent" as const, execute: async () => ({}) }]]),
        edges: [] as any[],
        startNode: "planner",
        endNodes: new Set(["planner"]),
        config: {},
      }));
      const regularGraphFactory = mock(() => ({
        nodes: new Map([["planner", { id: "planner", type: "agent" as const, execute: async () => ({}) }]]),
        edges: [] as any[],
        startNode: "planner",
        endNodes: new Set(["planner"]),
        config: {},
      }));

      const context = createMockContext();
      const definition = createDefinition({
        createConductorGraph: conductorGraphFactory,
        createGraph: regularGraphFactory,
      });

      await executeConductorWorkflow(definition, "prompt", context);

      expect(conductorGraphFactory).toHaveBeenCalledTimes(1);
      expect(regularGraphFactory).not.toHaveBeenCalled();
    });

    test("falls back to createGraph when createConductorGraph is not defined", async () => {
      const regularGraphFactory = mock(() => ({
        nodes: new Map([["planner", { id: "planner", type: "agent" as const, execute: async () => ({}) }]]),
        edges: [] as any[],
        startNode: "planner",
        endNodes: new Set(["planner"]),
        config: {},
      }));

      const context = createMockContext();
      const definition = createDefinition({
        createConductorGraph: undefined,
        createGraph: regularGraphFactory,
      });

      await executeConductorWorkflow(definition, "prompt", context);

      expect(regularGraphFactory).toHaveBeenCalledTimes(1);
    });
  });

  describe("abortSignal wiring", () => {
    test("options.abortSignal is respected — aborted workflow returns success", async () => {
      const controller = new AbortController();
      controller.abort(); // Pre-abort

      const context = createMockContext();
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "prompt", context, {
        abortSignal: controller.signal,
      });

      // The conductor sees aborted signal and exits; executor maps to success
      expect(result.success).toBe(true);
    });
  });

  describe("early exit conditions", () => {
    test("returns failure when no conductorStages are defined", async () => {
      const context = createMockContext();
      const definition = createDefinition({ conductorStages: [] });

      const result = await executeConductorWorkflow(definition, "prompt", context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("no conductor stages");
    });

    test("returns failure when createAgentSession is not available", async () => {
      const context = createMockContext({ createAgentSession: undefined });
      const definition = createDefinition();

      const result = await executeConductorWorkflow(definition, "prompt", context);

      expect(result.success).toBe(false);
      expect(result.message).toContain("session creation capability");
    });
  });
});
