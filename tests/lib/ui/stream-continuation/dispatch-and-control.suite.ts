import { beforeEach, describe, expect, test } from "bun:test";
import {
  createStartedStreamControlState,
  createStoppedStreamControlState,
  dispatchNextQueuedMessage,
  interruptRunningToolCalls,
} from "@/lib/ui/stream-continuation.ts";
import {
  getRuntimeParityMetricsSnapshot,
  resetRuntimeParityMetrics,
} from "@/services/workflows/runtime-parity-observability.ts";

describe("stream continuation helpers", () => {
  beforeEach(() => {
    resetRuntimeParityMetrics();
  });

  describe("dispatch and stream control", () => {
    test("dispatchNextQueuedMessage dispatches next queued item once", () => {
      const queue = ["first", "second"];
      const dispatched: string[] = [];
      const scheduledDelays: number[] = [];

      const dispatchedAny = dispatchNextQueuedMessage(
        () => queue.shift(),
        (message) => {
          dispatched.push(message);
        },
        {
          schedule: (callback, delayMs) => {
            scheduledDelays.push(delayMs);
            callback();
          },
        },
      );

      expect(dispatchedAny).toBe(true);
      expect(dispatched).toEqual(["first"]);
      expect(queue).toEqual(["second"]);
      expect(scheduledDelays).toEqual([50]);
    });

    test("dispatchNextQueuedMessage is a no-op when queue is empty", () => {
      const dispatched: string[] = [];
      const dispatchedAny = dispatchNextQueuedMessage(
        () => undefined,
        (message: string) => {
          dispatched.push(message);
        },
        {
          schedule: () => {
            throw new Error("scheduler should not run for empty queue");
          },
        },
      );

      expect(dispatchedAny).toBe(false);
      expect(dispatched).toEqual([]);

      const metrics = getRuntimeParityMetricsSnapshot();
      expect(
        metrics.counters[
          "workflow.runtime.parity.queue_dispatch_total{mode=unguarded,result=no-op}"
        ],
      ).toBe(1);
    });

    test("dispatchNextQueuedMessage fails on invalid delay invariants", () => {
      expect(() =>
        dispatchNextQueuedMessage(() => "item", () => {}, { delayMs: -1 }),
      ).toThrow("non-negative finite delay");

      const metrics = getRuntimeParityMetricsSnapshot();
      expect(
        metrics.counters[
          "workflow.runtime.parity.queue_dispatch_invariant_failures_total{reason=invalid_delay}"
        ],
      ).toBe(1);
    });

    test("guarded dispatch does not dequeue when streaming resumed", () => {
      const queue = ["first"];
      const dispatched: string[] = [];

      const dispatchedAny = dispatchNextQueuedMessage(
        () => queue.shift(),
        (message) => {
          dispatched.push(message);
        },
        {
          shouldDispatch: () => false,
          schedule: (callback) => {
            callback();
          },
        },
      );

      expect(dispatchedAny).toBe(true);
      expect(dispatched).toEqual([]);
      expect(queue).toEqual(["first"]);
    });

    test("guarded dispatch dequeues once across duplicate triggers", () => {
      const queue = ["first", "second"];
      const dispatched: string[] = [];
      const callbacks: Array<() => void> = [];
      let streaming = false;

      const scheduleGuardedDispatch = () => {
        dispatchNextQueuedMessage(
          () => queue.shift(),
          (message) => {
            dispatched.push(message);
            streaming = true;
          },
          {
            shouldDispatch: () => !streaming,
            schedule: (callback) => {
              callbacks.push(callback);
            },
          },
        );
      };

      scheduleGuardedDispatch();
      scheduleGuardedDispatch();

      expect(callbacks).toHaveLength(2);
      callbacks[0]?.();
      callbacks[1]?.();

      expect(dispatched).toEqual(["first"]);
      expect(queue).toEqual(["second"]);
    });

    test("createStoppedStreamControlState clears all transient flags", () => {
      const stopped = createStoppedStreamControlState({
        isStreaming: true,
        streamingMessageId: "msg_1",
        streamingStart: 123,
        hasStreamingMeta: true,
        hasRunningTool: true,
        isAgentOnlyStream: true,
        hasPendingCompletion: true,
        hasPendingBackgroundWork: true,
      });

      expect(stopped).toEqual({
        isStreaming: false,
        streamingMessageId: null,
        streamingStart: null,
        hasStreamingMeta: false,
        hasRunningTool: false,
        isAgentOnlyStream: false,
        hasPendingCompletion: false,
        hasPendingBackgroundWork: false,
      });
    });

    test("createStoppedStreamControlState can preserve elapsed timer start", () => {
      const stopped = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 999,
          hasStreamingMeta: true,
          hasRunningTool: false,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: false,
        },
        { preserveStreamingStart: true },
      );

      expect(stopped.streamingStart).toBe(999);
      expect(stopped.isStreaming).toBe(false);
    });

    test("createStoppedStreamControlState marks pending background work when agents active", () => {
      const stopped = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 500,
          hasStreamingMeta: true,
          hasRunningTool: true,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: false,
        },
        { hasActiveBackgroundAgents: true },
      );

      expect(stopped.hasPendingBackgroundWork).toBe(true);
      expect(stopped.isStreaming).toBe(false);
      expect(stopped.hasRunningTool).toBe(false);
    });

    test("createStoppedStreamControlState clears background work when no agents active", () => {
      const stopped = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 500,
          hasStreamingMeta: false,
          hasRunningTool: false,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: true,
        },
        { hasActiveBackgroundAgents: false },
      );

      expect(stopped.hasPendingBackgroundWork).toBe(false);
    });

    test("createStoppedStreamControlState defaults background work to false when option omitted", () => {
      const stopped = createStoppedStreamControlState({
        isStreaming: true,
        streamingMessageId: "msg_1",
        streamingStart: 500,
        hasStreamingMeta: false,
        hasRunningTool: false,
        isAgentOnlyStream: false,
        hasPendingCompletion: false,
        hasPendingBackgroundWork: true,
      });

      expect(stopped.hasPendingBackgroundWork).toBe(false);
    });

    test("createStoppedStreamControlState defaults background work to false with empty options", () => {
      const stopped = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 500,
          hasStreamingMeta: false,
          hasRunningTool: false,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: true,
        },
        {},
      );

      expect(stopped.hasPendingBackgroundWork).toBe(false);
    });

    test("createStoppedStreamControlState defaults background work to false with explicit undefined", () => {
      const stopped = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 500,
          hasStreamingMeta: false,
          hasRunningTool: false,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: true,
        },
        { hasActiveBackgroundAgents: undefined },
      );

      expect(stopped.hasPendingBackgroundWork).toBe(false);
    });

    test("createStoppedStreamControlState combines preserveStreamingStart with background agents", () => {
      const stopped = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 999,
          hasStreamingMeta: true,
          hasRunningTool: true,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: false,
        },
        { preserveStreamingStart: true, hasActiveBackgroundAgents: true },
      );

      expect(stopped.streamingStart).toBe(999);
      expect(stopped.hasPendingBackgroundWork).toBe(true);
      expect(stopped.isStreaming).toBe(false);
      expect(stopped.hasRunningTool).toBe(false);
    });

    test("createStoppedStreamControlState combines preserveStreamingStart with no background agents", () => {
      const stopped = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 999,
          hasStreamingMeta: true,
          hasRunningTool: false,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: true,
        },
        { preserveStreamingStart: true, hasActiveBackgroundAgents: false },
      );

      expect(stopped.streamingStart).toBe(999);
      expect(stopped.hasPendingBackgroundWork).toBe(false);
    });

    test("createStoppedStreamControlState double stop toggles background work off", () => {
      const base: Parameters<typeof createStoppedStreamControlState>[0] = {
        isStreaming: true,
        streamingMessageId: "msg_1",
        streamingStart: 500,
        hasStreamingMeta: true,
        hasRunningTool: true,
        isAgentOnlyStream: false,
        hasPendingCompletion: false,
        hasPendingBackgroundWork: false,
      };

      const firstStop = createStoppedStreamControlState(base, {
        hasActiveBackgroundAgents: true,
      });
      expect(firstStop.hasPendingBackgroundWork).toBe(true);

      const secondStop = createStoppedStreamControlState(firstStop, {
        hasActiveBackgroundAgents: false,
      });
      expect(secondStop.hasPendingBackgroundWork).toBe(false);
    });

    test("createStoppedStreamControlState double stop preserves background work when still active", () => {
      const base: Parameters<typeof createStoppedStreamControlState>[0] = {
        isStreaming: true,
        streamingMessageId: "msg_1",
        streamingStart: 500,
        hasStreamingMeta: true,
        hasRunningTool: true,
        isAgentOnlyStream: false,
        hasPendingCompletion: false,
        hasPendingBackgroundWork: false,
      };

      const firstStop = createStoppedStreamControlState(base, {
        hasActiveBackgroundAgents: true,
      });
      const secondStop = createStoppedStreamControlState(firstStop, {
        hasActiveBackgroundAgents: true,
      });

      expect(firstStop.hasPendingBackgroundWork).toBe(true);
      expect(secondStop.hasPendingBackgroundWork).toBe(true);
      expect(secondStop.isStreaming).toBe(false);
    });

    test("createStartedStreamControlState clears pending background work from prior stop", () => {
      const stoppedWithBackground = createStoppedStreamControlState(
        {
          isStreaming: true,
          streamingMessageId: "msg_1",
          streamingStart: 500,
          hasStreamingMeta: true,
          hasRunningTool: true,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: false,
        },
        { hasActiveBackgroundAgents: true },
      );
      expect(stoppedWithBackground.hasPendingBackgroundWork).toBe(true);

      const restarted = createStartedStreamControlState(stoppedWithBackground, {
        messageId: "msg_2",
        startedAt: 1000,
      });
      expect(restarted.hasPendingBackgroundWork).toBe(false);
      expect(restarted.isStreaming).toBe(true);
    });

    test("createStartedStreamControlState tracks command spinner as active stream", () => {
      const started = createStartedStreamControlState(
        {
          isStreaming: false,
          streamingMessageId: null,
          streamingStart: null,
          hasStreamingMeta: true,
          hasRunningTool: true,
          isAgentOnlyStream: true,
          hasPendingCompletion: true,
          hasPendingBackgroundWork: true,
        },
        { messageId: "spinner_1", startedAt: 456 },
      );

      expect(started).toEqual({
        isStreaming: true,
        streamingMessageId: "spinner_1",
        streamingStart: 456,
        hasStreamingMeta: false,
        hasRunningTool: false,
        isAgentOnlyStream: false,
        hasPendingCompletion: false,
        hasPendingBackgroundWork: false,
      });
    });

    test("double interrupt keeps stream state stopped", () => {
      const started = createStartedStreamControlState(
        {
          isStreaming: false,
          streamingMessageId: null,
          streamingStart: null,
          hasStreamingMeta: false,
          hasRunningTool: false,
          isAgentOnlyStream: false,
          hasPendingCompletion: false,
          hasPendingBackgroundWork: false,
        },
        { messageId: "assistant_stream", startedAt: 2000 },
      );

      const afterFirstInterrupt = createStoppedStreamControlState(started);
      const afterSecondInterrupt = createStoppedStreamControlState(afterFirstInterrupt);

      expect(afterFirstInterrupt.isStreaming).toBe(false);
      expect(afterFirstInterrupt.streamingMessageId).toBeNull();
      expect(afterSecondInterrupt).toEqual(afterFirstInterrupt);
    });

    test("double interrupt keeps tool calls in interrupted terminal state", () => {
      const firstPass = interruptRunningToolCalls([
        { id: "1", status: "running" },
        { id: "2", status: "completed" },
      ]);
      const secondPass = interruptRunningToolCalls(firstPass);

      expect(firstPass).toEqual([
        { id: "1", status: "interrupted" },
        { id: "2", status: "completed" },
      ]);
      expect(secondPass).toEqual(firstPass);
    });

    test("interruptRunningToolCalls only changes running tools", () => {
      const interrupted = interruptRunningToolCalls([
        { id: "1", status: "running" },
        { id: "2", status: "completed" },
        { id: "3", status: "error" },
      ]);

      expect(interrupted).toEqual([
        { id: "1", status: "interrupted" },
        { id: "2", status: "completed" },
        { id: "3", status: "error" },
      ]);
    });
  });
});
