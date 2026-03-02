import { describe, expect, test } from "bun:test";
import { shouldFinalizeAgentOnlyStream, shouldProcessStreamLifecycleEvent } from "./chat.tsx";

function shouldFinalizeOnIdle(args: {
  activeRunId: number | null;
  eventRunId: number;
  isStreaming: boolean;
}): boolean {
  if (!shouldProcessStreamLifecycleEvent(args.activeRunId, args.eventRunId)) {
    return false;
  }
  return args.isStreaming;
}

describe("chat stream lifecycle run guard", () => {
  test("ignores lifecycle events before stream.session.start binds a run", () => {
    expect(shouldProcessStreamLifecycleEvent(null, 7)).toBe(false);
  });

  test("ignores stale lifecycle events from a previous run", () => {
    expect(shouldProcessStreamLifecycleEvent(12, 11)).toBe(false);
  });

  test("accepts lifecycle events from the active run", () => {
    expect(shouldProcessStreamLifecycleEvent(12, 12)).toBe(true);
  });

  test("idle finalization runs only for the active stream run", () => {
    expect(
      shouldFinalizeOnIdle({
        activeRunId: 22,
        eventRunId: 21,
        isStreaming: true,
      }),
    ).toBe(false);

    expect(
      shouldFinalizeOnIdle({
        activeRunId: 22,
        eventRunId: 22,
        isStreaming: true,
      }),
    ).toBe(true);
  });
});

describe("agent-only stream finalization guard", () => {
  test("finalizes when live sub-agent state is present", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 1,
        messageAgentCount: 0,
      }),
    ).toBe(true);
  });

  test("finalizes when live state is cleared but message snapshot still has sub-agents", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 0,
        messageAgentCount: 1,
      }),
    ).toBe(true);
  });

  test("does not finalize before any sub-agent data exists", () => {
    expect(
      shouldFinalizeAgentOnlyStream({
        hasStreamingMessage: true,
        isStreaming: true,
        isAgentOnlyStream: true,
        liveAgentCount: 0,
        messageAgentCount: 0,
      }),
    ).toBe(false);
  });
});
