import { describe, expect, test } from "bun:test";
import {
  dispatchNextQueuedMessage,
  isAskQuestionToolName,
  shouldDeferComposerSubmit,
  shouldDispatchQueuedMessage,
  shouldTrackToolAsBlocking,
} from "@/state/chat/shared/helpers/stream-continuation.ts";

describe("stream continuation helpers", () => {
  describe("ask_question and blocking tool guards", () => {
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
      expect(
        shouldDeferComposerSubmit({
          isStreaming: true,
          runningAskQuestionToolCount: 1,
        }),
      ).toBe(true);

      expect(
        shouldDeferComposerSubmit({
          isStreaming: true,
          runningAskQuestionToolCount: 0,
        }),
      ).toBe(false);

      expect(
        shouldDeferComposerSubmit({
          isStreaming: false,
          runningAskQuestionToolCount: 2,
        }),
      ).toBe(false);
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
        if (
          shouldDeferComposerSubmit({
            isStreaming: composerState.isStreaming,
            runningAskQuestionToolCount: composerState.runningAskQuestionToolCount,
          })
        ) {
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
      expect(
        shouldDispatchQueuedMessage({
          isStreaming: true,
          runningAskQuestionToolCount: 0,
        }),
      ).toBe(false);

      expect(
        shouldDispatchQueuedMessage({
          isStreaming: false,
          runningAskQuestionToolCount: 1,
        }),
      ).toBe(false);

      expect(
        shouldDispatchQueuedMessage({
          isStreaming: false,
          runningAskQuestionToolCount: 0,
        }),
      ).toBe(true);
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

      scheduleDispatch();
      callbacks.shift()?.();
      expect(dispatched).toEqual([]);
      expect(queue).toEqual(["queued-message"]);

      guardState.isStreaming = false;
      scheduleDispatch();
      callbacks.shift()?.();
      expect(dispatched).toEqual([]);
      expect(queue).toEqual(["queued-message"]);

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
          shouldDispatch: () =>
            shouldDispatchQueuedMessage({
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
});
