import type {
  ContextUsage,
  McpRuntimeSnapshot,
  SessionCompactionState,
} from "@/services/agents/types.ts";
import {
  AUTO_COMPACTION_THRESHOLD,
  MAX_COMPACTION_WAIT_MS,
  emitOpenCodeCompactionContractFailureObservability,
  setCompactionControlState,
  toOpenCodeCompactionTerminalError,
  withCompactionTimeout,
} from "@/services/agents/clients/opencode/compaction.ts";
import {
  extractOpenCodeErrorMessage,
  type OpenCodeSessionState,
} from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeSessionRuntimeArgs } from "@/services/agents/clients/opencode/session-runtime-types.ts";

export async function summarizeOpenCodeSession(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
}): Promise<void> {
  const sdkClient = args.runtimeArgs.getSdkClient();
  if (!sdkClient) {
    throw new Error("Client not connected");
  }

  const preCompactionTokens =
    args.sessionState.inputTokens + args.sessionState.outputTokens;
  let summarizeSucceeded = false;
  try {
    const compactionStartAt = Date.now();
    setCompactionControlState(args.sessionState, "compaction.start", {
      now: compactionStartAt,
    });
    args.runtimeArgs.debugLog("compaction.summarize_start", {
      sessionId: args.runtimeArgs.sessionId,
      thresholdPercentage: AUTO_COMPACTION_THRESHOLD * 100,
      inputTokens: args.sessionState.inputTokens,
      outputTokens: args.sessionState.outputTokens,
      preCompactionTokens,
      contextWindow: args.sessionState.contextWindow ?? 0,
      maxCompactionWaitMs: MAX_COMPACTION_WAIT_MS,
    });
    args.runtimeArgs.emitEvent("session.compaction", args.runtimeArgs.sessionId, {
      phase: "start",
    });
    args.runtimeArgs.emitProviderEvent("session.compaction", args.runtimeArgs.sessionId, {
      phase: "start",
    }, {
      nativeSessionId: args.runtimeArgs.sessionId,
      timestamp: compactionStartAt,
    });
    args.sessionState.compaction.pendingCompactionComplete = true;

    await withCompactionTimeout(
      sdkClient.session.summarize({
        sessionID: args.runtimeArgs.sessionId,
        directory: args.runtimeArgs.directory,
      }),
    );
    summarizeSucceeded = true;

    try {
      const messagesResult = await sdkClient.session.messages({
        sessionID: args.runtimeArgs.sessionId,
      });
      const messages = messagesResult.data ?? [];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const msg = messages[i]!.info;
        if (msg.role === "assistant" && "tokens" in msg) {
          args.sessionState.inputTokens =
            msg.tokens.input ?? args.sessionState.inputTokens;
          args.sessionState.outputTokens = msg.tokens.output ?? 0;
          const cacheTokens =
            (msg.tokens.cache?.write ?? 0) + (msg.tokens.cache?.read ?? 0);
          if (cacheTokens > 0) {
            args.sessionState.systemToolsBaseline = cacheTokens;
          }
          break;
        }
      }
    } catch (refreshError) {
      args.runtimeArgs.debugLog("compaction.refresh_tokens_failed", {
        sessionId: args.runtimeArgs.sessionId,
        error: extractOpenCodeErrorMessage(refreshError),
      });
    }

    const postCompactionTokens =
      args.sessionState.inputTokens + args.sessionState.outputTokens;
    const tokensRemoved = preCompactionTokens - postCompactionTokens;
    args.runtimeArgs.debugLog("compaction.summarize_complete", {
      sessionId: args.runtimeArgs.sessionId,
      thresholdPercentage: AUTO_COMPACTION_THRESHOLD * 100,
      inputTokens: args.sessionState.inputTokens,
      outputTokens: args.sessionState.outputTokens,
      preCompactionTokens,
      postCompactionTokens,
      tokensRemoved,
      tokenLimit: args.sessionState.contextWindow ?? 0,
    });
    if (tokensRemoved > 0) {
      args.runtimeArgs.emitEvent("session.truncation", args.runtimeArgs.sessionId, {
        tokenLimit: args.sessionState.contextWindow ?? 0,
        tokensRemoved,
        messagesRemoved: 0,
      });
      args.runtimeArgs.emitProviderEvent("session.truncation", args.runtimeArgs.sessionId, {
        tokenLimit: args.sessionState.contextWindow ?? 0,
        tokensRemoved,
        messagesRemoved: 0,
      }, {
        nativeSessionId: args.runtimeArgs.sessionId,
      });
    }

    args.runtimeArgs.emitEvent("session.idle", args.runtimeArgs.sessionId, {
      reason: "context_compacted",
    });
    args.runtimeArgs.emitProviderEvent("session.idle", args.runtimeArgs.sessionId, {
      reason: "context_compacted",
    }, {
      nativeSessionId: args.runtimeArgs.sessionId,
    });
    setCompactionControlState(args.sessionState, "compaction.complete.success");
  } catch (error) {
    const sourceErrorMessage = extractOpenCodeErrorMessage(error);
    const terminalError = toOpenCodeCompactionTerminalError(error);
    setCompactionControlState(args.sessionState, "compaction.complete.error", {
      errorCode: terminalError.code,
      errorMessage: terminalError.message,
    });
    args.runtimeArgs.debugLog("compaction.summarize_failed", {
      sessionId: args.runtimeArgs.sessionId,
      thresholdPercentage: AUTO_COMPACTION_THRESHOLD * 100,
      inputTokens: args.sessionState.inputTokens,
      outputTokens: args.sessionState.outputTokens,
      preCompactionTokens,
      contextWindow: args.sessionState.contextWindow ?? 0,
      error: sourceErrorMessage,
      terminalErrorCode: terminalError.code,
      terminalError: terminalError.message,
    });
    emitOpenCodeCompactionContractFailureObservability({
      sessionId: args.runtimeArgs.sessionId,
      code: terminalError.code,
      sourceError: sourceErrorMessage,
      terminalError: terminalError.message,
    });
    args.runtimeArgs.emitEvent("session.compaction", args.runtimeArgs.sessionId, {
      phase: "complete",
      success: false,
      error: terminalError.message,
    });
    args.runtimeArgs.emitProviderEvent("session.compaction", args.runtimeArgs.sessionId, {
      phase: "complete",
      success: false,
      error: terminalError.message,
    }, {
      nativeSessionId: args.runtimeArgs.sessionId,
    });
    args.runtimeArgs.emitEvent("session.error", args.runtimeArgs.sessionId, {
      error: terminalError.message,
      code: terminalError.code,
    });
    args.runtimeArgs.emitProviderEvent("session.error", args.runtimeArgs.sessionId, {
      error: terminalError.message,
      code: terminalError.code,
    }, {
      nativeSessionId: args.runtimeArgs.sessionId,
    });
    throw terminalError;
  } finally {
    if (!summarizeSucceeded) {
      args.sessionState.compaction.pendingCompactionComplete = false;
    }
  }
}

export function getOpenCodeSessionContextUsage(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
}): ContextUsage {
  const maxTokens =
    args.runtimeArgs.getActiveContextWindow() ?? args.sessionState.contextWindow;
  if (maxTokens === null) {
    throw new Error("Context window size unavailable: provider.list() did not return model limits.");
  }
  const totalTokens = args.sessionState.inputTokens + args.sessionState.outputTokens;
  return {
    inputTokens: args.sessionState.inputTokens,
    outputTokens: args.sessionState.outputTokens,
    maxTokens,
    usagePercentage: (totalTokens / maxTokens) * 100,
  };
}

export function getOpenCodeSystemToolsTokens(
  sessionState: OpenCodeSessionState,
): number {
  if (sessionState.systemToolsBaseline === null) {
    throw new Error("System tools baseline unavailable: no query has completed. Send a message first.");
  }
  return sessionState.systemToolsBaseline;
}

export function getOpenCodeSessionCompactionState(
  sessionState: OpenCodeSessionState,
): SessionCompactionState {
  return {
    isCompacting: sessionState.compaction.isCompacting,
    hasAutoCompacted: sessionState.compaction.hasAutoCompacted,
  };
}

export async function getOpenCodeSessionMcpSnapshot(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
}): Promise<McpRuntimeSnapshot | null> {
  if (args.sessionState.isClosed) {
    return null;
  }
  return args.runtimeArgs.buildOpenCodeMcpSnapshot();
}

export async function abortOpenCodeSession(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
}): Promise<void> {
  if (args.sessionState.isClosed) return;
  const sdkClient = args.runtimeArgs.getSdkClient();
  if (!sdkClient) return;
  await sdkClient.session.abort({
    sessionID: args.runtimeArgs.sessionId,
    directory: args.runtimeArgs.directory,
  });
}

export async function abortOpenCodeBackgroundAgents(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
}): Promise<void> {
  if (args.sessionState.isClosed) return;
  const sdkClient = args.runtimeArgs.getSdkClient();
  if (!sdkClient) return;

  const childSessionIds = args.runtimeArgs.getChildSessionIds(args.runtimeArgs.sessionId);
  if (childSessionIds.length > 0) {
    const abortPromises = childSessionIds.map((childSid) =>
      sdkClient.session.abort({
        sessionID: childSid,
        directory: args.runtimeArgs.directory,
      }).catch((error: unknown) => {
        console.error(`Failed to abort child session ${childSid}:`, error);
      }),
    );
    await Promise.allSettled(abortPromises);
  }

  await sdkClient.session.abort({
    sessionID: args.runtimeArgs.sessionId,
    directory: args.runtimeArgs.directory,
  });
}

export async function destroyOpenCodeSession(args: {
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
}): Promise<void> {
  if (args.sessionState.isClosed) {
    return;
  }
  args.sessionState.isClosed = true;

  const sdkClient = args.runtimeArgs.getSdkClient();
  if (!sdkClient) {
    return;
  }

  await sdkClient.session.delete({
    sessionID: args.runtimeArgs.sessionId,
    directory: args.runtimeArgs.directory,
  });

  args.runtimeArgs.onDestroySession(args.runtimeArgs.sessionId);
  args.runtimeArgs.emitEvent("session.idle", args.runtimeArgs.sessionId, {
    reason: "destroyed",
  });
}
