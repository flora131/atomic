import { describe, expect, mock, test, beforeEach } from "bun:test";
import {
  shouldProcessStreamLifecycleEvent,
} from "@/state/chat/exports.ts";
import { createMessage } from "@/state/chat/helpers.ts";
import { MISC } from "@/theme/icons.ts";
import type { ChatMessage } from "@/state/chat/types.ts";

/**
 * Mirrors the stream.session.warning handler in use-session-subscriptions.ts.
 *
 * Extracted to test the lifecycle guard + rendering logic without needing
 * the full bus subscription infrastructure.
 */
function handleSessionWarning(
  state: {
    activeStreamRunIdRef: { current: number | null };
    setMessagesWindowed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  },
  event: { runId: number; data: { message?: string } },
): void {
  if (!shouldProcessStreamLifecycleEvent(state.activeStreamRunIdRef.current, event.runId)) {
    return;
  }

  const { message } = event.data;
  if (message) {
    state.setMessagesWindowed((prev) => [
      ...prev,
      createMessage("system", `${MISC.warning} ${message}`),
    ]);
  }
}

describe("stream.session.warning lifecycle guard", () => {
  let setMessagesWindowed: ReturnType<typeof mock>;
  let state: {
    activeStreamRunIdRef: { current: number | null };
    setMessagesWindowed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  };

  beforeEach(() => {
    setMessagesWindowed = mock();
    state = {
      activeStreamRunIdRef: { current: 5 },
      setMessagesWindowed,
    };
  });

  test("renders warning when runId matches active stream run", () => {
    handleSessionWarning(state, {
      runId: 5,
      data: { message: "Auto-denied permission for tool X" },
    });
    expect(setMessagesWindowed).toHaveBeenCalledTimes(1);
  });

  test("suppresses warning when runId is stale (from a previous run)", () => {
    handleSessionWarning(state, {
      runId: 4,
      data: { message: "Some post-stream warning" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses warning when no active run is bound (null activeStreamRunId)", () => {
    state.activeStreamRunIdRef.current = null;
    handleSessionWarning(state, {
      runId: 5,
      data: { message: "Orphaned warning" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses warning when message is empty", () => {
    handleSessionWarning(state, {
      runId: 5,
      data: { message: "" },
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("suppresses warning when message is undefined", () => {
    handleSessionWarning(state, {
      runId: 5,
      data: {},
    });
    expect(setMessagesWindowed).not.toHaveBeenCalled();
  });

  test("rendered message includes warning icon prefix", () => {
    let captured: ChatMessage[] = [];
    state.setMessagesWindowed = (updater) => {
      captured = updater([]);
    };

    handleSessionWarning(state, {
      runId: 5,
      data: { message: "Rate limit approaching" },
    });

    expect(captured).toHaveLength(1);
    const msg = captured[0]!;
    expect(msg.content).toBe(`${MISC.warning} Rate limit approaching`);
    expect(msg.role).toBe("system");
  });
});
