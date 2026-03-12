import type { BusEvent } from "@/services/events/bus-events.ts";
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

export async function runOpenCodeStreamingRuntime(args: {
  cleanupOrphanedTools: (runId: number) => void;
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
  session: Session;
  sessionId: string;
}): Promise<void> {
  const {
    cleanupOrphanedTools,
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
    session,
    sessionId,
  } = args;
  const { abortSignal, agent, messageId, runId, skillCommand } = options;

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
        const handleAbort = () => safeResolve({ reason: "aborted" });

        const onIdle = providerClient.onProviderEvent((event) => {
          if (event.type !== "session.idle" || event.sessionId !== sessionId) {
            return;
          }
          safeResolve({ reason: event.data.reason ?? "idle" });
        });
        pushUnsubscriber(onIdle);

        const onError = providerClient.onProviderEvent((event) => {
          if (event.type !== "session.error" || event.sessionId !== sessionId) {
            return;
          }
          safeResolve({ error: event.data.error, reason: "error" });
        });
        pushUnsubscriber(onError);

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
      });

      const adapterAbortSignal = getAbortController()?.signal;
      const dispatchAbortSignal = adapterAbortSignal && abortSignal
        ? AbortSignal.any([adapterAbortSignal, abortSignal])
        : adapterAbortSignal ?? abortSignal;

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

      if (getTextAccumulator().length > 0) {
        publishTextComplete(runId, messageId);
      }

      if (completion.error) {
        publishSessionError(runId, new Error(completion.error));
      }

      cleanupOrphanedTools(runId);
      publishSessionIdle(runId, completion.reason);
      return;
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES; attempt += 1) {
      try {
        const stream = session.stream(message, agent ? { agent } : undefined);
        for await (const chunk of stream) {
          if (getAbortController()?.signal.aborted) {
            break;
          }
          await processStreamChunk(chunk, runId, messageId);
        }

        if (getTextAccumulator().length > 0) {
          publishTextComplete(runId, messageId);
        }
        cleanupOrphanedTools(runId);
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

        const delay = computeDelay(attempt, classified);
        publishToBus({
          type: "stream.session.retry",
          sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            attempt,
            delay,
            message: `${classified.message} — retrying in ${Math.ceil(delay / 1000)}s`,
            nextRetryAt: Date.now() + delay,
          },
        });

        await retrySleep(delay, getAbortController()?.signal ?? new AbortController().signal);
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
    publishSessionIdle(runId, "error");
  } finally {
    cleanupOrphanedTools(runId);
  }
}
