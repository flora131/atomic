import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";

import type {
  EventHandler,
  EventType,
  AgentEvent,
} from "@/services/agents/types.ts";
import type {
  CopilotProviderEvent,
  CopilotProviderEventHandler,
  ProviderStreamEventDataMap,
  ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import { createSyntheticProviderNativeEvent } from "@/services/agents/provider-events.ts";

import { getCopilotNativeMeta } from "@/services/agents/clients/copilot/event-mapper.ts";

export function emitCopilotProviderEvent<T extends ProviderStreamEventType>(args: {
  providerEventHandlers: Set<CopilotProviderEventHandler>;
  eventType: T;
  sessionId: string;
  data: ProviderStreamEventDataMap[T];
  options?: {
    native?: SdkSessionEvent;
    nativeEventId?: string;
    nativeSessionId?: string;
    nativeParentEventId?: string;
    timestamp?: number;
  };
}): void {
  if (args.providerEventHandlers.size === 0) {
    return;
  }

  const nativeMeta = getCopilotNativeMeta(args.options?.native);
  const event: CopilotProviderEvent = {
    provider: "copilot",
    type: args.eventType,
    sessionId: args.sessionId,
    timestamp: args.options?.timestamp ?? Date.now(),
    nativeType: args.options?.native?.type ?? args.eventType,
    native: args.options?.native ?? createSyntheticProviderNativeEvent(args.eventType, args.data),
    ...(args.options?.nativeEventId ? { nativeEventId: args.options.nativeEventId } : {}),
    ...(args.options?.nativeSessionId ? { nativeSessionId: args.options.nativeSessionId } : {}),
    ...(args.options?.nativeParentEventId ? { nativeParentEventId: args.options.nativeParentEventId } : {}),
    ...(nativeMeta ? { nativeMeta } : {}),
    data: args.data,
  } as CopilotProviderEvent;

  for (const handler of args.providerEventHandlers) {
    try {
      handler(event);
    } catch (error) {
      console.error(`Error in provider event handler for ${args.eventType}:`, error);
    }
  }
}

export function emitMappedCopilotSdkEvent<T extends ProviderStreamEventType>(args: {
  eventType: T;
  sessionId: string;
  data: ProviderStreamEventDataMap[T];
  nativeEvent: SdkSessionEvent;
  unifiedData?: Record<string, unknown>;
  emitEvent: <U extends EventType>(
    eventType: U,
    sessionId: string,
    data: Record<string, unknown>,
  ) => void;
  emitProviderEvent: <U extends ProviderStreamEventType>(
    eventType: U,
    sessionId: string,
    data: ProviderStreamEventDataMap[U],
    options?: {
      native?: SdkSessionEvent;
      nativeEventId?: string;
      nativeSessionId?: string;
      nativeParentEventId?: string;
      timestamp?: number;
    },
  ) => void;
}): void {
  args.emitEvent(
    args.eventType as EventType,
    args.sessionId,
    args.unifiedData ?? (args.data as Record<string, unknown>),
  );
  args.emitProviderEvent(args.eventType, args.sessionId, args.data, {
    native: args.nativeEvent,
    nativeEventId: args.nativeEvent.id,
    nativeSessionId: args.sessionId,
    nativeParentEventId: args.nativeEvent.parentId ?? undefined,
    timestamp: Date.parse(args.nativeEvent.timestamp),
  });
}

export function emitCopilotEvent<T extends EventType>(args: {
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  eventType: T;
  sessionId: string;
  data: Record<string, unknown>;
}): void {
  const handlers = args.eventHandlers.get(args.eventType);
  if (!handlers || handlers.size === 0) {
    return;
  }

  const event: AgentEvent<T> = {
    type: args.eventType,
    sessionId: args.sessionId,
    timestamp: new Date().toISOString(),
    data: args.data as AgentEvent<T>["data"],
  };

  for (const handler of handlers) {
    try {
      handler(event as AgentEvent<EventType>);
    } catch (error) {
      console.error(`Error in event handler for ${args.eventType}:`, error);
    }
  }
}
