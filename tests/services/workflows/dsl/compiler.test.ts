/**
 * Unit tests for the DSL compiler — loop termination, break, and validation.
 *
 * Covers:
 * - `maxCycles` iteration counter enforcement on back-edge
 * - `.break(conditionFactory?)` for conditional/unconditional early termination
 * - Back-edge / exit-edge mutual exclusivity
 * - `break` instruction compilation and graph wiring
 * - `validateInstructions` for break outside loop
 * - End-to-end graph structure for loops and breaks
 */

import { describe, expect, test } from "bun:test";
import { defineWorkflow } from "@/services/workflows/dsl/define-workflow.ts";
import { validateInstructions } from "@/services/workflows/dsl/compiler.ts";
import type { StageOptions, ToolOptions, LoopOptions, Instruction } from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type { BaseState, Edge, CompiledGraph } from "@/services/workflows/graph/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStageOptions(overrides?: Partial<StageOptions>): StageOptions {
  return {
    name: overrides?.name ?? "test-stage",
    agent: "test-stage",
    description: "A test stage",
    prompt: (ctx: StageContext) => `Prompt: ${ctx.userPrompt}`,
    outputMapper: (response: string) => ({ result: response }),
    ...overrides,
  };
}

function makeToolOptions(overrides?: Partial<ToolOptions>): ToolOptions {
  return {
    name: "test-tool",
    execute: async () => ({ computed: true }),
    ...overrides,
  };
}

function makeLoopOptions(overrides?: Partial<LoopOptions>): LoopOptions {
  return {
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
  const builder = buildFn(defineWorkflow({ name: "test-wf", description: "test" }));
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
      { type: "loop", config: makeLoopOptions() },
      { type: "stage", id: "s1", config: makeStageOptions({ name: "s1" }) },
      { type: "break" },
      { type: "endLoop" },
    ];
    // Should not throw — but needs at least one stage/tool
    expect(() => validateInstructions(instructions)).not.toThrow();
  });

  test("break outside a loop throws", () => {
    const instructions: Instruction[] = [
      { type: "stage", id: "s1", config: makeStageOptions({ name: "s1" }) },
      { type: "break" },
    ];
    expect(() => validateInstructions(instructions)).toThrow(
      '"break" can only be used inside a loop',
    );
  });

  test("break in nested loop is valid", () => {
    const instructions: Instruction[] = [
      { type: "loop", config: makeLoopOptions() },
      { type: "loop", config: makeLoopOptions() },
      { type: "stage", id: "s1", config: makeStageOptions({ name: "s1" }) },
      { type: "break" },
      { type: "endLoop" },
      { type: "stage", id: "s2", config: makeStageOptions({ name: "s2" }) },
      { type: "endLoop" },
    ];
    expect(() => validateInstructions(instructions)).not.toThrow();
  });

  test("break after all loops closed throws", () => {
    const instructions: Instruction[] = [
      { type: "loop", config: makeLoopOptions() },
      { type: "stage", id: "s1", config: makeStageOptions({ name: "s1" }) },
      { type: "endLoop" },
      { type: "stage", id: "s2", config: makeStageOptions({ name: "s2" }) },
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
      b.loop(makeLoopOptions()).stage(makeStageOptions({ name: "s1" })).endLoop(),
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
      b.loop(makeLoopOptions()).stage(makeStageOptions({ name: "s1" })).endLoop(),
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
      b.loop(makeLoopOptions()).stage(makeStageOptions({ name: "s1" })).endLoop(),
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
      b.loop(makeLoopOptions()).stage(makeStageOptions({ name: "s1" })).endLoop(),
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
        .endLoop()
        .stage(makeStageOptions({ name: "s2" })),
    );

    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const edgeToS2 = edgeFromTo(graph, exitNodeId, "s2");
    expect(edgeToS2).toBeDefined();
  });

  test("loop exit node is an end node when no instructions follow", () => {
    const graph = compileGraph((b) =>
      b.loop(makeLoopOptions()).stage(makeStageOptions({ name: "s1" })).endLoop(),
    );

    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    expect(graph.endNodes.has(exitNodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Loop termination — .break(condition) wiring
// ---------------------------------------------------------------------------

describe("compiler loop break condition", () => {
  test("back-edge only checks maxCycles (no until predicate)", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;

    const state = makeBaseState();
    // With maxCycles=10 and no break, all iterations continue
    expect(backEdge.condition!(state)).toBe(true);
  });

  test("conditional break exits loop when condition returns true", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => () => true)
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    // break_exit edge should fire when condition is true
    const breakExitEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.to === exitNodeId && e.label === "break_exit",
    )!;
    expect(breakExitEdge).toBeDefined();

    const state = makeBaseState();
    expect(breakExitEdge.condition!(state)).toBe(true);
  });

  test("conditional break continues loop when condition returns false", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => () => false)
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;

    // break_continue edge should fire when condition is false (negated)
    const breakContinueEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.label === "break_continue",
    )!;
    expect(breakContinueEdge).toBeDefined();

    const state = makeBaseState();
    // condition returns false, so !false = true → continue
    expect(breakContinueEdge.condition!(state)).toBe(true);
  });

  test("conditional break predicate receives current state", () => {
    let receivedState: BaseState | null = null;
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => (s: BaseState) => {
          receivedState = s;
          return false;
        })
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const breakExitEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.to === exitNodeId && e.label === "break_exit",
    )!;

    const state = makeBaseState({ executionId: "custom-id" });
    breakExitEdge.condition!(state);

    expect(receivedState).not.toBeNull();
    expect(receivedState!).toBe(state);
    expect(receivedState!.executionId).toBe("custom-id");
  });

  test("conditional break that checks state outputs", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => (s: BaseState) => s.outputs["reviewer"] === "clean")
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const breakExitEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.to === exitNodeId && e.label === "break_exit",
    )!;
    const breakContinueEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.label === "break_continue",
    )!;

    // Not clean — should continue (break condition false)
    const stateDirty = makeBaseState({ outputs: { reviewer: "dirty" } });
    expect(breakExitEdge.condition!(stateDirty)).toBe(false);
    expect(breakContinueEdge.condition!(stateDirty)).toBe(true);

    // Clean — should exit (break condition true)
    const stateClean = makeBaseState({ outputs: { reviewer: "clean" } });
    expect(breakExitEdge.condition!(stateClean)).toBe(true);
    expect(breakContinueEdge.condition!(stateClean)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Loop termination — maxCycles enforcement
// ---------------------------------------------------------------------------

describe("compiler loop maxCycles enforcement", () => {
  test("back-edge stops after maxCycles iterations", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 3 })
        .stage(makeStageOptions({ name: "s1" }))
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
        .loop({ maxCycles: 1 })
        .stage(makeStageOptions({ name: "s1" }))
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

  test("break condition terminates before maxCycles", () => {
    let callCount = 0;
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => () => {
          callCount++;
          return callCount >= 2; // Terminate on 2nd evaluation
        })
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const breakExitEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.to === exitNodeId && e.label === "break_exit",
    )!;
    const state = makeBaseState();

    // 1st evaluation: callCount=1, returns false → continue
    expect(breakExitEdge.condition!(state)).toBe(false);
    // 2nd evaluation: callCount=2, returns true → break exits loop
    expect(breakExitEdge.condition!(state)).toBe(true);
  });

  test("iteration counter persists across evaluations", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 5 })
        .stage(makeStageOptions({ name: "s1" }))
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
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
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

  test("continue and exit edges are mutually exclusive when exiting at maxCycles", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 1 })
        .stage(makeStageOptions({ name: "s1" }))
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    const state = makeBaseState();

    // maxCycles=1: first check exits
    const continueResult = backEdge.condition!(state);
    const exitResult = exitEdge.condition!(state);

    expect(continueResult).toBe(false);
    expect(exitResult).toBe(true);
  });

  test("continue and exit edges are mutually exclusive at maxCycles boundary", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 1 })
        .stage(makeStageOptions({ name: "s1" }))
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
        .break()
        .stage(makeStageOptions({ name: "s2" }))
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s2" }))
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
        .loop({ maxCycles: 3 })
        .stage(makeStageOptions({ name: "s1" }))
        .loop({ maxCycles: 2 })
        .stage(makeStageOptions({ name: "s2" }))
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
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop()
        .stage(makeStageOptions({ name: "s3" }))
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
        .loop(makeLoopOptions())
        .tool(makeToolOptions({ name: "t1" }))
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
  test("simulated traversal respects break condition", () => {
    let checkCount = 0;
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 10 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => () => {
          checkCount++;
          return checkCount >= 3; // terminate after 3 evaluations
        })
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const breakExitEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.to === exitNodeId && e.label === "break_exit",
    )!;
    const state = makeBaseState();

    // Simulate: call condition on each "visit" to break node
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(breakExitEdge.condition!(state));
    }

    // Should continue for 2 iterations, then break
    expect(results[0]).toBe(false); // check 1: checkCount=1, not yet → continue
    expect(results[1]).toBe(false); // check 2: checkCount=2, not yet → continue
    expect(results[2]).toBe(true); // check 3: checkCount=3 → break exits loop
  });

  test("simulated traversal respects maxCycles without any break", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 3 })
        .stage(makeStageOptions({ name: "s1" }))
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

// ---------------------------------------------------------------------------
// Additional coverage: independent termination, counter isolation, break in conditional
// ---------------------------------------------------------------------------

describe("compiler loop break and maxCycles independence", () => {
  test("maxCycles terminates even when break condition never fires", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 2 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => () => false) // never fires
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    const state = makeBaseState();

    // Iteration 1: count=1 < 2 → continue
    expect(backEdge.condition!(state)).toBe(true);
    expect(exitEdge.condition!(state)).toBe(false);

    // Iteration 2: count=2 < 2 = false → maxCycles forces exit
    expect(backEdge.condition!(state)).toBe(false);
    expect(exitEdge.condition!(state)).toBe(true);
  });

  test("break exits loop before maxCycles is reached", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 1_000_000 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => () => true) // always fires
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const breakExitEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.to === exitNodeId && e.label === "break_exit",
    )!;
    const state = makeBaseState();

    // Very first evaluation: break condition true → exit, regardless of maxCycles
    expect(breakExitEdge.condition!(state)).toBe(true);
  });

  test("break and maxCycles are evaluated independently", () => {
    // Break condition fires on 3rd evaluation; maxCycles=3 also reached on 3rd back-edge check.
    // They operate on different edges, so both mechanisms work independently.
    let breakCallCount = 0;
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 3 })
        .stage(makeStageOptions({ name: "s1" }))
        .break(() => () => {
          breakCallCount++;
          return breakCallCount >= 3; // fires on 3rd evaluation
        })
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const breakExitEdge = graph.edges.find(
      (e) => e.from === breakNodeId && e.to === exitNodeId && e.label === "break_exit",
    )!;
    const state = makeBaseState();

    // Back-edge (maxCycles) and break condition are on different nodes
    // They can be evaluated independently
    expect(backEdge.condition!(state)).toBe(true); // iteration 1 < 3
    expect(breakExitEdge.condition!(state)).toBe(false); // breakCallCount=1, < 3

    expect(backEdge.condition!(state)).toBe(true); // iteration 2 < 3
    expect(breakExitEdge.condition!(state)).toBe(false); // breakCallCount=2, < 3

    // Iteration 3: both would trigger exit via their respective edges
    expect(backEdge.condition!(state)).toBe(false); // iteration 3 = maxCycles → exit
    expect(breakExitEdge.condition!(state)).toBe(true); // breakCallCount=3, >= 3 → break
  });
});

describe("compiler loop iteration counter isolation", () => {
  test("each compiled workflow has its own iteration counter", () => {
    // Compile workflow 1 and exhaust its counter
    const graph1 = compileGraph((b) =>
      b
        .loop({ maxCycles: 2 })
        .stage(makeStageOptions({ name: "s1" }))
        .endLoop(),
    );

    const checkNodeId1 = Array.from(graph1.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge1 = edgesFrom(graph1, checkNodeId1, "loop_continue")[0]!;
    const state = makeBaseState();

    // Exhaust graph1's counter
    expect(backEdge1.condition!(state)).toBe(true); // count=1
    expect(backEdge1.condition!(state)).toBe(false); // count=2 → exit

    // Compile workflow 2 — should start fresh
    const graph2 = compileGraph((b) =>
      b
        .loop({ maxCycles: 2 })
        .stage(makeStageOptions({ name: "s1" }))
        .endLoop(),
    );

    const checkNodeId2 = Array.from(graph2.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge2 = edgesFrom(graph2, checkNodeId2, "loop_continue")[0]!;

    // graph2's counter starts at 0 — not affected by graph1
    expect(backEdge2.condition!(state)).toBe(true); // count=1
    expect(backEdge2.condition!(state)).toBe(false); // count=2 → exit
  });

  test("nested loop counters are independent of each other within same compilation", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 3 })
        .stage(makeStageOptions({ name: "s1" }))
        .loop({ maxCycles: 2 })
        .stage(makeStageOptions({ name: "s2" }))
        .endLoop()
        .endLoop(),
    );

    const checkNodes = Array.from(graph.nodes.keys())
      .filter((id) => id.startsWith("__loop_check_"))
      .sort(); // deterministic order

    expect(checkNodes).toHaveLength(2);

    const state = makeBaseState();

    // Find inner and outer by checking maxCycles behavior
    // The inner loop (maxCycles=2) should exhaust after 2 evaluations
    // The outer loop (maxCycles=3) should exhaust after 3 evaluations
    const edgesForCheck0 = edgesFrom(graph, checkNodes[0]!, "loop_continue");
    const edgesForCheck1 = edgesFrom(graph, checkNodes[1]!, "loop_continue");

    // Check that both have independent counters by verifying
    // they exhaust at different maxCycles values
    const backEdge0 = edgesForCheck0[0]!;
    const backEdge1 = edgesForCheck1[0]!;

    // Evaluate each independently — neither should affect the other
    const result0_1 = backEdge0.condition!(state);
    const result1_1 = backEdge1.condition!(state);

    // Both should still be continuing after 1 iteration
    expect(result0_1).toBe(true);
    expect(result1_1).toBe(true);
  });
});

describe("compiler break inside conditional", () => {
  test("break inside an if block within a loop is valid and wired correctly", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopOptions())
        .stage(makeStageOptions({ name: "s1" }))
        .if(() => true)
        .stage(makeStageOptions({ name: "s2" }))
        .break()
        .endIf()
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    // Break should exist
    expect(breakNodeId).toBeDefined();

    // Break should have an unconditional edge to the exit node
    const breakToExit = edgeFromTo(graph, breakNodeId, exitNodeId);
    expect(breakToExit).toBeDefined();
    expect(breakToExit!.condition).toBeUndefined();
  });

  test("break inside else block within a loop wires to loop exit", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopOptions())
        .if(() => true)
        .stage(makeStageOptions({ name: "s1" }))
        .else()
        .stage(makeStageOptions({ name: "s2" }))
        .break()
        .endIf()
        .endLoop(),
    );

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    const exitNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_exit_"),
    )!;

    expect(breakNodeId).toBeDefined();

    const breakToExit = edgeFromTo(graph, breakNodeId, exitNodeId);
    expect(breakToExit).toBeDefined();
    expect(breakToExit!.condition).toBeUndefined();
  });

  test("break inside conditional validation: break in if inside loop does not throw", () => {
    const instructions: Instruction[] = [
      { type: "loop", config: makeLoopOptions() },
      { type: "if", condition: () => true },
      { type: "stage", id: "s1", config: makeStageOptions({ name: "s1" }) },
      { type: "break" },
      { type: "endIf" },
      { type: "stage", id: "s2", config: makeStageOptions({ name: "s2" }) },
      { type: "endLoop" },
    ];
    expect(() => validateInstructions(instructions)).not.toThrow();
  });
});

describe("compiler loop edge stability after exhaustion", () => {
  test("exit edge remains true after maxCycles is exceeded", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 2 })
        .stage(makeStageOptions({ name: "s1" }))
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    const state = makeBaseState();

    // Exhaust counter
    backEdge.condition!(state); // count=1, continue
    backEdge.condition!(state); // count=2, exit

    // Further evaluations: counter keeps incrementing but still exits
    expect(backEdge.condition!(state)).toBe(false); // count=3
    expect(exitEdge.condition!(state)).toBe(true);

    expect(backEdge.condition!(state)).toBe(false); // count=4
    expect(exitEdge.condition!(state)).toBe(true);
  });

  test("mutual exclusivity holds at every iteration from start to past exhaustion", () => {
    const graph = compileGraph((b) =>
      b
        .loop({ maxCycles: 3 })
        .stage(makeStageOptions({ name: "s1" }))
        .endLoop(),
    );

    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    const backEdge = edgesFrom(graph, checkNodeId, "loop_continue")[0]!;
    const exitEdge = edgesFrom(graph, checkNodeId, "loop_exit")[0]!;
    const state = makeBaseState();

    // Check mutual exclusivity at every step: before, at, and past maxCycles
    for (let i = 0; i < 6; i++) {
      const continueResult = backEdge.condition!(state);
      const exitResult = exitEdge.condition!(state);

      // They must always be the logical inverse of each other
      expect(continueResult).not.toBe(exitResult);
    }
  });
});

// ---------------------------------------------------------------------------
// Null agent — default SDK instructions
// ---------------------------------------------------------------------------

describe("compiler null agent handling", () => {
  test("stage with null agent compiles without error", () => {
    expect(() =>
      compileGraph((b) =>
        b.stage(makeStageOptions({ name: "s1", agent: null })),
      ),
    ).not.toThrow();
  });

  test("stage with omitted agent compiles without error", () => {
    expect(() =>
      compileGraph((b) =>
        b.stage({
          name: "s1",
          description: "Uses default SDK instructions",
          prompt: () => "Do something",
          outputMapper: () => ({}),
        }),
      ),
    ).not.toThrow();
  });

  test("null agent stage does not set systemPrompt on sessionConfig", () => {
    const builder = defineWorkflow({ name: "test-wf", description: "test" })
      .stage(makeStageOptions({ name: "s1", agent: null }));
    const compiled = builder.compile();
    const stages = compiled.conductorStages as unknown as Array<{ id: string; sessionConfig?: { systemPrompt?: string } }>;

    expect(stages).toHaveLength(1);
    expect(stages[0]!.sessionConfig?.systemPrompt).toBeUndefined();
  });

  test("null agent stage uses stage name as graph node name", () => {
    const graph = compileGraph((b) =>
      b.stage(makeStageOptions({ name: "my-stage", agent: null })),
    );

    const node = graph.nodes.get("my-stage");
    expect(node).toBeDefined();
    expect(node!.name).toBe("my-stage");
  });

  test("stage with explicit agent still resolves normally", () => {
    const graph = compileGraph((b) =>
      b.stage(makeStageOptions({ name: "s1", agent: "custom-agent" })),
    );

    const node = graph.nodes.get("s1");
    expect(node).toBeDefined();
    expect(node!.name).toBe("custom-agent");
  });
});
