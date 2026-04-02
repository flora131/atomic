import {
  createOpencodeServer,
  type ServerOptions as SdkServerOptions,
} from "@opencode-ai/sdk/v2/server";
import {
  createOpencodeClient as createSdkClient,
} from "@opencode-ai/sdk/v2/client";
import type { OpenCodeClientOptions } from "@/services/agents/clients/opencode.ts";
import type { AtomicManagedOpenCodeServerState } from "@/services/agents/clients/opencode/shared.ts";
import { isPipelineDebug } from "@/services/events/pipeline-logger.ts";

let atomicManagedOpenCodeServer: AtomicManagedOpenCodeServerState | null = null;

export async function spawnAtomicManagedOpenCodeServer(args: {
  clientOptions: OpenCodeClientOptions;
  defaultBaseUrl: string;
  isServerSpawned: boolean;
}): Promise<{ ok: boolean; baseUrl?: string; isServerSpawned: boolean }> {
  const acquireAtomicServerLease = (
    state: AtomicManagedOpenCodeServerState,
  ): { ok: boolean; baseUrl: string; isServerSpawned: boolean } => {
    state.leaseCount += 1;
    return {
      ok: true,
      baseUrl: state.url,
      isServerSpawned: true,
    };
  };

  const releaseUnhealthyAtomicServer = (): void => {
    if (!atomicManagedOpenCodeServer) {
      return;
    }
    try {
      atomicManagedOpenCodeServer.close();
    } catch {
      // Ignore cleanup errors and replace with a fresh server.
    }
    atomicManagedOpenCodeServer = null;
  };

  const isAtomicServerHealthy = async (
    serverUrl: string,
    directory: string | undefined,
  ): Promise<boolean> => {
    try {
      const tempClient = createSdkClient({
        baseUrl: serverUrl,
        directory,
      });
      const result = await tempClient.global.health();
      return !result.error;
    } catch {
      return false;
    }
  };

  if (args.isServerSpawned && atomicManagedOpenCodeServer) {
    return {
      ok: true,
      baseUrl: atomicManagedOpenCodeServer.url,
      isServerSpawned: true,
    };
  }

  if (atomicManagedOpenCodeServer) {
    const healthy = await isAtomicServerHealthy(
      atomicManagedOpenCodeServer.url,
      args.clientOptions.directory,
    );
    if (healthy) {
      return acquireAtomicServerLease(atomicManagedOpenCodeServer);
    }
    releaseUnhealthyAtomicServer();
  }

  const url = new URL(args.clientOptions.baseUrl ?? args.defaultBaseUrl);
  const port = args.clientOptions.port ?? parseInt(url.port || "4096", 10);
  const hostname = args.clientOptions.hostname ?? url.hostname ?? "127.0.0.1";

  try {
    const serverOptions: SdkServerOptions = {
      hostname,
      port,
      timeout: args.clientOptions.timeout ?? 30000,
      ...(isPipelineDebug() ? { config: { logLevel: "DEBUG" } } : {}),
    };

    process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL = "true";
    const { url: serverUrl, close } = await createOpencodeServer(serverOptions);
    atomicManagedOpenCodeServer = {
      url: serverUrl,
      close,
      leaseCount: 0,
    };

    return acquireAtomicServerLease(atomicManagedOpenCodeServer);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to spawn OpenCode server: ${errorMsg}`);
    return { ok: false, isServerSpawned: false };
  }
}

export function releaseAtomicManagedOpenCodeServerLease(
  isServerSpawned: boolean,
): boolean {
  if (!isServerSpawned) {
    return false;
  }

  if (!atomicManagedOpenCodeServer) {
    return false;
  }

  atomicManagedOpenCodeServer.leaseCount -= 1;
  if (atomicManagedOpenCodeServer.leaseCount > 0) {
    return false;
  }

  try {
    atomicManagedOpenCodeServer.close();
  } catch {
    // Ignore errors during cleanup
  }
  atomicManagedOpenCodeServer = null;
  return false;
}
