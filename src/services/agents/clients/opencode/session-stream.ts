import {
	AUTO_COMPACTION_THRESHOLD,
	OpenCodeCompactionError,
	computeCompactionThresholdPercent,
	setCompactionControlState,
} from "@/services/agents/clients/opencode/compaction.ts";
import type { OpenCodeResolvedPromptModel } from "@/services/agents/clients/opencode/model.ts";
import { buildOpenCodePromptParts } from "@/services/agents/clients/opencode/prompt.ts";
import type { OpenCodeSessionRuntimeArgs } from "@/services/agents/clients/opencode/session-runtime-types.ts";
import { createOpenCodeSessionStreamController } from "@/services/agents/clients/opencode/session-stream-controller.ts";
import { createOpenCodeSessionStreamEventHandlers } from "@/services/agents/clients/opencode/session-stream-event-handlers.ts";
import {
	extractOpenCodeErrorMessage,
	isContextOverflowError,
	type OpenCodeSessionState,
} from "@/services/agents/clients/opencode/shared.ts";
import {
	STREAM_STALE_TIMEOUT_MS,
	StaleStreamError,
} from "@/services/agents/clients/send-timeout.ts";
import type { AgentMessage } from "@/services/agents/types.ts";

export function createOpenCodeSessionStream(args: {
	runtimeArgs: OpenCodeSessionRuntimeArgs;
	sessionState: OpenCodeSessionState;
	agentMode: string;
	initialPromptModel: OpenCodeResolvedPromptModel | undefined;
	message: string;
	options?: { agent?: string; abortSignal?: AbortSignal };
	summarize: () => Promise<void>;
}): AsyncIterable<AgentMessage> {
	return {
		async *[Symbol.asyncIterator]() {
			if (args.sessionState.isClosed) {
				throw new Error("Session is closed");
			}
			const sdkClient = args.runtimeArgs.getSdkClient();
			if (!sdkClient) {
				throw new Error("Client not connected");
			}

			args.sessionState.compaction.hasAutoCompacted = false;
			args.sessionState.compaction.pendingCompactionComplete = false;
			setCompactionControlState(args.sessionState, "stream.start");

			const streamAbortSignal = args.options?.abortSignal;
			const isSubagentDispatch =
				typeof args.options?.agent === "string" &&
				args.options.agent.trim().length > 0;
			const controller = createOpenCodeSessionStreamController({
				sessionId: args.runtimeArgs.sessionId,
				isSubagentDispatch,
			});

			if (streamAbortSignal?.aborted) {
				controller.handleStreamAbort();
			} else if (streamAbortSignal) {
				streamAbortSignal.addEventListener(
					"abort",
					controller.handleStreamAbort,
					{ once: true },
				);
			}

			const isStreamAbortError = (error: unknown): boolean => {
				if (streamAbortSignal?.aborted) {
					return true;
				}
				if (error instanceof DOMException && error.name === "AbortError") {
					return true;
				}
				if (!(error instanceof Error)) {
					return false;
				}
				const errorWithCode = error as Error & { code?: string };
				if (
					error.name === "AbortError" ||
					errorWithCode.code === "ABORT_ERR" ||
					errorWithCode.code === "ERR_CANCELED"
				) {
					return true;
				}
				return error.message.toLowerCase().includes("aborted");
			};

			const {
				handleDelta,
				handleSubagentStart,
				handleSubagentUpdate,
				handleSubagentComplete,
				handleToolStart,
				handleToolComplete,
				handleIdle,
				handleError,
				handleUsage,
			} = createOpenCodeSessionStreamEventHandlers({
				controller,
				runtimeArgs: args.runtimeArgs,
				sessionState: args.sessionState,
				isSubagentDispatch,
			});

			// ---------------------------------------------------------------
			// Stale-stream detection: if no events arrive for
			// STREAM_STALE_TIMEOUT_MS after the prompt is dispatched, the
			// session is likely dead.  The timer resets on every yielded chunk.
			// ---------------------------------------------------------------
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
					controller.setStreamError(
						new StaleStreamError(STREAM_STALE_TIMEOUT_MS),
					);
					controller.markStreamDone();
				}, STREAM_STALE_TIMEOUT_MS);
			};

			const unsubDelta = args.runtimeArgs.on("message.delta", handleDelta);
			const unsubSubagentStart = isSubagentDispatch
				? args.runtimeArgs.on("subagent.start", handleSubagentStart)
				: () => {};
			const unsubSubagentUpdate = isSubagentDispatch
				? args.runtimeArgs.on("subagent.update", handleSubagentUpdate)
				: () => {};
			const unsubSubagentComplete = isSubagentDispatch
				? args.runtimeArgs.on("subagent.complete", handleSubagentComplete)
				: () => {};
			const unsubToolStart = isSubagentDispatch
				? args.runtimeArgs.on("tool.start", handleToolStart)
				: () => {};
			const unsubToolComplete = isSubagentDispatch
				? args.runtimeArgs.on("tool.complete", handleToolComplete)
				: () => {};
			const unsubIdle = args.runtimeArgs.on("session.idle", handleIdle);
			const unsubError = args.runtimeArgs.on("session.error", handleError);
			const unsubUsage = args.runtimeArgs.on("usage", handleUsage);

			const dispatchStreamPrompt = async (
				promptMessage: string,
			): Promise<void> => {
				controller.setPromptInFlight(true);
				try {
					const result = await sdkClient.session.promptAsync(
						{
							sessionID: args.runtimeArgs.sessionId,
							directory: args.runtimeArgs.directory,
							agent: args.agentMode,
							model:
								args.runtimeArgs.getActivePromptModel() ??
								args.initialPromptModel,
							variant: args.runtimeArgs.getActiveReasoningEffort(),
							...(args.runtimeArgs.config.systemPrompt
								? { system: args.runtimeArgs.config.systemPrompt }
								: {}),
							parts: buildOpenCodePromptParts(
								promptMessage,
								args.options?.agent,
								args.runtimeArgs.config.systemPrompt
									? undefined
									: args.runtimeArgs.config.additionalInstructions,
							),
						},
						streamAbortSignal ? { signal: streamAbortSignal } : undefined,
					);

					if (result?.error) {
						controller.setStreamError(
							new Error(extractOpenCodeErrorMessage(result.error)),
						);
						controller.markStreamDone();
					}
				} catch (error: unknown) {
					if (isStreamAbortError(error)) {
						controller.markStreamDone();
						controller.markTerminalEventSeen();
						return;
					}
					controller.setStreamError(
						error instanceof Error ? error : new Error(String(error)),
					);
					controller.markStreamDone();
				} finally {
					controller.setPromptInFlight(false);
				}
			};

			try {
				let reasoningStartMs: number | null = null;
				let reasoningDurationMs = 0;

				if (!streamAbortSignal?.aborted) {
					void dispatchStreamPrompt(args.message);
					resetStaleTimer();
				}

				while (true) {
					while (!controller.isStreamDone() || controller.hasQueuedDelta()) {
						if (streamAbortSignal?.aborted) {
							controller.markStreamDone();
							break;
						}

						const msg = controller.dequeueDelta();
						if (msg) {
							resetStaleTimer();
							if (msg.type === "thinking") {
								if (reasoningStartMs === null) {
									reasoningStartMs = Date.now();
								}
								const currentMs =
									reasoningDurationMs + (Date.now() - reasoningStartMs);
								const existingMetadata = (msg.metadata ?? {}) as Record<
									string,
									unknown
								>;
								msg.metadata = {
									...existingMetadata,
									streamingStats: { thinkingMs: currentMs, outputTokens: 0 },
								};
							} else if (reasoningStartMs !== null) {
								reasoningDurationMs += Date.now() - reasoningStartMs;
								reasoningStartMs = null;
							}
							yield msg;
							continue;
						}

						if (controller.isStreamDone()) {
							break;
						}

						if (controller.shouldAutoCompleteTerminalWait()) {
							controller.markStreamDone();
							break;
						}

						await controller.waitForStreamSignal();
					}

					if (streamAbortSignal?.aborted) {
						clearStaleTimer();
						break;
					}

					const streamError = controller.getStreamError();
					if (!streamError) {
						const maxTokens =
							args.runtimeArgs.getActiveContextWindow() ??
							args.sessionState.contextWindow;
						const usagePercentage =
							maxTokens && maxTokens > 0
								? ((args.sessionState.inputTokens +
										args.sessionState.outputTokens) /
										maxTokens) *
									100
								: 0;
						const effectiveThresholdPercent = maxTokens && maxTokens > 0
							? computeCompactionThresholdPercent(maxTokens)
							: AUTO_COMPACTION_THRESHOLD * 100;
						const shouldAttemptProactiveCompaction =
							!isSubagentDispatch &&
							usagePercentage >= effectiveThresholdPercent &&
							!args.sessionState.compaction.isCompacting &&
							args.sessionState.compaction.control.state === "STREAMING" &&
							!args.sessionState.compaction.hasAutoCompacted;

						if (!shouldAttemptProactiveCompaction) {
							clearStaleTimer();
							break;
						}

						args.runtimeArgs.debugLog("compaction.proactive_trigger", {
							sessionId: args.runtimeArgs.sessionId,
							trigger: "threshold",
							thresholdPercentage: effectiveThresholdPercent,
							usagePercentage,
							inputTokens: args.sessionState.inputTokens,
							outputTokens: args.sessionState.outputTokens,
							contextWindow: maxTokens ?? 0,
						});
						args.sessionState.compaction.hasAutoCompacted = true;
						await args.summarize();
						break;
					}

					if (reasoningStartMs !== null) {
						reasoningDurationMs += Date.now() - reasoningStartMs;
						reasoningStartMs = null;
					}

					const shouldAttemptAutoCompaction =
						isContextOverflowError(streamError) &&
						!args.sessionState.compaction.isCompacting &&
						args.sessionState.compaction.control.state === "STREAMING" &&
						!args.sessionState.compaction.hasAutoCompacted;

					if (!shouldAttemptAutoCompaction) {
						throw streamError;
					}

					args.runtimeArgs.debugLog("compaction.overflow_trigger", {
						sessionId: args.runtimeArgs.sessionId,
						trigger: "overflow",
						thresholdPercentage: AUTO_COMPACTION_THRESHOLD * 100,
						inputTokens: args.sessionState.inputTokens,
						outputTokens: args.sessionState.outputTokens,
						contextWindow: args.sessionState.contextWindow ?? 0,
						error: extractOpenCodeErrorMessage(streamError),
					});
					args.sessionState.compaction.hasAutoCompacted = true;

					await args.summarize();

					controller.clearQueuedDeltas();
					controller.resetStreamTerminalState();
					if (streamAbortSignal?.aborted) {
						clearStaleTimer();
						break;
					}
					void dispatchStreamPrompt("Continue");
					resetStaleTimer();
				}
			} catch (error) {
				if (error instanceof OpenCodeCompactionError) {
					setCompactionControlState(args.sessionState, "turn.ended");
					throw error;
				}
				throw new Error(extractOpenCodeErrorMessage(error));
			} finally {
				clearStaleTimer();
				controller.clearSettleWaitTimer();
				if (streamAbortSignal) {
					streamAbortSignal.removeEventListener(
						"abort",
						controller.handleStreamAbort,
					);
				}
				unsubDelta();
				unsubSubagentStart();
				unsubSubagentUpdate();
				unsubSubagentComplete();
				unsubToolStart();
				unsubToolComplete();
				unsubIdle();
				unsubError();
				unsubUsage();
			}
		},
	};
}
