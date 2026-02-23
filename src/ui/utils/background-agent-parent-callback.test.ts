import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import {
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
} from "./background-agent-termination.ts";
import { getActiveBackgroundAgents } from "./background-agent-footer.ts";

function createAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "task",
    task: overrides.task ?? "Background task",
    status: overrides.status ?? "background",
    background: overrides.background,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    currentTool: overrides.currentTool,
    durationMs: overrides.durationMs,
    result: overrides.result,
  };
}

describe("parent callback integration: termination pipeline", () => {
  test("termination produces interrupted IDs for parent callback", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-1", status: "background", background: true }),
      createAgent({ id: "bg-2", status: "running", background: true }),
      createAgent({ id: "fg-1", status: "running", background: false }),
    ];

    const result = interruptActiveBackgroundAgents(agents);

    // Parent callback expects interruptedIds to be non-empty
    expect(result.interruptedIds.length).toBeGreaterThan(0);
    expect(result.interruptedIds).toEqual(["bg-1", "bg-2"]);

    // Parent callback should only receive background agent IDs
    for (const id of result.interruptedIds) {
      const agent = agents.find((a) => a.id === id);
      expect(agent?.background).toBe(true);
    }
  });

  test("parent callback receives correct session scope (background agents only)", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-active", status: "background", background: true }),
      createAgent({ id: "fg-running", status: "running", background: false }),
      createAgent({ id: "fg-pending", status: "pending", background: false }),
    ];

    const result = interruptActiveBackgroundAgents(agents);

    // Only background agents should be interrupted
    expect(result.interruptedIds).toEqual(["bg-active"]);

    // Foreground agents should remain untouched
    const fgRunning = result.agents.find((a) => a.id === "fg-running");
    const fgPending = result.agents.find((a) => a.id === "fg-pending");
    expect(fgRunning?.status).toBe("running");
    expect(fgPending?.status).toBe("pending");

    // Background agent should be interrupted
    const bgAgent = result.agents.find((a) => a.id === "bg-active");
    expect(bgAgent?.status).toBe("interrupted");
  });

  test("no callback needed when no agents interrupted", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-completed", status: "completed", background: true }),
      createAgent({ id: "bg-interrupted", status: "interrupted", background: true }),
      createAgent({ id: "fg-running", status: "running", background: false }),
    ];

    const result = interruptActiveBackgroundAgents(agents);

    // Empty interruptedIds means parent callback should NOT be invoked
    expect(result.interruptedIds).toEqual([]);
    expect(result.interruptedIds.length).toBe(0);

    // All agents should remain unchanged
    expect(result.agents).toEqual(agents);
  });

  test("sequential termination flows don't double-fire callback", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-1", status: "background", background: true }),
      createAgent({ id: "bg-2", status: "running", background: true }),
    ];

    // First termination pass
    const firstPass = interruptActiveBackgroundAgents(agents);
    expect(firstPass.interruptedIds).toEqual(["bg-1", "bg-2"]);

    // Second termination pass on already-interrupted agents
    const secondPass = interruptActiveBackgroundAgents(firstPass.agents);
    expect(secondPass.interruptedIds).toEqual([]);
    expect(secondPass.interruptedIds.length).toBe(0);

    // All agents should remain interrupted (not re-interrupted)
    const bg1 = secondPass.agents.find((a) => a.id === "bg-1");
    const bg2 = secondPass.agents.find((a) => a.id === "bg-2");
    expect(bg1?.status).toBe("interrupted");
    expect(bg2?.status).toBe("interrupted");
  });

  test("full pipeline: decision → interrupt → callback data", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-1", status: "background", background: true }),
      createAgent({ id: "bg-2", status: "running", background: true }),
      createAgent({ id: "fg-1", status: "running", background: false }),
    ];

    // Step 1: Get active background agent count
    const activeBackgroundAgents = getActiveBackgroundAgents(agents);
    expect(activeBackgroundAgents.length).toBe(2);

    // Step 2: Get termination decision (first press)
    const firstDecision = getBackgroundTerminationDecision(0, activeBackgroundAgents.length);
    expect(firstDecision.action).toBe("warn");
    expect(firstDecision).toHaveProperty("message");

    // Step 3: Get termination decision (second press)
    const secondDecision = getBackgroundTerminationDecision(1, activeBackgroundAgents.length);
    expect(secondDecision.action).toBe("terminate");
    expect(secondDecision).toHaveProperty("message");

    // Step 4: Execute termination
    const result = interruptActiveBackgroundAgents(agents);

    // Step 5: Verify callback data is correct
    expect(result.interruptedIds).toEqual(["bg-1", "bg-2"]);
    expect(result.interruptedIds.length).toBe(2);

    // Verify interrupted agents have correct status
    const bg1 = result.agents.find((a) => a.id === "bg-1");
    const bg2 = result.agents.find((a) => a.id === "bg-2");
    expect(bg1?.status).toBe("interrupted");
    expect(bg2?.status).toBe("interrupted");
    expect(bg1?.currentTool).toBeUndefined();
    expect(bg2?.currentTool).toBeUndefined();

    // Foreground agent unchanged
    const fg1 = result.agents.find((a) => a.id === "fg-1");
    expect(fg1?.status).toBe("running");
  });

  test("active agent count drops to 0 after termination", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-1", status: "background", background: true }),
      createAgent({ id: "bg-2", status: "running", background: true }),
      createAgent({ id: "bg-3", status: "pending", background: true }),
      createAgent({ id: "fg-1", status: "running", background: false }),
    ];

    // Before termination: 3 active background agents
    const beforeActive = getActiveBackgroundAgents(agents);
    expect(beforeActive.length).toBe(3);

    // Execute termination
    const result = interruptActiveBackgroundAgents(agents);
    expect(result.interruptedIds.length).toBe(3);

    // After termination: 0 active background agents
    const afterActive = getActiveBackgroundAgents(result.agents);
    expect(afterActive.length).toBe(0);
    expect(afterActive).toEqual([]);

    // All background agents should be interrupted
    const bg1 = result.agents.find((a) => a.id === "bg-1");
    const bg2 = result.agents.find((a) => a.id === "bg-2");
    const bg3 = result.agents.find((a) => a.id === "bg-3");
    expect(bg1?.status).toBe("interrupted");
    expect(bg2?.status).toBe("interrupted");
    expect(bg3?.status).toBe("interrupted");

    // Foreground agent still running
    const fg1 = result.agents.find((a) => a.id === "fg-1");
    expect(fg1?.status).toBe("running");
  });
});
