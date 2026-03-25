import { describe, expect, test } from "bun:test";
import {
  createAgentOrderingState,
  clearAgentOrderingState,
  resetAgentOrderingForAgent,
  pruneAgentOrderingState,
  registerAgentCompletionSequence,
  registerDoneStateProjection,
  registerFirstPostCompleteDeltaSequence,
  hasDoneStateProjection,
  type AgentOrderingState,
} from "@/state/chat/shared/helpers/agent-ordering-contract.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Populate state with data for a single agent across all 4 maps. */
function populateAgent(
  state: AgentOrderingState,
  agentId: string,
  opts: {
    sequence?: number;
    doneProjected?: boolean;
    firstDelta?: number;
    projectionSource?: "effect" | "sync-bridge";
  } = {},
): void {
  const { sequence = 1, doneProjected = false, firstDelta, projectionSource } = opts;
  state.lastCompletionSequenceByAgent.set(agentId, sequence);
  state.doneProjectedByAgent.set(agentId, doneProjected);
  if (firstDelta !== undefined) {
    state.firstPostCompleteDeltaSequenceByAgent.set(agentId, firstDelta);
  }
  if (projectionSource !== undefined) {
    state.projectionSourceByAgent.set(agentId, projectionSource);
  }
}

// ---------------------------------------------------------------------------
// createAgentOrderingState
// ---------------------------------------------------------------------------

describe("createAgentOrderingState", () => {
  test("returns an object with four empty maps", () => {
    const state = createAgentOrderingState();
    expect(state.lastCompletionSequenceByAgent.size).toBe(0);
    expect(state.doneProjectedByAgent.size).toBe(0);
    expect(state.firstPostCompleteDeltaSequenceByAgent.size).toBe(0);
    expect(state.projectionSourceByAgent.size).toBe(0);
  });

  test("each call returns a fresh independent state object", () => {
    const a = createAgentOrderingState();
    const b = createAgentOrderingState();
    a.lastCompletionSequenceByAgent.set("agent-1", 42);
    expect(b.lastCompletionSequenceByAgent.size).toBe(0);
  });

  test("returned maps are mutable Map instances", () => {
    const state = createAgentOrderingState();
    expect(state.lastCompletionSequenceByAgent).toBeInstanceOf(Map);
    expect(state.doneProjectedByAgent).toBeInstanceOf(Map);
    expect(state.firstPostCompleteDeltaSequenceByAgent).toBeInstanceOf(Map);
    expect(state.projectionSourceByAgent).toBeInstanceOf(Map);
  });
});

// ---------------------------------------------------------------------------
// clearAgentOrderingState
// ---------------------------------------------------------------------------

describe("clearAgentOrderingState", () => {
  test("clears all four maps when populated", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "a1", { sequence: 10, doneProjected: true, firstDelta: 11, projectionSource: "effect" });
    populateAgent(state, "a2", { sequence: 20, doneProjected: false });

    clearAgentOrderingState(state);

    expect(state.lastCompletionSequenceByAgent.size).toBe(0);
    expect(state.doneProjectedByAgent.size).toBe(0);
    expect(state.firstPostCompleteDeltaSequenceByAgent.size).toBe(0);
    expect(state.projectionSourceByAgent.size).toBe(0);
  });

  test("is safe to call on already-empty state", () => {
    const state = createAgentOrderingState();
    clearAgentOrderingState(state);
    expect(state.lastCompletionSequenceByAgent.size).toBe(0);
  });

  test("state object identity is preserved (mutation, not replacement)", () => {
    const state = createAgentOrderingState();
    const originalMap = state.lastCompletionSequenceByAgent;
    populateAgent(state, "a1", { sequence: 5 });

    clearAgentOrderingState(state);
    expect(state.lastCompletionSequenceByAgent).toBe(originalMap);
  });
});

// ---------------------------------------------------------------------------
// resetAgentOrderingForAgent
// ---------------------------------------------------------------------------

describe("resetAgentOrderingForAgent", () => {
  test("removes the target agent from all four maps", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "target", { sequence: 5, doneProjected: true, firstDelta: 6, projectionSource: "sync-bridge" });

    resetAgentOrderingForAgent(state, "target");

    expect(state.lastCompletionSequenceByAgent.has("target")).toBe(false);
    expect(state.doneProjectedByAgent.has("target")).toBe(false);
    expect(state.firstPostCompleteDeltaSequenceByAgent.has("target")).toBe(false);
    expect(state.projectionSourceByAgent.has("target")).toBe(false);
  });

  test("does not affect other agents", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "keep", { sequence: 1, doneProjected: true, firstDelta: 2, projectionSource: "effect" });
    populateAgent(state, "remove", { sequence: 3, doneProjected: false, firstDelta: 4, projectionSource: "sync-bridge" });

    resetAgentOrderingForAgent(state, "remove");

    expect(state.lastCompletionSequenceByAgent.get("keep")).toBe(1);
    expect(state.doneProjectedByAgent.get("keep")).toBe(true);
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("keep")).toBe(2);
    expect(state.projectionSourceByAgent.get("keep")).toBe("effect");
  });

  test("is a no-op for an unknown agent id", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "a1", { sequence: 1 });

    resetAgentOrderingForAgent(state, "unknown");

    expect(state.lastCompletionSequenceByAgent.size).toBe(1);
    expect(state.doneProjectedByAgent.size).toBe(1);
  });

  test("handles agent that only exists in some maps", () => {
    const state = createAgentOrderingState();
    state.lastCompletionSequenceByAgent.set("partial", 10);
    // partial is only in lastCompletionSequenceByAgent, not in others

    resetAgentOrderingForAgent(state, "partial");
    expect(state.lastCompletionSequenceByAgent.has("partial")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pruneAgentOrderingState
// ---------------------------------------------------------------------------

describe("pruneAgentOrderingState", () => {
  test("removes agents not in activeAgentIds", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "active-1", { sequence: 1 });
    populateAgent(state, "active-2", { sequence: 2 });
    populateAgent(state, "stale", { sequence: 3 });

    const active = new Set(["active-1", "active-2"]);
    pruneAgentOrderingState(state, active);

    expect(state.lastCompletionSequenceByAgent.has("stale")).toBe(false);
    expect(state.lastCompletionSequenceByAgent.has("active-1")).toBe(true);
    expect(state.lastCompletionSequenceByAgent.has("active-2")).toBe(true);
  });

  test("keeps all agents when every agent is active", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "a1", { sequence: 1 });
    populateAgent(state, "a2", { sequence: 2 });

    pruneAgentOrderingState(state, new Set(["a1", "a2"]));

    expect(state.lastCompletionSequenceByAgent.size).toBe(2);
  });

  test("removes all agents when activeAgentIds is empty", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "a1", { sequence: 1, doneProjected: true, firstDelta: 2, projectionSource: "effect" });
    populateAgent(state, "a2", { sequence: 3 });

    pruneAgentOrderingState(state, new Set<string>());

    expect(state.lastCompletionSequenceByAgent.size).toBe(0);
    expect(state.doneProjectedByAgent.size).toBe(0);
    expect(state.firstPostCompleteDeltaSequenceByAgent.size).toBe(0);
    expect(state.projectionSourceByAgent.size).toBe(0);
  });

  test("is safe on empty state", () => {
    const state = createAgentOrderingState();
    pruneAgentOrderingState(state, new Set(["a1"]));
    expect(state.lastCompletionSequenceByAgent.size).toBe(0);
  });

  test("discovers agents spread across different maps", () => {
    const state = createAgentOrderingState();
    // agentA only in doneProjectedByAgent
    state.doneProjectedByAgent.set("agentA", true);
    // agentB only in firstPostCompleteDelta
    state.firstPostCompleteDeltaSequenceByAgent.set("agentB", 5);
    // agentC only in projectionSource
    state.projectionSourceByAgent.set("agentC", "effect");

    pruneAgentOrderingState(state, new Set(["agentA"]));

    expect(state.doneProjectedByAgent.has("agentA")).toBe(true);
    expect(state.firstPostCompleteDeltaSequenceByAgent.has("agentB")).toBe(false);
    expect(state.projectionSourceByAgent.has("agentC")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerAgentCompletionSequence
// ---------------------------------------------------------------------------

describe("registerAgentCompletionSequence", () => {
  test("sets the sequence for a brand-new agent", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);

    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(10);
  });

  test("sets doneProjected to false on registration", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);

    expect(state.doneProjectedByAgent.get("a1")).toBe(false);
  });

  test("deletes firstPostCompleteDelta and projectionSource on registration", () => {
    const state = createAgentOrderingState();
    // Pre-populate with delta and projection
    state.firstPostCompleteDeltaSequenceByAgent.set("a1", 5);
    state.projectionSourceByAgent.set("a1", "effect");

    registerAgentCompletionSequence(state, "a1", 10);

    expect(state.firstPostCompleteDeltaSequenceByAgent.has("a1")).toBe(false);
    expect(state.projectionSourceByAgent.has("a1")).toBe(false);
  });

  test("updates to higher sequence when new sequence exceeds existing", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 5);
    registerAgentCompletionSequence(state, "a1", 10);

    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(10);
  });

  test("keeps existing sequence when new sequence is lower", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);
    registerAgentCompletionSequence(state, "a1", 3);

    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(10);
  });

  test("keeps existing sequence when new sequence is equal", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 7);
    registerAgentCompletionSequence(state, "a1", 7);

    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(7);
  });

  test("resets doneProjected even if it was previously true", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 5);
    state.doneProjectedByAgent.set("a1", true);

    registerAgentCompletionSequence(state, "a1", 10);
    expect(state.doneProjectedByAgent.get("a1")).toBe(false);
  });

  test("does not affect other agents", () => {
    const state = createAgentOrderingState();
    populateAgent(state, "other", { sequence: 99, doneProjected: true, firstDelta: 100, projectionSource: "effect" });

    registerAgentCompletionSequence(state, "a1", 5);

    expect(state.lastCompletionSequenceByAgent.get("other")).toBe(99);
    expect(state.doneProjectedByAgent.get("other")).toBe(true);
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("other")).toBe(100);
    expect(state.projectionSourceByAgent.get("other")).toBe("effect");
  });
});

// ---------------------------------------------------------------------------
// registerDoneStateProjection
// ---------------------------------------------------------------------------

describe("registerDoneStateProjection", () => {
  test("returns true on first projection for an agent", () => {
    const state = createAgentOrderingState();
    const result = registerDoneStateProjection(state, {
      agentId: "a1",
      sequence: 10,
      projectionMode: "effect",
    });

    expect(result).toBe(true);
  });

  test("sets doneProjected to true", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "effect" });

    expect(state.doneProjectedByAgent.get("a1")).toBe(true);
  });

  test("sets projectionSource to the given projectionMode", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "sync-bridge" });

    expect(state.projectionSourceByAgent.get("a1")).toBe("sync-bridge");
  });

  test("updates sequence to max of existing and new when new is higher", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 5);
    registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "effect" });

    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(10);
  });

  test("keeps existing sequence when it is higher than the new one", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 20);
    registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "effect" });

    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(20);
  });

  test("returns false on second projection (idempotent guard)", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "effect" });
    const result = registerDoneStateProjection(state, { agentId: "a1", sequence: 20, projectionMode: "sync-bridge" });

    expect(result).toBe(false);
  });

  test("does not update state on duplicate projection", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "effect" });

    registerDoneStateProjection(state, { agentId: "a1", sequence: 99, projectionMode: "sync-bridge" });

    // Sequence and projectionSource should remain from the first call
    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(10);
    expect(state.projectionSourceByAgent.get("a1")).toBe("effect");
  });

  test("works independently for different agents", () => {
    const state = createAgentOrderingState();
    const r1 = registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "effect" });
    const r2 = registerDoneStateProjection(state, { agentId: "a2", sequence: 20, projectionMode: "sync-bridge" });

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(state.doneProjectedByAgent.get("a1")).toBe(true);
    expect(state.doneProjectedByAgent.get("a2")).toBe(true);
  });

  test("returns true after registerAgentCompletionSequence resets doneProjected", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 5, projectionMode: "effect" });
    // Completion resets doneProjected to false
    registerAgentCompletionSequence(state, "a1", 10);
    const result = registerDoneStateProjection(state, { agentId: "a1", sequence: 15, projectionMode: "sync-bridge" });

    expect(result).toBe(true);
    expect(state.projectionSourceByAgent.get("a1")).toBe("sync-bridge");
  });

  test("sets completion sequence when no prior completion was registered", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 42, projectionMode: "effect" });

    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// registerFirstPostCompleteDeltaSequence
// ---------------------------------------------------------------------------

describe("registerFirstPostCompleteDeltaSequence", () => {
  test("returns false when no completion has been registered for the agent", () => {
    const state = createAgentOrderingState();
    const result = registerFirstPostCompleteDeltaSequence(state, "a1", 5);
    expect(result).toBe(false);
  });

  test("returns true when completion exists and no delta has been recorded yet", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);

    const result = registerFirstPostCompleteDeltaSequence(state, "a1", 11);
    expect(result).toBe(true);
  });

  test("stores the delta sequence on success", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);
    registerFirstPostCompleteDeltaSequence(state, "a1", 11);

    expect(state.firstPostCompleteDeltaSequenceByAgent.get("a1")).toBe(11);
  });

  test("returns false on second call (already recorded)", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);
    registerFirstPostCompleteDeltaSequence(state, "a1", 11);

    const result = registerFirstPostCompleteDeltaSequence(state, "a1", 12);
    expect(result).toBe(false);
  });

  test("does not overwrite existing delta on second call", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);
    registerFirstPostCompleteDeltaSequence(state, "a1", 11);
    registerFirstPostCompleteDeltaSequence(state, "a1", 99);

    expect(state.firstPostCompleteDeltaSequenceByAgent.get("a1")).toBe(11);
  });

  test("succeeds again after registerAgentCompletionSequence resets the delta", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);
    registerFirstPostCompleteDeltaSequence(state, "a1", 11);

    // New completion resets delta
    registerAgentCompletionSequence(state, "a1", 20);
    const result = registerFirstPostCompleteDeltaSequence(state, "a1", 21);

    expect(result).toBe(true);
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("a1")).toBe(21);
  });

  test("works independently for different agents", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "a1", 10);
    registerAgentCompletionSequence(state, "a2", 20);

    const r1 = registerFirstPostCompleteDeltaSequence(state, "a1", 11);
    const r2 = registerFirstPostCompleteDeltaSequence(state, "a2", 21);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("a1")).toBe(11);
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("a2")).toBe(21);
  });

  test("returns false for agent with only doneProjected but no completion sequence", () => {
    const state = createAgentOrderingState();
    // Directly set doneProjected without going through registerAgentCompletionSequence
    state.doneProjectedByAgent.set("a1", true);

    const result = registerFirstPostCompleteDeltaSequence(state, "a1", 5);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasDoneStateProjection
// ---------------------------------------------------------------------------

describe("hasDoneStateProjection", () => {
  test("returns false for an unknown agent", () => {
    const state = createAgentOrderingState();
    expect(hasDoneStateProjection(state, "unknown")).toBe(false);
  });

  test("returns false when doneProjected is explicitly false", () => {
    const state = createAgentOrderingState();
    state.doneProjectedByAgent.set("a1", false);
    expect(hasDoneStateProjection(state, "a1")).toBe(false);
  });

  test("returns true when doneProjected is true", () => {
    const state = createAgentOrderingState();
    state.doneProjectedByAgent.set("a1", true);
    expect(hasDoneStateProjection(state, "a1")).toBe(true);
  });

  test("returns true after registerDoneStateProjection", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 5, projectionMode: "effect" });
    expect(hasDoneStateProjection(state, "a1")).toBe(true);
  });

  test("returns false after registerAgentCompletionSequence resets projection", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 5, projectionMode: "effect" });
    registerAgentCompletionSequence(state, "a1", 10);
    expect(hasDoneStateProjection(state, "a1")).toBe(false);
  });

  test("returns false after resetAgentOrderingForAgent", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 5, projectionMode: "effect" });
    resetAgentOrderingForAgent(state, "a1");
    expect(hasDoneStateProjection(state, "a1")).toBe(false);
  });

  test("returns false after clearAgentOrderingState", () => {
    const state = createAgentOrderingState();
    registerDoneStateProjection(state, { agentId: "a1", sequence: 5, projectionMode: "effect" });
    clearAgentOrderingState(state);
    expect(hasDoneStateProjection(state, "a1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: multi-step lifecycle
// ---------------------------------------------------------------------------

describe("agent ordering lifecycle (integration)", () => {
  test("full lifecycle: register completion -> project done -> delta -> reset -> re-register", () => {
    const state = createAgentOrderingState();

    // Step 1: Agent completes
    registerAgentCompletionSequence(state, "a1", 10);
    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(10);
    expect(hasDoneStateProjection(state, "a1")).toBe(false);

    // Step 2: Project done state
    const projected = registerDoneStateProjection(state, { agentId: "a1", sequence: 10, projectionMode: "effect" });
    expect(projected).toBe(true);
    expect(hasDoneStateProjection(state, "a1")).toBe(true);

    // Step 3: Record first post-complete delta
    const deltaOk = registerFirstPostCompleteDeltaSequence(state, "a1", 11);
    expect(deltaOk).toBe(true);
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("a1")).toBe(11);

    // Step 4: New completion resets everything
    registerAgentCompletionSequence(state, "a1", 20);
    expect(hasDoneStateProjection(state, "a1")).toBe(false);
    expect(state.firstPostCompleteDeltaSequenceByAgent.has("a1")).toBe(false);
    expect(state.projectionSourceByAgent.has("a1")).toBe(false);
    expect(state.lastCompletionSequenceByAgent.get("a1")).toBe(20);

    // Step 5: Can project again
    const projectedAgain = registerDoneStateProjection(state, {
      agentId: "a1",
      sequence: 25,
      projectionMode: "sync-bridge",
    });
    expect(projectedAgain).toBe(true);
    expect(state.projectionSourceByAgent.get("a1")).toBe("sync-bridge");
  });

  test("pruning during active workflow with mixed agent states", () => {
    const state = createAgentOrderingState();

    registerAgentCompletionSequence(state, "main", 1);
    registerAgentCompletionSequence(state, "bg-1", 2);
    registerAgentCompletionSequence(state, "bg-2", 3);

    registerDoneStateProjection(state, { agentId: "bg-1", sequence: 2, projectionMode: "effect" });
    registerFirstPostCompleteDeltaSequence(state, "bg-2", 4);

    // bg-2 is removed from active set
    pruneAgentOrderingState(state, new Set(["main", "bg-1"]));

    expect(state.lastCompletionSequenceByAgent.has("main")).toBe(true);
    expect(state.lastCompletionSequenceByAgent.has("bg-1")).toBe(true);
    expect(state.lastCompletionSequenceByAgent.has("bg-2")).toBe(false);
    expect(state.firstPostCompleteDeltaSequenceByAgent.has("bg-2")).toBe(false);
    // bg-1 projection is still intact
    expect(hasDoneStateProjection(state, "bg-1")).toBe(true);
  });
});
