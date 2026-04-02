import type { AgentType } from "@/services/models/index.ts";
import {
  createTuiTelemetrySessionTracker,
} from "@/services/telemetry/index.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { attachDebugSubscriber } from "@/services/events/debug-subscriber/index.ts";
import type {
  ChatUIState,
  CreateChatUIRuntimeStateArgs,
  ChatUIDebugSubscription,
} from "@/state/runtime/chat-ui-controller-types.ts";

const FLUSH_FRAME_MS = 16;

function maybeLogDebugSubscription(debugSub: ChatUIDebugSubscription): void {
  if (!debugSub.logDirPath) {
    return;
  }

  console.info(`[Atomic] Stream debug logs: ${debugSub.logDirPath}`);
  if (debugSub.logPath) {
    console.info(`[Atomic] Stream events log: ${debugSub.logPath}`);
  }
  if (debugSub.rawLogPath) {
    console.info(`[Atomic] Stream raw log: ${debugSub.rawLogPath}`);
  }
}

function createTelemetryTracker(
  resolvedAgentType: AgentType | undefined,
  args: CreateChatUIRuntimeStateArgs,
) {
  if (!resolvedAgentType) {
    return null;
  }

  return createTuiTelemetrySessionTracker({
    agentType: resolvedAgentType,
    hasInitialPrompt: Boolean(args.initialPrompt),
  });
}

export async function createChatUIRuntimeState(
  args: CreateChatUIRuntimeStateArgs,
): Promise<{
  state: ChatUIState;
  debugSub: ChatUIDebugSubscription;
}> {
  const bus = new EventBus({
    validatePayloads: process.env.ATOMIC_VALIDATE_BUS_EVENTS === "1",
  });
  const dispatcher = new BatchDispatcher(bus, FLUSH_FRAME_MS);
  const debugSub = await attachDebugSubscriber(bus, args.resolvedAgentType);

  maybeLogDebugSubscription(debugSub);

  const state: ChatUIState = {
    renderer: null,
    root: null,
    session: null,
    startTime: Date.now(),
    messageCount: 0,
    cleanupHandlers: [],
    interruptCount: 0,
    interruptTimeout: null,
    streamAbortController: null,
    pendingAbortPromise: null,
    pendingBackgroundTerminationPromise: null,
    isStreaming: false,
    ownedSessionIds: new Set(),
    sessionCreationPromise: null,
    runCounter: 0,
    currentRunId: null,
    telemetryTracker: createTelemetryTracker(args.resolvedAgentType, args),
    bus,
    dispatcher,
    backgroundAgentsTerminated: false,
  };

  return { state, debugSub };
}
