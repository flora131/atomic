import type { AgentType } from "@/services/telemetry/types.ts";
import type { EventHandler, EventType } from "@/services/agents/contracts/events.ts";
import type { ModelDisplayInfo } from "@/services/agents/contracts/models.ts";
import type { Session, SessionConfig, SessionMessageWithParts } from "@/services/agents/contracts/session.ts";
import type { ToolDefinition } from "@/services/agents/contracts/tools.ts";

export interface CodingAgentClient {
  readonly agentType: AgentType;
  createSession(config?: SessionConfig): Promise<Session>;
  resumeSession(sessionId: string): Promise<Session | null>;
  getSessionMessagesWithParts?(sessionId: string): Promise<SessionMessageWithParts[]>;
  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void;
  registerTool(tool: ToolDefinition): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  getModelDisplayInfo(modelHint?: string): Promise<ModelDisplayInfo>;
  setActiveSessionModel?(
    model: string,
    options?: { reasoningEffort?: string }
  ): Promise<void>;
  getSystemToolsTokens(): number | null;
  getKnownAgentNames?(): string[];
}

export type CodingAgentClientFactory = (
  agentType: AgentType,
  options?: Record<string, unknown>
) => CodingAgentClient;
