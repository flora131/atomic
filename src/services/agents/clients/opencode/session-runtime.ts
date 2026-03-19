import type { Session } from "@/services/agents/types.ts";
import {
  abortOpenCodeBackgroundAgents,
  abortOpenCodeSession,
  destroyOpenCodeSession,
  getOpenCodeSessionCompactionState,
  getOpenCodeSessionContextUsage,
  getOpenCodeSessionMcpSnapshot,
  getOpenCodeSystemToolsTokens,
  summarizeOpenCodeSession,
} from "@/services/agents/clients/opencode/session-maintenance.ts";
import {
  runOpenCodeSessionCommand,
  sendOpenCodeSessionPrompt,
  sendOpenCodeSessionPromptAsync,
} from "@/services/agents/clients/opencode/session-prompt-actions.ts";
import {
  type OpenCodeSessionRuntimeArgs,
} from "@/services/agents/clients/opencode/session-runtime-types.ts";
import { createOpenCodeSessionStream } from "@/services/agents/clients/opencode/session-stream.ts";
import type { OpenCodeSessionState } from "@/services/agents/clients/opencode/shared.ts";

export type { OpenCodeSessionRuntimeArgs } from "@/services/agents/clients/opencode/session-runtime-types.ts";

export async function createWrappedOpenCodeSession(
  args: OpenCodeSessionRuntimeArgs,
): Promise<Session> {
  const agentMode = args.config.agentMode ?? args.defaultAgentMode ?? "build";
  const initialPromptModel = args.resolveModelForPrompt(args.config.model);
  if (initialPromptModel) {
    args.setActivePromptModelIfMissing(initialPromptModel);
  }
  args.setActiveReasoningEffortIfMissing(args.config.reasoningEffort);

  const sessionState: OpenCodeSessionState = {
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
        state: "STREAMING",
        startedAt: null,
      },
    },
  };
  args.setSessionState(args.sessionId, sessionState);

  sessionState.contextWindow = await args.resolveModelContextWindow(args.config.model);

  const summarize = (): Promise<void> => summarizeOpenCodeSession({
    runtimeArgs: args,
    sessionState,
  });

  return {
    id: args.sessionId,

    send: (message) =>
      sendOpenCodeSessionPrompt({
        runtimeArgs: args,
        sessionState,
        agentMode,
        initialPromptModel,
        message,
      }),

    sendAsync: (message, options) =>
      sendOpenCodeSessionPromptAsync({
        runtimeArgs: args,
        sessionState,
        agentMode,
        initialPromptModel,
        message,
        options,
      }),

    command: (commandName, commandArgs, options) =>
      runOpenCodeSessionCommand({
        runtimeArgs: args,
        sessionState,
        agentMode,
        initialPromptModel,
        commandName,
        commandArgs,
        options,
      }),

    stream: (message, options) =>
      createOpenCodeSessionStream({
        runtimeArgs: args,
        sessionState,
        agentMode,
        initialPromptModel,
        message,
        options,
        summarize,
      }),

    summarize,

    getContextUsage: async () =>
      getOpenCodeSessionContextUsage({
        runtimeArgs: args,
        sessionState,
      }),

    getSystemToolsTokens: () => getOpenCodeSystemToolsTokens(sessionState),

    getCompactionState: () => getOpenCodeSessionCompactionState(sessionState),

    getMcpSnapshot: () =>
      getOpenCodeSessionMcpSnapshot({
        runtimeArgs: args,
        sessionState,
      }),

    abort: () =>
      abortOpenCodeSession({
        runtimeArgs: args,
        sessionState,
      }),

    abortBackgroundAgents: () =>
      abortOpenCodeBackgroundAgents({
        runtimeArgs: args,
        sessionState,
      }),

    destroy: () =>
      destroyOpenCodeSession({
        runtimeArgs: args,
        sessionState,
      }),
  };
}
