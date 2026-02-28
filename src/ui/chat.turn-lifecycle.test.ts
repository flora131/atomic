/**
 * Tests for turn lifecycle event wiring in chat.tsx
 *
 * Validates that useBusSubscription handlers for stream.turn.start and
 * stream.turn.end behave correctly:
 * - stream.turn.start: ensures streaming state is active (safety-net)
 * - stream.turn.end: flushes batched events at the turn boundary
 *
 * These are unit tests of the handler logic patterns, not React component
 * tests. The actual useBusSubscription hooks are integration-tested via
 * the event bus integration test suite.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Handler logic extracted from chat.tsx useBusSubscription patterns
// ---------------------------------------------------------------------------

interface TurnStartState {
  isStreamingRef: { current: boolean };
  streamingStartRef: { current: number | null };
  setIsStreaming: (v: boolean) => void;
}

/**
 * Mirrors the stream.turn.start handler in chat.tsx.
 */
function handleTurnStart(state: TurnStartState): void {
  if (!state.isStreamingRef.current) {
    state.isStreamingRef.current = true;
    state.setIsStreaming(true);
    if (!state.streamingStartRef.current) {
      state.streamingStartRef.current = Date.now();
    }
  }
}

interface TurnEndState {
  isStreamingRef: { current: boolean };
  batchDispatcher: { flush: () => void };
}

/**
 * Mirrors the stream.turn.end handler in chat.tsx.
 */
function handleTurnEnd(state: TurnEndState): void {
  if (state.isStreamingRef.current) {
    state.batchDispatcher.flush();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stream.turn.start handler", () => {
  let state: TurnStartState;

  beforeEach(() => {
    state = {
      isStreamingRef: { current: false },
      streamingStartRef: { current: null },
      setIsStreaming: mock(() => {}),
    };
  });

  test("activates streaming state when not already streaming", () => {
    handleTurnStart(state);

    expect(state.isStreamingRef.current).toBe(true);
    expect(state.setIsStreaming).toHaveBeenCalledWith(true);
    expect(state.streamingStartRef.current).toBeGreaterThan(0);
  });

  test("preserves existing streamingStartRef when already set", () => {
    const existingStart = Date.now() - 5000;
    state.streamingStartRef.current = existingStart;

    handleTurnStart(state);

    expect(state.isStreamingRef.current).toBe(true);
    expect(state.streamingStartRef.current).toBe(existingStart);
  });

  test("is a no-op when already streaming", () => {
    state.isStreamingRef.current = true;

    handleTurnStart(state);

    expect(state.setIsStreaming).not.toHaveBeenCalled();
  });
});

describe("stream.turn.end handler", () => {
  let state: TurnEndState;

  beforeEach(() => {
    state = {
      isStreamingRef: { current: true },
      batchDispatcher: { flush: mock(() => {}) },
    };
  });

  test("flushes batch dispatcher when streaming", () => {
    handleTurnEnd(state);

    expect(state.batchDispatcher.flush).toHaveBeenCalledTimes(1);
  });

  test("does not flush when not streaming", () => {
    state.isStreamingRef.current = false;

    handleTurnEnd(state);

    expect(state.batchDispatcher.flush).not.toHaveBeenCalled();
  });
});
