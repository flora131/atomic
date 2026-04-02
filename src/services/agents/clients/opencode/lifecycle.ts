import type { EventType } from "@/services/agents/types.ts";
import type {
  OpenCodeSseAbortReason,
  OpenCodeSseDiagnosticsCounter,
} from "@/services/agents/clients/opencode/event-stream.ts";
import {
  processOpenCodeEventStream,
  reconcileOpenCodeStateOnReconnect,
  runOpenCodeEventLoop,
} from "@/services/agents/clients/opencode/event-stream.ts";

export async function subscribeToOpenCodeSdkEvents(args: {
  hasSdkClient: boolean;
  setEventSubscriptionController: (controller: AbortController) => void;
  runEventLoop: () => Promise<void>;
}): Promise<void> {
  if (!args.hasSdkClient) {
    return;
  }

  args.setEventSubscriptionController(new AbortController());
  args.runEventLoop().catch((error) => {
    if (error?.name !== "AbortError") {
      console.error("SSE event loop terminated:", error);
    }
  });
}

export async function runOpenCodeSdkLifecycleLoop(args: {
  sdkClient: Parameters<typeof runOpenCodeEventLoop>[0]["sdkClient"] | null;
  directory?: string;
  isRunning: () => boolean;
  getEventSubscriptionController: () => AbortController | null;
  reconcileStateOnReconnect: () => Promise<void>;
  processEventStream: (
    eventStream: AsyncGenerator<unknown, unknown, unknown>,
    watchdogAbort: AbortController,
  ) => Promise<void>;
}): Promise<void> {
  if (!args.sdkClient) {
    return;
  }

  await runOpenCodeEventLoop({
    sdkClient: args.sdkClient,
    directory: args.directory,
    isRunning: args.isRunning,
    getEventSubscriptionController: args.getEventSubscriptionController,
    reconcileStateOnReconnect: args.reconcileStateOnReconnect,
    processEventStream: args.processEventStream,
    onConnectionError: (error) => {
      console.error("SSE connection error, reconnecting:", error);
    },
  });
}

export async function reconcileOpenCodeLifecycleState(args: {
  listSessions: () => Promise<Array<{ id: string; title?: string; createdAt?: number }>>;
  registerActiveSession: (sessionId: string) => void;
  emitSessionStart: (sessionId: string, title?: string) => void;
}): Promise<void> {
  await reconcileOpenCodeStateOnReconnect({
    listSessions: args.listSessions,
    registerActiveSession: args.registerActiveSession,
    emitSessionStart: args.emitSessionStart,
    onFailure: (error) => {
      console.warn("State reconciliation failed after reconnect:", error);
    },
  });
}

export async function processOpenCodeLifecycleEventStream(args: {
  eventStream: AsyncGenerator<unknown, unknown, unknown>;
  watchdogAbort: AbortController;
  getGlobalAbortSignal: () => AbortSignal | null;
  shouldProcessSseEvent: Parameters<typeof processOpenCodeEventStream>[0]["shouldProcessSseEvent"];
  handleSdkEvent: Parameters<typeof processOpenCodeEventStream>[0]["handleSdkEvent"];
  getActiveSessionCount: () => number;
  emitSseDiagnosticsCounter: (
    counter: OpenCodeSseDiagnosticsCounter,
    amount?: number,
  ) => number;
  emitSseAbortDiagnostics: (reason: OpenCodeSseAbortReason) => number;
  debugLog: (label: string, data: Record<string, unknown>) => void;
}): Promise<void> {
  await processOpenCodeEventStream({
    eventStream: args.eventStream,
    watchdogAbort: args.watchdogAbort,
    getGlobalAbortSignal: args.getGlobalAbortSignal,
    shouldProcessSseEvent: args.shouldProcessSseEvent,
    handleSdkEvent: args.handleSdkEvent,
    getActiveSessionCount: args.getActiveSessionCount,
    emitSseDiagnosticsCounter: args.emitSseDiagnosticsCounter,
    emitSseAbortDiagnostics: args.emitSseAbortDiagnostics,
    debugLog: args.debugLog,
  });
}

export function emitOpenCodeSseDiagnosticsCounter(args: {
  counters: Record<OpenCodeSseDiagnosticsCounter, number>;
  counter: OpenCodeSseDiagnosticsCounter;
  amount?: number;
  emitEvent: <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>,
  ) => void;
  marker: string;
}): number {
  args.counters[args.counter] += args.amount ?? 1;
  const value = args.counters[args.counter];
  args.emitEvent("usage", "connection", {
    provider: "opencode",
    marker: args.marker,
    counter: args.counter,
    value,
  });
  return value;
}

export function emitOpenCodeSseAbortDiagnostics(args: {
  reason: OpenCodeSseAbortReason;
  emitSseDiagnosticsCounter: (counter: OpenCodeSseDiagnosticsCounter, amount?: number) => number;
}): number {
  if (args.reason === "watchdog") {
    return args.emitSseDiagnosticsCounter("sse.abort.watchdog.count");
  }
  if (args.reason === "global") {
    return args.emitSseDiagnosticsCounter("sse.abort.global.count");
  }
  return args.emitSseDiagnosticsCounter("sse.abort.unknown.count");
}

export async function startOpenCodeClientLifecycle(args: {
  isRunning: boolean;
  autoStart: boolean;
  reuseExistingServer: boolean;
  spawnServer: () => Promise<boolean>;
  connect: () => Promise<boolean>;
  releaseServerLease: () => void;
  setRunning: (value: boolean) => void;
  subscribeToSdkEvents: () => Promise<void>;
}): Promise<void> {
  if (args.isRunning) {
    return;
  }

  if (args.autoStart) {
    const spawned = await args.spawnServer();
    if (!spawned) {
      throw new Error("Failed to start Atomic-managed OpenCode server");
    }

    try {
      await args.connect();
    } catch (error) {
      args.releaseServerLease();
      throw error;
    }
  } else {
    if (!args.reuseExistingServer) {
      throw new Error(
        "OpenCode autoStart is disabled. Enable autoStart or set reuseExistingServer to connect to an external server.",
      );
    }
    await args.connect();
  }

  args.setRunning(true);
  await args.subscribeToSdkEvents();
}

export async function stopOpenCodeClientLifecycle(args: {
  isRunning: boolean;
  disconnect: () => Promise<void>;
  releaseServerLease: () => void;
  clearEventHandlers: () => void;
  setRunning: (value: boolean) => void;
}): Promise<void> {
  if (!args.isRunning) {
    return;
  }

  await args.disconnect();
  args.releaseServerLease();
  args.clearEventHandlers();
  args.setRunning(false);
}
