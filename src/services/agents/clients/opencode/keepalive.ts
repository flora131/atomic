import type { OpencodeClient as SdkClient } from "@opencode-ai/sdk/v2/client";

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export interface OpenCodeKeepaliveHandle {
  start(): void;
  stop(): void;
}

/**
 * Creates a keepalive timer that periodically health-checks the OpenCode server
 * to prevent idle disconnections while the TUI is open.
 *
 * When consecutive health-check failures reach the threshold, the
 * `onConnectionLost` callback is invoked so the caller can restart the
 * client — mirroring Copilot's keepalive recovery pattern.
 */
export function createOpenCodeKeepalive(args: {
  getSdkClient: () => SdkClient | null;
  isRunning: () => boolean;
  onConnectionLost?: () => void;
  intervalMs?: number;
  maxConsecutiveFailures?: number;
  debugLog?: (label: string, data: Record<string, unknown>) => void;
}): OpenCodeKeepaliveHandle {
  const intervalMs = args.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  const maxFailures =
    args.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  let timer: ReturnType<typeof setInterval> | null = null;
  let consecutiveFailures = 0;
  let connectionLostFired = false;

  const fireConnectionLost = (): void => {
    if (connectionLostFired) {
      return;
    }
    connectionLostFired = true;
    args.debugLog?.("keepalive.connection_lost", {
      consecutiveFailures,
      intervalMs,
    });
    args.onConnectionLost?.();
  };

  const healthPing = async (): Promise<void> => {
    const client = args.getSdkClient();
    if (!client || !args.isRunning()) {
      return;
    }

    try {
      const result = await client.global.health();
      if (result.error) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Health check returned error",
        );
      }
      consecutiveFailures = 0;
      args.debugLog?.("keepalive.health.ok", { intervalMs });
    } catch (error) {
      consecutiveFailures++;
      args.debugLog?.("keepalive.health.failed", {
        intervalMs,
        consecutiveFailures,
        error: error instanceof Error ? error.message : String(error),
      });

      if (consecutiveFailures >= maxFailures) {
        fireConnectionLost();
      }
    }
  };

  return {
    start() {
      if (timer !== null) {
        return;
      }
      consecutiveFailures = 0;
      connectionLostFired = false;
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
      consecutiveFailures = 0;
      connectionLostFired = false;
    },
  };
}
