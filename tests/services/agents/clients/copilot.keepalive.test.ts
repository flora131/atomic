import { describe, expect, mock, test } from "bun:test";
import { createCopilotKeepalive } from "@/services/agents/clients/copilot/keepalive.ts";

/**
 * Helper to build a minimal mock SDK client with ping and getState.
 */
function buildMockSdkClient(overrides: {
	ping?: () => Promise<{ message: string; timestamp: number }>;
	getState?: () => "connected" | "disconnected" | "connecting" | "error";
} = {}) {
	return {
		ping: overrides.ping ?? mock(() =>
			Promise.resolve({ message: "keepalive", timestamp: Date.now() }),
		),
		getState: overrides.getState ?? (() => "connected" as const),
	};
}

/**
 * Helper to build the required args with sensible defaults.
 * Tests override only the properties they care about.
 */
function buildKeepaliveArgs(overrides: Record<string, unknown> = {}) {
	return {
		getSdkClient: () => null as never,
		isRunning: () => true,
		intervalMs: 10,
		...overrides,
	};
}

/**
 * Poll until a mock has been called at least `minCalls` times.
 * Avoids flaky timing-based assertions.
 */
async function waitForCalls(
	mockFn: ReturnType<typeof mock>,
	minCalls: number,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (mockFn.mock.calls.length < minCalls) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(
				`Timed out waiting for ${minCalls} calls (got ${mockFn.mock.calls.length})`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

/**
 * Poll until a predicate is true.
 */
async function waitFor(
	predicate: () => boolean,
	timeoutMs = 2000,
): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("Timed out waiting for predicate");
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe("createCopilotKeepalive", () => {
	test("calls sdkClient.ping periodically while running", async () => {
		const client = buildMockSdkClient();
		const pingMock = client.ping as ReturnType<typeof mock>;

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				isRunning: () => true,
			}),
		);

		handle.start();
		await waitForCalls(pingMock, 2);
		handle.stop();

		expect(pingMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(pingMock).toHaveBeenCalledWith("keepalive");
	});

	test("does not ping when client is not running", async () => {
		const client = buildMockSdkClient();
		const pingMock = client.ping as ReturnType<typeof mock>;

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				isRunning: () => false,
			}),
		);

		handle.start();
		// Wait enough time for several intervals to pass
		await new Promise((resolve) => setTimeout(resolve, 60));
		handle.stop();

		expect(pingMock).not.toHaveBeenCalled();
	});

	test("does not ping when sdkClient is null", async () => {
		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => null,
			}),
		);

		handle.start();
		await new Promise((resolve) => setTimeout(resolve, 60));
		handle.stop();
		// No crash -- swallowed gracefully
	});

	test("swallows ping errors without crashing", async () => {
		const client = buildMockSdkClient({
			ping: mock(() => Promise.reject(new Error("connection lost"))),
			getState: () => "connected",
		});
		const pingMock = client.ping as ReturnType<typeof mock>;
		const debugLog = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				isRunning: () => true,
				debugLog,
			}),
		);

		handle.start();
		await waitForCalls(pingMock, 2);
		handle.stop();

		expect(pingMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(debugLog).toHaveBeenCalledWith(
			"keepalive.ping.failed",
			expect.objectContaining({ error: "connection lost" }),
		);
	});

	test("stop is idempotent", () => {
		const handle = createCopilotKeepalive(buildKeepaliveArgs());

		handle.start();
		handle.stop();
		handle.stop(); // should not throw
	});

	test("start is idempotent -- does not create multiple timers", async () => {
		const client = buildMockSdkClient();
		const pingMock = client.ping as ReturnType<typeof mock>;

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
			}),
		);

		handle.start();
		handle.start(); // duplicate -- should be no-op

		await waitForCalls(pingMock, 2);
		const countAtStop = pingMock.mock.calls.length;
		handle.stop();

		// With a single timer at 10ms intervals, 2 calls is expected.
		// A duplicate timer would roughly double the count.
		expect(countAtStop).toBeLessThanOrEqual(6);
	});

	test("does not invoke onConnectionLost on intermittent failures -- just logs", async () => {
		let callCount = 0;
		const client = buildMockSdkClient({
			ping: mock(() => {
				callCount++;
				if (callCount % 2 === 0) {
					return Promise.resolve({ message: "keepalive", timestamp: Date.now() });
				}
				return Promise.reject(new Error("transient error"));
			}),
			getState: () => "connected",
		});
		const pingMock = client.ping as ReturnType<typeof mock>;
		const debugLog = mock(() => {});
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				debugLog,
				onConnectionLost,
			}),
		);

		handle.start();
		await waitForCalls(pingMock, 6);
		handle.stop();

		// Alternating pass/fail never reaches the consecutive-failure threshold
		expect(onConnectionLost).not.toHaveBeenCalled();

		const failCalls = debugLog.mock.calls.filter(
			(c) => (c as string[])[0] === "keepalive.ping.failed",
		);
		expect(failCalls.length).toBeGreaterThan(0);
	});

	// ---------------------------------------------------------------
	// Connection-loss detection
	// ---------------------------------------------------------------

	test("fires onConnectionLost when getState returns 'disconnected' before ping", async () => {
		const client = buildMockSdkClient({
			getState: () => "disconnected",
		});
		const pingMock = client.ping as ReturnType<typeof mock>;
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				onConnectionLost,
			}),
		);

		handle.start();
		await waitFor(() => onConnectionLost.mock.calls.length >= 1);
		handle.stop();

		// ping should not have been attempted — state was checked first
		expect(pingMock).not.toHaveBeenCalled();
		expect(onConnectionLost).toHaveBeenCalledTimes(1);
	});

	test("fires onConnectionLost when getState returns 'error' before ping", async () => {
		const client = buildMockSdkClient({
			getState: () => "error",
		});
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				onConnectionLost,
			}),
		);

		handle.start();
		await waitFor(() => onConnectionLost.mock.calls.length >= 1);
		handle.stop();

		expect(onConnectionLost).toHaveBeenCalledTimes(1);
	});

	test("fires onConnectionLost when getState transitions to disconnected after ping failure", async () => {
		let state: "connected" | "disconnected" = "connected";
		const client = buildMockSdkClient({
			ping: mock(() => {
				// Simulate: connection drops, state updates
				state = "disconnected";
				return Promise.reject(new Error("write EPIPE"));
			}),
			getState: () => state,
		});
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				onConnectionLost,
			}),
		);

		handle.start();
		await waitFor(() => onConnectionLost.mock.calls.length >= 1);
		handle.stop();

		expect(onConnectionLost).toHaveBeenCalledTimes(1);
	});

	test("fires onConnectionLost after consecutive ping failures even if state stays 'connected'", async () => {
		const client = buildMockSdkClient({
			ping: mock(() => Promise.reject(new Error("timeout"))),
			// State never transitions (SDK bug or race) — consecutive failures are the fallback
			getState: () => "connected",
		});
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				onConnectionLost,
				maxConsecutiveFailures: 3,
			}),
		);

		handle.start();
		await waitFor(() => onConnectionLost.mock.calls.length >= 1);
		handle.stop();

		expect(onConnectionLost).toHaveBeenCalledTimes(1);
	});

	test("onConnectionLost fires only once per start/stop cycle", async () => {
		const client = buildMockSdkClient({
			ping: mock(() => Promise.reject(new Error("dead"))),
			getState: () => "disconnected",
		});
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				onConnectionLost,
			}),
		);

		handle.start();
		await waitFor(() => onConnectionLost.mock.calls.length >= 1);
		// Let a few more ticks pass -- should not fire again
		await new Promise((resolve) => setTimeout(resolve, 60));
		handle.stop();

		expect(onConnectionLost).toHaveBeenCalledTimes(1);
	});

	test("connectionLostFired resets after stop/start cycle", async () => {
		const client = buildMockSdkClient({
			getState: () => "disconnected",
		});
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				onConnectionLost,
			}),
		);

		// First cycle
		handle.start();
		await waitFor(() => onConnectionLost.mock.calls.length >= 1);
		handle.stop();

		// Second cycle — should fire again
		handle.start();
		await waitFor(() => onConnectionLost.mock.calls.length >= 2);
		handle.stop();

		expect(onConnectionLost).toHaveBeenCalledTimes(2);
	});

	test("successful ping resets consecutive failure counter", async () => {
		let callCount = 0;
		// Fail twice, succeed once, fail twice, succeed once, ...
		// With maxConsecutiveFailures=3, this should never trigger.
		const client = buildMockSdkClient({
			ping: mock(() => {
				callCount++;
				if (callCount % 3 === 0) {
					return Promise.resolve({ message: "keepalive", timestamp: Date.now() });
				}
				return Promise.reject(new Error("flaky"));
			}),
			getState: () => "connected",
		});
		const onConnectionLost = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => client as never,
				onConnectionLost,
				maxConsecutiveFailures: 3,
			}),
		);

		handle.start();
		await waitForCalls(client.ping as ReturnType<typeof mock>, 9);
		handle.stop();

		// The pattern (fail, fail, pass) resets the counter at 2 each time,
		// never reaching 3.
		expect(onConnectionLost).not.toHaveBeenCalled();
	});
});
