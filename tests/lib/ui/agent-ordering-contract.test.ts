import { describe, expect, test } from "bun:test";

import {
  clearAgentOrderingState,
  createAgentOrderingState,
  hasDoneStateProjection,
  pruneAgentOrderingState,
  resetAgentOrderingForAgent,
  registerAgentCompletionSequence,
  registerDoneStateProjection,
  registerFirstPostCompleteDeltaSequence,
} from "@/lib/ui/agent-ordering-contract.ts";

describe("agent ordering contract state", () => {
  test("creates empty tracking maps", () => {
    const state = createAgentOrderingState();

    expect(state.lastCompletionSequenceByAgent.size).toBe(0);
    expect(state.doneProjectedByAgent.size).toBe(0);
    expect(state.firstPostCompleteDeltaSequenceByAgent.size).toBe(0);
    expect(state.projectionSourceByAgent.size).toBe(0);
  });

  test("records completion sequence and resets projection markers", () => {
    const state = createAgentOrderingState();

    registerDoneStateProjection(state, {
      agentId: "agent-1",
      sequence: 2,
      projectionMode: "effect",
    });
    registerFirstPostCompleteDeltaSequence(state, "agent-1", 6);
    registerAgentCompletionSequence(state, "agent-1", 5);

    expect(state.lastCompletionSequenceByAgent.get("agent-1")).toBe(5);
    expect(hasDoneStateProjection(state, "agent-1")).toBeFalse();
    expect(state.projectionSourceByAgent.has("agent-1")).toBeFalse();
    expect(state.firstPostCompleteDeltaSequenceByAgent.has("agent-1")).toBeFalse();
  });

  test("tracks done-state projection idempotently", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "agent-1", 4);

    const first = registerDoneStateProjection(state, {
      agentId: "agent-1",
      sequence: 4,
      projectionMode: "effect",
    });
    const second = registerDoneStateProjection(state, {
      agentId: "agent-1",
      sequence: 4,
      projectionMode: "effect",
    });

    expect(first).toBeTrue();
    expect(second).toBeFalse();
    expect(hasDoneStateProjection(state, "agent-1")).toBeTrue();
    expect(state.projectionSourceByAgent.get("agent-1")).toBe("effect");
  });

  test("keeps first projection source when duplicate projection arrives", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "agent-1", 4);

    const first = registerDoneStateProjection(state, {
      agentId: "agent-1",
      sequence: 4,
      projectionMode: "sync-bridge",
    });
    const second = registerDoneStateProjection(state, {
      agentId: "agent-1",
      sequence: 4,
      projectionMode: "effect",
    });

    expect(first).toBeTrue();
    expect(second).toBeFalse();
    expect(state.projectionSourceByAgent.get("agent-1")).toBe("sync-bridge");
  });

  test("stores only first post-complete delta sequence", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "agent-1", 3);

    const first = registerFirstPostCompleteDeltaSequence(state, "agent-1", 9);
    const second = registerFirstPostCompleteDeltaSequence(state, "agent-1", 12);

    expect(first).toBeTrue();
    expect(second).toBeFalse();
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("agent-1")).toBe(9);
  });

  test("prunes and clears tracking state", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "agent-1", 2);
    registerAgentCompletionSequence(state, "agent-2", 3);
    registerDoneStateProjection(state, {
      agentId: "agent-1",
      sequence: 2,
      projectionMode: "effect",
    });
    registerFirstPostCompleteDeltaSequence(state, "agent-1", 4);
    registerDoneStateProjection(state, {
      agentId: "agent-2",
      sequence: 3,
      projectionMode: "sync-bridge",
    });
    registerFirstPostCompleteDeltaSequence(state, "agent-2", 5);

    pruneAgentOrderingState(state, new Set(["agent-2"]));
    expect(state.lastCompletionSequenceByAgent.has("agent-1")).toBeFalse();
    expect(state.lastCompletionSequenceByAgent.has("agent-2")).toBeTrue();
    expect(state.doneProjectedByAgent.has("agent-1")).toBeFalse();
    expect(state.firstPostCompleteDeltaSequenceByAgent.has("agent-1")).toBeFalse();
    expect(state.projectionSourceByAgent.has("agent-1")).toBeFalse();
    expect(state.doneProjectedByAgent.has("agent-2")).toBeTrue();
    expect(state.firstPostCompleteDeltaSequenceByAgent.get("agent-2")).toBe(5);
    expect(state.projectionSourceByAgent.get("agent-2")).toBe("sync-bridge");

    clearAgentOrderingState(state);
    expect(state.lastCompletionSequenceByAgent.size).toBe(0);
    expect(state.doneProjectedByAgent.size).toBe(0);
    expect(state.firstPostCompleteDeltaSequenceByAgent.size).toBe(0);
    expect(state.projectionSourceByAgent.size).toBe(0);
  });

  test("resets bookkeeping for a single agent", () => {
    const state = createAgentOrderingState();
    registerAgentCompletionSequence(state, "agent-1", 2);
    registerDoneStateProjection(state, {
      agentId: "agent-1",
      sequence: 2,
      projectionMode: "sync-bridge",
    });
    registerFirstPostCompleteDeltaSequence(state, "agent-1", 7);
    registerAgentCompletionSequence(state, "agent-2", 3);

    resetAgentOrderingForAgent(state, "agent-1");

    expect(state.lastCompletionSequenceByAgent.has("agent-1")).toBeFalse();
    expect(state.doneProjectedByAgent.has("agent-1")).toBeFalse();
    expect(state.firstPostCompleteDeltaSequenceByAgent.has("agent-1")).toBeFalse();
    expect(state.projectionSourceByAgent.has("agent-1")).toBeFalse();
    expect(state.lastCompletionSequenceByAgent.get("agent-2")).toBe(3);
  });
});
