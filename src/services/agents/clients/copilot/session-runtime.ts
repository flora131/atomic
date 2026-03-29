import type {
	CopilotSession as SdkCopilotSession,
	SessionEvent as SdkSessionEvent,
} from "@github/copilot-sdk";
import {
	type CopilotSessionState,
	RECENT_EVENT_ID_WINDOW,
} from "@/services/agents/clients/copilot/types.ts";
import type {
	ProviderStreamEventDataMap,
	ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import {
	STREAM_STALE_TIMEOUT_MS,
	StaleStreamError,
	withSendTimeout,
} from "@/services/agents/clients/send-timeout.ts";
import type {
	AgentMessage,
	ContextUsage,
	EventType,
	Session,
	SessionConfig,
} from "@/services/agents/types.ts";

export function createAbortError(
	message = "The operation was aborted.",
): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

function isSessionNotFoundError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Session not found");
}

export function subscribeCopilotSessionEvents(args: {
	sessionId: string;
	sdkSession: SdkCopilotSession;
	sessions: Map<string, CopilotSessionState>;
	handleSdkEvent: (sessionId: string, event: SdkSessionEvent) => void;
}): () => void {
	return args.sdkSession.on((event: SdkSessionEvent) => {
		const activeState = args.sessions.get(args.sessionId);
		if (activeState && activeState.sdkSession !== args.sdkSession) {
			return;
		}
		args.handleSdkEvent(args.sessionId, event);
	});
}

export function isDuplicateCopilotSdkEvent(
	state: CopilotSessionState,
	event: SdkSessionEvent,
): boolean {
	const id = (event as { id?: string }).id;
	if (!id) {
		return false;
	}

	if (state.recentEventIds.has(id)) {
		return true;
	}

	state.recentEventIds.add(id);
	state.recentEventOrder.push(id);

	if (state.recentEventOrder.length > RECENT_EVENT_ID_WINDOW) {
		const evicted = state.recentEventOrder.shift();
		if (evicted) {
			state.recentEventIds.delete(evicted);
		}
	}
	return false;
}

export function createWrappedCopilotSession(args: {
	sdkSession: SdkCopilotSession;
	config: SessionConfig;
	sessions: Map<string, CopilotSessionState>;
	subscribeSessionEvents: (
		sessionId: string,
		sdkSession: SdkCopilotSession,
	) => () => void;
	emitEvent: <T extends EventType>(
		eventType: T,
		sessionId: string,
		data: Record<string, unknown>,
	) => void;
	emitProviderEvent: <T extends ProviderStreamEventType>(
		eventType: T,
		sessionId: string,
		data: ProviderStreamEventDataMap[T],
		options?: {
			native?: SdkSessionEvent;
			nativeEventId?: string;
			nativeSessionId?: string;
			nativeParentEventId?: string;
			timestamp?: number;
		},
	) => void;
	extractErrorMessage: (error: unknown) => string;
}): Session {
	const sessionId = args.sdkSession.sessionId;
	const unsubscribe = args.subscribeSessionEvents(sessionId, args.sdkSession);

	const state: CopilotSessionState = {
		sdkSession: args.sdkSession,
		sessionId,
		config: args.config,
		inputTokens: 0,
		outputTokens: 0,
		isClosed: false,
		unsubscribe,
		recentEventIds: new Set(),
		recentEventOrder: [],
		toolCallIdToName: new Map(),
		toolCallIdToSubagentName: new Map(),
		backgroundAgentIdToToolCallId: new Map(),
		contextWindow: null,
		systemToolsBaseline: null,
		pendingAbortPromise: null,
	};

	const waitForPendingAbort = async (): Promise<void> => {
		const pendingAbort = state.pendingAbortPromise;
		if (!pendingAbort) {
			return;
		}
		try {
			await pendingAbort;
		} catch {
			// If abort fails, do not block subsequent turns.
		}
	};

	const runAbortWithLock = (): Promise<void> => {
		if (state.pendingAbortPromise) {
			return state.pendingAbortPromise;
		}

		const abortPromise = state.sdkSession.abort().catch((error: unknown) => {
			// Session may already have been torn down; suppress the error.
			if (isSessionNotFoundError(error)) {
				return;
			}
			throw error;
		});
		state.pendingAbortPromise = abortPromise;
		void abortPromise
			.finally(() => {
				if (state.pendingAbortPromise === abortPromise) {
					state.pendingAbortPromise = null;
				}
			})
			.catch(() => {
				// Swallow errors from the finally-chain to avoid unhandled rejections.
			});

		return abortPromise;
	};

	args.sessions.set(sessionId, state);
	args.emitEvent("session.start", sessionId, { config: args.config });
	args.emitProviderEvent(
		"session.start",
		sessionId,
		{ config: args.config },
		{
			nativeSessionId: sessionId,
		},
	);

	return {
		id: sessionId,

		send: async (message: string): Promise<AgentMessage> => {
			if (state.isClosed) {
				throw new Error("session expired: session is closed");
			}

			await waitForPendingAbort();

			try {
				const response = await withSendTimeout(
					state.sdkSession.sendAndWait({ prompt: message }),
				);
				return {
					type: "text",
					content: response?.data.content ?? "",
					role: "assistant",
				};
			} catch (error) {
				if (isSessionNotFoundError(error)) {
					state.isClosed = true;
				}
				throw new Error(args.extractErrorMessage(error));
			}
		},

		stream: (
			message: string,
			options?: { agent?: string; abortSignal?: AbortSignal },
		): AsyncIterable<AgentMessage> => {
			return {
				[Symbol.asyncIterator]: async function* () {
					if (state.isClosed) {
						throw new Error("session expired: session is closed");
					}

					await waitForPendingAbort();

					if (options?.abortSignal?.aborted) {
						throw createAbortError();
					}

					const chunks: AgentMessage[] = [];
					let resolveChunk: (() => void) | null = null;
					let done = false;
					let aborted = false;
					let streamTimedOut = false;
					let hasYieldedDeltas = false;

					const notifyConsumer = () => {
						if (resolveChunk) {
							const resolve = resolveChunk;
							resolveChunk = null;
							resolve();
						}
					};

					const abortListener = () => {
						aborted = true;
						done = true;
						notifyConsumer();
					};

					// -----------------------------------------------------------------
					// Stale-stream detection: if no SDK events arrive for
					// STREAM_STALE_TIMEOUT_MS after the initial send, the session is
					// likely dead.  The timer resets on every received event.
					// -----------------------------------------------------------------
					let staleTimer: ReturnType<typeof setTimeout> | null = null;
					const clearStaleTimer = () => {
						if (staleTimer !== null) {
							clearTimeout(staleTimer);
							staleTimer = null;
						}
					};
					const resetStaleTimer = () => {
						clearStaleTimer();
						staleTimer = setTimeout(() => {
							streamTimedOut = true;
							done = true;
							notifyConsumer();
						}, STREAM_STALE_TIMEOUT_MS);
					};

					let reasoningStartMs: number | null = null;
					let reasoningDurationMs = 0;
					let streamingOutputTokens = 0;

					const eventHandler = (event: SdkSessionEvent) => {
						// Any event from the server means the session is alive —
						// reset the stale-stream timer.
						resetStaleTimer();

						if (event.type === "assistant.message_delta") {
							const deltaData = event.data as Record<string, unknown>;
							if (deltaData.parentToolCallId) {
								return;
							}

							if (reasoningStartMs !== null) {
								reasoningDurationMs += Date.now() - reasoningStartMs;
								reasoningStartMs = null;
							}
							hasYieldedDeltas = true;
							chunks.push({
								type: "text",
								content: event.data.deltaContent,
								role: "assistant",
							});
							notifyConsumer();
							return;
						}

						if (event.type === "assistant.reasoning_delta") {
							if (reasoningStartMs === null) {
								reasoningStartMs = Date.now();
							}
							hasYieldedDeltas = true;
							chunks.push({
								type: "thinking",
								content: event.data.deltaContent,
								role: "assistant",
								metadata: {
									provider: "copilot",
									thinkingSourceKey: event.data.reasoningId,
									streamingStats: {
										thinkingMs:
											reasoningDurationMs + (Date.now() - reasoningStartMs),
										outputTokens: 0,
									},
								},
							});
							notifyConsumer();
							return;
						}

						if (event.type === "assistant.usage") {
							if (reasoningStartMs !== null) {
								reasoningDurationMs += Date.now() - reasoningStartMs;
								reasoningStartMs = null;
							}
							streamingOutputTokens += event.data.outputTokens ?? 0;
							chunks.push({
								type: "text",
								content: "",
								role: "assistant",
								metadata: {
									streamingStats: {
										outputTokens: streamingOutputTokens,
										thinkingMs: reasoningDurationMs,
									},
								},
							});
							notifyConsumer();
							return;
						}

						if (event.type === "assistant.message") {
							const messageData = event.data as Record<string, unknown>;
							if (messageData.parentToolCallId) {
								return;
							}
							if (!hasYieldedDeltas) {
								chunks.push({
									type: "text",
									content: event.data.content,
									role: "assistant",
									metadata: {
										messageId: event.data.messageId,
									},
								});
								notifyConsumer();
							}
							return;
						}

						if (event.type === "tool.execution_start") {
							const d = event.data as Record<string, unknown>;
							const toolName =
								(d.toolName as string) ??
								(d.mcpToolName as string) ??
								"unknown";
							chunks.push({
								type: "tool_use",
								content: {
									name: toolName,
									id: d.toolCallId,
									input: d.arguments,
								},
								role: "assistant",
								metadata: {
									toolId: d.toolCallId as string,
									toolName,
								},
							} as AgentMessage);
							notifyConsumer();
							return;
						}

						if (event.type === "tool.execution_complete") {
							const d = event.data as Record<string, unknown>;
							const toolName =
								(d.toolName as string) ??
								(d.mcpToolName as string) ??
								"unknown";
							chunks.push({
								type: "tool_result",
								content: d.result,
								role: "assistant",
								tool_use_id: d.toolCallId,
								toolName,
								is_error: d.success === false,
								metadata: {
									toolId: d.toolCallId as string,
									toolName,
								},
							} as unknown as AgentMessage);
							notifyConsumer();
							return;
						}

						if (event.type === "session.idle") {
							done = true;
							notifyConsumer();
						}
					};

					const unsub = state.sdkSession.on(eventHandler);

					options?.abortSignal?.addEventListener("abort", abortListener, {
						once: true,
					});

					try {
						await withSendTimeout(state.sdkSession.send({ prompt: message }));

						// Start the stale-stream timer now that send succeeded.
						resetStaleTimer();

						while ((!done || chunks.length > 0) && !aborted) {
							if (chunks.length > 0) {
								yield chunks.shift()!;
							} else if (!done) {
								await new Promise<void>((resolve) => {
									resolveChunk = resolve;
									if (done || chunks.length > 0) {
										resolveChunk = null;
										resolve();
									}
								});
							}
						}

						if (aborted) {
							throw createAbortError();
						}

						if (streamTimedOut) {
							throw new StaleStreamError(STREAM_STALE_TIMEOUT_MS);
						}
					} catch (sendError) {
						if (isSessionNotFoundError(sendError)) {
							state.isClosed = true;
							throw createAbortError("Session was closed during send.");
						}
						// Preserve StaleStreamError type so adapter-level retry/resume
						// logic can detect it (via instanceof or isRetryable) and
						// transparently recover with resumeSession() instead of
						// escalating a fatal session-expired error.
						if (sendError instanceof StaleStreamError) {
							throw sendError;
						}
						throw new Error(args.extractErrorMessage(sendError));
					} finally {
						unsub();
						clearStaleTimer();
						options?.abortSignal?.removeEventListener("abort", abortListener);
					}
				},
			};
		},

		summarize: async (): Promise<void> => {
			if (state.isClosed) {
				throw new Error("session expired: session is closed");
			}

			await waitForPendingAbort();

			try {
				await withSendTimeout(
					state.sdkSession.sendAndWait({ prompt: "/compact" }),
				);
			} catch (error) {
				if (isSessionNotFoundError(error)) {
					state.isClosed = true;
					throw new Error("session expired: session is closed");
				}
				throw error;
			}
		},

		getContextUsage: async (): Promise<ContextUsage> => {
			if (state.contextWindow === null) {
				throw new Error(
					"Context window size unavailable: listModels() did not return model limits.",
				);
			}

			const maxTokens = state.contextWindow;
			return {
				inputTokens: state.inputTokens,
				outputTokens: state.outputTokens,
				maxTokens,
				usagePercentage:
					((state.inputTokens + state.outputTokens) / maxTokens) * 100,
			};
		},

		destroy: async (): Promise<void> => {
			if (!state.isClosed) {
				state.isClosed = true;
				state.unsubscribe();
				try {
					await state.sdkSession.destroy();
				} catch (error) {
					// Session may already have been torn down during abort/cancel.
					if (!isSessionNotFoundError(error)) {
						throw error;
					}
				}
				args.sessions.delete(sessionId);
				args.emitEvent("session.idle", sessionId, { reason: "destroyed" });
				args.emitProviderEvent(
					"session.idle",
					sessionId,
					{ reason: "destroyed" },
					{
						nativeSessionId: sessionId,
					},
				);
			}
		},

		abort: async (): Promise<void> => {
			await runAbortWithLock();
		},

		abortBackgroundAgents: async (): Promise<void> => {
			await runAbortWithLock();
		},

		getSystemToolsTokens: (): number => {
			if (state.systemToolsBaseline === null) {
				throw new Error(
					"System tools baseline unavailable: no session.usage_info received yet.",
				);
			}
			return state.systemToolsBaseline;
		},
	};
}
