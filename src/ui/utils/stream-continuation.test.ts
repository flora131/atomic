import { describe, expect, test } from "bun:test";
import {
  dispatchNextQueuedMessage,
  invalidateActiveStreamGeneration,
  isCurrentStreamCallback,
} from "./stream-continuation.ts";

describe("stream continuation helpers", () => {
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
  });

  test("interrupt invalidation advances generation and makes old callback stale", () => {
    const currentGeneration = 7;
    const interruptedGeneration = invalidateActiveStreamGeneration(currentGeneration);

    expect(interruptedGeneration).toBe(8);
    expect(interruptedGeneration).not.toBe(currentGeneration);
    expect(isCurrentStreamCallback(interruptedGeneration, currentGeneration)).toBe(false);
    expect(isCurrentStreamCallback(interruptedGeneration, interruptedGeneration)).toBe(true);
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

    expect(callbacks).toHaveLength(2);
    callbacks[0]?.();
    callbacks[1]?.();

    expect(dispatched).toEqual(["first"]);
    expect(queue).toEqual(["second"]);
  });
});
