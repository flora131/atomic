/**
 * Test fixture factories for Session and SessionConfig types.
 *
 * The Session interface includes async methods (send, stream, etc.)
 * so these factories return stub implementations that are safe to
 * call but do nothing by default. Tests can override individual
 * methods via the overrides parameter.
 */

import type {
  Session,
  SessionConfig,
  ContextUsage,
  AgentMessage,
  SessionCompactionState,
} from "@/services/agents/contracts/session.ts";

// ---------------------------------------------------------------------------
// Session ID counter
// ---------------------------------------------------------------------------

let sessionIdCounter = 0;

export function nextSessionId(): string {
  return `session_${String(++sessionIdCounter).padStart(4, "0")}`;
}

export function resetSessionIdCounter(): void {
  sessionIdCounter = 0;
}

// ---------------------------------------------------------------------------
// SessionConfig factory
// ---------------------------------------------------------------------------

export function createSessionConfig(
  overrides?: Partial<SessionConfig>,
): SessionConfig {
  return {
    model: "claude-sonnet-4-20250514",
    permissionMode: "auto",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ContextUsage factory
// ---------------------------------------------------------------------------

export function createContextUsage(
  overrides?: Partial<ContextUsage>,
): ContextUsage {
  return {
    inputTokens: 2000,
    outputTokens: 500,
    maxTokens: 128000,
    usagePercentage: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AgentMessage factory
// ---------------------------------------------------------------------------

export function createAgentMessage(
  overrides?: Partial<AgentMessage>,
): AgentMessage {
  return {
    type: "text",
    content: "Agent response text.",
    role: "assistant",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SessionCompactionState factory
// ---------------------------------------------------------------------------

export function createSessionCompactionState(
  overrides?: Partial<SessionCompactionState>,
): SessionCompactionState {
  return {
    isCompacting: false,
    hasAutoCompacted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Session factory
// ---------------------------------------------------------------------------

/**
 * Override shape for createMockSession.
 *
 * Each method can be replaced individually. The `id` field is handled
 * separately since the Session interface declares it as `readonly`.
 */
interface MockSessionOverrides {
  id?: string;
  send?: Session["send"];
  stream?: Session["stream"];
  sendAsync?: Session["sendAsync"];
  summarize?: Session["summarize"];
  getContextUsage?: Session["getContextUsage"];
  getSystemToolsTokens?: Session["getSystemToolsTokens"];
  getMcpSnapshot?: Session["getMcpSnapshot"];
  getCompactionState?: Session["getCompactionState"];
  destroy?: Session["destroy"];
  command?: Session["command"];
  abort?: Session["abort"];
  abortBackgroundAgents?: Session["abortBackgroundAgents"];
}

/**
 * Creates a mock Session whose methods are safe no-op stubs by default.
 *
 * Usage:
 * ```ts
 * const session = createMockSession({ id: "s1" });
 * expect(session.id).toBe("s1");
 * await session.destroy(); // no-op
 * ```
 */
export function createMockSession(overrides?: MockSessionOverrides): Session {
  const id = overrides?.id ?? nextSessionId();

  // We need to create an object that satisfies the Session interface.
  // `id` is declared `readonly` on Session, so we use Object.defineProperty.
  const session: Session = {
    id,
    send: overrides?.send ?? (async (_msg: string) => createAgentMessage()),

    stream: overrides?.stream ?? (async function* (_msg: string) {
      yield createAgentMessage();
    }),

    sendAsync: overrides?.sendAsync ?? (async () => {}),

    summarize: overrides?.summarize ?? (async () => {}),

    getContextUsage:
      overrides?.getContextUsage ?? (async () => createContextUsage()),

    getSystemToolsTokens: overrides?.getSystemToolsTokens ?? (() => 0),

    getMcpSnapshot: overrides?.getMcpSnapshot ?? (async () => null),

    getCompactionState:
      overrides?.getCompactionState ?? (() => createSessionCompactionState()),

    destroy: overrides?.destroy ?? (async () => {}),

    command: overrides?.command ?? (async () => {}),

    abort: overrides?.abort ?? (async () => {}),

    abortBackgroundAgents: overrides?.abortBackgroundAgents ?? (async () => {}),
  };

  return session;
}
