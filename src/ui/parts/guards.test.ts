import { test, expect, describe } from "bun:test";
import {
  shouldFinalizeOnToolComplete,
  hasActiveForegroundAgents,
  shouldFinalizeDeferredStream,
} from "./guards.ts";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

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

  test("returns true when only background agents remain", () => {
    const agents = [createMockAgent({ status: "background", background: true })];
    expect(shouldFinalizeDeferredStream(agents, false)).toBe(true);
  });
});
