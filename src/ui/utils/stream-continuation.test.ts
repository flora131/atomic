import { describe, expect, test } from "bun:test";
import {
  createStartedStreamControlState,
  createStoppedStreamControlState,
  dispatchNextQueuedMessage,
  interruptRunningToolCalls,
  isAskQuestionToolName,
  invalidateActiveStreamGeneration,
  isCurrentStreamCallback,
  shouldTrackToolAsBlocking,
  shouldDispatchQueuedMessage,
  shouldDeferComposerSubmit,
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

  test("interrupt invalidation advances generation with strict guard", () => {
    const currentGeneration = 7;
    const interruptedGeneration = invalidateActiveStreamGeneration(currentGeneration);

    expect(interruptedGeneration).toBe(8);
    expect(interruptedGeneration).not.toBe(currentGeneration);
    // Strict guard: only current generation is accepted
    expect(isCurrentStreamCallback(interruptedGeneration, currentGeneration)).toBe(false);
    expect(isCurrentStreamCallback(interruptedGeneration, interruptedGeneration)).toBe(true);
    // Older generations are rejected
    expect(isCurrentStreamCallback(interruptedGeneration, currentGeneration - 1)).toBe(false);
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

  test("double interrupt keeps command spinner stream state stopped", () => {
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
      { messageId: "command_spinner", startedAt: 1000 },
    );

    const afterFirstInterrupt = createStoppedStreamControlState(started);
    const afterSecondInterrupt = createStoppedStreamControlState(afterFirstInterrupt);

    expect(afterFirstInterrupt.isStreaming).toBe(false);
    expect(afterFirstInterrupt.streamingMessageId).toBeNull();
    expect(afterSecondInterrupt).toEqual(afterFirstInterrupt);
  });

  test("double interrupt keeps chat streaming state stopped", () => {
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

  test("isAskQuestionToolName matches MCP and plain ask_question names", () => {
    expect(isAskQuestionToolName("ask_question")).toBe(true);
    expect(isAskQuestionToolName("deepwiki/ask_question")).toBe(true);
    expect(isAskQuestionToolName("mcp__deepwiki__ask_question")).toBe(true);
    expect(isAskQuestionToolName("question")).toBe(false);
    expect(isAskQuestionToolName("read_page")).toBe(false);
  });

  test("shouldTrackToolAsBlocking skips skill lifecycle tools", () => {
    expect(shouldTrackToolAsBlocking("Skill")).toBe(false);
    expect(shouldTrackToolAsBlocking("skill")).toBe(false);
    expect(shouldTrackToolAsBlocking("deepwiki/skill")).toBe(false);
    expect(shouldTrackToolAsBlocking("mcp__core__skill")).toBe(false);
  });

  test("shouldTrackToolAsBlocking keeps normal tools as blocking", () => {
    expect(shouldTrackToolAsBlocking("Bash")).toBe(true);
    expect(shouldTrackToolAsBlocking("Read")).toBe(true);
    expect(shouldTrackToolAsBlocking("ask_question")).toBe(true);
  });

  test("shouldDeferComposerSubmit keeps composer text during ask_question", () => {
    expect(shouldDeferComposerSubmit({
      isStreaming: true,
      runningAskQuestionToolCount: 1,
    })).toBe(true);

    expect(shouldDeferComposerSubmit({
      isStreaming: true,
      runningAskQuestionToolCount: 0,
    })).toBe(false);

    expect(shouldDeferComposerSubmit({
      isStreaming: false,
      runningAskQuestionToolCount: 2,
    })).toBe(false);
  });

  test("composer text stays intact while ask_question is active", () => {
    const composerState = {
      value: "keep this draft",
      submitted: [] as string[],
      isStreaming: true,
      runningAskQuestionToolCount: 1,
    };

    const attemptSubmit = () => {
      const trimmed = composerState.value.trim();
      if (!trimmed) {
        return;
      }
      if (shouldDeferComposerSubmit({
        isStreaming: composerState.isStreaming,
        runningAskQuestionToolCount: composerState.runningAskQuestionToolCount,
      })) {
        return;
      }
      composerState.submitted.push(trimmed);
      composerState.value = "";
    };

    attemptSubmit();

    expect(composerState.value).toBe("keep this draft");
    expect(composerState.submitted).toEqual([]);
  });

  test("shouldDispatchQueuedMessage waits for stream + ask_question to settle", () => {
    expect(shouldDispatchQueuedMessage({
      isStreaming: true,
      runningAskQuestionToolCount: 0,
    })).toBe(false);

    expect(shouldDispatchQueuedMessage({
      isStreaming: false,
      runningAskQuestionToolCount: 1,
    })).toBe(false);

    expect(shouldDispatchQueuedMessage({
      isStreaming: false,
      runningAskQuestionToolCount: 0,
    })).toBe(true);
  });

  test("guarded queue dispatch resumes after ask_question + interrupt settle", () => {
    const queue = ["queued-message"];
    const dispatched: string[] = [];
    const callbacks: Array<() => void> = [];
    const guardState = {
      isStreaming: true,
      runningAskQuestionToolCount: 1,
    };

    const scheduleDispatch = () => {
      dispatchNextQueuedMessage(
        () => queue.shift(),
        (message) => {
          dispatched.push(message);
        },
        {
          shouldDispatch: () => shouldDispatchQueuedMessage(guardState),
          schedule: (callback) => {
            callbacks.push(callback);
          },
        },
      );
    };

    // Still streaming: queue must stay untouched.
    scheduleDispatch();
    callbacks.shift()?.();
    expect(dispatched).toEqual([]);
    expect(queue).toEqual(["queued-message"]);

    // Stream interrupted/settled but ask_question still active: still blocked.
    guardState.isStreaming = false;
    scheduleDispatch();
    callbacks.shift()?.();
    expect(dispatched).toEqual([]);
    expect(queue).toEqual(["queued-message"]);

    // ask_question settles too: queued message resumes.
    guardState.runningAskQuestionToolCount = 0;
    scheduleDispatch();
    callbacks.shift()?.();
    expect(dispatched).toEqual(["queued-message"]);
    expect(queue).toEqual([]);
  });

  test("queue dispatch remains blocked while ask_question is active after interruption", () => {
    const queue = ["queued-message"];
    const dispatched: string[] = [];

    dispatchNextQueuedMessage(
      () => queue.shift(),
      (message) => {
        dispatched.push(message);
      },
      {
        shouldDispatch: () => shouldDispatchQueuedMessage({
          isStreaming: false,
          runningAskQuestionToolCount: 1,
        }),
        schedule: (callback) => {
          callback();
        },
      },
    );

    expect(dispatched).toEqual([]);
    expect(queue).toEqual(["queued-message"]);
  });

  test("blocked queued message resumes once ask_question settles", () => {
    const queue = ["queued-message"];
    const dispatched: string[] = [];
    const guardState = {
      isStreaming: false,
      runningAskQuestionToolCount: 1,
    };

    const dispatchIfAllowed = () => {
      dispatchNextQueuedMessage(
        () => queue.shift(),
        (message) => {
          dispatched.push(message);
        },
        {
          shouldDispatch: () => shouldDispatchQueuedMessage(guardState),
          schedule: (callback) => {
            callback();
          },
        },
      );
    };

    dispatchIfAllowed();
    expect(dispatched).toEqual([]);
    expect(queue).toEqual(["queued-message"]);

    guardState.runningAskQuestionToolCount = 0;
    dispatchIfAllowed();
    expect(dispatched).toEqual(["queued-message"]);
    expect(queue).toEqual([]);
  });
});
