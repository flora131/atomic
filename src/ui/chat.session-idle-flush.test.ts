/**
 * Tests for stream.session.idle handler flush ordering in chat.tsx
 *
 * Validates that the batch dispatcher is flushed BEFORE
 * shouldContinueParentSessionLoop checks hasRunningBlockingTool.
 *
 * Without this flush, Claude sessions (which do not emit stream.turn.end)
 * can have stale tool-tracking state when session.idle fires, causing
 * the continuation check to block queue processing indefinitely.
 *
 * OpenCode / Copilot avoid this because stream.turn.end already triggers
 * a dispatcher flush before session.idle arrives.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { shouldContinueParentSessionLoop } from "./utils/stream-continuation.ts";

// ---------------------------------------------------------------------------
// Handler logic extracted from chat.tsx session.idle handler
// ---------------------------------------------------------------------------

interface SessionIdleState {
  isStreamingRef: { current: boolean };
  hasRunningToolRef: { current: boolean };
  lastTurnFinishReasonRef: { current: string | null };
  parallelAgentsRef: { current: unknown[] };
  batchDispatcher: { flush: () => void };
  handleStreamComplete: () => void;
  hasPendingTaskResultContract: () => boolean;
}

/**
 * Mirrors the stream.session.idle handler in chat.tsx (POST-FIX).
 *
 * The key invariant is: batchDispatcher.flush() runs BEFORE
 * shouldContinueParentSessionLoop reads hasRunningToolRef.
 */
function handleSessionIdle(state: SessionIdleState): void {
  if (state.isStreamingRef.current) {
    // Critical: flush before checking tool state
    state.batchDispatcher.flush();

    const continuationSignal = shouldContinueParentSessionLoop({
      finishReason: (state.lastTurnFinishReasonRef.current ?? undefined) as
        | "tool-calls" | "stop" | "max-tokens" | "max-turns" | "error" | "unknown"
        | undefined,
      hasActiveForegroundAgents: state.parallelAgentsRef.current.length > 0,
      hasRunningBlockingTool: state.hasRunningToolRef.current,
      hasPendingTaskContract: state.hasPendingTaskResultContract(),
    });

    if (continuationSignal.shouldContinue) {
      return;
    }

    state.handleStreamComplete();
  }
}

/**
 * The BROKEN version (pre-fix) where flush happens AFTER the check.
 */
function handleSessionIdleBroken(state: SessionIdleState): void {
  if (state.isStreamingRef.current) {
    const continuationSignal = shouldContinueParentSessionLoop({
      finishReason: (state.lastTurnFinishReasonRef.current ?? undefined) as
        | "tool-calls" | "stop" | "max-tokens" | "max-turns" | "error" | "unknown"
        | undefined,
      hasActiveForegroundAgents: state.parallelAgentsRef.current.length > 0,
      hasRunningBlockingTool: state.hasRunningToolRef.current,
      hasPendingTaskContract: state.hasPendingTaskResultContract(),
    });

    if (continuationSignal.shouldContinue) {
      return;
    }

    state.batchDispatcher.flush();
    state.handleStreamComplete();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stream.session.idle handler", () => {
  let state: SessionIdleState;
  let flushFn: ReturnType<typeof mock>;
  let completeFn: ReturnType<typeof mock>;

  beforeEach(() => {
    flushFn = mock(() => {
      // Simulate the dispatcher flush processing a pending tool.complete
      // event, which sets hasRunningToolRef.current = false.
      state.hasRunningToolRef.current = false;
    });
    completeFn = mock();

    state = {
      isStreamingRef: { current: true },
      hasRunningToolRef: { current: true }, // Stale: tool.complete pending in dispatcher
      lastTurnFinishReasonRef: { current: null }, // Claude doesn't emit turn.end
      parallelAgentsRef: { current: [] },
      batchDispatcher: { flush: flushFn },
      handleStreamComplete: completeFn,
      hasPendingTaskResultContract: () => false,
    };
  });

  describe("Claude queue dispatch (no turn.end events)", () => {
    test("fixed: flushes dispatcher before continuation check, allowing queue dispatch", () => {
      handleSessionIdle(state);

      // Flush should have been called
      expect(flushFn).toHaveBeenCalledTimes(1);

      // After flush, hasRunningToolRef became false, so handleStreamComplete is called
      expect(completeFn).toHaveBeenCalledTimes(1);
    });

    test("broken: stale tool state blocks queue dispatch when flush is too late", () => {
      handleSessionIdleBroken(state);

      // Flush was NOT called because shouldContinueParentSessionLoop returned early
      expect(flushFn).toHaveBeenCalledTimes(0);

      // handleStreamComplete was never reached
      expect(completeFn).toHaveBeenCalledTimes(0);
    });
  });

  describe("normal completion (no pending tools)", () => {
    test("calls handleStreamComplete when no blocking conditions", () => {
      state.hasRunningToolRef.current = false; // No pending tools

      handleSessionIdle(state);

      expect(flushFn).toHaveBeenCalledTimes(1);
      expect(completeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("active foreground agents block completion", () => {
    test("returns early when foreground agents are active (even after flush)", () => {
      state.hasRunningToolRef.current = false;
      state.parallelAgentsRef.current = [{ id: "agent-1" }];

      handleSessionIdle(state);

      expect(flushFn).toHaveBeenCalledTimes(1);
      expect(completeFn).toHaveBeenCalledTimes(0);
    });
  });

  describe("pending task contract blocks completion", () => {
    test("returns early when task contract is pending (even after flush)", () => {
      state.hasRunningToolRef.current = false;
      state.hasPendingTaskResultContract = () => true;

      handleSessionIdle(state);

      expect(flushFn).toHaveBeenCalledTimes(1);
      expect(completeFn).toHaveBeenCalledTimes(0);
    });
  });

  describe("not streaming", () => {
    test("does nothing when not streaming", () => {
      state.isStreamingRef.current = false;

      handleSessionIdle(state);

      expect(flushFn).toHaveBeenCalledTimes(0);
      expect(completeFn).toHaveBeenCalledTimes(0);
    });
  });

  describe("finish reason blocking", () => {
    test("continues loop when finish reason is tool-calls (even after flush clears tools)", () => {
      state.lastTurnFinishReasonRef.current = "tool-calls";

      handleSessionIdle(state);

      expect(flushFn).toHaveBeenCalledTimes(1);
      // shouldContinue: true due to finish reason, not tools
      expect(completeFn).toHaveBeenCalledTimes(0);
    });

    test("continues loop when finish reason is unknown (even after flush clears tools)", () => {
      state.lastTurnFinishReasonRef.current = "unknown";

      handleSessionIdle(state);

      expect(flushFn).toHaveBeenCalledTimes(1);
      expect(completeFn).toHaveBeenCalledTimes(0);
    });

    test("completes when finish reason is stop", () => {
      state.lastTurnFinishReasonRef.current = "stop";

      handleSessionIdle(state);

      expect(flushFn).toHaveBeenCalledTimes(1);
      expect(completeFn).toHaveBeenCalledTimes(1);
    });
  });
});
