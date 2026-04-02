import type { CopilotClient as SdkCopilotClient, ConnectionState } from "@github/copilot-sdk";

const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export interface CopilotKeepaliveHandle {
	start(): void;
	stop(): void;
}

/**
 * Creates a keepalive timer that periodically pings the Copilot CLI server
 * to prevent idle disconnections while the TUI is open.
 *
 * When the ping fails and the SDK client reports a "disconnected" or "error"
 * connection state (or consecutive ping failures exceed the threshold), the
 * `onConnectionLost` callback is invoked so the caller can restart the
 * client.
 */
export function createCopilotKeepalive(args: {
	getSdkClient: () => SdkCopilotClient | null;
	isRunning: () => boolean;
	onConnectionLost?: () => void;
	intervalMs?: number;
	maxConsecutiveFailures?: number;
	debugLog?: (label: string, data: Record<string, unknown>) => void;
}): CopilotKeepaliveHandle {
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

	const isDeadState = (state: ConnectionState): boolean =>
		state === "disconnected" || state === "error";

	const ping = async (): Promise<void> => {
		const client = args.getSdkClient();
		if (!client || !args.isRunning()) {
			return;
		}

		// Check connection state before even attempting the ping.
		if (isDeadState(client.getState())) {
			fireConnectionLost();
			return;
		}

		try {
			await client.ping("keepalive");
			consecutiveFailures = 0;
			args.debugLog?.("keepalive.ping.ok", { intervalMs });
		} catch (error) {
			consecutiveFailures++;
			args.debugLog?.("keepalive.ping.failed", {
				intervalMs,
				consecutiveFailures,
				error: error instanceof Error ? error.message : String(error),
			});

			// After a failed ping, re-check state — the SDK may have
			// transitioned to disconnected/error as a result.
			if (isDeadState(client.getState())) {
				fireConnectionLost();
				return;
			}

			// Even if the state hasn't updated yet, treat repeated failures
			// as a reliable signal that the connection is gone.
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
			timer = setInterval(() => void ping(), intervalMs);
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
