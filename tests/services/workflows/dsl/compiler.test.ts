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
import type { StageOptions, ToolOptions, LoopOptions, AskUserQuestionOptions, Instruction } from "@/services/workflows/dsl/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type { BaseState, Edge, CompiledGraph, ExecutionContext } from "@/services/workflows/graph/types.ts";

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

function makeAskUserOptions(overrides?: Partial<AskUserQuestionOptions>): AskUserQuestionOptions {
  return {
    name: overrides?.name ?? "test-question",
    question: { question: "Continue?" },
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

// ---------------------------------------------------------------------------
// validateInstructions — askUserQuestion validation
// ---------------------------------------------------------------------------

describe("validateInstructions askUserQuestion", () => {
  test("askUserQuestion is accepted as a valid node", () => {
    const instructions: Instruction[] = [
      { type: "askUserQuestion", id: "q1", config: makeAskUserOptions({ name: "q1" }) },
    ];
    expect(() => validateInstructions(instructions)).not.toThrow();
  });

  test("askUserQuestion satisfies 'at least one node' requirement", () => {
    const instructions: Instruction[] = [
      { type: "askUserQuestion", id: "q1", config: makeAskUserOptions({ name: "q1" }) },
    ];
    expect(() => validateInstructions(instructions)).not.toThrow();
  });

  test("duplicate askUserQuestion IDs throw", () => {
    const instructions: Instruction[] = [
      { type: "askUserQuestion", id: "q1", config: makeAskUserOptions({ name: "q1" }) },
      { type: "askUserQuestion", id: "q1", config: makeAskUserOptions({ name: "q1" }) },
    ];
    expect(() => validateInstructions(instructions)).toThrow('Duplicate node ID: "q1"');
  });

  test("askUserQuestion ID duplicating a stage ID throws", () => {
    const instructions: Instruction[] = [
      { type: "stage", id: "shared", config: makeStageOptions({ name: "shared" }) },
      { type: "askUserQuestion", id: "shared", config: makeAskUserOptions({ name: "shared" }) },
    ];
    expect(() => validateInstructions(instructions)).toThrow('Duplicate node ID: "shared"');
  });

  test("askUserQuestion inside a conditional branch makes it non-empty", () => {
    const instructions: Instruction[] = [
      { type: "stage", id: "s1", config: makeStageOptions({ name: "s1" }) },
      { type: "if", condition: () => true },
      { type: "askUserQuestion", id: "q1", config: makeAskUserOptions({ name: "q1" }) },
      { type: "endIf" },
    ];
    expect(() => validateInstructions(instructions)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Graph Generation — askUserQuestion nodes
// ---------------------------------------------------------------------------

describe("compiler askUserQuestion graph generation", () => {
  test("askUserQuestion produces an ask_user type node in the graph", () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({ name: "q1" })),
    );

    const node = graph.nodes.get("q1");
    expect(node).toBeDefined();
    expect(node!.type).toBe("ask_user");
  });

  test("askUserQuestion node is connected to previous and next nodes", () => {
    const graph = compileGraph((b) =>
      b
        .stage(makeStageOptions({ name: "s1" }))
        .askUserQuestion(makeAskUserOptions({ name: "q1" }))
        .stage(makeStageOptions({ name: "s2" })),
    );

    // s1 → q1
    const edgeS1ToQ1 = edgeFromTo(graph, "s1", "q1");
    expect(edgeS1ToQ1).toBeDefined();

    // q1 → s2
    const edgeQ1ToS2 = edgeFromTo(graph, "q1", "s2");
    expect(edgeQ1ToS2).toBeDefined();
  });

  test("askUserQuestion does NOT produce a StageDefinition", () => {
    const builder = defineWorkflow({ name: "test-wf", description: "test" })
      .stage(makeStageOptions({ name: "s1" }))
      .askUserQuestion(makeAskUserOptions({ name: "q1" }))
      .stage(makeStageOptions({ name: "s2" }));

    const compiled = builder.compile();
    const stages = compiled.conductorStages as unknown as Array<{ id: string }>;

    // Only stage instructions produce StageDefinitions
    expect(stages).toHaveLength(2);
    expect(stages[0]!.id).toBe("s1");
    expect(stages[1]!.id).toBe("s2");
  });

  test("askUserQuestion as the only node compiles successfully", () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({ name: "q1" })),
    );

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.nodes.get("q1")).toBeDefined();
    expect(graph.startNode).toBe("q1");
    expect(graph.endNodes.has("q1")).toBe(true);
  });

  test("askUserQuestion node name uses options.name", () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({ name: "my-question" })),
    );

    const node = graph.nodes.get("my-question");
    expect(node).toBeDefined();
    expect(node!.name).toBe("my-question");
  });

  test("askUserQuestion with description sets node description", () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({
        name: "q1",
        description: "Ask for review approval"
      })),
    );

    const node = graph.nodes.get("q1");
    expect(node).toBeDefined();
    expect(node!.description).toBe("Ask for review approval");
  });
});

// ---------------------------------------------------------------------------
// askUserQuestion inside conditional blocks
// ---------------------------------------------------------------------------

describe("compiler askUserQuestion in conditionals", () => {
  test("askUserQuestion inside an if block is valid and wired correctly", () => {
    const graph = compileGraph((b) =>
      b
        .stage(makeStageOptions({ name: "s1" }))
        .if(() => true)
          .askUserQuestion(makeAskUserOptions({ name: "q1" }))
        .endIf()
        .stage(makeStageOptions({ name: "s2" })),
    );

    expect(graph.nodes.get("q1")).toBeDefined();
    expect(graph.nodes.get("q1")!.type).toBe("ask_user");

    // Edges: s1 → q1 → s2
    expect(edgeFromTo(graph, "s1", "q1")).toBeDefined();
    expect(edgeFromTo(graph, "q1", "s2")).toBeDefined();
  });

  test("askUserQuestion inside else block is valid", () => {
    const graph = compileGraph((b) =>
      b
        .if(() => true)
          .stage(makeStageOptions({ name: "s1" }))
        .else()
          .askUserQuestion(makeAskUserOptions({ name: "q1" }))
        .endIf(),
    );

    expect(graph.nodes.get("q1")).toBeDefined();
    expect(graph.nodes.get("q1")!.type).toBe("ask_user");
  });
});

// ---------------------------------------------------------------------------
// askUserQuestion inside loop blocks
// ---------------------------------------------------------------------------

describe("compiler askUserQuestion in loops", () => {
  test("askUserQuestion inside a loop is valid and wired correctly", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopOptions())
          .stage(makeStageOptions({ name: "s1" }))
          .askUserQuestion(makeAskUserOptions({ name: "q1" }))
        .endLoop(),
    );

    expect(graph.nodes.get("q1")).toBeDefined();
    expect(graph.nodes.get("q1")!.type).toBe("ask_user");

    // s1 → q1
    expect(edgeFromTo(graph, "s1", "q1")).toBeDefined();

    // q1 → loop check
    const checkNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__loop_check_"),
    )!;
    expect(edgeFromTo(graph, "q1", checkNodeId)).toBeDefined();
  });

  test("askUserQuestion with break in loop compiles correctly", () => {
    const graph = compileGraph((b) =>
      b
        .loop(makeLoopOptions())
          .askUserQuestion(makeAskUserOptions({ name: "q1" }))
          .break(() => () => true)
        .endLoop(),
    );

    expect(graph.nodes.get("q1")).toBeDefined();

    const breakNodeId = Array.from(graph.nodes.keys()).find((id) =>
      id.startsWith("__break_"),
    )!;
    expect(breakNodeId).toBeDefined();

    // q1 → break node
    expect(edgeFromTo(graph, "q1", breakNodeId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// askUserQuestion graph node descriptions
// ---------------------------------------------------------------------------

describe("compiler askUserQuestion node descriptions", () => {
  test("compiled workflow includes askUserQuestion node in nodeDescriptions", () => {
    const builder = defineWorkflow({ name: "w", description: "d" })
      .askUserQuestion(makeAskUserOptions({ name: "confirm" }));

    const compiled = builder.compile();
    const descriptions = compiled.nodeDescriptions as Record<string, string>;

    expect(descriptions.confirm).toBe("confirm");
  });
});

// ---------------------------------------------------------------------------
// askUserQuestion askUserNode() factory integration
// ---------------------------------------------------------------------------

describe("compiler askUserQuestion uses askUserNode factory", () => {
  test("askUserQuestion node execute emits human_input_required with dslAskUser flag", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({ name: "q1" })),
    );

    const node = graph.nodes.get("q1")!;
    expect(node).toBeDefined();

    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
      },
    };

    const result = await node.execute(ctx);

    // Should have emitted human_input_required event
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.type).toBe("human_input_required");
    expect(emittedEvents[0]!.data).toBeDefined();
    expect(emittedEvents[0]!.data!.dslAskUser).toBe(true);
    expect(emittedEvents[0]!.data!.question).toBe("Continue?");
    expect(emittedEvents[0]!.data!.nodeId).toBe("q1");

    // Should also return signals with human_input_required
    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals![0]!.type).toBe("human_input_required");

    // Should set wait state
    expect(result.stateUpdate).toBeDefined();
    const stateUpdate = result.stateUpdate as Record<string, unknown>;
    expect(stateUpdate.__waitingForInput).toBe(true);
    expect(stateUpdate.__waitNodeId).toBe("q1");
    expect(stateUpdate.__askUserRequestId).toBeDefined();
  });

  test("askUserQuestion node execute works without emit callback", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({ name: "q1" })),
    );

    const node = graph.nodes.get("q1")!;
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      // No emit callback
    };

    // Should not throw when emit is not provided
    const result = await node.execute(ctx);
    expect(result.stateUpdate).toBeDefined();
    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals![0]!.type).toBe("human_input_required");
  });

  test("askUserQuestion passes multiSelect through to event data", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({
        name: "q1",
        question: {
          question: "Pick options",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: true,
        },
      })),
    );

    const node = graph.nodes.get("q1")!;
    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
      },
    };

    await node.execute(ctx);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.data!.multiSelect).toBe(true);
    expect(emittedEvents[0]!.data!.dslAskUser).toBe(true);
  });

  test("askUserQuestion passes options array through to event data", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({
        name: "q1",
        question: {
          question: "Choose one",
          options: [
            { label: "Yes", description: "Approve" },
            { label: "No", description: "Reject" },
          ],
        },
      })),
    );

    const node = graph.nodes.get("q1")!;
    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
      },
    };

    await node.execute(ctx);

    expect(emittedEvents[0]!.data!.question).toBe("Choose one");
    const options = emittedEvents[0]!.data!.options as Array<{ label: string; description?: string }>;
    expect(options).toHaveLength(2);
    expect(options[0]!.label).toBe("Yes");
    expect(options[1]!.label).toBe("No");
  });

  test("askUserQuestion passes header through to event data", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({
        name: "q1",
        question: {
          question: "Continue?",
          header: "Review Required",
        },
      })),
    );

    const node = graph.nodes.get("q1")!;
    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
      },
    };

    await node.execute(ctx);

    expect(emittedEvents[0]!.data!.header).toBe("Review Required");
  });

  test("askUserQuestion with dynamic question resolves from state", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: (state: BaseState) => ({
          question: `Review output for ${state.executionId}?`,
          header: "Dynamic Header",
          multiSelect: false,
        }),
      }),
    );

    const node = graph.nodes.get("q1")!;
    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState({ executionId: "exec-123" }),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
      },
    };

    await node.execute(ctx);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.data!.question).toBe("Review output for exec-123?");
    expect(emittedEvents[0]!.data!.header).toBe("Dynamic Header");
    expect(emittedEvents[0]!.data!.dslAskUser).toBe(true);
  });

  test("askUserQuestion with dynamic options and multiSelect", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: (state: BaseState) => ({
          question: "Select items",
          options: Object.keys(state.outputs).map((k) => ({ label: k })),
          multiSelect: true,
        }),
      }),
    );

    const node = graph.nodes.get("q1")!;
    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState({ outputs: { file1: "ok", file2: "error" } }),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
      },
    };

    await node.execute(ctx);

    expect(emittedEvents[0]!.data!.multiSelect).toBe(true);
    const options = emittedEvents[0]!.data!.options as Array<{ label: string }>;
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.label).sort()).toEqual(["file1", "file2"]);
  });

  test("each compiled graph creates fresh askUserNode instances", async () => {
    // Ensure that recompiling produces independent nodes
    const builder = defineWorkflow({ name: "w", description: "d" })
      .askUserQuestion(makeAskUserOptions({ name: "q1" }));
    const compiled = builder.compile();

    const graph1 = compiled.createConductorGraph!() as CompiledGraph<BaseState>;
    const graph2 = compiled.createConductorGraph!() as CompiledGraph<BaseState>;

    // Different node instances
    const node1 = graph1.nodes.get("q1")!;
    const node2 = graph2.nodes.get("q1")!;
    expect(node1).not.toBe(node2);
  });
});

// ---------------------------------------------------------------------------
// askUserQuestion outputMapper callback wiring
// ---------------------------------------------------------------------------

describe("compiler askUserQuestion outputMapper callback", () => {
  test("outputMapper is invoked with the user's answer and result is merged into stateUpdate", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: {
          question: "Approve changes?",
          options: [{ label: "Yes" }, { label: "No" }],
        },
        outputMapper: (answer) => ({
          approved: answer === "Yes",
        }),
      }),
    );

    const node = graph.nodes.get("q1")!;
    // Simulate execution with emit that calls respond immediately
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (_type: string, data?: Record<string, unknown>) => {
        const respond = data?.respond as (answer: string | string[]) => void;
        // Simulate user selecting "Yes"
        respond("Yes");
      },
    };

    const result = await node.execute(ctx);

    expect(result.stateUpdate).toBeDefined();
    const stateUpdate = result.stateUpdate as Record<string, unknown>;
    expect(stateUpdate.approved).toBe(true);
    expect(stateUpdate.__waitingForInput).toBe(false);
  });

  test("outputMapper receives multi-select array when multiSelect is true", async () => {
    const receivedAnswers: Array<string | string[]> = [];
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: {
          question: "Select items",
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
          multiSelect: true,
        },
        outputMapper: (answer) => {
          receivedAnswers.push(answer);
          return { selections: answer };
        },
      }),
    );

    const node = graph.nodes.get("q1")!;
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (_type: string, data?: Record<string, unknown>) => {
        const respond = data?.respond as (answer: string | string[]) => void;
        respond(["A", "C"]);
      },
    };

    const result = await node.execute(ctx);

    // Compilation probes outputMapper("") once to infer outputs, so the runtime
    // answer ["A", "C"] is the last entry rather than the only one.
    const runtimeAnswers = receivedAnswers.filter((a) => Array.isArray(a));
    expect(runtimeAnswers).toHaveLength(1);
    expect(runtimeAnswers[0]).toEqual(["A", "C"]);
    const stateUpdate = result.stateUpdate as Record<string, unknown>;
    expect(stateUpdate.selections).toEqual(["A", "C"]);
  });

  test("outputMapper result is merged with original askUserNode stateUpdate", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: { question: "Continue?" },
        outputMapper: (answer) => ({ userChoice: answer }),
      }),
    );

    const node = graph.nodes.get("q1")!;
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (_type: string, data?: Record<string, unknown>) => {
        const respond = data?.respond as (answer: string | string[]) => void;
        respond("yes");
      },
    };

    const result = await node.execute(ctx);
    const stateUpdate = result.stateUpdate as Record<string, unknown>;

    // outputMapper result
    expect(stateUpdate.userChoice).toBe("yes");
    // __waitingForInput is cleared after answer
    expect(stateUpdate.__waitingForInput).toBe(false);
  });

  test("outputMapper emitted event still has dslAskUser flag", async () => {
    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: { question: "Continue?" },
        outputMapper: (answer) => ({ choice: answer }),
      }),
    );

    const node = graph.nodes.get("q1")!;
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
        const respond = data?.respond as (answer: string | string[]) => void;
        respond("ok");
      },
    };

    await node.execute(ctx);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]!.data!.dslAskUser).toBe(true);
  });

  test("without outputMapper, execute does not block (returns immediately)", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion(makeAskUserOptions({ name: "q1" })),
    );

    const node = graph.nodes.get("q1")!;
    const emittedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({ type, data });
        // Do NOT call respond — if outputMapper were wired, this would hang
      },
    };

    // Should resolve immediately without waiting for respond
    const result = await node.execute(ctx);

    expect(result.stateUpdate).toBeDefined();
    const stateUpdate = result.stateUpdate as Record<string, unknown>;
    expect(stateUpdate.__waitingForInput).toBe(true);
  });

  test("outputMapper is not invoked when emit is unavailable", async () => {
    let outputMapperCallCount = 0;
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: { question: "Continue?" },
        outputMapper: () => {
          outputMapperCallCount++;
          return {};
        },
      }),
    );

    // Compilation probes outputMapper once to infer outputs; record the
    // count after compilation so we can detect runtime-only invocations.
    const countAfterCompile = outputMapperCallCount;

    const node = graph.nodes.get("q1")!;
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      // No emit callback — conductor path
    };

    const result = await node.execute(ctx);

    // Falls back to non-blocking path; outputMapper is not invoked at runtime
    expect(outputMapperCallCount).toBe(countAfterCompile);
    expect(result.stateUpdate).toBeDefined();
    const stateUpdate = result.stateUpdate as Record<string, unknown>;
    expect(stateUpdate.__waitingForInput).toBe(true);
  });

  test("outputMapper with dynamic question resolves correctly", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: (state: BaseState) => ({
          question: `Review ${state.executionId}?`,
          options: [{ label: "Approve" }, { label: "Reject" }],
        }),
        outputMapper: (answer) => ({
          reviewResult: answer === "Approve" ? "approved" : "rejected",
        }),
      }),
    );

    const node = graph.nodes.get("q1")!;
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState({ executionId: "exec-42" }),
      config: {},
      errors: [],
      emit: (_type: string, data?: Record<string, unknown>) => {
        // Verify dynamic question was resolved
        expect(data?.question).toBe("Review exec-42?");
        const respond = data?.respond as (answer: string | string[]) => void;
        respond("Approve");
      },
    };

    const result = await node.execute(ctx);
    const stateUpdate = result.stateUpdate as Record<string, unknown>;
    expect(stateUpdate.reviewResult).toBe("approved");
  });

  test("outputMapper signals are preserved from original result", async () => {
    const graph = compileGraph((b) =>
      b.askUserQuestion({
        name: "q1",
        question: { question: "Continue?" },
        outputMapper: () => ({ answered: true }),
      }),
    );

    const node = graph.nodes.get("q1")!;
    const ctx: ExecutionContext<BaseState> = {
      state: makeBaseState(),
      config: {},
      errors: [],
      emit: (_type: string, data?: Record<string, unknown>) => {
        const respond = data?.respond as (answer: string | string[]) => void;
        respond("yes");
      },
    };

    const result = await node.execute(ctx);

    // Signals from the original askUserNode result are preserved
    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(1);
    expect(result.signals![0]!.type).toBe("human_input_required");
  });
});
