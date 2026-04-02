import { describe, expect, mock, test } from "bun:test";
import { createCopilotKeepalive } from "@/services/agents/clients/copilot/keepalive.ts";

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

describe("createCopilotKeepalive", () => {
	test("calls sdkClient.ping periodically while running", async () => {
		const pingMock = mock(() =>
			Promise.resolve({ message: "keepalive", timestamp: Date.now() }),
		);
		const sdkClient = { ping: pingMock };

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => sdkClient as never,
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
		const pingMock = mock(() =>
			Promise.resolve({ message: "keepalive", timestamp: Date.now() }),
		);
		const sdkClient = { ping: pingMock };

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => sdkClient as never,
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
		// No crash — swallowed gracefully
	});

	test("swallows ping errors without crashing", async () => {
		const pingMock = mock(() => Promise.reject(new Error("connection lost")));
		const sdkClient = { ping: pingMock };
		const debugLog = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => sdkClient as never,
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

	test("start is idempotent — does not create multiple timers", async () => {
		const pingMock = mock(() =>
			Promise.resolve({ message: "keepalive", timestamp: Date.now() }),
		);
		const sdkClient = { ping: pingMock };

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => sdkClient as never,
			}),
		);

		handle.start();
		handle.start(); // duplicate — should be no-op

		await waitForCalls(pingMock, 2);
		const countAtStop = pingMock.mock.calls.length;
		handle.stop();

		// With a single timer at 10ms intervals, 2 calls is expected.
		// A duplicate timer would roughly double the count.
		expect(countAtStop).toBeLessThanOrEqual(6);
	});

	test("does not invoke on intermittent failures — just logs", async () => {
		let callCount = 0;
		const pingMock = mock(() => {
			callCount++;
			if (callCount % 2 === 0) {
				return Promise.resolve({ message: "keepalive", timestamp: Date.now() });
			}
			return Promise.reject(new Error("transient error"));
		});
		const sdkClient = { ping: pingMock };
		const debugLog = mock(() => {});

		const handle = createCopilotKeepalive(
			buildKeepaliveArgs({
				getSdkClient: () => sdkClient as never,
				debugLog,
			}),
		);

		handle.start();
		await waitForCalls(pingMock, 4);
		handle.stop();

		// Failures are logged but don't crash
		const failCalls = debugLog.mock.calls.filter(
			(c) => (c as string[])[0] === "keepalive.ping.failed",
		);
		expect(failCalls.length).toBeGreaterThan(0);
	});
});
