import type {
  CopilotClient as SdkCopilotClient,
  CopilotClientOptions as SdkClientOptions,
  PermissionHandler as SdkPermissionHandler,
} from "@github/copilot-sdk";

import { stripProviderPrefix, type EventHandler, type EventType } from "@/services/agents/types.ts";

import { buildCopilotModelDisplayInfo } from "@/services/agents/clients/copilot/models.ts";
import type {
  CopilotSessionState,
  CopilotSdkModelRecord,
} from "@/services/agents/clients/copilot/types.ts";

export async function startCopilotRuntime(args: {
  isRunning: boolean;
  buildSdkOptions: () => Promise<SdkClientOptions>;
  createSdkClientInstance: (options: SdkClientOptions) => SdkCopilotClient;
  setSdkClient: (client: SdkCopilotClient | null) => void;
  setIsRunning: (running: boolean) => void;
  getCopilotPermissionHandler: () => SdkPermissionHandler;
  setProbeSystemToolsBaseline: (baseline: number | null) => void;
  setProbePromise: (promise: Promise<void> | null) => void;
}): Promise<void> {
  if (args.isRunning) {
    return;
  }

  const sdkOptions = await args.buildSdkOptions();
  const sdkClient = args.createSdkClientInstance(sdkOptions);
  args.setSdkClient(sdkClient);
  await sdkClient.start();
  args.setIsRunning(true);

  const probePromise = (async () => {
    try {
      const probeSession = await sdkClient.createSession({
        onPermissionRequest: args.getCopilotPermissionHandler(),
      });
      const baseline = await new Promise<number | null>((resolve) => {
        let unsub: (() => void) | null = null;
        const timeout = setTimeout(() => {
          unsub?.();
          resolve(null);
        }, 3000);
        unsub = probeSession.on("session.usage_info", (event) => {
          const data = event.data as Record<string, unknown>;
          const currentTokens = data.currentTokens;
          if (typeof currentTokens !== "number" || currentTokens <= 0) {
            return;
          }
          unsub?.();
          clearTimeout(timeout);
          resolve(currentTokens);
        });
      });
      args.setProbeSystemToolsBaseline(baseline);
      await probeSession.destroy();
    } catch {
      // Probe failed - baseline will be populated on first message.
    }
  })();

  args.setProbePromise(probePromise);
}

export async function stopCopilotRuntime(args: {
  isRunning: boolean;
  probePromise: Promise<void> | null;
  setProbePromise: (promise: Promise<void> | null) => void;
  sessions: Map<string, CopilotSessionState>;
  sdkClient: SdkCopilotClient | null;
  setSdkClient: (client: SdkCopilotClient | null) => void;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  setIsRunning: (running: boolean) => void;
}): Promise<void> {
  if (!args.isRunning) {
    return;
  }

  if (args.probePromise) {
    await args.probePromise;
    args.setProbePromise(null);
  }

  for (const state of args.sessions.values()) {
    if (!state.isClosed) {
      state.isClosed = true;
      state.unsubscribe();
      try {
        await state.sdkSession.destroy();
      } catch {
        // Ignore errors during cleanup.
      }
    }
  }
  args.sessions.clear();

  if (args.sdkClient) {
    await args.sdkClient.stop();
    args.setSdkClient(null);
  }

  args.eventHandlers.clear();
  args.setIsRunning(false);
}

export async function listCopilotAvailableModels(args: {
  isRunning: boolean;
  sdkClient: SdkCopilotClient | null;
  isExternalServer: boolean;
  listSdkModelsFresh: () => Promise<unknown[]>;
  listSdkModelsFromFreshClient: () => Promise<unknown[]>;
}): Promise<unknown[]> {
  if (!args.isRunning || !args.sdkClient) {
    throw new Error("Client not started. Call start() first.");
  }

  if (args.isExternalServer) {
    return await args.listSdkModelsFresh();
  }

  return await args.listSdkModelsFromFreshClient();
}

export async function listCopilotSessions(args: {
  isRunning: boolean;
  sdkClient: SdkCopilotClient | null;
}): Promise<Array<{ sessionId: string; summary?: string }>> {
  if (!args.isRunning || !args.sdkClient) {
    return [];
  }

  const sessions = await args.sdkClient.listSessions();
  return sessions.map((session) => ({
    sessionId: session.sessionId,
    summary: session.summary,
  }));
}

export async function deleteCopilotSession(args: {
  isRunning: boolean;
  sdkClient: SdkCopilotClient | null;
  sessionId: string;
  sessions: Map<string, CopilotSessionState>;
}): Promise<void> {
  if (!args.isRunning || !args.sdkClient) {
    return;
  }

  const state = args.sessions.get(args.sessionId);
  if (state) {
    state.isClosed = true;
    state.unsubscribe();
    args.sessions.delete(args.sessionId);
  }

  await args.sdkClient.deleteSession(args.sessionId);
}

export async function getCopilotModelDisplayInfoForClient(args: {
  isRunning: boolean;
  sdkClient: SdkCopilotClient | null;
  modelHint?: string;
  listSdkModelsFresh: () => Promise<unknown[]>;
}): Promise<{
  model: string;
  tier: string;
  supportsReasoning?: boolean;
  defaultReasoningEffort?: string;
  contextWindow?: number;
}> {
  if (args.isRunning && args.sdkClient) {
    try {
      const models = await args.listSdkModelsFresh() as CopilotSdkModelRecord[];
      const modelInfo = buildCopilotModelDisplayInfo(models, args.modelHint);
      if (modelInfo) {
        return modelInfo;
      }
    } catch {
      // SDK listModels() failed - fall through to raw ID below.
    }
  }

  if (args.modelHint) {
    return {
      model: stripProviderPrefix(args.modelHint),
      tier: "GitHub Copilot",
    };
  }

  return {
    model: "Copilot",
    tier: "GitHub Copilot",
  };
}
