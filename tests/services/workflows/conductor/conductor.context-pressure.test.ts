/**
 * Conductor Context Pressure Integration Tests
 *
 * Tests the WorkflowSessionConductor's integration with context pressure
 * monitoring. Verifies that:
 * - Context usage is captured after each stage's streaming
 * - Pressure levels are computed and stored in StageOutput.contextUsage
 * - Accumulated pressure is threaded into StageContext.contextPressure
 * - The onContextPressure callback is invoked with correct parameters
 * - WorkflowResult includes accumulated context pressure
 * - Backward compatibility: no-pressure-config behavior is unchanged
 */

import { describe, expect, test, mock } from "bun:test";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import type {
  ConductorConfig,
  ContextPressureSnapshot,
  StageContext,
  StageDefinition,
} from "@/services/workflows/conductor/types.ts";
import type {
  BaseState,
  CompiledGraph,
  NodeDefinition,
  Edge,
} from "@/services/workflows/graph/types.ts";
import type {
  Session,
  AgentMessage,
  SessionConfig,
  ContextUsage,
} from "@/services/agents/types.ts";
import { createDefaultContextPressureConfig } from "@/services/workflows/conductor/context-pressure.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Create a session whose getContextUsage returns a specific usage. */
function createSessionWithUsage(
  response: string,
  usage: ContextUsage,
  id = "session-1",
): Session {
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
    getContextUsage: mock(async () => usage),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {}),
  };
}

/** Create a session whose getContextUsage throws (simulating no-query-yet). */
function createSessionWithFailingUsage(response: string, id = "session-1"): Session {
  return {
    id,
    send: mock(async () => ({ type: "text" as const, content: response })),
    stream: async function* () {
      yield { type: "text" as const, content: response } as AgentMessage;
    },
    summarize: mock(async () => {}),
    getContextUsage: mock(async () => {
      throw new Error("No query completed");
    }),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {}),
  };
}

function agentNode(id: string): NodeDefinition<BaseState> {
  return { id, type: "agent", execute: mock(async () => ({})) };
}

function buildLinearGraph(
  nodes: NodeDefinition<BaseState>[],
): CompiledGraph<BaseState> {
  const edges: Edge<BaseState>[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
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

function normalUsage(percentage = 10): ContextUsage {
  return {
    inputTokens: 5000,
    outputTokens: 3000,
    maxTokens: 100000,
    usagePercentage: percentage,
  };
}

function elevatedUsage(percentage = 50): ContextUsage {
  return {
    inputTokens: 25000,
    outputTokens: 15000,
    maxTokens: 100000,
    usagePercentage: percentage,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowSessionConductor — context pressure monitoring", () => {
  // -----------------------------------------------------------------------
  // Backward Compatibility
  // -----------------------------------------------------------------------

  describe("backward compatibility (no contextPressure config)", () => {
    test("StageOutput has no contextUsage when monitoring is disabled", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () =>
        createSessionWithUsage("output", normalUsage()),
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.contextUsage).toBeUndefined();
    });

    test("StageContext has no contextPressure when monitoring is disabled", async () => {
      let capturedContext: StageContext | undefined;
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () =>
        createSessionWithUsage("output", normalUsage()),
      );
      const stages = [
        stage("planner", {
          buildPrompt: (ctx) => {
            capturedContext = ctx;
            return "prompt";
          },
        }),
      ];
      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedContext!.contextPressure).toBeUndefined();
    });

    test("WorkflowResult has no contextPressure when monitoring is disabled", async () => {
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(graph, async () =>
        createSessionWithUsage("output", normalUsage()),
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      expect(result.contextPressure).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Context Usage Capture
  // -----------------------------------------------------------------------

  describe("context usage capture", () => {
    test("captures context usage snapshot in StageOutput when monitoring is enabled", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(
        graph,
        async () => createSessionWithUsage("output", normalUsage(15)),
        { contextPressure: pressureConfig },
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      expect(output!.contextUsage).toBeDefined();
      expect(output!.contextUsage!.usagePercentage).toBe(15);
      expect(output!.contextUsage!.level).toBe("normal");
    });

    test("captures snapshots for each stage independently", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      let callCount = 0;
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("orchestrator"),
        agentNode("reviewer"),
      ]);

      const usages: ContextUsage[] = [
        normalUsage(10),
        elevatedUsage(50),
        normalUsage(20),
      ];

      const config = buildConfig(
        graph,
        async () => {
          const usage = usages[callCount]!;
          callCount++;
          return createSessionWithUsage(`output-${callCount}`, usage);
        },
        { contextPressure: pressureConfig },
      );

      const stages = [
        stage("planner"),
        stage("orchestrator"),
        stage("reviewer"),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.stageOutputs.get("planner")!.contextUsage!.level).toBe("normal");
      expect(result.stageOutputs.get("orchestrator")!.contextUsage!.level).toBe("elevated");
      expect(result.stageOutputs.get("reviewer")!.contextUsage!.level).toBe("normal");
    });

    test("contextUsage is undefined when getContextUsage fails", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);
      const config = buildConfig(
        graph,
        async () => createSessionWithFailingUsage("output"),
        { contextPressure: pressureConfig },
      );
      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      const result = await conductor.execute("test");

      const output = result.stageOutputs.get("planner");
      // Stage still completes successfully
      expect(output!.status).toBe("completed");
      expect(output!.contextUsage).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Accumulated Pressure in StageContext
  // -----------------------------------------------------------------------

  describe("accumulated pressure in StageContext", () => {
    test("downstream stages receive accumulated pressure from prior stages", async () => {
      const capturedContexts: StageContext[] = [];
      const pressureConfig = createDefaultContextPressureConfig();
      let callCount = 0;

      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);

      const usages: ContextUsage[] = [
        normalUsage(15),
        normalUsage(20),
      ];

      const config = buildConfig(
        graph,
        async () => {
          const usage = usages[callCount]!;
          callCount++;
          return createSessionWithUsage("output", usage);
        },
        { contextPressure: pressureConfig },
      );

      const stages = [
        stage("planner", {
          buildPrompt: (ctx) => {
            capturedContexts.push(ctx);
            return "plan";
          },
        }),
        stage("reviewer", {
          buildPrompt: (ctx) => {
            capturedContexts.push(ctx);
            return "review";
          },
        }),
      ];

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      // Planner gets empty pressure (no prior stages)
      const plannerCtx = capturedContexts[0]!;
      expect(plannerCtx.contextPressure).toBeDefined();
      expect(plannerCtx.contextPressure!.totalInputTokens).toBe(0);
      expect(plannerCtx.contextPressure!.stageSnapshots.size).toBe(0);

      // Reviewer gets planner's accumulated pressure
      const reviewerCtx = capturedContexts[1]!;
      expect(reviewerCtx.contextPressure).toBeDefined();
      expect(reviewerCtx.contextPressure!.totalInputTokens).toBeGreaterThan(0);
      expect(reviewerCtx.contextPressure!.stageSnapshots.size).toBe(1);
      expect(reviewerCtx.contextPressure!.stageSnapshots.has("planner")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // WorkflowResult Accumulated Pressure
  // -----------------------------------------------------------------------

  describe("WorkflowResult accumulated pressure", () => {
    test("includes accumulated pressure in result", async () => {
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([
        agentNode("planner"),
        agentNode("reviewer"),
      ]);
      let callCount = 0;

      const config = buildConfig(
        graph,
        async () => {
          callCount++;
          return createSessionWithUsage(`output-${callCount}`, normalUsage(15));
        },
        { contextPressure: pressureConfig },
      );

      const stages = [stage("planner"), stage("reviewer")];
      const conductor = new WorkflowSessionConductor(config, stages);
      const result = await conductor.execute("test");

      expect(result.contextPressure).toBeDefined();
      expect(result.contextPressure!.stageSnapshots.size).toBe(2);
      expect(result.contextPressure!.totalInputTokens).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // onContextPressure Callback
  // -----------------------------------------------------------------------

  describe("onContextPressure callback", () => {
    test("invoked after each stage with snapshot data", async () => {
      const pressureCalls: Array<[string, ContextPressureSnapshot]> = [];
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);

      const config = buildConfig(
        graph,
        async () => createSessionWithUsage("output", normalUsage(30)),
        {
          contextPressure: pressureConfig,
          onContextPressure: (stageId, snapshot) => {
            pressureCalls.push([stageId, snapshot]);
          },
        },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      await conductor.execute("test");

      expect(pressureCalls).toHaveLength(1);
      expect(pressureCalls[0]![0]).toBe("planner");
      expect(pressureCalls[0]![1].usagePercentage).toBe(30);
      expect(pressureCalls[0]![1].level).toBe("normal");
    });

    test("not invoked when getContextUsage fails", async () => {
      const pressureCalls: unknown[] = [];
      const pressureConfig = createDefaultContextPressureConfig();
      const graph = buildLinearGraph([agentNode("planner")]);

      const config = buildConfig(
        graph,
        async () => createSessionWithFailingUsage("output"),
        {
          contextPressure: pressureConfig,
          onContextPressure: (...args) => {
            pressureCalls.push(args);
          },
        },
      );

      const conductor = new WorkflowSessionConductor(config, [stage("planner")]);
      await conductor.execute("test");

      expect(pressureCalls).toHaveLength(0);
    });
  });
});
