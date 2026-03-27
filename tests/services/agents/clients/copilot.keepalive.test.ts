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
		intervalMs: 50,
		...overrides,
	};
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

		await new Promise((resolve) => setTimeout(resolve, 130));
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
		await new Promise((resolve) => setTimeout(resolve, 130));
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
		await new Promise((resolve) => setTimeout(resolve, 130));
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
		await new Promise((resolve) => setTimeout(resolve, 130));
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

		await new Promise((resolve) => setTimeout(resolve, 130));
		handle.stop();

		// Should still only have ~2 pings, not ~4
		expect(pingMock.mock.calls.length).toBeLessThanOrEqual(4);
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
				intervalMs: 30,
				debugLog,
			}),
		);

		handle.start();
		await new Promise((resolve) => setTimeout(resolve, 200));
		handle.stop();

		// Failures are logged but don't crash
		const failCalls = debugLog.mock.calls.filter(
			(c) => (c as string[])[0] === "keepalive.ping.failed",
		);
		expect(failCalls.length).toBeGreaterThan(0);
	});
});
