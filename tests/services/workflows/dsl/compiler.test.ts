/**
 * Unit tests for the DSL compiler — loop termination, break, and validation.
 *
 * Covers:
 * - `until` predicate wiring into back-edge condition
 * - `maxCycles` iteration counter enforcement
 * - Back-edge / exit-edge mutual exclusivity
 * - `break` instruction compilation and graph wiring
 * - `validateInstructions` for break outside loop
 * - End-to-end graph structure for loops and breaks
 */

import { describe, expect, test } from "bun:test";
import { defineWorkflow } from "@/services/workflows/dsl/define-workflow.ts";
import { validateInstructions } from "@/services/workflows/dsl/compiler.ts";
import type { StageConfig, ToolConfig, LoopConfig, Instruction } from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type { BaseState, Edge, CompiledGraph } from "@/services/workflows/graph/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStageConfig(overrides?: Partial<StageConfig>): StageConfig {
  return {
    name: "test-stage",
    description: "A test stage",
    prompt: (ctx: StageContext) => `Prompt: ${ctx.userPrompt}`,
    outputMapper: (response: string) => ({ result: response }),
    ...overrides,
  };
}

function makeToolConfig(overrides?: Partial<ToolConfig>): ToolConfig {
  return {
    name: "test-tool",
    execute: async () => ({ computed: true }),
    ...overrides,
  };
}

function makeLoopConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  return {
    until: () => false,
    maxCycles: 5,
    ...overrides,
  };
}

function makeBaseState(overrides?: Partial<BaseState>): BaseState {
  return {
    executionId: "test-exec",
    lastUpdated: new Date().toISOString(),
    outputs: {},
    ...overrides,
  };
}

/** Compile a workflow and return its graph. */
function compileGraph(
  buildFn: (b: ReturnType<typeof defineWorkflow>) => ReturnType<typeof defineWorkflow>,
): CompiledGraph<BaseState> {
  const builder = buildFn(defineWorkflow("test-wf", "test"));
  const compiled = builder.compile();
  return compiled.createConductorGraph!() as CompiledGraph<BaseState>;
}

/** Find edges from a node by label. */
function edgesFrom(graph: CompiledGraph<BaseState>, nodeId: string, label?: string): Edge<BaseState>[] {
  return graph.edges.filter(
    (e) => e.from === nodeId && (label === undefined || e.label === label),
  );
}

/** Find edges from a node to a specific target. */
function edgeFromTo(graph: CompiledGraph<BaseState>, from: string, to: string): Edge<BaseState> | undefined {
  return graph.edges.find((e) => e.from === from && e.to === to);
}

// ---------------------------------------------------------------------------
// validateInstructions — break validation
// ---------------------------------------------------------------------------

describe("validateInstructions break validation", () => {
  test("break inside a loop is valid", () => {
    const instructions: Instruction[] = [
      { type: "loop", config: makeLoopConfig() },
      { type: "stage", id: "s1", config: makeStageConfig() },
      { type: "break" },
      { type: "endLoop" },
    ];
    // Should not throw — but needs at least one stage/tool
    expect(() => validateInstructions(instructions)).not.toThrow();
  });

  test("break outside a loop throws", () => {
    const instructions: Instruction[] = [
      { type: "stage", id: "s1", config: makeStageConfig() },
      { type: "break" },
    ];
    expect(() => validateInstructions(instructions)).toThrow(
      '"break" can only be used inside a loop',
    );
  });

  test("break in nested loop is valid", () => {
    const instructions: Instruction[] = [
      { type: "loop", config: makeLoopConfig() },
      { type: "loop", config: makeLoopConfig() },
      { type: "stage", id: "s1", config: makeStageConfig() },
      { type: "break" },
      { type: "endLoop" },
      { type: "stage", id: "s2", config: makeStageConfig() },
      { type: "endLoop" },
    ];
    expect(() => validateInstructions(instructions)).not.toThrow();
  });

  test("break after all loops closed throws", () => {
    const instructions: Instruction[] = [
      { type: "loop", config: makeLoopConfig() },
      { type: "stage", id: "s1", config: makeStageConfig() },
      { type: "endLoop" },
      { type: "stage", id: "s2", config: makeStageConfig() },
      { type: "break" },
    ];
    expect(() => validateInstructions(instructions)).toThrow(
      '"break" can only be used inside a loop',
    );
  });
});

// ---------------------------------------------------------------------------
// Graph Generation — loop structure
// ---------------------------------------------------------------------------

describe("compiler loop graph structure", () => {
  test("loop generates start, check, and exit decision nodes", () => {
    const graph = compileGraph((b) =>
      b.loop(makeLoopConfig()).stage("s1", makeStageConfig()).endLoop(),
    );

    const nodeIds = Array.from(graph.nodes.keys());
    const loopStartNodes = nodeIds.filter((id) => id.startsWith("__loop_start_"));
    const loopCheckNodes = nodeIds.filter((id) => id.startsWith("__loop_check_"));
    const loopExitNodes = nodeIds.filter((id) => id.startsWith("__loop_exit_"));

    expect(loopStartNodes).toHaveLength(1);
    expect(loopCheckNodes).toHaveLength(1);
    expect(loopExitNodes).toHaveLength(1);
  });

  test("loop check node has both continue and exit edges", () => {
    const graph = compileGraph((b) =>
      b.loop(makeLoopConfig()).stage("s1", makeStageConfig()).endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;

    const continueEdge = edgesFrom(graph, checkNodeId, "loop_continue");
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit");

    expect(continueEdge).toHaveLength(1);
    expect(exitEdge).toHaveLength(1);
  });

  test("back-edge targets loop start node", () => {
    const graph = compileGraph((b) =>
      b.loop(makeLoopConfig()).stage("s1", makeStageConfig()).endLoop(),
    );

    const startNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_start_"),
    )!;
    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;

    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    expect(backEdge.to).toBe(startNodeId);
  });

  test("exit edge targets loop exit node", () => {
    const graph = compileGraph((b) =>
      b.loop(makeLoopConfig()).stage("s1", makeStageConfig()).endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    expect(exitEdge.to).toBe(exitNodeId);
  });

  test("node after loop connects from exit node", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .endLoop()
        .stage("s2", makeStageConfig()),
    );

    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const edgeToS2 = edgeFromTo(graph, exitNodeId, "s2");
    expect(edgeToS2).toBeDefined();
  });

  test("loop exit node is an end node when no instructions follow", () => {
    const graph = compileGraph((b) =>
      b.loop(makeLoopConfig()).stage("s1", makeStageConfig()).endLoop(),
    );

    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    expect(graph.endNodes.has(exitNodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Loop termination — until predicate wiring
// ---------------------------------------------------------------------------

describe("compiler loop until predicate", () => {
  test("back-edge returns true (continue) when until is false", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 10 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;

    const state = makeBaseState();
    expect(backEdge.condition!(state)).toBe(true);
  });

  test("back-edge returns false (exit) when until is true", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => true, maxCycles: 10 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;

    const state = makeBaseState();
    expect(backEdge.condition!(state)).toBe(false);
  });

  test("until predicate receives the current state", () => {
    let receivedState: BaseState | null = null;
    const graph = compileGraph((b) =>
      b
        .loop(
          makeLoopConfig({
            until: (s) => {
              receivedState = s;
              return false;
            },
            maxCycles: 10,
          }),
        )
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;

    const state = makeBaseState({ executionId: "custom-id" });
    backEdge.condition!(state);

    expect(receivedState).not.toBeNull();
    expect(receivedState!).toBe(state);
    expect(receivedState!.executionId).toBe("custom-id");
  });

  test("until predicate that checks state outputs", () => {
    const graph = compileGraph((b) =>
      b
        .loop(
          makeLoopConfig({
            until: (s) => s.outputs["reviewer"] === "clean",
            maxCycles: 10,
          }),
        )
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;

    // Not clean — should continue
    const stateDirty = makeBaseState({ outputs: { reviewer: "dirty" } });
    expect(backEdge.condition!(stateDirty)).toBe(true);

    // Clean — should exit
    const stateClean = makeBaseState({ outputs: { reviewer: "clean" } });
    expect(backEdge.condition!(stateClean)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Loop termination — maxCycles enforcement
// ---------------------------------------------------------------------------

describe("compiler loop maxCycles enforcement", () => {
  test("back-edge stops after maxCycles iterations", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 3 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const state = makeBaseState();

    // Iteration 1: count=1, 1 < 3 = true → continue
    expect(backEdge.condition!(state)).toBe(true);
    // Iteration 2: count=2, 2 < 3 = true → continue
    expect(backEdge.condition!(state)).toBe(true);
    // Iteration 3: count=3, 3 < 3 = false → exit
    expect(backEdge.condition!(state)).toBe(false);
  });

  test("maxCycles=1 allows exactly one iteration", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 1 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const state = makeBaseState();

    // First check: count=1, 1 < 1 = false → exit (body ran once, no re-entry)
    expect(backEdge.condition!(state)).toBe(false);
  });

  test("until predicate terminates before maxCycles", () => {
    let callCount = 0;
    const graph = compileGraph((b) =>
      b
        .loop(
          makeLoopConfig({
            until: () => {
              callCount++;
              return callCount >= 2; // Terminate on 2nd check
            },
            maxCycles: 10,
          }),
        )
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const state = makeBaseState();

    // 1st check: until returns false (callCount=1), count=1 < 10 → continue
    expect(backEdge.condition!(state)).toBe(true);
    // 2nd check: until returns true (callCount=2), → exit
    expect(backEdge.condition!(state)).toBe(false);
  });

  test("iteration counter persists across evaluations", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 5 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const state = makeBaseState();

    // Each call increments the counter
    for (let i = 0; i < 4; i++) {
      expect(backEdge.condition!(state)).toBe(true);
    }
    // 5th call: count=5, 5 < 5 = false
    expect(backEdge.condition!(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge mutual exclusivity
// ---------------------------------------------------------------------------

describe("compiler loop edge mutual exclusivity", () => {
  test("continue and exit edges are mutually exclusive when continuing", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 10 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    const state = makeBaseState();

    // Evaluate back-edge first (as conductor would)
    const continueResult = backEdge.condition!(state);
    const exitResult = exitEdge.condition!(state);

    expect(continueResult).toBe(true);
    expect(exitResult).toBe(false);
  });

  test("continue and exit edges are mutually exclusive when exiting", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => true, maxCycles: 10 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    const state = makeBaseState();

    // Evaluate back-edge first (as conductor would)
    const continueResult = backEdge.condition!(state);
    const exitResult = exitEdge.condition!(state);

    expect(continueResult).toBe(false);
    expect(exitResult).toBe(true);
  });

  test("continue and exit edges are mutually exclusive at maxCycles boundary", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 1 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    const state = makeBaseState();

    // At maxCycles=1, first check should exit
    const continueResult = backEdge.condition!(state);
    const exitResult = exitEdge.condition!(state);

    expect(continueResult).toBe(false);
    expect(exitResult).toBe(true);
  });

  test("back-edge appears before exit edge in the edges array", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const checkEdges = graph.edges.filter((e) => e.from === checkNodeId);

    // The back-edge (loop_continue) should come before the exit edge (loop_exit)
    const continueIdx = checkEdges.findIndex((e) => e.label === "loop_continue");
    const exitIdx = checkEdges.findIndex((e) => e.label === "loop_exit");

    expect(continueIdx).toBeLessThan(exitIdx);
  });
});

// ---------------------------------------------------------------------------
// Break instruction compilation
// ---------------------------------------------------------------------------

describe("compiler break instruction", () => {
  test("break creates a decision node in the graph", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .break()
        .endLoop(),
    );

    const breakNodes = Array.from(graph.nodes.keys()).filter((id) =>
      id.startsWith("__break_"),
    );
    expect(breakNodes).toHaveLength(1);
  });

  test("break node connects to previous node", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .break()
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;

    const edgeToBreak = edgeFromTo(graph, "s1", breakNodeId);
    expect(edgeToBreak).toBeDefined();
  });

  test("break node has unconditional edge to loop exit node", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .break()
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const breakToExit = edgeFromTo(graph, breakNodeId, exitNodeId);
    expect(breakToExit).toBeDefined();
    // Unconditional — no condition function
    expect(breakToExit!.condition).toBeUndefined();
  });

  test("multiple breaks in same loop all connect to exit", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .break()
        .stage("s2", makeStageConfig())
        .break()
        .endLoop(),
    );

    const breakNodes = Array.from(graph.nodes.keys()).filter((id) =>
      id.startsWith("__break_"),
    );
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    expect(breakNodes).toHaveLength(2);
    for (const breakId of breakNodes) {
      const edge = edgeFromTo(graph, breakId, exitNodeId);
      expect(edge).toBeDefined();
    }
  });

  test("break in inner loop connects to inner loop exit, not outer", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .loop(makeLoopConfig())
        .stage("s2", makeStageConfig())
        .break()
        .endLoop()
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodes = Array.from(graph.nodes.keys()).filter((id) =>
      id.startsWith("__loop_exit_"),
    );

    // Two exit nodes (one per loop)
    expect(exitNodes).toHaveLength(2);

    // The break should connect to exactly one exit node
    const breakExitEdges = graph.edges.filter(
      (e) => e.from === breakNodeId && e.to.startsWith("__loop_exit_"),
    );
    expect(breakExitEdges).toHaveLength(1);

    // The inner loop's exit node (created first since inner endLoop is processed first)
    const innerExitNodeId = exitNodes[0]!;
    expect(breakExitEdges[0]!.to).toBe(innerExitNodeId);
  });
});

// ---------------------------------------------------------------------------
// Nested loops
// ---------------------------------------------------------------------------

describe("compiler nested loops", () => {
  test("nested loops have independent iteration counters", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 3 }))
        .stage("s1", makeStageConfig())
        .loop(makeLoopConfig({ until: () => false, maxCycles: 2 }))
        .stage("s2", makeStageConfig())
        .endLoop()
        .endLoop(),
    );

    const checkNodes = Array.from(graph.nodes.keys()).filter((id) =>
      id.startsWith("__loop_check_"),
    );
    expect(checkNodes).toHaveLength(2);

    // Each check node has its own continue and exit edges
    for (const checkNodeId of checkNodes) {
      const continueEdge = edgesFrom(graph, checkNodeId, "loop_continue");
      const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit");
      expect(continueEdge).toHaveLength(1);
      expect(exitEdge).toHaveLength(1);
    }
  });

  test("nested loop exit connects to outer loop body", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .stage("s1", makeStageConfig())
        .loop(makeLoopConfig())
        .stage("s2", makeStageConfig())
        .endLoop()
        .stage("s3", makeStageConfig())
        .endLoop(),
    );

    // The inner loop exit should connect to s3
    const innerExitNodeId = Array.from(graph.nodes.keys()).filter((id) =>
      id.startsWith("__loop_exit_"),
    )[0]!;

    const exitToS3 = edgeFromTo(graph, innerExitNodeId, "s3");
    expect(exitToS3).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Loop with tools
// ---------------------------------------------------------------------------

describe("compiler loop with tool nodes", () => {
  test("tool nodes inside loop are wired correctly", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig())
        .tool("t1", makeToolConfig())
        .endLoop(),
    );

    const nodeIds = Array.from(graph.nodes.keys());
    expect(nodeIds).toContain("t1");

    const startNodeId = nodeIds.find((id) => id.startsWith("__loop_start_"))!;
    const checkNodeId = nodeIds.find((id) => id.startsWith("__loop_check_"))!;

    // start → t1
    expect(edgeFromTo(graph, startNodeId, "t1")).toBeDefined();
    // t1 → check
    expect(edgeFromTo(graph, "t1", checkNodeId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Full graph walk simulation
// ---------------------------------------------------------------------------

describe("compiler loop graph traversal simulation", () => {
  test("simulated traversal respects until predicate", () => {
    let checkCount = 0;
    const graph = compileGraph((b) =>
      b
        .loop(
          makeLoopConfig({
            until: () => {
              checkCount++;
              return checkCount >= 3; // terminate after 3 checks
            },
            maxCycles: 10,
          }),
        )
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const state = makeBaseState();

    // Simulate: call condition on each "visit" to check node
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(backEdge.condition!(state));
    }

    // Should continue for 2 iterations, then stop
    expect(results[0]).toBe(true); // check 1: checkCount=1, until=false, count=1 < 10
    expect(results[1]).toBe(true); // check 2: checkCount=2, until=false, count=2 < 10
    expect(results[2]).toBe(false); // check 3: checkCount=3, until=true → exit
  });

  test("simulated traversal respects maxCycles even when until never fires", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopConfig({ until: () => false, maxCycles: 3 }))
        .stage("s1", makeStageConfig())
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const state = makeBaseState();

    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(backEdge.condition!(state));
    }

    // maxCycles=3: continue for iterations 1 and 2, stop at 3
    expect(results[0]).toBe(true);
    expect(results[1]).toBe(true);
    expect(results[2]).toBe(false);
    // After stopping, further calls keep returning false
    expect(results[3]).toBe(false);
    expect(results[4]).toBe(false);
  });
});
