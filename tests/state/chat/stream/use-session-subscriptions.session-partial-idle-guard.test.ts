import { describe, expect, mock, test, beforeEach } from "bun:test";
import {
  shouldProcessStreamLifecycleEvent,
} from "@/state/chat/exports.ts";

/**
 * Mirrors the stream.session.partial-idle handler in use-session-subscriptions.ts.
 *
 * Extracted to test the lifecycle guard + streaming guard + completion flow
 * without needing the full bus subscription infrastructure.
 */
function handleSessionPartialIdle(
  state: {
    activeStreamRunIdRef: { current: number | null };
    isStreamingRef: { current: boolean };
    batchDispatcher: { flush: () => void };
    handleStreamComplete: () => void;
  },
  event: {
    runId: number;
    data: { completionReason: string; activeBackgroundAgentCount: number };
  },
): void {
  if (!shouldProcessStreamLifecycleEvent(state.activeStreamRunIdRef.current, event.runId)) {
    return;
  }

  if (!state.isStreamingRef.current) {
    return;
  }

  state.batchDispatcher.flush();

  state.handleStreamComplete();
}

describe("stream.session.partial-idle lifecycle guard", () => {
  let flush: ReturnType<typeof mock>;
  let handleStreamComplete: ReturnType<typeof mock>;
  let state: {
    activeStreamRunIdRef: { current: number | null };
    isStreamingRef: { current: boolean };
    batchDispatcher: { flush: () => void };
    handleStreamComplete: () => void;
  };

  beforeEach(() => {
    flush = mock();
    handleStreamComplete = mock();
    state = {
      activeStreamRunIdRef: { current: 5 },
      isStreamingRef: { current: true },
      batchDispatcher: { flush },
      handleStreamComplete,
    };
  });

  test("calls handleStreamComplete when runId matches active stream run", () => {
    handleSessionPartialIdle(state, {
      runId: 5,
      data: { completionReason: "end_turn", activeBackgroundAgentCount: 2 },
    });
    expect(handleStreamComplete).toHaveBeenCalledTimes(1);
  });

  test("suppresses when runId is stale (from a previous run)", () => {
    handleSessionPartialIdle(state, {
      runId: 4,
      data: { completionReason: "end_turn", activeBackgroundAgentCount: 1 },
    });
    expect(handleStreamComplete).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  test("suppresses when no active run is bound (null activeStreamRunId)", () => {
    state.activeStreamRunIdRef.current = null;
    handleSessionPartialIdle(state, {
      runId: 5,
      data: { completionReason: "end_turn", activeBackgroundAgentCount: 1 },
    });
    expect(handleStreamComplete).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("stream.session.partial-idle streaming guard", () => {
  let flush: ReturnType<typeof mock>;
  let handleStreamComplete: ReturnType<typeof mock>;
  let state: {
    activeStreamRunIdRef: { current: number | null };
    isStreamingRef: { current: boolean };
    batchDispatcher: { flush: () => void };
    handleStreamComplete: () => void;
  };

  beforeEach(() => {
    flush = mock();
    handleStreamComplete = mock();
    state = {
      activeStreamRunIdRef: { current: 5 },
      isStreamingRef: { current: true },
      batchDispatcher: { flush },
      handleStreamComplete,
    };
  });

  test("suppresses when not currently streaming", () => {
    state.isStreamingRef.current = false;
    handleSessionPartialIdle(state, {
      runId: 5,
      data: { completionReason: "end_turn", activeBackgroundAgentCount: 1 },
    });
    expect(handleStreamComplete).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("stream.session.partial-idle flush ordering", () => {
  test("flushes batch dispatcher before calling handleStreamComplete", () => {
    const callOrder: string[] = [];
    const state = {
      activeStreamRunIdRef: { current: 5 as number | null },
      isStreamingRef: { current: true },
      batchDispatcher: { flush: () => callOrder.push("flush") },
      handleStreamComplete: () => callOrder.push("handleStreamComplete"),
    };

    handleSessionPartialIdle(state, {
      runId: 5,
      data: { completionReason: "end_turn", activeBackgroundAgentCount: 3 },
    });

    expect(callOrder).toEqual(["flush", "handleStreamComplete"]);
  });
});
