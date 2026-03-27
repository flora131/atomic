import { describe, expect, mock, test } from "bun:test";
import { createWrappedCopilotSession } from "@/services/agents/clients/copilot/session-runtime.ts";
import type { CopilotSessionState } from "@/services/agents/clients/copilot/types.ts";

// ---------------------------------------------------------------------------
// Helpers — build minimal SDK session mocks that simulate real SDK behavior
// ---------------------------------------------------------------------------

type MockListener = (event: {
	type: string;
	id?: string;
	data: Record<string, unknown>;
}) => void;

function createMockSdkSession(
	sessionId: string,
	overrides: Record<string, unknown> = {},
) {
	const listeners = new Set<MockListener>();
	return {
		sessionId,
		listeners,
		on: mock((handler: MockListener) => {
			listeners.add(handler);
			return () => {
				listeners.delete(handler);
			};
		}),
		send: mock(async () => {
			// Default: immediately emit session.idle to complete the stream
			for (const fn of listeners) {
				fn({ type: "session.idle", data: {} });
			}
		}),
		sendAndWait: mock(() => Promise.resolve({ data: { content: "response" } })),
		destroy: mock(() => Promise.resolve()),
		abort: mock(() => Promise.resolve()),
		...overrides,
	};
}

function buildWrappedSessionArgs(
	sdkSession: ReturnType<typeof createMockSdkSession>,
) {
	const sessions = new Map<string, CopilotSessionState>();
	return {
		sdkSession: sdkSession as never,
		config: {},
		sessions,
		subscribeSessionEvents: mock(
			(
				_sessionId: string,
				activeSdkSession: { on: (handler: MockListener) => () => void },
			) => activeSdkSession.on(() => {}),
		),
		emitEvent: mock(() => {}),
		emitProviderEvent: mock(() => {}),
		extractErrorMessage: (error: unknown) =>
			error instanceof Error ? error.message : String(error),
	};
}

// ---------------------------------------------------------------------------
// send() timeout behavior
// ---------------------------------------------------------------------------

describe("send() timeout", () => {
	test("throws when session is closed", async () => {
		const sdkSession = createMockSdkSession("closed-send-1");
		const args = buildWrappedSessionArgs(sdkSession);
		const session = createWrappedCopilotSession(args as never);

		// Close the session
		await session.destroy();

		await expect(session.send("hello")).rejects.toThrow("session is closed");
	});

	test("surfaces Session not found as a closed session", async () => {
		const notFoundSession = createMockSdkSession("notfound-send-1", {
			sendAndWait: mock(() => Promise.reject(new Error("Session not found"))),
		});

		const args = buildWrappedSessionArgs(notFoundSession);
		const session = createWrappedCopilotSession(args as never);

		await expect(session.send("hello")).rejects.toThrow("Session not found");

		// Subsequent sends should fail with "session is closed"
		await expect(session.send("hello")).rejects.toThrow("session is closed");
	});
});

// ---------------------------------------------------------------------------
// stream() timeout behavior
// ---------------------------------------------------------------------------

describe("stream() timeout", () => {
	test("stream propagates send errors", async () => {
		const failingSession = createMockSdkSession("fail-stream-1", {
			send: mock(async () => {
				throw new Error("server crashed");
			}),
		});

		const args = buildWrappedSessionArgs(failingSession);
		const session = createWrappedCopilotSession(args as never);

		const consumeStream = async () => {
			for await (const _chunk of session.stream("hello")) {
				// noop
			}
		};

		await expect(consumeStream()).rejects.toThrow("server crashed");
	});
});

// ---------------------------------------------------------------------------
// stream() stale detection
// ---------------------------------------------------------------------------

describe("stream stale detection", () => {
	test("stale timer resets when events arrive", async () => {
		const slowSdkSession = createMockSdkSession("stale-stream-2", {
			send: mock(async () => {
				let count = 0;
				const interval = setInterval(() => {
					count++;
					for (const fn of slowSdkSession.listeners) {
						if (count < 3) {
							fn({
								type: "assistant.message_delta",
								data: {
									deltaContent: `chunk-${count}`,
									messageId: "msg-1",
								},
							});
						} else {
							fn({ type: "session.idle", data: {} });
							clearInterval(interval);
						}
					}
				}, 200);
			}),
		});

		const args = buildWrappedSessionArgs(slowSdkSession);
		const session = createWrappedCopilotSession(args as never);
		const chunks: string[] = [];

		for await (const chunk of session.stream("hello")) {
			const c = chunk as { type: string; content: unknown };
			if (c.type === "text" && typeof c.content === "string" && c.content) {
				chunks.push(c.content);
			}
		}

		// Should have received all 2 chunks without timing out
		expect(chunks).toEqual(["chunk-1", "chunk-2"]);
	});

});

// ---------------------------------------------------------------------------
// summarize() timeout behavior
// ---------------------------------------------------------------------------

describe("summarize() timeout", () => {
	test("marks session closed on Session not found", async () => {
		const notFoundSession = createMockSdkSession("notfound-summarize-1", {
			sendAndWait: mock(() => Promise.reject(new Error("Session not found"))),
		});

		const args = buildWrappedSessionArgs(notFoundSession);
		const session = createWrappedCopilotSession(args as never);

		await expect(session.summarize()).rejects.toThrow("session is closed");

		// Subsequent operations should fail fast
		await expect(session.send("hello")).rejects.toThrow("session is closed");
	});
});
