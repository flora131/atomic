import type { CopilotClient as SdkCopilotClient } from "@github/copilot-sdk";

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000;

export interface CopilotKeepaliveHandle {
  start(): void;
  stop(): void;
}

/**
 * Creates a keepalive timer that periodically pings the Copilot CLI server
 * to prevent idle disconnections while the TUI is open.
 *
 * Ping failures are silently swallowed — keepalive is best-effort.
 */
export function createCopilotKeepalive(args: {
  getSdkClient: () => SdkCopilotClient | null;
  isRunning: () => boolean;
  intervalMs?: number;
  debugLog?: (label: string, data: Record<string, unknown>) => void;
}): CopilotKeepaliveHandle {
  const intervalMs = args.intervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;

  const ping = async (): Promise<void> => {
    const client = args.getSdkClient();
    if (!client || !args.isRunning()) {
      return;
    }

    try {
      await client.ping("keepalive");
      args.debugLog?.("keepalive.ping.ok", { intervalMs });
    } catch (error) {
      args.debugLog?.("keepalive.ping.failed", {
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
      timer = setInterval(() => void ping(), intervalMs);
      // Prevent the timer from blocking process exit
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
