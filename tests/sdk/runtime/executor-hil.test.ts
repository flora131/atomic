import { test, expect, describe } from "bun:test";
import { wrapCopilotSend, watchOpencodeStreamForHIL } from "../../../src/sdk/runtime/executor.ts";
import type { CopilotSendSessionSurface } from "../../../src/sdk/runtime/executor.ts";

// ---------------------------------------------------------------------------
// Minimal mock for CopilotSendSessionSurface
// ---------------------------------------------------------------------------

type Handler = (event: { data?: unknown }) => void;

function makeMockSession() {
  const handlers: Map<string, Handler[]> = new Map();

  const session: CopilotSendSessionSurface = {
    on(eventType: string, handler: Handler): () => void {
      if (!handlers.has(eventType)) handlers.set(eventType, []);
      handlers.get(eventType)!.push(handler);
      return () => {
        const list = handlers.get(eventType);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx !== -1) list.splice(idx, 1);
        }
      };
    },
  };

  function emit(eventType: string, data?: unknown) {
    const list = handlers.get(eventType) ?? [];
    for (const h of [...list]) h({ data });
  }

  function handlerCount(eventType: string): number {
    return handlers.get(eventType)?.length ?? 0;
  }

  return { session, emit, handlerCount };
}

// ---------------------------------------------------------------------------
// wrapCopilotSend
// ---------------------------------------------------------------------------

describe("wrapCopilotSend", () => {
  test("resolves immediately when session.idle fires with no HIL pending", async () => {
    const { session, emit } = makeMockSession();
    const hilCalls: boolean[] = [];
    const nativeSend = async (_opts: string) => "msg-1";

    const wrappedSend = wrapCopilotSend(session, nativeSend, (w) => hilCalls.push(w));

    const sendPromise = wrappedSend("hello");
    emit("session.idle");
    const result = await sendPromise;

    expect(result).toBe("msg-1");
    expect(hilCalls).toEqual([]);
  });

  test("calls onHIL(true) when user_input.requested fires", async () => {
    const { session, emit } = makeMockSession();
    const hilCalls: boolean[] = [];
    const nativeSend = async (_opts: string) => "msg-2";

    const wrappedSend = wrapCopilotSend(session, nativeSend, (w) => hilCalls.push(w));
    const sendPromise = wrappedSend("hello");

    emit("user_input.requested");
    expect(hilCalls).toEqual([true]);

    // HIL is pending — emit idle should NOT resolve yet
    emit("session.idle");

    // Still not resolved — emit user_input.completed and then idle
    emit("user_input.completed");
    expect(hilCalls).toEqual([true, false]);

    emit("session.idle");
    const result = await sendPromise;
    expect(result).toBe("msg-2");
  });

  test("does not resolve session.idle while HIL is pending", async () => {
    const { session, emit } = makeMockSession();
    let resolved = false;
    const nativeSend = async (_opts: string) => "x";

    const wrappedSend = wrapCopilotSend(session, nativeSend, () => {});
    wrappedSend("q").then(() => { resolved = true; });

    // Simulate HIL request fires, then idle fires (should NOT resolve)
    emit("user_input.requested");
    emit("session.idle");

    // Give microtasks a chance to run
    await Promise.resolve();
    await Promise.resolve();

    expect(resolved).toBe(false);

    // User answers, then idle fires again — should resolve now
    emit("user_input.completed");
    emit("session.idle");

    await Promise.resolve();
    await Promise.resolve();

    expect(resolved).toBe(true);
  });

  test("calls onHIL(false) when user_input.completed fires", async () => {
    const { session, emit } = makeMockSession();
    const hilCalls: boolean[] = [];
    const nativeSend = async (_opts: string) => "msg-3";

    const wrappedSend = wrapCopilotSend(session, nativeSend, (w) => hilCalls.push(w));
    const sendPromise = wrappedSend("hi");

    emit("user_input.requested");
    emit("user_input.completed");
    expect(hilCalls).toEqual([true, false]);

    emit("session.idle");
    await sendPromise;
  });

  test("rejects when session.error fires", async () => {
    const { session, emit } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-4";

    const wrappedSend = wrapCopilotSend(session, nativeSend, () => {});
    const sendPromise = wrappedSend("hello");

    emit("session.error", { message: "something went wrong" });

    await expect(sendPromise).rejects.toThrow("something went wrong");
  });

  test("rejects with default message when session.error data is missing", async () => {
    const { session, emit } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-5";

    const wrappedSend = wrapCopilotSend(session, nativeSend, () => {});
    const sendPromise = wrappedSend("hello");

    emit("session.error");

    await expect(sendPromise).rejects.toThrow("Copilot session error");
  });

  test("cleans up all listeners after resolution", async () => {
    const { session, emit, handlerCount } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-6";

    const wrappedSend = wrapCopilotSend(session, nativeSend, () => {});
    const sendPromise = wrappedSend("hello");

    // Listeners should be registered before send resolves
    expect(handlerCount("session.idle")).toBe(1);
    expect(handlerCount("session.error")).toBe(1);
    expect(handlerCount("user_input.requested")).toBe(1);
    expect(handlerCount("user_input.completed")).toBe(1);

    emit("session.idle");
    await sendPromise;

    // All listeners should be cleaned up after resolution
    expect(handlerCount("session.idle")).toBe(0);
    expect(handlerCount("session.error")).toBe(0);
    expect(handlerCount("user_input.requested")).toBe(0);
    expect(handlerCount("user_input.completed")).toBe(0);
  });

  test("cleans up all listeners after error rejection", async () => {
    const { session, emit, handlerCount } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-7";

    const wrappedSend = wrapCopilotSend(session, nativeSend, () => {});
    const sendPromise = wrappedSend("hello");

    // Listeners registered before error fires
    expect(handlerCount("session.idle")).toBe(1);

    emit("session.error", { message: "oops" });
    await sendPromise.catch(() => {});

    // All listeners cleaned up after error
    expect(handlerCount("session.idle")).toBe(0);
    expect(handlerCount("session.error")).toBe(0);
    expect(handlerCount("user_input.requested")).toBe(0);
    expect(handlerCount("user_input.completed")).toBe(0);
  });

  test("passes the correct options to nativeSend", async () => {
    const { session, emit } = makeMockSession();
    let capturedOpts: unknown;
    const nativeSend = async (opts: { prompt: string }) => {
      capturedOpts = opts;
      return "msg-8";
    };

    const wrappedSend = wrapCopilotSend(session, nativeSend, () => {});
    const sendPromise = wrappedSend({ prompt: "test message" });

    emit("session.idle");
    await sendPromise;

    expect(capturedOpts).toEqual({ prompt: "test message" });
  });
});

// ---------------------------------------------------------------------------
// OpenCode HIL event stream helper
// ---------------------------------------------------------------------------

/**
 * Creates a minimal fake OpenCode event stream (async generator) from an array
 * of pre-defined events.
 */
async function* makeEventStream(
  events: Array<{ type: string; properties: Record<string, unknown> }>,
): AsyncGenerator<{ type: string; properties: Record<string, unknown> }> {
  for (const evt of events) {
    yield evt;
  }
}

describe("watchOpencodeStreamForHIL", () => {
  test("calls onHIL(true) when question.asked fires for the tracked session", async () => {
    const hilCalls: boolean[] = [];
    const sessionId = "session-abc";

    const stream = makeEventStream([
      { type: "question.asked", properties: { sessionID: sessionId, id: "q1", questions: [] } },
    ]);

    await watchOpencodeStreamForHIL(stream, sessionId, (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([true]);
  });

  test("calls onHIL(false) when question.replied fires for the tracked session", async () => {
    const hilCalls: boolean[] = [];
    const sessionId = "session-abc";

    const stream = makeEventStream([
      { type: "question.replied", properties: { sessionID: sessionId, requestID: "r1", answers: [] } },
    ]);

    await watchOpencodeStreamForHIL(stream, sessionId, (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([false]);
  });

  test("calls onHIL(false) when question.rejected fires for the tracked session", async () => {
    const hilCalls: boolean[] = [];
    const sessionId = "session-abc";

    const stream = makeEventStream([
      { type: "question.rejected", properties: { sessionID: sessionId, requestID: "r1" } },
    ]);

    await watchOpencodeStreamForHIL(stream, sessionId, (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([false]);
  });

  test("ignores question.asked events for a different session", async () => {
    const hilCalls: boolean[] = [];

    const stream = makeEventStream([
      { type: "question.asked", properties: { sessionID: "other-session", id: "q1", questions: [] } },
    ]);

    await watchOpencodeStreamForHIL(stream, "session-abc", (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([]);
  });

  test("ignores question.replied events for a different session", async () => {
    const hilCalls: boolean[] = [];

    const stream = makeEventStream([
      { type: "question.replied", properties: { sessionID: "other-session", requestID: "r1", answers: [] } },
    ]);

    await watchOpencodeStreamForHIL(stream, "session-abc", (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([]);
  });

  test("ignores unrelated event types", async () => {
    const hilCalls: boolean[] = [];

    const stream = makeEventStream([
      { type: "session.idle", properties: { sessionID: "session-abc" } },
      { type: "session.status", properties: { sessionID: "session-abc", status: "running" } },
      { type: "file.edited", properties: { file: "main.ts" } },
    ]);

    await watchOpencodeStreamForHIL(stream, "session-abc", (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([]);
  });

  test("handles a sequence of question.asked then question.replied correctly", async () => {
    const hilCalls: boolean[] = [];
    const sessionId = "session-abc";

    const stream = makeEventStream([
      { type: "question.asked", properties: { sessionID: sessionId, id: "q1", questions: [] } },
      { type: "question.replied", properties: { sessionID: sessionId, requestID: "q1", answers: [] } },
    ]);

    await watchOpencodeStreamForHIL(stream, sessionId, (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([true, false]);
  });

  test("handles mixed sessions: only fires for tracked session", async () => {
    const hilCalls: boolean[] = [];
    const sessionId = "session-abc";

    const stream = makeEventStream([
      { type: "question.asked", properties: { sessionID: "other-session", id: "q1", questions: [] } },
      { type: "question.asked", properties: { sessionID: sessionId, id: "q2", questions: [] } },
      { type: "question.replied", properties: { sessionID: "other-session", requestID: "q1", answers: [] } },
      { type: "question.rejected", properties: { sessionID: sessionId, requestID: "q2" } },
    ]);

    await watchOpencodeStreamForHIL(stream, sessionId, (w) => hilCalls.push(w));

    expect(hilCalls).toEqual([true, false]);
  });
});
