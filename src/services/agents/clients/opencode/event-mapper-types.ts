import type {
  Event as OpenCodeEvent,
  OpencodeClient as SdkClient,
} from "@opencode-ai/sdk/v2/client";
import type { EventType } from "@/services/agents/types.ts";
import type {
  ProviderStreamEventDataMap,
  ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import type { OpenCodeSessionState } from "@/services/agents/clients/opencode/shared.ts";
import type {
  OpenCodeSessionStateSupport,
  OpenCodeSubagentSessionState,
} from "@/services/agents/clients/opencode/session-state.ts";

export interface OpenCodeEventMapperContext {
  sdkClient: SdkClient | null;
  directory?: string;
  sessionStateSupport: OpenCodeSessionStateSupport;
  sessionTitlesById: Map<string, string>;
  sessionStateById: Map<string, OpenCodeSessionState>;
  childSessionToParentSession: Map<string, string>;
  reasoningPartIds: Set<string>;
  compactionCompleteDedupeWindowMs: number;
  debugLog: (label: string, data: Record<string, unknown>) => void;
  resolveAutoDenyForPermission: (
    sessionId: string,
    toolName: string,
  ) => OpenCodeSubagentAutoDenyResult | null;
  maybeEmitSkillInvokedEvent: (args: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    toolUseId?: string;
    toolCallId?: string;
  }) => void;
  emitEvent: <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>,
  ) => void;
  emitProviderEvent: <T extends ProviderStreamEventType>(
    eventType: T,
    sessionId: string,
    data: ProviderStreamEventDataMap[T],
    options?: {
      native?: OpenCodeEvent;
      nativeEventId?: string;
      nativeSessionId?: string;
      timestamp?: number;
    },
  ) => void;
}

export interface OpenCodeToolPartContext {
  part: Record<string, unknown>;
  partSessionId: string;
  partMessageId: string;
  parentSessionId: string | undefined;
  sessionSubagentState: OpenCodeSubagentSessionState;
  properties: Record<string, unknown> | undefined;
  context: OpenCodeEventMapperContext;
}

export type OpenCodeProviderOnlyContext = Pick<
  OpenCodeEventMapperContext,
  "sdkClient" | "directory" | "emitEvent" | "emitProviderEvent"
>;

export type OpenCodePermissionContext = Pick<
  OpenCodeEventMapperContext,
  | "sdkClient"
  | "directory"
  | "sessionStateSupport"
  | "emitEvent"
  | "emitProviderEvent"
>;

export interface OpenCodeSubagentAutoDenyResult {
  parentSessionId: string;
  subagentName: string;
}

export type OpenCodeAutoDenyPermissionContext = OpenCodePermissionContext & {
  resolveAutoDenyForPermission: (
    sessionId: string,
    toolName: string,
  ) => OpenCodeSubagentAutoDenyResult | null;
};
