import { describe, expect, test } from "bun:test";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { createChatUIController, type ChatUIState } from "@/state/runtime/chat-ui-controller.ts";
import type {
  CodingAgentClient,
  ModelDisplayInfo,
  Session,
  SessionConfig,
} from "@/services/agents/types.ts";

function createMockSession(id: string): Session {
  return {
    id,
    send: async () => ({ type: "text", content: "" }),
    stream: async function* () {},
    summarize: async () => {},
    getContextUsage: async () => ({
      inputTokens: 0,
      outputTokens: 0,
      maxTokens: 0,
      usagePercentage: 0,
    }),
    getSystemToolsTokens: () => 0,
    destroy: async () => {},
  };
}

function createMockClient(sessions: Session[]): CodingAgentClient {
  let sessionIndex = 0;
  const modelDisplay: ModelDisplayInfo = {
    model: "claude-sonnet-4",
    tier: "OpenCode",
  };

  return {
    agentType: "opencode",
    createSession: async (_config?: SessionConfig) =>
      sessions[sessionIndex++] ?? createMockSession(`session-${sessionIndex}`),
    resumeSession: async () => null,
    on: () => () => {},
    registerTool: () => {},
    start: async () => {},
    stop: async () => {},
    getModelDisplayInfo: async () => modelDisplay,
    getSystemToolsTokens: () => null,
  };
}

function createState(): ChatUIState {
  const bus = new EventBus();
  return {
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
    isStreaming: false,
    ownedSessionIds: new Set(),
    sessionCreationPromise: null,
    runCounter: 0,
    currentRunId: null,
    telemetryTracker: null,
    bus,
    dispatcher: new BatchDispatcher(bus, 16),
    backgroundAgentsTerminated: false,
  };
}

describe("createChatUIController", () => {
  test("invalidates the model cache when the session boundary changes", async () => {
    const sessions = [
      createMockSession("session-1"),
      createMockSession("session-2"),
    ];
    const client = createMockClient(sessions);
    const state = createState();
    let invalidationCalls = 0;

    const controller = createChatUIController({
      client,
      resolvedAgentType: "opencode",
      sessionConfig: {},
      modelOps: {
        invalidateModelCache: () => {
          invalidationCalls += 1;
        },
        getPendingModel: () => undefined,
        getCurrentModel: async () => undefined,
      } as never,
      state,
      debugSub: {
        unsubscribe: async () => {},
        logPath: null,
        rawLogPath: null,
        logDirPath: null,
        writeRawLine: () => {},
      },
      onExitResolved: () => {},
    });

    await controller.ensureSession();
    await controller.ensureSession();

    expect(state.session?.id).toBe("session-1");
    expect(invalidationCalls).toBe(1);

    await controller.resetSession();
    expect(invalidationCalls).toBe(2);

    await controller.ensureSession();

    expect(state.session?.id).toBe("session-2");
    expect(invalidationCalls).toBe(3);
  });

  test("sanitizes stale Copilot reasoning effort before creating a session", async () => {
    const sessions = [createMockSession("session-1")];
    const capturedConfigs: SessionConfig[] = [];
    const client: CodingAgentClient = {
      ...createMockClient(sessions),
      agentType: "copilot",
      createSession: async (config?: SessionConfig) => {
        capturedConfigs.push({ ...(config ?? {}) });
        return sessions[0] ?? createMockSession("session-1");
      },
    };
    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "copilot",
      sessionConfig: {
        model: "github-copilot/gpt-5.4",
        reasoningEffort: "high",
      },
      modelOps: {
        invalidateModelCache: () => {},
        getPendingModel: () => undefined,
        getCurrentModel: async () => "github-copilot/gpt-5.4",
        getPendingReasoningEffort: () => undefined,
        sanitizeReasoningEffortForModel: async () => undefined,
      } as never,
      state,
      debugSub: {
        unsubscribe: async () => {},
        logPath: null,
        rawLogPath: null,
        logDirPath: null,
        writeRawLine: () => {},
      },
      onExitResolved: () => {},
    });

    await controller.ensureSession();

    expect(capturedConfigs).toHaveLength(1);
    expect(capturedConfigs[0]?.model).toBe("github-copilot/gpt-5.4");
    expect(capturedConfigs[0]?.reasoningEffort).toBeUndefined();
  });
});
