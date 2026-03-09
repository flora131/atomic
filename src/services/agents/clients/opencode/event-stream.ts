import type { Event as OpenCodeEvent, OpencodeClient as SdkClient } from "@opencode-ai/sdk/v2/client";

export type OpenCodeSseDiagnosticsCounter =
  | "sse.watchdog.timeout.count"
  | "sse.event.filtered.count"
  | "sse.abort.watchdog.count"
  | "sse.abort.global.count"
  | "sse.abort.unknown.count";

export type OpenCodeSseAbortReason = "watchdog" | "global" | "unknown";

const SSE_RECONNECT_DELAY_MS = 250;
const HEARTBEAT_TIMEOUT_MS = 15_000;

export async function runOpenCodeEventLoop(args: {
  sdkClient: SdkClient;
  directory?: string;
  isRunning: () => boolean;
  getEventSubscriptionController: () => AbortController | null;
  reconcileStateOnReconnect: () => Promise<void>;
  processEventStream: (
    eventStream: AsyncGenerator<unknown, unknown, unknown>,
    watchdogAbort: AbortController,
  ) => Promise<void>;
  onConnectionError: (error: unknown) => void;
}): Promise<void> {
  let isReconnect = false;

  while (!args.getEventSubscriptionController()?.signal.aborted && args.isRunning()) {
    try {
      const watchdogAbort = new AbortController();
      const globalAbortSignal = args.getEventSubscriptionController()?.signal;
      if (!globalAbortSignal) {
        break;
      }

      const composedAbortSignal = AbortSignal.any([
        globalAbortSignal,
        watchdogAbort.signal,
      ]);

      const result = await args.sdkClient.event.subscribe(
        {
          directory: args.directory,
        },
        {
          signal: composedAbortSignal,
        },
      );

      if (isReconnect) {
        await args.reconcileStateOnReconnect();
      }

      await args.processEventStream(result.stream, watchdogAbort);

      if (args.getEventSubscriptionController()?.signal.aborted) {
        break;
      }
      isReconnect = true;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        break;
      }
      if (args.getEventSubscriptionController()?.signal.aborted) {
        break;
      }

      args.onConnectionError(error);
      isReconnect = true;
    }

    if (!args.getEventSubscriptionController()?.signal.aborted && args.isRunning()) {
      await new Promise((resolve) => setTimeout(resolve, SSE_RECONNECT_DELAY_MS));
    }
  }
}

export async function reconcileOpenCodeStateOnReconnect(args: {
  listSessions: () => Promise<Array<{ id: string; title?: string }>>;
  registerActiveSession: (sessionId: string) => void;
  emitSessionStart: (sessionId: string, title: string) => void;
  onFailure: (error: unknown) => void;
}): Promise<void> {
  try {
    const sessions = await args.listSessions();
    for (const session of sessions) {
      args.registerActiveSession(session.id);
      args.emitSessionStart(session.id, session.title ?? "Reconnected session");
    }
  } catch (error) {
    args.onFailure(error);
  }
}

export async function processOpenCodeEventStream(args: {
  eventStream: AsyncGenerator<unknown, unknown, unknown>;
  watchdogAbort: AbortController;
  getGlobalAbortSignal: () => AbortSignal | null;
  shouldProcessSseEvent: (event: Record<string, unknown>) => boolean;
  handleSdkEvent: (event: OpenCodeEvent) => void;
  getActiveSessionCount: () => number;
  emitSseDiagnosticsCounter: (
    counter: OpenCodeSseDiagnosticsCounter,
    amount?: number,
  ) => number;
  emitSseAbortDiagnostics: (reason: OpenCodeSseAbortReason) => number;
  debugLog: (label: string, data: Record<string, unknown>) => void;
}): Promise<void> {
  let lastEventAt = Date.now();
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let filteredEventCount = 0;
  let abortDiagnosticsEmitted = false;

  const resetWatchdog = () => {
    lastEventAt = Date.now();
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
    }
    watchdogTimer = setTimeout(() => {
      const elapsed = Date.now() - lastEventAt;
      if (elapsed >= HEARTBEAT_TIMEOUT_MS) {
        const timeoutCount = args.emitSseDiagnosticsCounter("sse.watchdog.timeout.count");
        console.warn(
          `SSE heartbeat timeout: no events for ${elapsed}ms, forcing reconnect (timeoutCount=${timeoutCount})`,
        );
        args.debugLog("sse-watchdog-timeout", {
          elapsed,
          timeoutCount,
          activeSessions: args.getActiveSessionCount(),
        });
        args.watchdogAbort.abort();
      }
    }, HEARTBEAT_TIMEOUT_MS);
  };

  resetWatchdog();

  try {
    for await (const event of args.eventStream) {
      const globalAbortSignal = args.getGlobalAbortSignal();
      if (globalAbortSignal?.aborted || args.watchdogAbort.signal.aborted) {
        const abortReason: OpenCodeSseAbortReason = args.watchdogAbort.signal.aborted
          ? "watchdog"
          : globalAbortSignal?.aborted
            ? "global"
            : "unknown";
        const abortCount = args.emitSseAbortDiagnostics(abortReason);
        abortDiagnosticsEmitted = true;
        args.debugLog("sse-abort", {
          reason: abortReason,
          abortCount,
          activeSessions: args.getActiveSessionCount(),
        });
        break;
      }

      resetWatchdog();
      const sdkEvent = event as OpenCodeEvent;
      if (!args.shouldProcessSseEvent(sdkEvent as unknown as Record<string, unknown>)) {
        filteredEventCount += 1;
        continue;
      }
      args.handleSdkEvent(sdkEvent);
    }
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      throw error;
    }

    if (!abortDiagnosticsEmitted) {
      const globalAbortSignal = args.getGlobalAbortSignal();
      const abortReason: OpenCodeSseAbortReason = args.watchdogAbort.signal.aborted
        ? "watchdog"
        : globalAbortSignal?.aborted
          ? "global"
          : "unknown";
      const abortCount = args.emitSseAbortDiagnostics(abortReason);
      args.debugLog("sse-abort", {
        reason: abortReason,
        abortCount,
        activeSessions: args.getActiveSessionCount(),
      });
    }
  } finally {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
    }
    if (filteredEventCount > 0) {
      const totalFilteredCount = args.emitSseDiagnosticsCounter(
        "sse.event.filtered.count",
        filteredEventCount,
      );
      args.debugLog("sse-event-filter", {
        filteredEventCount,
        totalFilteredCount,
        activeSessions: args.getActiveSessionCount(),
      });
    }
  }
}
