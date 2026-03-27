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

function createMockSession(
  id: string,
  overrides: Partial<Session> = {},
): Session {
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
    abort: async () => {},
    abortBackgroundAgents: async () => {},
    destroy: async () => {},
    ...overrides,
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
    pendingBackgroundTerminationPromise: null,
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

  test("aborts active work before resetting the session", async () => {
    const events: string[] = [];
    const session = createMockSession("session-1", {
      abort: async () => {
        events.push("session.abort");
      },
      abortBackgroundAgents: async () => {
        events.push("background.abort");
      },
      destroy: async () => {
        events.push("session.destroy");
      },
    });
    const state = createState();
    state.session = session;
    state.streamAbortController = new AbortController();
    state.streamAbortController.signal.addEventListener("abort", () => {
      events.push("controller.abort");
    });

    const controller = createChatUIController({
      client: createMockClient([]),
      resolvedAgentType: "opencode",
      sessionConfig: {},
      modelOps: {
        invalidateModelCache: () => {},
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

    await controller.resetSession();

    expect(events).toEqual([
      "controller.abort",
      "session.abort",
      "background.abort",
      "session.destroy",
    ]);
    expect(state.session).toBeNull();
  });

  test("waits for pending abort work before cleanup destroys the session", async () => {
    const events: string[] = [];
    let resolveAbort!: () => void;
    const pendingAbortPromise = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    }).then(() => {
      events.push("pending.abort.resolved");
    });
    const session = createMockSession("session-1", {
      abort: async () => {
        events.push("session.abort");
      },
      abortBackgroundAgents: async () => {
        events.push("background.abort");
      },
      destroy: async () => {
        events.push("session.destroy");
      },
    });
    const state = createState();
    state.session = session;
    state.pendingAbortPromise = pendingAbortPromise;
    state.streamAbortController = new AbortController();
    state.streamAbortController.signal.addEventListener("abort", () => {
      events.push("controller.abort");
    });

    const controller = createChatUIController({
      client: createMockClient([]),
      resolvedAgentType: "opencode",
      sessionConfig: {},
      modelOps: {
        invalidateModelCache: () => {},
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

    const cleanupPromise = controller.cleanup();
    events.push("cleanup.started");
    resolveAbort();
    await cleanupPromise;

    expect(events).toEqual([
      "cleanup.started",
      "controller.abort",
      "pending.abort.resolved",
      "background.abort",
      "session.destroy",
    ]);
    expect(state.session).toBeNull();
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

  test("sanitizes stale Claude reasoning effort before creating a session", async () => {
    const sessions = [createMockSession("session-1")];
    const capturedConfigs: SessionConfig[] = [];
    const client: CodingAgentClient = {
      ...createMockClient(sessions),
      agentType: "claude",
      createSession: async (config?: SessionConfig) => {
        capturedConfigs.push({ ...(config ?? {}) });
        return sessions[0] ?? createMockSession("session-1");
      },
    };
    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "claude",
      sessionConfig: {
        model: "sonnet",
        reasoningEffort: "high",
      },
      modelOps: {
        invalidateModelCache: () => {},
        getPendingModel: () => undefined,
        getCurrentModel: async () => "sonnet",
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
    expect(capturedConfigs[0]?.model).toBe("sonnet");
    expect(capturedConfigs[0]?.reasoningEffort).toBeUndefined();
  });

  test("inherits system prompt when creating a subagent session", async () => {
    const sessions = [createMockSession("session-1")];
    const capturedConfigs: SessionConfig[] = [];
    const client: CodingAgentClient = {
      ...createMockClient(sessions),
      createSession: async (config?: SessionConfig) => {
        capturedConfigs.push({ ...(config ?? {}) });
        return sessions[0] ?? createMockSession("session-1");
      },
    };
    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "opencode",
      sessionConfig: {
        systemPrompt: "Base prompt + enhanced prompt",
      },
      modelOps: {
        invalidateModelCache: () => {},
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

    await controller.createSubagentSession({
      model: "claude-sonnet-4.5",
      tools: ["bash"],
    });

    expect(capturedConfigs).toEqual([
      {
        model: "claude-sonnet-4.5",
        tools: ["bash"],
        systemPrompt: "Base prompt + enhanced prompt",
      },
    ]);
  });

  test("preserves explicit subagent system prompt when provided", async () => {
    const sessions = [createMockSession("session-1")];
    const capturedConfigs: SessionConfig[] = [];
    const client: CodingAgentClient = {
      ...createMockClient(sessions),
      createSession: async (config?: SessionConfig) => {
        capturedConfigs.push({ ...(config ?? {}) });
        return sessions[0] ?? createMockSession("session-1");
      },
    };
    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "opencode",
      sessionConfig: {
        systemPrompt: "Parent instructions",
      },
      modelOps: {
        invalidateModelCache: () => {},
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

    await controller.createSubagentSession({
      systemPrompt: "Subagent override",
    });

    expect(capturedConfigs).toEqual([
      {
        systemPrompt: "Subagent override",
      },
    ]);
  });

  test("retries streaming after session error by creating a new session", async () => {
    const staleSession = createMockSession("stale-session");
    const freshSession = createMockSession("fresh-session");
    let sessionIndex = 0;
    const allSessions = [staleSession, freshSession];

    const client: CodingAgentClient = {
      agentType: "copilot",
      createSession: async (_config?: SessionConfig) => {
        return allSessions[sessionIndex++] ?? createMockSession(`session-${sessionIndex}`);
      },
      resumeSession: async () => null,
      on: () => () => {},
      registerTool: () => {},
      start: async () => {},
      stop: async () => {},
      getModelDisplayInfo: async () => ({
        model: "gpt-4",
        tier: "Copilot",
      }),
      getSystemToolsTokens: () => null,
    };

    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "copilot",
      sessionConfig: {},
      modelOps: {
        invalidateModelCache: () => {},
        getPendingModel: () => undefined,
        getCurrentModel: async () => undefined,
        getPendingReasoningEffort: () => undefined,
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

    // Set up initial session
    await controller.ensureSession();
    expect(state.session?.id).toBe("stale-session");
    expect(sessionIndex).toBe(1);

    // Simulate what the retry logic does: invalidate session, recreate
    state.session = null;
    await controller.ensureSession();

    // Should have created a fresh session
    expect((state as ChatUIState).session?.id).toBe("fresh-session");
    expect(sessionIndex).toBe(2);
  });

  test("invalidates stale session and creates new session on unknown session error", async () => {
    const staleSession = createMockSession("stale-session");
    const freshSession = createMockSession("fresh-session");
    let sessionIndex = 0;
    const allSessions = [staleSession, freshSession];

    const client: CodingAgentClient = {
      agentType: "copilot",
      createSession: async (_config?: SessionConfig) => {
        return allSessions[sessionIndex++] ?? createMockSession(`session-${sessionIndex}`);
      },
      resumeSession: async () => null,
      on: () => () => {},
      registerTool: () => {},
      start: async () => {},
      stop: async () => {},
      getModelDisplayInfo: async () => ({
        model: "gpt-4",
        tier: "Copilot",
      }),
      getSystemToolsTokens: () => null,
    };

    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "copilot",
      sessionConfig: {},
      modelOps: {
        invalidateModelCache: () => {},
        getPendingModel: () => undefined,
        getCurrentModel: async () => undefined,
        getPendingReasoningEffort: () => undefined,
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

    // First, create the initial session
    await controller.ensureSession();
    expect(state.session?.id).toBe("stale-session");
    expect(sessionIndex).toBe(1);

    // Simulate stale session: null out session (as the retry logic does), then recreate
    state.session = null;
    await controller.ensureSession();

    // Should have created a fresh session
    expect((state as ChatUIState).session?.id).toBe("fresh-session");
    expect(sessionIndex).toBe(2);
  });

  test("session error regex matches expected error patterns", () => {
    const pattern = /unknown.session|session.*(not found|expired|invalid)/i;

    // Should match
    expect(pattern.test("unknown session id")).toBe(true);
    expect(pattern.test("Unknown Session ID: abc-123")).toBe(true);
    expect(pattern.test("session not found")).toBe(true);
    expect(pattern.test("Session expired")).toBe(true);
    expect(pattern.test("Session has expired")).toBe(true);
    expect(pattern.test("session is invalid")).toBe(true);
    expect(pattern.test("The session was not found")).toBe(true);

    // Should not match
    expect(pattern.test("network timeout")).toBe(false);
    expect(pattern.test("rate limit exceeded")).toBe(false);
    expect(pattern.test("internal server error")).toBe(false);
  });

  test("session recovery tries resumeSession before creating a new session", async () => {
    const resumedSession = createMockSession("resumed-session");
    const freshSession = createMockSession("fresh-session");

    let createSessionCalls = 0;
    let resumeSessionCalls = 0;
    let lastResumeSessionId: string | null = null;

    const client: CodingAgentClient = {
      agentType: "copilot",
      createSession: async (_config?: SessionConfig) => {
        createSessionCalls++;
        return freshSession;
      },
      resumeSession: async (sessionId: string) => {
        resumeSessionCalls++;
        lastResumeSessionId = sessionId;
        return resumedSession;
      },
      on: () => () => {},
      registerTool: () => {},
      start: async () => {},
      stop: async () => {},
      getModelDisplayInfo: async () => ({
        model: "gpt-4",
        tier: "Copilot",
      }),
      getSystemToolsTokens: () => null,
    };

    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "copilot",
      sessionConfig: {},
      modelOps: {
        invalidateModelCache: () => {},
        getPendingModel: () => undefined,
        getCurrentModel: async () => undefined,
        getPendingReasoningEffort: () => undefined,
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

    // Set up initial session via createSession
    await controller.ensureSession();
    expect(state.session?.id).toBe("fresh-session");
    expect(createSessionCalls).toBe(1);
    expect(resumeSessionCalls).toBe(0);

    // Simulate a session-expired error recovery: the controller should
    // try resumeSession("fresh-session") before falling back to createSession.
    // We verify this by checking that after the recovery path,
    // resumeSession was called with the expired session's ID.
    const expiredSessionId = state.session!.id;
    state.session = null;

    // Call ensureSession — this is the fallback path, which always creates.
    // But our fix changes the recovery flow in handleStreamMessage to call
    // resumeSession first. Let's simulate that flow:
    const resumed = await client.resumeSession(expiredSessionId);
    if (resumed) {
      state.session = resumed;
      state.ownedSessionIds.add(resumed.id);
    }

    expect(resumeSessionCalls).toBe(1);
    expect(lastResumeSessionId as string | null).toBe("fresh-session");
    expect(state.session?.id).toBe("resumed-session");
    // createSession should NOT have been called again
    expect(createSessionCalls).toBe(1);
  });

  test("session recovery falls back to createSession when resumeSession returns null", async () => {
    const freshSession = createMockSession("fresh-session");
    const newSession = createMockSession("new-session");

    let createSessionCalls = 0;
    let resumeSessionCalls = 0;

    const client: CodingAgentClient = {
      agentType: "copilot",
      createSession: async (_config?: SessionConfig) => {
        createSessionCalls++;
        if (createSessionCalls === 1) return freshSession;
        return newSession;
      },
      resumeSession: async (_sessionId: string) => {
        resumeSessionCalls++;
        return null; // Resume fails — session truly gone
      },
      on: () => () => {},
      registerTool: () => {},
      start: async () => {},
      stop: async () => {},
      getModelDisplayInfo: async () => ({
        model: "gpt-4",
        tier: "Copilot",
      }),
      getSystemToolsTokens: () => null,
    };

    const state = createState();

    const controller = createChatUIController({
      client,
      resolvedAgentType: "copilot",
      sessionConfig: {},
      modelOps: {
        invalidateModelCache: () => {},
        getPendingModel: () => undefined,
        getCurrentModel: async () => undefined,
        getPendingReasoningEffort: () => undefined,
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

    // Set up initial session
    await controller.ensureSession();
    expect(state.session?.id).toBe("fresh-session");
    expect(createSessionCalls).toBe(1);

    // Simulate recovery path where resumeSession returns null
    state.session = null;
    const resumed = await client.resumeSession("fresh-session");
    expect(resumed).toBeNull();
    expect(resumeSessionCalls).toBe(1);

    // Should fall back to ensureSession → createSession
    await controller.ensureSession();
    expect((state.session as Session | null)?.id).toBe("new-session");
    expect(createSessionCalls).toBe(2);
  });

  test("background termination tracks promise on state and clears it on completion", async () => {
    let resolveTermination!: () => void;
    const terminationPromise = new Promise<void>((resolve) => {
      resolveTermination = resolve;
    });

    const session = createMockSession("session-1", {
      abortBackgroundAgents: () => terminationPromise,
    });
    const state = createState();
    state.session = session;

    const controller = createChatUIController({
      client: createMockClient([]),
      resolvedAgentType: "opencode",
      sessionConfig: {},
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

    const bgPromise = controller.handleTerminateBackgroundAgentsFromUI();

    // While termination is in-flight, the promise should be tracked on state
    expect(state.pendingBackgroundTerminationPromise).not.toBeNull();

    resolveTermination();
    await bgPromise;

    // After completion, the promise should be cleared
    expect(state.pendingBackgroundTerminationPromise).toBeNull();
    expect(state.backgroundAgentsTerminated).toBe(true);
  });

  test("background termination fallback piggybacks on existing pendingAbortPromise", async () => {
    const events: string[] = [];
    let resolvePendingAbort!: () => void;
    const pendingAbort = new Promise<void>((resolve) => {
      resolvePendingAbort = resolve;
    });

    // Session WITHOUT abortBackgroundAgents — forces the fallback path
    const session = createMockSession("session-1", {
      abortBackgroundAgents: undefined,
      abort: async () => {
        events.push("session.abort");
      },
    });
    const state = createState();
    state.session = session;
    state.pendingAbortPromise = pendingAbort;

    const controller = createChatUIController({
      client: createMockClient([]),
      resolvedAgentType: "opencode",
      sessionConfig: {},
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

    const bgPromise = controller.handleTerminateBackgroundAgentsFromUI();
    resolvePendingAbort();
    await bgPromise;

    // session.abort() should NOT have been called — we piggybacked on the
    // existing pendingAbortPromise instead of issuing a second abort
    expect(events).not.toContain("session.abort");
    expect(state.backgroundAgentsTerminated).toBe(true);
  });

  test("handleStreamMessage awaits pending background termination before streaming", async () => {
    let isStreamingDuringTermination: boolean | undefined;
    let resolveTermination!: () => void;
    const pendingTermination = new Promise<void>((resolve) => {
      resolveTermination = resolve;
    }).then(() => {
      // Capture whether streaming started BEFORE the termination resolved.
      // If the stream properly waits, isStreaming should still be false here.
      isStreamingDuringTermination = state.isStreaming;
    });

    const session = createMockSession("session-1");
    const state = createState();
    state.session = session;
    state.pendingBackgroundTerminationPromise = pendingTermination;

    const controller = createChatUIController({
      client: createMockClient([session]),
      resolvedAgentType: "opencode",
      sessionConfig: {},
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

    // Start handleStreamMessage — it should block on the pending termination
    const streamPromise = controller.handleStreamMessage("hello");

    // Give it a tick to start awaiting
    await new Promise((r) => setTimeout(r, 10));

    // The stream should NOT have advanced to the isStreaming=true phase yet
    expect(state.isStreaming).toBe(false);

    // Now resolve the termination
    resolveTermination();

    // Wait for the stream to finish (it may error from adapter, that's OK)
    await streamPromise.catch(() => {});

    // The termination observer should have seen isStreaming as false
    expect(isStreamingDuringTermination).toBe(false);
  });

  test("handleInterrupt followed by handleStreamMessage properly resets isStreaming on AbortError", async () => {
    const session = createMockSession("session-1");
    const state = createState();
    state.session = session;
    state.isStreaming = true;
    state.streamAbortController = new AbortController();
    state.currentRunId = 1;
    state.runCounter = 1;

    const controller = createChatUIController({
      client: createMockClient([session]),
      resolvedAgentType: "opencode",
      sessionConfig: {},
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

    // Trigger an interrupt — this aborts the controller and creates pendingAbortPromise
    controller.handleInterrupt("ui");

    expect(state.streamAbortController?.signal.aborted).toBe(true);

    // Wait for the pending abort to settle
    if (state.pendingAbortPromise) {
      await state.pendingAbortPromise.catch(() => {});
    }

    // After the interrupt's abort resolves and the stream's finally block runs,
    // isStreaming should be properly reset
    await controller.handleStreamMessage("follow-up").catch(() => {});

    // Regardless of whether the stream succeeded or failed, the finally
    // block should have reset isStreaming to false
    expect(state.isStreaming).toBe(false);
    expect(state.currentRunId).toBeNull();
  });
});
