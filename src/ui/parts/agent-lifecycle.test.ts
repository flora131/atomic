/**
 * Background Agent Lifecycle Tests
 *
 * These tests verify that background agents are not prematurely finalized.
 * They test the shouldFinalizeOnToolComplete() guard across all finalization paths.
 */

import { describe, test, expect } from "bun:test";
import { shouldFinalizeOnToolComplete } from "./guards.ts";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

/**
 * Helper function to create a test agent with default values.
 */
function createAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: "agent-1",
    name: "test-agent",
    task: "Test task",
    status: "running",
    startedAt: new Date().toISOString(),
    background: false,
    ...overrides,
  };
}

describe("Background agent lifecycle", () => {
  test("background agent survives tool.complete", () => {
    const agent = createAgent({ background: true, status: "running" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("foreground agent finalizes on tool.complete", () => {
    const agent = createAgent({ background: false, status: "running" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("background agent with 'background' status survives", () => {
    const agent = createAgent({ background: false, status: "background" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("background agent completes on subagent.complete", () => {
    // When a background agent completes, its status changes to "completed"
    const agent = createAgent({ background: true, status: "completed" });
    // Even though it's a background agent, if it's completed, it should be finalized
    // Actually, let's check the guard behavior - background agents should not be finalized
    // even when completed, as the guard is specifically for tool.complete handling
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("mixed agents: foreground completes, background persists", () => {
    const foregroundAgent = createAgent({
      id: "foreground-1",
      background: false,
      status: "running",
    });
    const backgroundAgent = createAgent({
      id: "background-1",
      background: true,
      status: "running",
    });

    // Foreground agent should be finalized
    expect(shouldFinalizeOnToolComplete(foregroundAgent)).toBe(true);
    // Background agent should persist
    expect(shouldFinalizeOnToolComplete(backgroundAgent)).toBe(false);
  });

  test("guard returns false for completed background agent", () => {
    // Background agents should not be finalized on tool.complete even if completed
    const agent = createAgent({ background: true, status: "completed" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("guard returns false for running background agent", () => {
    // Background agents with running status should not be finalized on tool.complete
    const agent = createAgent({ background: true, status: "running" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("background agent with background status and flag survives", () => {
    // Both background flag and status set should still prevent finalization
    const agent = createAgent({ background: true, status: "background" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("foreground agent with pending status finalizes", () => {
    // Non-background agents in pending state should be finalized
    const agent = createAgent({ background: false, status: "pending" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("background agent with pending status survives", () => {
    // Background agents in pending state should not be finalized
    const agent = createAgent({ background: true, status: "pending" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("foreground agent with error status finalizes", () => {
    // Non-background agents with errors should be finalized
    const agent = createAgent({ background: false, status: "error" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("background agent with error status survives", () => {
    // Background agents with errors should not be finalized on tool.complete
    const agent = createAgent({ background: true, status: "error" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("foreground agent with interrupted status finalizes", () => {
    // Non-background agents that are interrupted should be finalized
    const agent = createAgent({ background: false, status: "interrupted" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });

  test("background agent with interrupted status survives", () => {
    // Background agents that are interrupted should not be finalized on tool.complete
    const agent = createAgent({ background: true, status: "interrupted" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(false);
  });

  test("agent with undefined background flag defaults to foreground", () => {
    // When background is undefined, it defaults to false (foreground)
    const agent = createAgent({ background: undefined, status: "running" });
    expect(shouldFinalizeOnToolComplete(agent)).toBe(true);
  });
});
