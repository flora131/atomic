import { test, expect, describe } from "bun:test";
import {
  shouldFinalizeOnToolComplete,
  hasActiveForegroundAgents,
  shouldFinalizeDeferredStream,
  hasActiveBackgroundAgentsForSpinner,
} from "@/state/parts/guards.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";

// Create minimal ParallelAgent objects for testing
function createMockAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
  return {
    id: "test-agent-1",
    name: "Test Agent",
    task: "Test task",
    status: "running",
    startedAt: new Date().toISOString(),
    background: false,
    ...overrides,
  };
}

describe("shouldFinalizeOnToolComplete", () => {
  test("returns true for regular completed agent", () => {
    const agent = createMockAgent({ background: false, status: "completed" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("returns false when agent.background is true", () => {
    const agent = createMockAgent({ background: true, status: "running" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("returns false when agent.status is 'background'", () => {
    const agent = createMockAgent({ background: false, status: "background" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("returns true for running non-background agent", () => {
    const agent = createMockAgent({ background: false, status: "running" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("returns true for pending agent", () => {
    const agent = createMockAgent({ background: false, status: "pending" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("returns false when both background flag and status are background", () => {
    const agent = createMockAgent({ background: true, status: "background" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("returns true for error status agent", () => {
    const agent = createMockAgent({ background: false, status: "error" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("returns true for interrupted status agent", () => {
    const agent = createMockAgent({ background: false, status: "interrupted" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });
});

describe("hasActiveForegroundAgents", () => {
  test("returns true for running foreground agent", () => {
    const agents = [createMockAgent({ status: "running", background: false })];
    expect(hasActiveForegroundAgents(agents)).toBe(true);
  });

  test("returns true for pending foreground agent", () => {
    const agents = [createMockAgent({ status: "pending", background: false })];
    expect(hasActiveForegroundAgents(agents)).toBe(true);
  });

  test("returns false for running background-only agents", () => {
    const agents = [createMockAgent({ status: "running", background: true })];
    expect(hasActiveForegroundAgents(agents)).toBe(false);
  });

  test("returns false when all agents are terminal", () => {
    const agents = [
      createMockAgent({ status: "completed", background: false }),
      createMockAgent({ id: "agent-2", status: "error", background: false }),
    ];
    expect(hasActiveForegroundAgents(agents)).toBe(false);
  });

  test("returns false for shadow foreground agent tied to active background agent", () => {
    const agents = [
      createMockAgent({
        id: "bg-1",
        name: "Researcher",
        status: "background",
        background: true,
        taskToolCallId: "bg-1",
      }),
      createMockAgent({
        id: "fg-shadow-1",
        name: "Researcher",
        status: "running",
        background: false,
        taskToolCallId: "bg-1",
      }),
    ];
    expect(hasActiveForegroundAgents(agents)).toBe(false);
  });
});

describe("shouldFinalizeDeferredStream", () => {
  test("returns false while foreground agents are active", () => {
    const agents = [createMockAgent({ status: "running", background: false })];
    expect(shouldFinalizeDeferredStream(agents, false)).toBe(false);
  });

  test("returns false while tools are still running", () => {
    const agents = [createMockAgent({ status: "completed", background: false })];
    expect(shouldFinalizeDeferredStream(agents, true)).toBe(false);
  });

  test("returns false when only background agents remain", () => {
    const agents = [createMockAgent({ status: "background", background: true })];
    expect(shouldFinalizeDeferredStream(agents, false)).toBe(false);
  });

  test("returns false when both foreground and background agents are active", () => {
    const agents = [
      createMockAgent({ status: "running", background: false }),
      createMockAgent({ status: "background", background: true }),
    ];
    expect(shouldFinalizeDeferredStream(agents, false)).toBe(false);
  });

  test("returns true when all agents (foreground and background) are done", () => {
    const agents = [
      createMockAgent({ status: "completed", background: false }),
      createMockAgent({ status: "completed", background: true }),
    ];
    expect(shouldFinalizeDeferredStream(agents, false)).toBe(true);
  });
});

describe("hasActiveBackgroundAgentsForSpinner", () => {
  test("returns true for background agent with 'background' status", () => {
    const agents = [createMockAgent({ background: true, status: "background" })];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);
  });

  test("returns true for background agent with 'running' status", () => {
    const agents = [createMockAgent({ background: true, status: "running" })];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);
  });

  test("returns true for background agent with 'pending' status", () => {
    const agents = [createMockAgent({ background: true, status: "pending" })];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);
  });

  test("returns false for background agent with 'completed' status", () => {
    const agents = [createMockAgent({ background: true, status: "completed" })];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
  });

  test("returns false for background agent with 'error' status", () => {
    const agents = [createMockAgent({ background: true, status: "error" })];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
  });

  test("returns false for background agent with 'interrupted' status", () => {
    const agents = [createMockAgent({ background: true, status: "interrupted" })];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
  });

  test("returns false for foreground agents regardless of status", () => {
    const agents = [
      createMockAgent({ background: false, status: "running" }),
      createMockAgent({ id: "agent-2", background: false, status: "pending" }),
    ];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
  });

  test("returns false for empty agents array", () => {
    expect(hasActiveBackgroundAgentsForSpinner([])).toBe(false);
  });

  test("returns true when mix of foreground and active background agents", () => {
    const agents = [
      createMockAgent({ id: "fg-1", background: false, status: "completed" }),
      createMockAgent({ id: "bg-1", background: true, status: "background" }),
    ];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);
  });

  test("returns false when all background agents are terminal", () => {
    const agents = [
      createMockAgent({ id: "bg-1", background: true, status: "completed" }),
      createMockAgent({ id: "bg-2", background: true, status: "error" }),
      createMockAgent({ id: "bg-3", background: true, status: "interrupted" }),
    ];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
  });

  test("detects background via status 'background' even without background flag", () => {
    const agents = [createMockAgent({ background: false, status: "background" })];
    expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);
  });
});
