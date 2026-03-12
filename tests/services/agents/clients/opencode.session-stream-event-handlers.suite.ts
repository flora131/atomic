import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentMessage } from "@/services/agents/types.ts";
import type { OpenCodeSessionStreamController } from "@/services/agents/clients/opencode/session-stream-controller.ts";
import { createOpenCodeSessionStreamEventHandlers } from "@/services/agents/clients/opencode/session-stream-event-handlers.ts";
import {
  readSubagentLifecycleMetadata,
  readSubagentRoutingMetadata,
} from "@/services/agents/contracts/subagent-stream.ts";
import type { OpenCodeSessionState } from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeSessionRuntimeArgs } from "@/services/agents/clients/opencode/session-runtime-types.ts";

function createController(sessionId: string): {
  controller: OpenCodeSessionStreamController;
  queued: AgentMessage[];
} {
  const queued: AgentMessage[] = [];
  const relatedSessionIds = new Set<string>([sessionId]);
  const startedToolIds = new Set<string>();
  const completedToolIds = new Set<string>();

  return {
    queued,
    controller: {
      enqueueDelta: (messageChunk) => {
        queued.push(messageChunk);
      },
      dequeueDelta: () => queued.shift(),
      hasQueuedDelta: () => queued.length > 0,
      clearQueuedDeltas: () => {
        queued.length = 0;
      },
      waitForStreamSignal: async () => {},
      clearSettleWaitTimer: () => {},
      handleStreamAbort: () => {},
      isRelatedSession: (candidateSessionId) => relatedSessionIds.has(candidateSessionId),
      registerRelatedSession: (candidateSessionId) => {
        if (typeof candidateSessionId === "string" && candidateSessionId.length > 0) {
          relatedSessionIds.add(candidateSessionId);
        }
      },
      buildSyntheticToolUseId: () => `tool-${startedToolIds.size + 1}`,
      markToolStarted: (toolUseId) => {
        if (startedToolIds.has(toolUseId)) {
          return false;
        }
        startedToolIds.add(toolUseId);
        return true;
      },
      markToolCompleted: (toolUseId) => {
        if (completedToolIds.has(toolUseId)) {
          return false;
        }
        completedToolIds.add(toolUseId);
        return true;
      },
      markTerminalEventSeen: () => {},
      markStreamDone: () => {},
      isStreamDone: () => false,
      setStreamError: () => {},
      getStreamError: () => null,
      setPromptInFlight: () => {},
      isPromptInFlight: () => false,
      shouldAutoCompleteTerminalWait: () => false,
      resetStreamTerminalState: () => {},
    },
  };
}

function createRuntimeArgs(sessionId: string): OpenCodeSessionRuntimeArgs {
  return {
    sessionId,
    config: {},
    getSdkClient: () => null,
    getActivePromptModel: () => undefined,
    setActivePromptModelIfMissing: () => {},
    getActiveContextWindow: () => null,
    resolveModelForPrompt: () => undefined,
    resolveModelContextWindow: async () => 0,
    setSessionState: () => {},
    buildOpenCodeMcpSnapshot: async () => null,
    getChildSessionIds: () => [],
    onDestroySession: () => {},
    on: () => () => {},
    emitEvent: () => {},
    emitProviderEvent: () => {},
    debugLog: () => {},
  };
}

function createSessionState(): OpenCodeSessionState {
  return {
    inputTokens: 0,
    outputTokens: 0,
    isClosed: false,
    contextWindow: null,
    systemToolsBaseline: null,
    compaction: {
      isCompacting: false,
      hasAutoCompacted: false,
      pendingCompactionComplete: false,
      lastCompactionCompleteAt: null,
      control: {
        state: "ENDED",
        startedAt: null,
      },
    },
  };
}

function createEvent<T extends AgentEvent["type"]>(
  type: T,
  sessionId: string,
  data: Extract<AgentEvent<T>, { type: T }>["data"],
): AgentEvent<T> {
  return {
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    data,
  } as AgentEvent<T>;
}

describe("createOpenCodeSessionStreamEventHandlers", () => {
  test("forwards nested lifecycle chunks for workflow subagent dispatch", () => {
    const sessionId = "parent-session";
    const { controller, queued } = createController(sessionId);
    const handlers = createOpenCodeSessionStreamEventHandlers({
      controller,
      runtimeArgs: createRuntimeArgs(sessionId),
      sessionState: createSessionState(),
      isSubagentDispatch: true,
    });

    handlers.handleSubagentStart(
      createEvent("subagent.start", sessionId, {
        subagentId: "child-agent",
        subagentSessionId: "child-session",
        subagentType: "codebase-locator",
        task: "Locate the files",
        toolCallId: "task-call-1",
        isBackground: true,
      }),
    );
    handlers.handleSubagentUpdate(
      createEvent("subagent.update", sessionId, {
        subagentId: "child-agent",
        currentTool: "Read",
        toolUses: 1,
      }),
    );
    handlers.handleSubagentComplete(
      createEvent("subagent.complete", sessionId, {
        subagentId: "child-agent",
        success: true,
        result: "done",
      }),
    );

    expect(queued).toHaveLength(3);

    expect(readSubagentLifecycleMetadata(queued[0]!.metadata)).toEqual({
      eventType: "start",
      subagentId: "child-agent",
      subagentType: "codebase-locator",
      task: "Locate the files",
      toolCallId: "task-call-1",
      sdkCorrelationId: "task-call-1",
      isBackground: true,
    });
    expect(readSubagentLifecycleMetadata(queued[1]!.metadata)).toEqual({
      eventType: "update",
      subagentId: "child-agent",
      currentTool: "Read",
      toolUses: 1,
    });
    expect(readSubagentLifecycleMetadata(queued[2]!.metadata)).toEqual({
      eventType: "complete",
      subagentId: "child-agent",
      success: true,
      result: "done",
    });
  });

  test("routes child-session deltas and tool events to the discovered nested agent", () => {
    const sessionId = "parent-session";
    const { controller, queued } = createController(sessionId);
    const handlers = createOpenCodeSessionStreamEventHandlers({
      controller,
      runtimeArgs: createRuntimeArgs(sessionId),
      sessionState: createSessionState(),
      isSubagentDispatch: true,
    });

    handlers.handleSubagentStart(
      createEvent("subagent.start", sessionId, {
        subagentId: "child-agent",
        subagentSessionId: "child-session",
        subagentType: "worker",
        task: "Inspect workflow state",
      }),
    );
    handlers.handleDelta(
      createEvent("message.delta", "child-session", {
        delta: "nested text",
      }),
    );
    handlers.handleToolStart(
      createEvent("tool.start", "child-session", {
        toolName: "Read",
        toolInput: { filePath: "src/workflows/index.ts" },
        toolUseId: "tool-child-1",
      }),
    );
    handlers.handleToolComplete(
      createEvent("tool.complete", "child-session", {
        toolName: "Read",
        success: true,
        toolResult: { ok: true },
        toolUseId: "tool-child-1",
      }),
    );

    expect(queued).toHaveLength(4);

    expect(readSubagentRoutingMetadata(queued[1]!.metadata)).toEqual({
      agentId: "child-agent",
      sessionId: "child-session",
    });
    expect(readSubagentRoutingMetadata(queued[2]!.metadata)).toEqual({
      agentId: "child-agent",
      sessionId: "child-session",
    });
    expect(readSubagentRoutingMetadata(queued[3]!.metadata)).toEqual({
      agentId: "child-agent",
      sessionId: "child-session",
    });

    expect(queued[2]!.type).toBe("tool_use");
    expect(queued[3]!.type).toBe("tool_result");
  });
});
