/**
 * Provider HIL (human-in-the-loop) watcher helpers.
 *
 * These helpers translate provider-specific SDK event streams into the
 * runtime's unified `onHIL(waiting)` callback used by graph nodes to render
 * the `awaiting_input` state.
 */

/**
 * Uses a generic `on` signature to remain compatible with both the real
 * CopilotSession and lightweight test mocks.
 */
export interface CopilotSendSessionSurface {
  on(
    eventType: string,
    handler: (event: { data?: unknown }) => void,
  ): () => void;
}

/**
 * Wraps a Copilot session's `send()` to block until `session.idle` fires.
 *
 * Copilot's `send()` is fire-and-forget — it returns immediately after
 * queuing the message. This wrapper blocks the returned promise until the
 * session emits `session.idle` (turn complete) or `session.error`.
 */
export function wrapCopilotSend<O, R>(
  session: CopilotSendSessionSurface,
  nativeSend: (options: O) => Promise<R>,
): (options: O) => Promise<R> {
  return async (options: O): Promise<R> => {
    const idle = new Promise<void>((resolve, reject) => {
      let unsubIdle: (() => void) | undefined;
      let unsubError: (() => void) | undefined;
      const cleanup = () => {
        unsubIdle?.();
        unsubError?.();
      };
      unsubIdle = session.on("session.idle", () => {
        cleanup();
        resolve();
      });
      unsubError = session.on("session.error", (event) => {
        cleanup();
        const data = event.data as { message?: string } | undefined;
        reject(new Error(data?.message ?? "Copilot session error"));
      });
    });
    const result = await nativeSend(options);
    await idle;
    return result;
  };
}

/**
 * Minimal shape of an event as produced by the OpenCode v2 SDK event stream.
 * Using a structural interface rather than the SDK's generated union type keeps
 * this helper independently unit-testable with plain objects.
 */
export interface OpenCodeHILEvent {
  type: string;
  properties: { sessionID?: string; [key: string]: unknown };
}

/**
 * Consume an OpenCode SSE event stream and call `onHIL` whenever the session
 * with `sessionId` enters or exits a human-in-the-loop (HIL) state:
 *
 *   - `question.asked`    → `onHIL(true)`   (agent awaiting user input)
 *   - `question.replied`  → `onHIL(false)`  (user answered, agent resumes)
 *   - `question.rejected` → `onHIL(false)`  (user dismissed, agent resumes)
 *
 * Events for other sessions are silently ignored. The function returns when
 * the stream is exhausted (i.e. the server closes the connection).
 */
export async function watchOpencodeStreamForHIL(
  stream: AsyncIterable<OpenCodeHILEvent>,
  sessionId: string,
  onHIL: (waiting: boolean) => void,
): Promise<void> {
  for await (const event of stream) {
    if (
      event.type === "question.asked" &&
      event.properties.sessionID === sessionId
    ) {
      onHIL(true);
    } else if (
      (event.type === "question.replied" ||
        event.type === "question.rejected") &&
      event.properties.sessionID === sessionId
    ) {
      onHIL(false);
    }
  }
}

/**
 * Minimal Copilot session surface required by `watchCopilotSessionForHIL()`.
 * A structural `on()` signature keeps this helper independently unit-testable
 * with plain objects and compatible with both the real CopilotSession and
 * test mocks.
 */
export interface CopilotHILSessionSurface {
  on(
    eventType: string,
    handler: (event: { data?: unknown }) => void,
  ): () => void;
}

/**
 * Subscribe to a Copilot session's tool-execution events to track HIL state
 * for the `ask_user` built-in tool:
 *
 *   - `tool.execution_start`    with `toolName === "ask_user"` → `onHIL(true)`
 *   - `tool.execution_complete` with matching `toolCallId`     → `onHIL(false)`
 *
 * Overlapping `ask_user` invocations are tracked by `toolCallId` so
 * `onHIL(false)` only fires after the last active request resolves.
 */
export function watchCopilotSessionForHIL(
  session: CopilotHILSessionSurface,
  onHIL: (waiting: boolean) => void,
): () => void {
  const active = new Set<string>();
  const unsubStart = session.on("tool.execution_start", (event) => {
    const data = event.data as
      | { toolName?: string; toolCallId?: string }
      | undefined;
    if (data?.toolName === "ask_user" && data.toolCallId) {
      const wasEmpty = active.size === 0;
      active.add(data.toolCallId);
      if (wasEmpty) onHIL(true);
    }
  });
  const unsubComplete = session.on("tool.execution_complete", (event) => {
    const data = event.data as { toolCallId?: string } | undefined;
    if (
      data?.toolCallId &&
      active.delete(data.toolCallId) &&
      active.size === 0
    ) {
      onHIL(false);
    }
  });
  return () => {
    unsubStart();
    unsubComplete();
  };
}

/**
 * Subscribe to a Copilot session's elicitation events to track HIL state for
 * `session.ui.elicitation()`, `session.ui.select()`, `session.ui.input()`, and
 * MCP-server-initiated elicitation requests.
 */
export function watchCopilotSessionForElicitation(
  session: CopilotHILSessionSurface,
  onHIL: (waiting: boolean) => void,
): () => void {
  const active = new Set<string>();
  const unsubRequested = session.on("elicitation.requested", (event) => {
    const data = event.data as { requestId?: string } | undefined;
    if (data?.requestId) {
      const wasEmpty = active.size === 0;
      active.add(data.requestId);
      if (wasEmpty) onHIL(true);
    }
  });
  const unsubCompleted = session.on("elicitation.completed", (event) => {
    const data = event.data as { requestId?: string } | undefined;
    if (data?.requestId && active.delete(data.requestId) && active.size === 0) {
      onHIL(false);
    }
  });
  return () => {
    unsubRequested();
    unsubCompleted();
  };
}
