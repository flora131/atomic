import type { OpencodeClient as SdkClient } from "@opencode-ai/sdk/v2/client";

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000;

export interface OpenCodeKeepaliveHandle {
  start(): void;
  stop(): void;
}

/**
 * Creates a keepalive timer that periodically health-checks the OpenCode server
 * to prevent idle disconnections while the TUI is open.
 *
 * Health check failures are silently swallowed — keepalive is best-effort.
 */
export function createOpenCodeKeepalive(args: {
  getSdkClient: () => SdkClient | null;
  isRunning: () => boolean;
  intervalMs?: number;
  debugLog?: (label: string, data: Record<string, unknown>) => void;
}): OpenCodeKeepaliveHandle {
  const intervalMs = args.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;

  const healthPing = async (): Promise<void> => {
    const client = args.getSdkClient();
    if (!client || !args.isRunning()) {
      return;
    }

    try {
      await client.global.health();
      args.debugLog?.("keepalive.health.ok", { intervalMs });
    } catch (error) {
      args.debugLog?.("keepalive.health.failed", {
        intervalMs,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(() => void healthPing(), intervalMs);
      if (timer && typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
    },

    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
