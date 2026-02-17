import { test, expect, describe } from "bun:test";
import { shouldFinalizeOnToolComplete } from "./guards.ts";
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
