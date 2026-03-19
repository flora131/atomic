import type {
  CopilotSession as SdkCopilotSession,
  CustomAgentConfig as SdkCustomAgentConfig,
} from "@github/copilot-sdk";

import type { SessionConfig } from "@/services/agents/types.ts";

export interface CopilotSessionState {
  sdkSession: SdkCopilotSession;
  sessionId: string;
  config: SessionConfig;
  inputTokens: number;
  outputTokens: number;
  isClosed: boolean;
  unsubscribe: () => void;
  recentEventIds: Set<string>;
  recentEventOrder: string[];
  toolCallIdToName: Map<string, string>;
  toolCallIdToSubagentName: Map<string, string>;
  contextWindow: number | null;
  systemToolsBaseline: number | null;
  pendingAbortPromise: Promise<void> | null;
}

export interface CopilotAgentToolPolicy {
  tools?: string[] | null;
  disallowedTools?: string[] | null;
}

export type CopilotSdkModelRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  defaultReasoningEffort?: unknown;
  supportedReasoningEfforts?: unknown;
  capabilities?: Record<string, unknown>;
};

export interface CopilotSessionArtifacts {
  customAgents?: SdkCustomAgentConfig[];
  agentToolPolicies?: Record<string, CopilotAgentToolPolicy>;
  skillDirectories?: string[];
  instructions?: string;
}

export const RECENT_EVENT_ID_WINDOW = 2048;
