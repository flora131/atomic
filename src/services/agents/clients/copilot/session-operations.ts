import type {
  CopilotClient as SdkCopilotClient,
  CopilotSession as SdkCopilotSession,
  ResumeSessionConfig as SdkResumeSessionConfig,
  SessionConfig as SdkSessionConfig,
} from "@github/copilot-sdk";

import {
  stripProviderPrefix,
  type Session,
  type SessionConfig,
} from "@/services/agents/types.ts";
import { computeCompactionThreshold } from "@/services/workflows/graph/types.ts";
import {
  resolveCreateSessionModelConfig,
  resolveModelContextWindow,
  resolveModelSwitchReasoningEffort,
} from "@/services/agents/clients/copilot/models.ts";
import type {
  CopilotSessionArtifacts,
  CopilotSessionState,
  CopilotSdkModelRecord,
} from "@/services/agents/clients/copilot/types.ts";

export async function createCopilotSession(args: {
  sdkClient: SdkCopilotClient | null;
  isRunning: boolean;
  clientCwd?: string;
  config: SessionConfig;
  sessions: Map<string, CopilotSessionState>;
  loadCopilotSessionArtifacts: (
    projectRoot: string,
  ) => Promise<CopilotSessionArtifacts>;
  listSdkModelsFresh: () => Promise<unknown[]>;
  buildSdkSessionConfigBase: (
    config: SessionConfig,
    options: {
      sessionIdForUserInput: string;
      model?: string;
      reasoningEffort?: SdkSessionConfig["reasoningEffort"];
      artifacts?: CopilotSessionArtifacts;
    },
  ) => Omit<SdkSessionConfig, "sessionId">;
  wrapSession: (
    sdkSession: SdkCopilotSession,
    config: SessionConfig,
  ) => Session;
}): Promise<Session> {
  if (!args.isRunning || !args.sdkClient) {
    throw new Error("Client not started. Call start() first.");
  }

  const tentativeSessionId = args.config.sessionId ?? `copilot_${Date.now()}`;
  const projectRoot = args.clientCwd ?? process.cwd();
  const [artifacts, modelConfig] = await Promise.all([
    args.loadCopilotSessionArtifacts(projectRoot),
    resolveCreateSessionModelConfig({
      config: args.config,
      listModelsFresh: async () =>
        await args.listSdkModelsFresh() as CopilotSdkModelRecord[],
    }),
  ]);

  if (modelConfig.contextWindow === null) {
    throw new Error("Failed to resolve context window size from Copilot SDK listModels()");
  }

  const baseConfig = args.buildSdkSessionConfigBase(args.config, {
    sessionIdForUserInput: tentativeSessionId,
    model: modelConfig.resolvedModel,
    reasoningEffort: modelConfig.sanitizedReasoningEffort,
    artifacts,
  });
  const sdkConfig: SdkSessionConfig = {
    sessionId: args.config.sessionId,
    ...baseConfig,
    infiniteSessions: {
      ...baseConfig.infiniteSessions,
      backgroundCompactionThreshold: computeCompactionThreshold(modelConfig.contextWindow),
    },
  };

  const sdkSession = await args.sdkClient.createSession(sdkConfig);
  const effectiveConfig: SessionConfig = {
    ...args.config,
    ...(modelConfig.sanitizedReasoningEffort !== undefined
      ? { reasoningEffort: modelConfig.sanitizedReasoningEffort }
      : {}),
  };
  if (modelConfig.sanitizedReasoningEffort === undefined) {
    delete effectiveConfig.reasoningEffort;
  }

  const session = args.wrapSession(sdkSession, effectiveConfig);
  const sessionState = args.sessions.get(sdkSession.sessionId);
  if (sessionState) {
    sessionState.contextWindow = modelConfig.contextWindow;
  }

  return session;
}

export async function resumeCopilotSession(args: {
  sdkClient: SdkCopilotClient | null;
  isRunning: boolean;
  sessionId: string;
  clientCwd?: string;
  sessions: Map<string, CopilotSessionState>;
  loadCopilotSessionArtifacts: (
    projectRoot: string,
  ) => Promise<CopilotSessionArtifacts>;
  buildSdkSessionConfigBase: (
    config: SessionConfig,
    options: {
      sessionIdForUserInput: string;
      model?: string;
      reasoningEffort?: SdkSessionConfig["reasoningEffort"];
      artifacts?: CopilotSessionArtifacts;
    },
  ) => Omit<SdkSessionConfig, "sessionId">;
  wrapSession: (
    sdkSession: SdkCopilotSession,
    config: SessionConfig,
  ) => Session;
}): Promise<Session | null> {
  if (!args.isRunning || !args.sdkClient) {
    throw new Error("Client not started. Call start() first.");
  }

  const existingState = args.sessions.get(args.sessionId);
  if (existingState && !existingState.isClosed) {
    existingState.unsubscribe();
    return args.wrapSession(existingState.sdkSession, existingState.config);
  }

  try {
    const projectRoot = args.clientCwd ?? process.cwd();
    const artifacts = await args.loadCopilotSessionArtifacts(projectRoot);
    const resumeConfig: SdkResumeSessionConfig = args.buildSdkSessionConfigBase({}, {
      sessionIdForUserInput: args.sessionId,
      artifacts,
    });
    const sdkSession = await args.sdkClient.resumeSession(args.sessionId, resumeConfig);
    return args.wrapSession(sdkSession, {});
  } catch {
    return null;
  }
}

export async function setCopilotActiveSessionModel(args: {
  sdkClient: SdkCopilotClient | null;
  isRunning: boolean;
  model: string;
  options?: { reasoningEffort?: string };
  clientCwd?: string;
  sessions: Map<string, CopilotSessionState>;
  loadCopilotSessionArtifacts: (
    projectRoot: string,
  ) => Promise<CopilotSessionArtifacts>;
  listSdkModelsFresh: () => Promise<unknown[]>;
  buildSdkSessionConfigBase: (
    config: SessionConfig,
    options: {
      sessionIdForUserInput: string;
      model?: string;
      reasoningEffort?: SdkSessionConfig["reasoningEffort"];
      artifacts?: CopilotSessionArtifacts;
    },
  ) => Omit<SdkSessionConfig, "sessionId">;
  subscribeSessionEvents: (
    sessionId: string,
    sdkSession: SdkCopilotSession,
  ) => () => void;
}): Promise<void> {
  if (!args.isRunning || !args.sdkClient) {
    throw new Error("Client not started. Call start() first.");
  }

  const activeStates = Array.from(args.sessions.values()).filter((state) => !state.isClosed);
  const activeState = activeStates[activeStates.length - 1];
  if (!activeState) {
    return;
  }

  const resolvedModel = stripProviderPrefix(args.model).trim();
  if (!resolvedModel) {
    throw new Error("Model ID cannot be empty.");
  }

  const listModelsFresh = async () =>
    await args.listSdkModelsFresh() as CopilotSdkModelRecord[];

  const [sanitizedReasoningEffort, newModelContextWindow] = await Promise.all([
    resolveModelSwitchReasoningEffort({
      resolvedModel,
      requestedReasoningEffort: args.options?.reasoningEffort,
      listModelsFresh,
    }),
    resolveModelContextWindow({
      resolvedModel,
      listModelsFresh,
    }),
  ]);

  const projectRoot = args.clientCwd ?? process.cwd();
  const artifacts = await args.loadCopilotSessionArtifacts(projectRoot);
  const nextConfig: SessionConfig = {
    ...activeState.config,
    model: args.model,
    ...(sanitizedReasoningEffort !== undefined
      ? { reasoningEffort: sanitizedReasoningEffort }
      : {}),
  };
  if (sanitizedReasoningEffort === undefined) {
    delete nextConfig.reasoningEffort;
  }

  const baseResumeConfig: SdkResumeSessionConfig = args.buildSdkSessionConfigBase(nextConfig, {
    sessionIdForUserInput: activeState.sessionId,
    model: resolvedModel,
    reasoningEffort: sanitizedReasoningEffort as SdkSessionConfig["reasoningEffort"] | undefined,
    artifacts,
  });
  const resumeConfig: SdkResumeSessionConfig = {
    ...baseResumeConfig,
    infiniteSessions: {
      ...baseResumeConfig.infiniteSessions,
      backgroundCompactionThreshold: computeCompactionThreshold(newModelContextWindow),
    },
  };

  const resumedSession = await args.sdkClient.resumeSession(activeState.sessionId, resumeConfig);

  activeState.unsubscribe();
  activeState.sdkSession = resumedSession;
  activeState.config = nextConfig;
  activeState.recentEventIds = new Set();
  activeState.recentEventOrder = [];
  activeState.unsubscribe = args.subscribeSessionEvents(
    activeState.sessionId,
    resumedSession,
  );
}
