/**
 * Tests for conductor → workflow.step.* event wiring.
 *
 * Validates:
 * 1. Conductor emits workflow.step.start and workflow.step.complete bus events
 * 2. Events are NOT emitted when dispatchEvent is not configured
 * 3. Correct event data shape for all stage transition scenarios
 * 4. Skipped stages emit workflow.step.complete with status "skipped"
 * 5. Error stages emit workflow.step.complete with status "error"
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import type {
  ConductorConfig,
  StageContext,
  StageDefinition,
} from "@/services/workflows/conductor/types.ts";
import type { BaseState, CompiledGraph, NodeDefinition, Edge } from "@/services/workflows/graph/types.ts";
import type { Session, AgentMessage, SessionConfig } from "@/services/agents/types.ts";
import type { BusEvent, BusEventType, BusEventDataMap } from "@/services/events/bus-events/types.ts";

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

function agentNode(id: string): NodeDefinition<BaseState> {
  return {
    id,
    type: "agent",
    execute: mock(async () => ({})),
  };
}

function buildLinearGraph(nodes: NodeDefinition<BaseState>[]): CompiledGraph<BaseState> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: Edge<BaseState>[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }
  return {
    nodes: nodeMap,
    edges,
    startNode: nodes[0]!.id,
    endNodes: new Set([nodes[nodes.length - 1]!.id]),
    config: {},
  };
}

function stage(
  id: string,
  options?: Partial<StageDefinition>,
): StageDefinition {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    indicator: `[${id.toUpperCase()}]`,
    buildPrompt: (_ctx: StageContext) => `Prompt for ${id}`,
    ...options,
  };
}

function buildConfig(
  graph: CompiledGraph<BaseState>,
  sessionFactory: (config?: SessionConfig) => Promise<Session>,
  overrides?: Partial<ConductorConfig>,
): ConductorConfig {
  return {
    graph,
    createSession: sessionFactory,
    destroySession: mock(async (_session: Session) => {}),
    onStageTransition: mock((_from: string | null, _to: string) => {}),
    onTaskUpdate: mock((_tasks) => {}),
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

/** Typed event capture — records all dispatched events. */
function createEventCapture() {
  const events: BusEvent[] = [];
  const dispatchEvent = <T extends BusEventType>(event: BusEvent<T>) => {
    events.push(event as BusEvent);
  };
  return { events, dispatchEvent };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowSessionConductor event dispatch", () => {
  describe("workflow.step.start events", () => {
    test("emits workflow.step.start when an agent stage begins", async () => {
      const session = createMockSession("Planner output");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-1",
        sessionId: "sess-1",
        runId: 1,
        dispatchEvent,
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Build auth module");

      const startEvents = events.filter((e) => e.type === "workflow.step.start");
      expect(startEvents).toHaveLength(1);

      const startData = startEvents[0]!.data as BusEventDataMap["workflow.step.start"];
      expect(startData.workflowId).toBe("wf-1");
      expect(startData.nodeId).toBe("planner");
      expect(startData.nodeName).toBe("Planner");
      expect(startData.indicator).toBe("[PLANNER]");

      expect(startEvents[0]!.sessionId).toBe("sess-1");
      expect(startEvents[0]!.runId).toBe(1);
      expect(startEvents[0]!.timestamp).toBeGreaterThan(0);
    });

    test("emits start events for each stage in a multi-stage workflow", async () => {
      const session = createMockSession("response");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("orchestrator"),
        agentNode("reviewer"),
      ]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-2",
        sessionId: "sess-2",
        runId: 2,
        dispatchEvent,
      });
      const stages = [
        stage("planner"),
        stage("orchestrator"),
        stage("reviewer"),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Build feature");

      const startEvents = events.filter((e) => e.type === "workflow.step.start");
      expect(startEvents).toHaveLength(3);

      const nodeIds = startEvents.map(
        (e) => (e.data as BusEventDataMap["workflow.step.start"]).nodeId,
      );
      expect(nodeIds).toEqual(["planner", "orchestrator", "reviewer"]);
    });
  });

  describe("workflow.step.complete events", () => {
    test("emits workflow.step.complete with 'completed' status on success", async () => {
      const session = createMockSession("Planner output");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-1",
        sessionId: "sess-1",
        runId: 1,
        dispatchEvent,
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Build auth module");

      const completeEvents = events.filter((e) => e.type === "workflow.step.complete");
      expect(completeEvents).toHaveLength(1);

      const data = completeEvents[0]!.data as BusEventDataMap["workflow.step.complete"];
      expect(data.workflowId).toBe("wf-1");
      expect(data.nodeId).toBe("planner");
      expect(data.nodeName).toBe("Planner");
      expect(data.status).toBe("completed");
      expect(data.durationMs).toBeGreaterThanOrEqual(0);
      expect(data.error).toBeUndefined();
    });

    test("emits workflow.step.complete with 'error' status on failure", async () => {
      const failSession: Session = {
        id: "fail-session",
        send: mock(async () => { throw new Error("Session failed"); }),
        stream: async function* () {
          throw new Error("Session failed");
        },
        summarize: mock(async () => {}),
        getContextUsage: mock(async () => ({
          inputTokens: 0, outputTokens: 0, maxTokens: 100000, usagePercentage: 0,
        })),
        getSystemToolsTokens: () => 0,
        destroy: mock(async () => {}),
      };
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => failSession, {
        workflowId: "wf-err",
        sessionId: "sess-err",
        runId: 3,
        dispatchEvent,
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Fail test");

      const completeEvents = events.filter((e) => e.type === "workflow.step.complete");
      expect(completeEvents).toHaveLength(1);

      const data = completeEvents[0]!.data as BusEventDataMap["workflow.step.complete"];
      expect(data.status).toBe("error");
      expect(data.error).toBe("Session failed");
    });

    test("emits workflow.step.complete with 'skipped' status when shouldRun returns false", async () => {
      const session = createMockSession("response");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner"), agentNode("debugger")]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-skip",
        sessionId: "sess-skip",
        runId: 4,
        dispatchEvent,
      });
      const stages = [
        stage("planner"),
        stage("debugger", { shouldRun: () => false }),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Test");

      const completeEvents = events.filter((e) => e.type === "workflow.step.complete");
      expect(completeEvents).toHaveLength(2);

      const skippedEvent = completeEvents.find(
        (e) => (e.data as BusEventDataMap["workflow.step.complete"]).nodeId === "debugger",
      );
      expect(skippedEvent).toBeDefined();
      expect((skippedEvent!.data as BusEventDataMap["workflow.step.complete"]).status).toBe("skipped");
      expect((skippedEvent!.data as BusEventDataMap["workflow.step.complete"]).durationMs).toBe(0);
    });
  });

  describe("event ordering", () => {
    test("start event precedes complete event for same stage", async () => {
      const session = createMockSession("response");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-order",
        sessionId: "sess-order",
        runId: 5,
        dispatchEvent,
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Test ordering");

      const plannerEvents = events.filter((e) => {
        const data = e.data as { nodeId?: string };
        return data.nodeId === "planner";
      });
      expect(plannerEvents).toHaveLength(2);
      expect(plannerEvents[0]!.type).toBe("workflow.step.start");
      expect(plannerEvents[1]!.type).toBe("workflow.step.complete");
    });

    test("multi-stage events interleave correctly: start→complete for each", async () => {
      const session = createMockSession("response");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("orchestrator"),
      ]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-interleave",
        sessionId: "sess-interleave",
        runId: 6,
        dispatchEvent,
      });
      const stages = [stage("planner"), stage("orchestrator")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Test");

      const types = events.map((e) => e.type);
      expect(types).toEqual([
        "workflow.step.start",
        "workflow.step.complete",
        "workflow.step.start",
        "workflow.step.complete",
      ]);

      const nodeIds = events.map(
        (e) => (e.data as { nodeId: string }).nodeId,
      );
      expect(nodeIds).toEqual(["planner", "planner", "orchestrator", "orchestrator"]);
    });
  });

  describe("no dispatchEvent configured", () => {
    test("does not emit events when dispatchEvent is not provided", async () => {
      const session = createMockSession("response");

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session);
      const stages = [stage("planner")];

      // Should not throw — events simply not emitted
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("Test");
      expect(result.success).toBe(true);
    });

    test("does not emit events when workflowId is missing", async () => {
      const session = createMockSession("response");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        sessionId: "sess-1",
        runId: 1,
        dispatchEvent,
        // workflowId intentionally omitted
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Test");

      expect(events).toHaveLength(0);
    });

    test("does not emit events when sessionId is missing", async () => {
      const session = createMockSession("response");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-1",
        runId: 1,
        dispatchEvent,
        // sessionId intentionally omitted
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Test");

      expect(events).toHaveLength(0);
    });

    test("does not emit events when runId is missing", async () => {
      const session = createMockSession("response");
      const { events, dispatchEvent } = createEventCapture();

      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () => session, {
        workflowId: "wf-1",
        sessionId: "sess-1",
        dispatchEvent,
        // runId intentionally omitted
      });
      const stages = [stage("planner")];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("Test");

      expect(events).toHaveLength(0);
    });
  });
});
