import { test, expect, describe } from "bun:test";
import {
  wrapCopilotSend,
  watchOpencodeStreamForHIL,
  watchCopilotPaneForHIL,
  COPILOT_HIL_PATTERN,
} from "../../../src/sdk/runtime/executor.ts";
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
  test("resolves when session.idle fires", async () => {
    const { session, emit } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-1";

    const wrappedSend = wrapCopilotSend(session, nativeSend);

    const sendPromise = wrappedSend("hello");
    emit("session.idle");
    const result = await sendPromise;

    expect(result).toBe("msg-1");
  });

  test("rejects when session.error fires", async () => {
    const { session, emit } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-2";

    const wrappedSend = wrapCopilotSend(session, nativeSend);
    const sendPromise = wrappedSend("hello");

    emit("session.error", { message: "something went wrong" });

    await expect(sendPromise).rejects.toThrow("something went wrong");
  });

  test("rejects with default message when session.error data is missing", async () => {
    const { session, emit } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-3";

    const wrappedSend = wrapCopilotSend(session, nativeSend);
    const sendPromise = wrappedSend("hello");

    emit("session.error");

    await expect(sendPromise).rejects.toThrow("Copilot session error");
  });

  test("cleans up listeners after resolution", async () => {
    const { session, emit, handlerCount } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-4";

    const wrappedSend = wrapCopilotSend(session, nativeSend);
    const sendPromise = wrappedSend("hello");

    expect(handlerCount("session.idle")).toBe(1);
    expect(handlerCount("session.error")).toBe(1);

    emit("session.idle");
    await sendPromise;

    expect(handlerCount("session.idle")).toBe(0);
    expect(handlerCount("session.error")).toBe(0);
  });

  test("cleans up listeners after error rejection", async () => {
    const { session, emit, handlerCount } = makeMockSession();
    const nativeSend = async (_opts: string) => "msg-5";

    const wrappedSend = wrapCopilotSend(session, nativeSend);
    const sendPromise = wrappedSend("hello");

    expect(handlerCount("session.idle")).toBe(1);

    emit("session.error", { message: "oops" });
    await sendPromise.catch(() => {});

    expect(handlerCount("session.idle")).toBe(0);
    expect(handlerCount("session.error")).toBe(0);
  });

  test("passes the correct options to nativeSend", async () => {
    const { session, emit } = makeMockSession();
    let capturedOpts: unknown;
    const nativeSend = async (opts: { prompt: string }) => {
      capturedOpts = opts;
      return "msg-6";
    };

    const wrappedSend = wrapCopilotSend(session, nativeSend);
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

// ---------------------------------------------------------------------------
// COPILOT_HIL_PATTERN
// ---------------------------------------------------------------------------

describe("COPILOT_HIL_PATTERN", () => {
  test("matches 'Copilot is requesting information'", () => {
    expect(COPILOT_HIL_PATTERN.test("Copilot is requesting information")).toBe(true);
  });

  test("matches 'requesting information' (case-insensitive)", () => {
    expect(COPILOT_HIL_PATTERN.test("Requesting Information")).toBe(true);
  });

  test("matches 'ctrl+d decline' footer hint", () => {
    expect(COPILOT_HIL_PATTERN.test("Enter accept · ctrl+d decline · Esc cancel")).toBe(true);
  });

  test("does not match normal agent output", () => {
    expect(COPILOT_HIL_PATTERN.test("Creating file worker-b-start.txt")).toBe(false);
  });

  test("does not match empty string", () => {
    expect(COPILOT_HIL_PATTERN.test("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// watchCopilotPaneForHIL
// ---------------------------------------------------------------------------

describe("watchCopilotPaneForHIL", () => {
  test("exits immediately when already aborted", async () => {
    const hilCalls: boolean[] = [];
    const ac = new AbortController();
    ac.abort();

    await watchCopilotPaneForHIL("fake-pane", ac.signal, (w) => hilCalls.push(w), 50);

    expect(hilCalls).toEqual([]);
  });

  test("stops polling when abort signal fires", async () => {
    const ac = new AbortController();
    const start = Date.now();

    // Abort after 100ms
    setTimeout(() => ac.abort(), 100);

    await watchCopilotPaneForHIL("fake-pane", ac.signal, () => {}, 50);

    const elapsed = Date.now() - start;
    // Should stop within a reasonable time after abort (not stuck polling)
    expect(elapsed).toBeLessThan(500);
  });
});
