/**
 * Tests for the workflow verifier orchestrator.
 *
 * Validates that verifyWorkflow correctly runs all 5 property checks
 * and aggregates results. Uses injectable checkers to isolate the orchestrator.
 */

import { test, expect, describe } from "bun:test";
import { verifyWorkflow } from "@/services/workflows/verification/verifier.ts";
import type { PropertyCheckers } from "@/services/workflows/verification/verifier.ts";
import type {
  PropertyResult,
  EncodedGraph,
} from "@/services/workflows/verification/types.ts";
import type {
  CompiledGraph,
  BaseState,
  NodeDefinition,
} from "@/services/workflows/graph/types.ts";

/** Create a minimal CompiledGraph for testing. */
function makeGraph(): CompiledGraph<BaseState> {
  const nodes = new Map<string, NodeDefinition<BaseState>>();
  nodes.set("start", {
    id: "start",
    type: "agent",
    execute: async () => ({}),
  });
  nodes.set("end", {
    id: "end",
    type: "agent",
    execute: async () => ({}),
  });

  return {
    nodes,
    edges: [{ from: "start", to: "end" }],
    startNode: "start",
    endNodes: new Set(["end"]),
    config: {},
  };
}

/** Create mock checkers that all pass. */
function allPassCheckers(): PropertyCheckers {
  const pass = async (): Promise<PropertyResult> => ({ verified: true });
  return {
    checkReachability: pass,
    checkTermination: pass,
    checkDeadlockFreedom: pass,
    checkLoopBounds: pass,
    checkStateDataFlow: pass,
    checkModelValidation: async () => ({ verified: true }),
  };
}

describe("verifyWorkflow", () => {
  test("returns valid=true when all checkers pass", async () => {
    const graph = makeGraph();
    const result = await verifyWorkflow(graph, {
      checkers: allPassCheckers(),
    });

    expect(result.valid).toBe(true);
    expect(result.properties.reachability.verified).toBe(true);
    expect(result.properties.termination.verified).toBe(true);
    expect(result.properties.deadlockFreedom.verified).toBe(true);
    expect(result.properties.loopBounds.verified).toBe(true);
    expect(result.properties.stateDataFlow.verified).toBe(true);
  });

  test("returns valid=false when one checker fails", async () => {
    const graph = makeGraph();
    const checkers = allPassCheckers();
    checkers.checkTermination = async () => ({
      verified: false,
      counterexample: "dead end node",
    });

    const result = await verifyWorkflow(graph, { checkers });

    expect(result.valid).toBe(false);
    expect(result.properties.termination.verified).toBe(false);
    expect(result.properties.termination.counterexample).toBe("dead end node");
    // Other properties still pass
    expect(result.properties.reachability.verified).toBe(true);
    expect(result.properties.deadlockFreedom.verified).toBe(true);
  });

  test("returns valid=false when multiple checkers fail", async () => {
    const graph = makeGraph();
    const checkers = allPassCheckers();
    checkers.checkReachability = async () => ({
      verified: false,
      counterexample: "unreachable",
    });
    checkers.checkDeadlockFreedom = async () => ({
      verified: false,
      counterexample: "deadlocked",
    });

    const result = await verifyWorkflow(graph, { checkers });
    expect(result.valid).toBe(false);
    expect(result.properties.reachability.verified).toBe(false);
    expect(result.properties.deadlockFreedom.verified).toBe(false);
    expect(result.properties.termination.verified).toBe(true);
  });

  test("accepts pre-encoded graph via options", async () => {
    const graph = makeGraph();
    const preEncoded: EncodedGraph = {
      nodes: [
        { id: "custom-start", type: "agent" },
        { id: "custom-end", type: "tool" },
      ],
      edges: [{ from: "custom-start", to: "custom-end", hasCondition: false }],
      startNode: "custom-start",
      endNodes: ["custom-end"],
      loops: [],
      stateFields: [],
    };

    let receivedGraph: EncodedGraph | undefined;
    const checkers = allPassCheckers();
    checkers.checkReachability = async (g) => {
      receivedGraph = g;
      return { verified: true };
    };

    await verifyWorkflow(graph, {
      encodedGraph: preEncoded,
      checkers,
    });

    // The pre-encoded graph should have been used, not the compiled one
    expect(receivedGraph).toBeDefined();
    expect(receivedGraph as EncodedGraph).toBe(preEncoded);
  });

  test("uses default checkers when none provided", async () => {
    const graph = makeGraph();
    // This tests with the real checkers — the simple graph should pass
    const result = await verifyWorkflow(graph);
    expect(result.valid).toBe(true);
  });

  test("partial checker override merges with defaults", async () => {
    const graph = makeGraph();

    // Only override one checker — the rest should use defaults
    const result = await verifyWorkflow(graph, {
      checkers: {
        checkLoopBounds: async () => ({
          verified: false,
          counterexample: "custom failure",
        }),
      },
    });

    expect(result.valid).toBe(false);
    expect(result.properties.loopBounds.verified).toBe(false);
    expect(result.properties.loopBounds.counterexample).toBe("custom failure");
    // Other properties use real checkers and should pass on simple graph
    expect(result.properties.reachability.verified).toBe(true);
    expect(result.properties.termination.verified).toBe(true);
  });

  test("all checkers run concurrently (via Promise.all)", async () => {
    const graph = makeGraph();
    const callOrder: string[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const checkers: PropertyCheckers = {
      checkReachability: async () => {
        callOrder.push("reach-start");
        await delay(10);
        callOrder.push("reach-end");
        return { verified: true };
      },
      checkTermination: async () => {
        callOrder.push("term-start");
        await delay(10);
        callOrder.push("term-end");
        return { verified: true };
      },
      checkDeadlockFreedom: async () => {
        callOrder.push("dl-start");
        await delay(10);
        callOrder.push("dl-end");
        return { verified: true };
      },
      checkLoopBounds: async () => {
        callOrder.push("lb-start");
        await delay(10);
        callOrder.push("lb-end");
        return { verified: true };
      },
      checkStateDataFlow: async () => {
        callOrder.push("sdf-start");
        await delay(10);
        callOrder.push("sdf-end");
        return { verified: true };
      },
      checkModelValidation: async () => ({ verified: true }),
    };

    await verifyWorkflow(graph, { checkers });

    // All starts should appear before all ends (concurrent execution)
    const startIndices = callOrder
      .map((v, i) => (v.endsWith("-start") ? i : -1))
      .filter((i) => i >= 0);
    const endIndices = callOrder
      .map((v, i) => (v.endsWith("-end") ? i : -1))
      .filter((i) => i >= 0);

    // At least some starts should be before the first end
    const firstEnd = Math.min(...endIndices);
    const startsBeforeFirstEnd = startIndices.filter((i) => i < firstEnd);
    expect(startsBeforeFirstEnd.length).toBeGreaterThan(1);
  });

  test("result structure matches VerificationResult shape", async () => {
    const graph = makeGraph();
    const result = await verifyWorkflow(graph, {
      checkers: allPassCheckers(),
    });

    expect(typeof result.valid).toBe("boolean");
    expect(result.properties).toBeDefined();
    expect("reachability" in result.properties).toBe(true);
    expect("termination" in result.properties).toBe(true);
    expect("deadlockFreedom" in result.properties).toBe(true);
    expect("loopBounds" in result.properties).toBe(true);
    expect("stateDataFlow" in result.properties).toBe(true);
  });
});
