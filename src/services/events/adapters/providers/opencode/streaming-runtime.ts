import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { StreamAdapterOptions } from "@/services/events/adapters/types.ts";
import type {
  CodingAgentClient,
  Session,
  AgentMessage,
} from "@/services/agents/types.ts";
import type { OpenCodeProviderEventSource } from "@/services/agents/provider-events.ts";
import {
  classifyError,
  computeDelay,
  DEFAULT_MAX_RETRIES,
  retrySleep,
} from "@/services/events/adapters/retry.ts";
import { createStaleStreamWatchdog, StaleStreamError, DEFAULT_FOREGROUND_STALE_TIMEOUT_MS } from "@/services/events/adapters/stale-stream-watchdog.ts";

export async function runOpenCodeStreamingRuntime(args: {
  cleanupOrphanedTools: (runId: number) => void;
  flushOrphanedAgentCompletions: (runId: number) => void;
  getAbortController: () => AbortController | null;
  getTextAccumulator: () => string;
  message: string;
  options: StreamAdapterOptions;
  processStreamChunk: (
    chunk: AgentMessage,
    runId: number,
    messageId: string,
  ) => Promise<void> | void;
  providerClient: CodingAgentClient & OpenCodeProviderEventSource;
  publishSessionError: (runId: number, error: unknown) => void;
  publishSessionIdle: (runId: number, reason: string) => void;
  publishTextComplete: (runId: number, messageId: string) => void;
  publishToBus: (event: BusEvent<"stream.session.retry">) => void;
  pushUnsubscriber: (unsubscriber: () => void) => void;
  resumeSession: () => Promise<Session | null>;
  session: Session;
  sessionId: string;
}): Promise<void> {
  const {
    cleanupOrphanedTools,
    flushOrphanedAgentCompletions,
    getAbortController,
    getTextAccumulator,
    message,
    options,
    processStreamChunk,
    providerClient,
    publishSessionError,
    publishSessionIdle,
    publishTextComplete,
    publishToBus,
    pushUnsubscriber,
    resumeSession,
    sessionId,
  } = args;
  let { session } = args;
  const { abortSignal, agent, messageId, runId, skillCommand } = options;

  // Stale stream watchdog: on timeout, abort only the current stream
  // attempt (not the adapter controller) so the retry loop can silently
  // resume the same session. Modeled after OpenCode's SessionProcessor
  // retry pattern — the user never sees an error.
  let staleAbort: AbortController | null = null;
  const watchdog = createStaleStreamWatchdog({
    onStale: () => {
      staleAbort?.abort();
    },
  });

  try {
    if (session.sendAsync) {
      const completionPromise = new Promise<{ error?: string; reason: string }>((resolve) => {
        let resolved = false;
        const safeResolve = (value: { error?: string; reason: string }) => {
          if (resolved) {
            return;
          }
          resolved = true;
          resolve(value);
        };
        const handleAbort = () => {
          safeResolve({ reason: watchdog.hasFired ? "stale" : "aborted" });
        };

        const onIdle = providerClient.onProviderEvent((event) => {
          if (event.type !== "session.idle" || event.sessionId !== sessionId) {
            return;
          }
          watchdog.kick();
          safeResolve({ reason: event.data.reason ?? "idle" });
        });
        pushUnsubscriber(onIdle);

        const onError = providerClient.onProviderEvent((event) => {
          if (event.type !== "session.error" || event.sessionId !== sessionId) {
            return;
          }
          watchdog.kick();
          safeResolve({ error: event.data.error, reason: "error" });
        });
        pushUnsubscriber(onError);

        // Kick watchdog on any provider event for this session
        const onActivity = providerClient.onProviderEvent((event) => {
          if (event.sessionId !== sessionId) {
            return;
          }
          watchdog.kick();
        });
        pushUnsubscriber(onActivity);

        const adapterAbortSignal = getAbortController()?.signal;
        if (adapterAbortSignal) {
          if (adapterAbortSignal.aborted) {
            handleAbort();
          } else {
            adapterAbortSignal.addEventListener("abort", handleAbort, { once: true });
            pushUnsubscriber(
              () => adapterAbortSignal.removeEventListener("abort", handleAbort),
            );
          }
        }

        if (abortSignal) {
          if (abortSignal.aborted) {
            handleAbort();
          } else {
            abortSignal.addEventListener("abort", handleAbort, { once: true });
            pushUnsubscriber(() => abortSignal.removeEventListener("abort", handleAbort));
          }
        }

        // Initialize staleAbort for the sendAsync path so the watchdog's
        // onStale callback can abort it and wake the completionPromise.
        // Without this, staleAbort stays null and the 5-minute watchdog
        // fires into the void — leaving completionPromise hung forever
        // when SSE events are missed during a reconnect window.
        staleAbort = new AbortController();
        staleAbort.signal.addEventListener("abort", handleAbort, { once: true });
        pushUnsubscriber(
          () => staleAbort?.signal.removeEventListener("abort", handleAbort),
        );
      });

      const adapterAbortSignal = getAbortController()?.signal;
      // Include staleAbort so a hung HTTP POST (stale TCP connection after
      // extended idle) gets cancelled when the 5-minute watchdog fires.
      // Without this, `await session.sendAsync()` blocks forever and the
      // already-resolved completionPromise is never reached.
      // NOTE: staleAbort is assigned synchronously inside the Promise
      // constructor above, but TypeScript's control flow can't track that.
      const staleSignal = (staleAbort as AbortController | null)?.signal;
      const dispatchSignals = [adapterAbortSignal, abortSignal, staleSignal].filter(
        (s): s is AbortSignal => s != null,
      );
      const dispatchAbortSignal = dispatchSignals.length > 0
        ? AbortSignal.any(dispatchSignals)
        : undefined;

      const isDispatchAbortError = (error: unknown): boolean => {
        if (dispatchAbortSignal?.aborted) {
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
          error.name === "AbortError"
          || errorWithCode.code === "ABORT_ERR"
          || errorWithCode.code === "ERR_CANCELED"
        ) {
          return true;
        }
        return error.message.toLowerCase().includes("aborted");
      };

      const dispatchOptions = agent || dispatchAbortSignal
        ? { agent: agent ?? undefined, abortSignal: dispatchAbortSignal }
        : undefined;

      watchdog.start();

      try {
        if (skillCommand) {
          await session.command!(skillCommand.name, skillCommand.args, dispatchOptions);
        } else {
          await session.sendAsync(message, dispatchOptions);
        }
      } catch (error) {
        if (!isDispatchAbortError(error)) {
          throw error;
        }
      }

      const completion = await completionPromise;

      // Stale detection: silently use SDK resume to get a fresh session
      // handle, then re-dispatch. No UI indicators — invisible to the user.
      if (completion.reason === "stale") {
        watchdog.reset();

        const retryDelay = computeDelay(1);
        await retrySleep(retryDelay, getAbortController()?.signal ?? new AbortController().signal).catch(() => {});

        if (!getAbortController()?.signal.aborted) {
          const resumed = await resumeSession();
          if (resumed) {
            session = resumed;
            watchdog.start();
            try {
              if (resumed.sendAsync) {
                await resumed.sendAsync("Continue", dispatchOptions);
              } else {
                // Fall back to iterator path on resumed session
                const stream = resumed.stream("Continue", agent ? { agent } : undefined);
                for await (const chunk of stream) {
                  watchdog.kick();
                  if (getAbortController()?.signal.aborted) break;
                  await processStreamChunk(chunk, runId, messageId);
                }
              }
            } catch (error) {
              if (!getAbortController()?.signal.aborted) {
                publishSessionError(runId, error);
              }
            }
            const resumeCompletion = await completionPromise;
            if (getTextAccumulator().length > 0) {
              publishTextComplete(runId, messageId);
            }
            if (resumeCompletion.error) {
              publishSessionError(runId, new Error(resumeCompletion.error));
            }
            cleanupOrphanedTools(runId);
            flushOrphanedAgentCompletions(runId);
            publishSessionIdle(runId, resumeCompletion.reason);
            return;
          }
        }
      }

      if (getTextAccumulator().length > 0) {
        publishTextComplete(runId, messageId);
      }

      if (completion.error) {
        publishSessionError(runId, new Error(completion.error));
      }

      cleanupOrphanedTools(runId);
      flushOrphanedAgentCompletions(runId);
      publishSessionIdle(runId, completion.reason);
      return;
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES; attempt += 1) {
      try {
        // Per-attempt abort controller for watchdog — does not touch the
        // adapter's controller so the retry loop can continue.
        staleAbort = new AbortController();
        const attemptSignal = getAbortController()?.signal;
        if (attemptSignal?.aborted) break;

        const stream = session.stream(message, agent ? { agent } : undefined);
        watchdog.start();
        for await (const chunk of stream) {
          watchdog.kick();
          if (attemptSignal?.aborted) {
            break;
          }
          if (staleAbort.signal.aborted) {
            throw new StaleStreamError(DEFAULT_FOREGROUND_STALE_TIMEOUT_MS);
          }
          await processStreamChunk(chunk, runId, messageId);
        }

        // Check if watchdog fired after the stream naturally ended
        if (staleAbort.signal.aborted) {
          throw new StaleStreamError(DEFAULT_FOREGROUND_STALE_TIMEOUT_MS);
        }

        if (getTextAccumulator().length > 0) {
          publishTextComplete(runId, messageId);
        }
        cleanupOrphanedTools(runId);
        flushOrphanedAgentCompletions(runId);
        publishSessionIdle(runId, "generator-complete");
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (getAbortController()?.signal.aborted) {
          break;
        }

        const classified = classifyError(error);
        if (!classified.isRetryable || attempt >= DEFAULT_MAX_RETRIES) {
          break;
        }

        watchdog.reset();

        const isStale = error instanceof StaleStreamError;
        const delay = computeDelay(attempt, classified);

        // Only publish retry indicator for non-stale errors (rate limits, etc.)
        // Stale recovery is invisible to the user.
        if (!isStale) {
          publishToBus({
            type: "stream.session.retry",
            sessionId,
            runId,
            timestamp: Date.now(),
            data: {
              attempt,
              delay,
              message: classified.message,
              nextRetryAt: Date.now() + delay,
            },
          });
        }

        await retrySleep(delay, getAbortController()?.signal ?? new AbortController().signal);

        // Use SDK resume to get a fresh session handle
        if (isStale) {
          const resumed = await resumeSession();
          if (resumed) {
            session = resumed;
          }
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
  } catch (error) {
    if (!getAbortController()?.signal.aborted) {
      publishSessionError(runId, error);
    }
    cleanupOrphanedTools(runId);
    flushOrphanedAgentCompletions(runId);
    publishSessionIdle(runId, "error");
  } finally {
    watchdog.dispose();
    cleanupOrphanedTools(runId);
    flushOrphanedAgentCompletions(runId);
  }
}
