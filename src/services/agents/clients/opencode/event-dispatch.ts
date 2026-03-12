import {
  extractSkillInvocationFromToolInput,
  isSkillToolName,
} from "@/services/agents/clients/skill-invocation.ts";
import type {
  AgentEvent,
  EventHandler,
  EventType,
} from "@/services/agents/types.ts";
import type {
  OpenCodeProviderEvent,
  OpenCodeProviderEventHandler,
  ProviderStreamEventDataMap,
  ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import { createSyntheticProviderNativeEvent } from "@/services/agents/provider-events.ts";
import type { Event as OpenCodeEvent } from "@opencode-ai/sdk/v2/client";
import { getOpenCodeNativeMeta } from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeSessionStateSupport } from "@/services/agents/clients/opencode/session-state.ts";

export function emitOpenCodeEvent<T extends EventType>(args: {
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  eventType: T;
  sessionId: string;
  data: Record<string, unknown>;
}): void {
  const handlers = args.eventHandlers.get(args.eventType);
  if (!handlers || handlers.size === 0) return;

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

export function addOpenCodeProviderEventHandler(args: {
  providerEventHandlers: Set<OpenCodeProviderEventHandler>;
  handler: OpenCodeProviderEventHandler;
}): () => void {
  args.providerEventHandlers.add(args.handler);
  return () => {
    args.providerEventHandlers.delete(args.handler);
  };
}

export function emitOpenCodeProviderEvent<T extends ProviderStreamEventType>(args: {
  providerEventHandlers: Set<OpenCodeProviderEventHandler>;
  eventType: T;
  sessionId: string;
  data: ProviderStreamEventDataMap[T];
  activeNativeProviderEvent: OpenCodeEvent | null;
  options?: {
    native?: OpenCodeEvent;
    nativeEventId?: string;
    nativeSessionId?: string;
    timestamp?: number;
  };
}): void {
  if (args.providerEventHandlers.size === 0) {
    return;
  }

  const nativeEvent = args.options?.native ?? args.activeNativeProviderEvent;

  const event: OpenCodeProviderEvent = {
    provider: "opencode",
    type: args.eventType,
    sessionId: args.sessionId,
    timestamp: args.options?.timestamp ?? Date.now(),
    nativeType: nativeEvent?.type ?? args.eventType,
    native: nativeEvent ?? createSyntheticProviderNativeEvent(args.eventType, args.data),
    ...(args.options?.nativeEventId ? { nativeEventId: args.options.nativeEventId } : {}),
    ...(args.options?.nativeSessionId ? { nativeSessionId: args.options.nativeSessionId } : {}),
    ...(getOpenCodeNativeMeta(nativeEvent) ? { nativeMeta: getOpenCodeNativeMeta(nativeEvent) } : {}),
    data: args.data,
  } as OpenCodeProviderEvent;

  for (const handler of args.providerEventHandlers) {
    try {
      handler(event);
    } catch (error) {
      console.error(`Error in provider event handler for ${args.eventType}:`, error);
    }
  }
}

export function maybeEmitOpenCodeSkillInvokedEvent(args: {
  sessionStateSupport: OpenCodeSessionStateSupport;
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  toolCallId?: string;
  emitEvent: (eventType: "skill.invoked", sessionId: string, data: Record<string, unknown>) => void;
  emitProviderEvent: (
    eventType: "skill.invoked",
    sessionId: string,
    data: ProviderStreamEventDataMap["skill.invoked"],
    options?: {
      native?: OpenCodeEvent;
      nativeEventId?: string;
      nativeSessionId?: string;
      timestamp?: number;
    },
  ) => void;
}): void {
  if (!args.sessionId || !isSkillToolName(args.toolName)) {
    return;
  }

  const invocation = extractSkillInvocationFromToolInput(args.toolInput);
  if (!invocation) {
    return;
  }

  const dedupeKey =
    args.toolUseId
    || args.toolCallId
    || invocation.skillPath
    || invocation.skillName;
  if (!args.sessionStateSupport.shouldEmitSkillInvocation(args.sessionId, dedupeKey)) {
    return;
  }

  args.emitEvent("skill.invoked", args.sessionId, invocation);
  args.emitProviderEvent("skill.invoked", args.sessionId, invocation, {
    nativeEventId: dedupeKey,
    nativeSessionId: args.sessionId,
  });
}
