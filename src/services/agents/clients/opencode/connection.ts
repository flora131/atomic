import {
  createOpencodeClient as createSdkClient,
  type OpencodeClient as SdkClient,
} from "@opencode-ai/sdk/v2/client";
import type { EventType } from "@/services/agents/types.ts";
import type {
  OpenCodeClientOptions,
  OpenCodeHealthStatus,
} from "@/services/agents/clients/opencode/client-types.ts";
import type { OpenCodeSessionState } from "@/services/agents/clients/opencode/shared.ts";
import { extractOpenCodeErrorMessage } from "@/services/agents/clients/opencode/shared.ts";

export async function healthCheckOpenCode(args: {
  sdkClient: SdkClient | null;
  clientOptions: Pick<OpenCodeClientOptions, "baseUrl" | "directory">;
}): Promise<OpenCodeHealthStatus> {
  try {
    if (!args.sdkClient) {
      const tempClient = createSdkClient({
        baseUrl: args.clientOptions.baseUrl,
        directory: args.clientOptions.directory,
      });
      const result = await tempClient.global.health();
      if (result.error) {
        return {
          healthy: false,
          error: extractOpenCodeErrorMessage(result.error),
        };
      }
      return {
        healthy: true,
        version: result.data?.version,
      };
    }

    const result = await args.sdkClient.global.health();
    if (result.error) {
      return {
        healthy: false,
        error: extractOpenCodeErrorMessage(result.error),
      };
    }
    return {
      healthy: true,
      version: result.data?.version,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function connectOpenCode(args: {
  isConnected: boolean;
  clientOptions: OpenCodeClientOptions;
  defaultMaxRetries: number;
  defaultRetryDelay: number;
  setSdkClient: (client: SdkClient) => void;
  setIsConnected: (value: boolean) => void;
  healthCheck: () => Promise<OpenCodeHealthStatus>;
  emitEvent: <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>,
  ) => void;
}): Promise<boolean> {
  if (args.isConnected) {
    return true;
  }

  const maxRetries = args.clientOptions.maxRetries ?? args.defaultMaxRetries;
  const retryDelay = args.clientOptions.retryDelay ?? args.defaultRetryDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      args.setSdkClient(createSdkClient({
        baseUrl: args.clientOptions.baseUrl,
        directory: args.clientOptions.directory,
      }));

      const health = await args.healthCheck();
      if (health.healthy) {
        args.setIsConnected(true);
        args.emitEvent("session.start", "connection", {
          config: { baseUrl: args.clientOptions.baseUrl },
        });
        return true;
      }

      throw new Error(health.error ?? "Health check failed");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (attempt === maxRetries) {
        args.emitEvent("session.error", "connection", {
          error: `Failed to connect after ${maxRetries} attempts: ${errorMsg}`,
        });
        throw new Error(
          `Failed to connect to OpenCode server at ${args.clientOptions.baseUrl}: ${errorMsg}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  return false;
}

export async function disconnectOpenCode(args: {
  eventSubscriptionController: AbortController | null;
  clearEventSubscriptionController: () => void;
  activeSessions: Set<string>;
  sdkClient: SdkClient | null;
  directory?: string;
  sessionStateById: Map<string, OpenCodeSessionState>;
  resetConnectionState: () => void;
  clearStreamingState: () => void;
  emitEvent: <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>,
  ) => void;
}): Promise<void> {
  if (args.eventSubscriptionController) {
    args.eventSubscriptionController.abort();
    args.clearEventSubscriptionController();
  }

  for (const sessionId of args.activeSessions) {
    try {
      if (args.sdkClient) {
        await args.sdkClient.session.delete({
          sessionID: sessionId,
          directory: args.directory,
        });
      }
    } catch {
      // Ignore cleanup errors.
    }
  }
  args.activeSessions.clear();
  args.sessionStateById.clear();
  args.resetConnectionState();
  args.clearStreamingState();

  args.emitEvent("session.idle", "connection", { reason: "disconnected" });
}
