import type {
  EventHandler,
  EventType,
  McpRuntimeSnapshot,
  SessionConfig,
} from "@/services/agents/types.ts";
import type { OpenCodeResolvedPromptModel } from "@/services/agents/clients/opencode/model.ts";
import type { OpenCodeSessionState } from "@/services/agents/clients/opencode/shared.ts";
import type { ProviderStreamEventDataMap, ProviderStreamEventType } from "@/services/agents/provider-events.ts";

export interface PromptTokenSnapshot {
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}

export interface OpenCodePromptResult {
  error?: unknown;
  data?: {
    info?: {
      tokens?: PromptTokenSnapshot;
    };
    parts?: Array<Record<string, unknown>>;
  };
}

export interface OpenCodeSdkSessionClient {
  session: {
    prompt: (params: Record<string, unknown>) => Promise<OpenCodePromptResult>;
    promptAsync: (
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ) => Promise<Record<string, unknown> | undefined>;
    command: (
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ) => Promise<Record<string, unknown> | undefined>;
    summarize: (params: Record<string, unknown>) => Promise<unknown>;
    messages: (params: Record<string, unknown>) => Promise<{
      data?: Array<{
        info: {
          role?: string;
          tokens: PromptTokenSnapshot;
        };
      }>;
    }>;
    abort: (params: Record<string, unknown>) => Promise<unknown>;
    delete: (params: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface OpenCodeSessionRuntimeArgs {
  sessionId: string;
  config: SessionConfig;
  directory?: string;
  defaultAgentMode?: string;
  getSdkClient: () => OpenCodeSdkSessionClient | null;
  getActivePromptModel: () => OpenCodeResolvedPromptModel | undefined;
  setActivePromptModelIfMissing: (
    model: OpenCodeResolvedPromptModel | undefined,
  ) => void;
  getActiveContextWindow: () => number | null;
  resolveModelForPrompt: (
    model?: string,
  ) => OpenCodeResolvedPromptModel | undefined;
  resolveModelContextWindow: (modelHint?: string) => Promise<number>;
  setSessionState: (sessionId: string, state: OpenCodeSessionState) => void;
  buildOpenCodeMcpSnapshot: () => Promise<McpRuntimeSnapshot | null>;
  getChildSessionIds: (sessionId: string) => string[];
  onDestroySession: (sessionId: string) => void;
  on: <T extends EventType>(eventType: T, handler: EventHandler<T>) => () => void;
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
      nativeEventId?: string;
      nativeSessionId?: string;
      timestamp?: number;
    },
  ) => void;
  debugLog: (label: string, data: Record<string, unknown>) => void;
}
