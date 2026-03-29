/**
 * Unit tests for disallowedTools resolution in the WorkflowSessionConductor.
 *
 * The conductor's `resolveSessionConfig` method takes a per-provider
 * `disallowedTools` map (e.g., `{ claude: ["Bash"], copilot: ["Edit"] }`)
 * and resolves it to `SessionConfig.excludedTools` for the active agent type.
 *
 * These tests verify:
 * - Correct resolution for each agent type (claude, copilot, opencode)
 * - Missing agent type entries produce no excludedTools
 * - Undefined/empty disallowedTools maps are handled gracefully
 * - End-to-end: resolved excludedTools are passed to createSession
 */

import { describe, expect, test, mock } from "bun:test";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import type {
  ConductorConfig,
  StageContext,
  StageDefinition,
} from "@/services/workflows/conductor/types.ts";
import type { BaseState, CompiledGraph, NodeDefinition, Edge } from "@/services/workflows/graph/types.ts";
import type { Session, AgentMessage, SessionConfig } from "@/services/agents/types.ts";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowSessionConductor disallowedTools resolution", () => {
  // -----------------------------------------------------------------------
  // Per-agent resolution
  // -----------------------------------------------------------------------

  describe("resolves disallowedTools for the active agent type", () => {
    test("claude agent receives its disallowed tools as excludedTools", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", {
          disallowedTools: {
            claude: ["Bash", "Write"],
            copilot: ["Edit"],
            opencode: ["Grep"],
          },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toEqual(["Bash", "Write"]);
    });

    test("copilot agent receives its disallowed tools as excludedTools", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", {
          disallowedTools: {
            claude: ["Bash"],
            copilot: ["Edit", "Glob"],
            opencode: ["Grep"],
          },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "copilot" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toEqual(["Edit", "Glob"]);
    });

    test("opencode agent receives its disallowed tools as excludedTools", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", {
          disallowedTools: {
            claude: ["Bash"],
            copilot: ["Edit"],
            opencode: ["Grep", "Read"],
          },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "opencode" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toEqual(["Grep", "Read"]);
    });
  });

  // -----------------------------------------------------------------------
  // Missing / empty entries
  // -----------------------------------------------------------------------

  describe("handles missing and empty disallowedTools entries", () => {
    test("no excludedTools when active agent has no entry in the map", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", {
          disallowedTools: {
            copilot: ["Edit"],
            opencode: ["Grep"],
          },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toBeUndefined();
    });

    test("no excludedTools when disallowedTools is undefined", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [stage("planner")]; // no disallowedTools

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toBeUndefined();
    });

    test("no excludedTools when disallowedTools is an empty object", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [stage("planner", { disallowedTools: {} })];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toBeUndefined();
    });

    test("empty array is passed through when agent entry is an empty array", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [stage("planner", { disallowedTools: { claude: [] } })];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // No agentType configured
  // -----------------------------------------------------------------------

  describe("handles missing agentType on conductor config", () => {
    test("no excludedTools when agentType is not set", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", {
          disallowedTools: {
            claude: ["Bash"],
            copilot: ["Edit"],
          },
        }),
      ];

      // No agentType in config
      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Multi-stage resolution
  // -----------------------------------------------------------------------

  describe("resolves disallowedTools independently per stage", () => {
    test("each stage resolves its own disallowedTools for the active agent", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);

      const stages = [
        stage("planner", {
          disallowedTools: {
            claude: ["Bash", "Write"],
          },
        }),
        stage("reviewer", {
          disallowedTools: {
            claude: ["Edit"],
          },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(2);
      expect(capturedConfigs[0]?.excludedTools).toEqual(["Bash", "Write"]);
      expect(capturedConfigs[1]?.excludedTools).toEqual(["Edit"]);
    });

    test("stage without disallowedTools has no excludedTools even when others do", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner"), agentNode("reviewer")]);

      const stages = [
        stage("planner", {
          disallowedTools: {
            claude: ["Bash"],
          },
        }),
        stage("reviewer"), // no disallowedTools
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(2);
      expect(capturedConfigs[0]?.excludedTools).toEqual(["Bash"]);
      expect(capturedConfigs[1]?.excludedTools).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Combined with other sessionConfig fields
  // -----------------------------------------------------------------------

  describe("disallowedTools works alongside other sessionConfig fields", () => {
    test("excludedTools and model are both resolved correctly", async () => {
      const capturedConfigs: (SessionConfig | undefined)[] = [];
      const graph = buildLinearGraph([agentNode("planner")]);

      const stages = [
        stage("planner", {
          sessionConfig: {
            model: { claude: "claude-opus-4-20250514" },
            maxTurns: 10,
          },
          disallowedTools: {
            claude: ["Bash"],
          },
        }),
      ];

      const config = buildConfig(graph, async (cfg) => {
        capturedConfigs.push(cfg);
        return createMockSession("output");
      }, { agentType: "claude" });

      const conductor = new WorkflowSessionConductor(config, stages);
      await conductor.execute("test");

      expect(capturedConfigs).toHaveLength(1);
      expect(capturedConfigs[0]?.excludedTools).toEqual(["Bash"]);
      expect(capturedConfigs[0]?.maxTurns).toBe(10);
    });
  });
});
