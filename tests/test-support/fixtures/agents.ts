/**
 * Test fixture factories for agent-related types.
 *
 * Covers CodingAgentClient configuration, ModelDisplayInfo,
 * and provider event data types used across the test suite.
 */

import type { SessionConfig } from "@/services/agents/contracts/session.ts";
import type { ModelDisplayInfo } from "@/services/agents/contracts/models.ts";
import type { CodingAgentClient } from "@/services/agents/contracts/client.ts";
import type { EventType, EventHandler } from "@/services/agents/contracts/events.ts";
import { createMockSession } from "./sessions.ts";

type AgentType = "claude" | "opencode" | "copilot";

// ---------------------------------------------------------------------------
// Agent config factory (SessionConfig tailored for agent usage)
// ---------------------------------------------------------------------------

export function createAgentConfig(
  overrides?: Partial<SessionConfig>,
): SessionConfig {
  return {
    model: "claude-sonnet-4-20250514",
    permissionMode: "auto",
    maxTurns: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ModelDisplayInfo factory
// ---------------------------------------------------------------------------

export function createModelDisplayInfo(
  overrides?: Partial<ModelDisplayInfo>,
): ModelDisplayInfo {
  return {
    model: "claude-sonnet-4-20250514",
    tier: "standard",
    supportsReasoning: true,
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    contextWindow: 200000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AgentInfo-like metadata factory
// ---------------------------------------------------------------------------

export interface AgentInfoFixture {
  name: string;
  agentType: AgentType;
  model: string;
  description: string;
  source: "project" | "user";
}

export function createAgentInfo(
  overrides?: Partial<AgentInfoFixture>,
): AgentInfoFixture {
  return {
    name: "test-agent",
    agentType: "claude",
    model: "claude-sonnet-4-20250514",
    description: "A test agent for unit tests.",
    source: "project",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock CodingAgentClient factory
// ---------------------------------------------------------------------------

interface MockCodingAgentClientOverrides {
  agentType?: AgentType;
  createSession?: CodingAgentClient["createSession"];
  resumeSession?: CodingAgentClient["resumeSession"];
  getSessionMessagesWithParts?: CodingAgentClient["getSessionMessagesWithParts"];
  on?: CodingAgentClient["on"];
  registerTool?: CodingAgentClient["registerTool"];
  start?: CodingAgentClient["start"];
  stop?: CodingAgentClient["stop"];
  getModelDisplayInfo?: CodingAgentClient["getModelDisplayInfo"];
  setActiveSessionModel?: CodingAgentClient["setActiveSessionModel"];
  getSystemToolsTokens?: CodingAgentClient["getSystemToolsTokens"];
  getKnownAgentNames?: CodingAgentClient["getKnownAgentNames"];
}

/**
 * Creates a mock CodingAgentClient with safe no-op stubs.
 *
 * Usage:
 * ```ts
 * const client = createMockCodingAgentClient({ agentType: "opencode" });
 * expect(client.agentType).toBe("opencode");
 * ```
 */
export function createMockCodingAgentClient(
  overrides?: MockCodingAgentClientOverrides,
): CodingAgentClient {
  return {
    agentType: overrides?.agentType ?? "claude",

    createSession:
      overrides?.createSession ?? (async () => createMockSession()),

    resumeSession:
      overrides?.resumeSession ?? (async () => null),

    getSessionMessagesWithParts:
      overrides?.getSessionMessagesWithParts ?? (async () => []),

    on: overrides?.on ?? (<T extends EventType>(_type: T, _handler: EventHandler<T>) => {
      // Return an unsubscribe no-op
      return () => {};
    }),

    registerTool: overrides?.registerTool ?? (() => {}),

    start: overrides?.start ?? (async () => {}),

    stop: overrides?.stop ?? (async () => {}),

    getModelDisplayInfo:
      overrides?.getModelDisplayInfo ?? (async () => createModelDisplayInfo()),

    setActiveSessionModel:
      overrides?.setActiveSessionModel ?? (async () => {}),

    getSystemToolsTokens: overrides?.getSystemToolsTokens ?? (() => null),

    getKnownAgentNames: overrides?.getKnownAgentNames ?? (() => []),
  };
}
