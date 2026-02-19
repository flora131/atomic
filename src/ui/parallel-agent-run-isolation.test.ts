/**
 * Run isolation guards for parallel sub-agent tracking.
 *
 * These tests mirror the run-ownership checks in src/ui/index.ts so stale
 * hook events cannot leak sub-agent trees into a newer prompt/session.
 */

import { describe, expect, test } from "bun:test";

function shouldAcceptToolStart(args: {
  isOwnedSession: boolean;
  activeRunId: number | null;
  isStreaming: boolean;
  sdkRunId?: number;
}): boolean {
  if (args.activeRunId === null || !args.isStreaming) return false;
  if (!args.isOwnedSession && args.sdkRunId !== args.activeRunId) return false;
  if (args.sdkRunId !== undefined && args.sdkRunId !== args.activeRunId) return false;
  return true;
}

function shouldAcceptToolComplete(args: {
  isOwnedSession: boolean;
  activeRunId: number | null;
  isStreaming: boolean;
  sdkRunId?: number;
  eventRunId?: number;
}): boolean {
  if (args.activeRunId === null || !args.isStreaming) return false;
  if (!args.isOwnedSession && args.sdkRunId !== args.activeRunId) return false;
  if (args.eventRunId === undefined) return false;
  return args.eventRunId === args.activeRunId;
}

function shouldAcceptSubagentStart(args: {
  isOwnedSession: boolean;
  activeRunId: number | null;
  isStreaming: boolean;
  sdkRunId?: number;
  pendingEntryRunId?: number;
}): boolean {
  if (args.activeRunId === null || !args.isStreaming) return false;
  if (args.sdkRunId !== undefined && args.sdkRunId !== args.activeRunId) return false;
  if (
    !args.isOwnedSession
    && args.pendingEntryRunId === undefined
    && args.sdkRunId !== args.activeRunId
  ) return false;
  if (args.pendingEntryRunId === undefined && args.sdkRunId === undefined) return false;
  if (args.pendingEntryRunId !== undefined && args.pendingEntryRunId !== args.activeRunId) return false;
  return true;
}

function shouldFinalizeRun(args: {
  hasActiveAgents: boolean;
  hasPendingCorrelations: boolean;
}): boolean {
  return !args.hasActiveAgents && !args.hasPendingCorrelations;
}

function shouldClearRunOwnershipWhenParallelTrackingFinalizes(): boolean {
  // Parallel-tracking cleanup and stream ownership are intentionally decoupled.
  // Ownership is cleared only by stream completion/interrupt/session reset.
  return false;
}

describe("parallel agent run isolation guards", () => {
  test("accepts task tool.start for active run even without sdk correlation ID", () => {
    expect(shouldAcceptToolStart({
      isOwnedSession: true,
      activeRunId: 2,
      isStreaming: true,
    })).toBe(true);
  });

  test("rejects tool.start from unowned session without active-run correlation", () => {
    expect(shouldAcceptToolStart({
      isOwnedSession: false,
      activeRunId: 2,
      isStreaming: true,
    })).toBe(false);
  });

  test("rejects tool.start from stale run", () => {
    expect(shouldAcceptToolStart({
      isOwnedSession: true,
      activeRunId: 7,
      isStreaming: true,
      sdkRunId: 6,
    })).toBe(false);
  });

  test("accepts tool.start owned by active run", () => {
    expect(shouldAcceptToolStart({
      isOwnedSession: true,
      activeRunId: 7,
      isStreaming: true,
      sdkRunId: 7,
    })).toBe(true);
  });

  test("accepts tool.start from unowned session when sdk correlation matches active run", () => {
    expect(shouldAcceptToolStart({
      isOwnedSession: false,
      activeRunId: 7,
      isStreaming: true,
      sdkRunId: 7,
    })).toBe(true);
  });

  test("rejects unowned tool.complete", () => {
    expect(shouldAcceptToolComplete({
      isOwnedSession: true,
      activeRunId: 3,
      isStreaming: true,
      eventRunId: undefined,
    })).toBe(false);
  });

  test("rejects stale-run tool.complete", () => {
    expect(shouldAcceptToolComplete({
      isOwnedSession: true,
      activeRunId: 3,
      isStreaming: true,
      eventRunId: 2,
    })).toBe(false);
  });

  test("accepts active-run tool.complete", () => {
    expect(shouldAcceptToolComplete({
      isOwnedSession: true,
      activeRunId: 3,
      isStreaming: true,
      eventRunId: 3,
    })).toBe(true);
  });

  test("rejects tool.complete from unowned session without sdk correlation", () => {
    expect(shouldAcceptToolComplete({
      isOwnedSession: false,
      activeRunId: 3,
      isStreaming: true,
      eventRunId: 3,
    })).toBe(false);
  });

  test("accepts tool.complete from unowned session with sdk correlation", () => {
    expect(shouldAcceptToolComplete({
      isOwnedSession: false,
      activeRunId: 3,
      isStreaming: true,
      sdkRunId: 3,
      eventRunId: 3,
    })).toBe(true);
  });

  test("rejects subagent.start when no pending entry or SDK correlation exists", () => {
    expect(shouldAcceptSubagentStart({
      isOwnedSession: true,
      activeRunId: 4,
      isStreaming: true,
    })).toBe(false);
  });

  test("rejects subagent.start pending entry from previous run", () => {
    expect(shouldAcceptSubagentStart({
      isOwnedSession: true,
      activeRunId: 4,
      isStreaming: true,
      sdkRunId: 4,
      pendingEntryRunId: 3,
    })).toBe(false);
  });

  test("accepts subagent.start only when pending entry matches active run", () => {
    expect(shouldAcceptSubagentStart({
      isOwnedSession: true,
      activeRunId: 4,
      isStreaming: true,
      sdkRunId: 4,
      pendingEntryRunId: 4,
    })).toBe(true);
  });

  test("accepts subagent.start when SDK correlation matches even without pending entry", () => {
    expect(shouldAcceptSubagentStart({
      isOwnedSession: true,
      activeRunId: 4,
      isStreaming: true,
      sdkRunId: 4,
    })).toBe(true);
  });

  test("accepts subagent.start from unowned session when pending task entry matches active run", () => {
    expect(shouldAcceptSubagentStart({
      isOwnedSession: false,
      activeRunId: 4,
      isStreaming: true,
      pendingEntryRunId: 4,
    })).toBe(true);
  });

  test("rejects subagent.start from unowned session with no pending/correlation", () => {
    expect(shouldAcceptSubagentStart({
      isOwnedSession: false,
      activeRunId: 4,
      isStreaming: true,
    })).toBe(false);
  });

  test("finalizes run only when no active agents and no pending correlations", () => {
    expect(shouldFinalizeRun({ hasActiveAgents: false, hasPendingCorrelations: false })).toBe(true);
    expect(shouldFinalizeRun({ hasActiveAgents: true, hasPendingCorrelations: false })).toBe(false);
    expect(shouldFinalizeRun({ hasActiveAgents: false, hasPendingCorrelations: true })).toBe(false);
  });

  test("does not clear stream ownership when parallel tracking finalizes", () => {
    expect(shouldClearRunOwnershipWhenParallelTrackingFinalizes()).toBe(false);
  });
});
