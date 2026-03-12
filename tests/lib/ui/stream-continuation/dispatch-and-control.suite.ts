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
      });

      expect(stopped).toEqual({
        isStreaming: false,
        streamingMessageId: null,
        streamingStart: null,
        hasStreamingMeta: false,
        hasRunningTool: false,
        isAgentOnlyStream: false,
        hasPendingCompletion: false,
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
        },
        { preserveStreamingStart: true },
      );

      expect(stopped.streamingStart).toBe(999);
      expect(stopped.isStreaming).toBe(false);
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
